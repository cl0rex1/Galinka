import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID, randomBytes, createECDH } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { deliverPushJob, type PushTransports } from '../server/push.js';
import { digest } from '../server/security.js';

const database = process.env.TEST_DATABASE_URL;
test(
  'Web Push: authenticated subscriptions, private delivery, retries and revocation against PostgreSQL',
  {
    skip: !database,
    timeout: 60000,
  },
  async () => {
    // A private schema also prevents any other test server/worker claiming these jobs.
    const schema = 'push_' + randomUUID().replaceAll('-', '');
    const admin = new Pool({ connectionString: database });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const connection = new URL(database!);
    connection.searchParams.set('options', `-c search_path=${schema}`);
    const db = new Pool({ connectionString: connection.href, max: 20 });
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-push-'));
    const base = 'http://localhost:3021';
    const curve = createECDH('prime256v1');
    curve.generateKeys();
    const keys = {
      p256dh: curve.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    };
    let server: ChildProcess | undefined;
    let logs = '';
    async function stopServer() {
      if (!server || server.exitCode !== null || server.signalCode !== null) return;
      const exited = new Promise((resolve) => server!.once('exit', resolve));
      server.kill('SIGTERM');
      await exited;
    }
    async function request(route: string, method = 'GET', body?: unknown, cookie = '') {
      const response = await fetch(base + '/messenger' + route, {
        method,
        headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    }
    const endpoint = (name: string) => `https://web.push.apple.com/${name}`;
    async function account(name: string) {
      const id = randomUUID(),
        raw = randomBytes(32).toString('base64url'),
        token = digest(raw);
      await db.query('INSERT INTO users(id,username,name,password) VALUES($1,$2,$2,$3)', [
        id,
        name,
        'not-a-login-hash',
      ]);
      await db.query(
        "INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
        [token, id],
      );
      return { id, token, cookie: `galinka=${raw}` };
    }
    try {
      server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
        env: {
          ...process.env,
          DATABASE_URL: connection.href,
          PORT: '3021',
          INVITE_CODE: 'web-push-test-invite',
          APP_ORIGIN: base,
          PUBLIC_API_ORIGIN: '',
          UPLOAD_DIR: directory,
          NODE_ENV: 'test',
          COOKIE_SECURE: 'false',
          PUSH_ENABLED: 'false',
          WEB_PUSH_PUBLIC_KEY: keys.p256dh,
          WEB_PUSH_PRIVATE_KEY: curve.getPrivateKey().toString('base64url'),
          WEB_PUSH_SUBJECT: 'https://mess.quiby.me',
        },
        stdio: 'pipe',
      });
      server.stderr?.on('data', (data) => {
        logs += data;
      });
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(base + '/api/health')).ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(ready, 'Push test API failed to start: ' + logs);
      const sender = await account('sender'),
        recipient = await account('recipient');
      const subscription = { endpoint: endpoint('active'), expirationTime: null, keys };
      assert.equal((await request('/push/status')).status, 401);
      assert.deepEqual((await request('/push/status', 'GET', undefined, recipient.cookie)).data, {
        enabled: false,
        browserAvailable: true,
        publicKey: keys.p256dh,
      });
      assert.equal((await request('/push/subscriptions', 'POST', subscription)).status, 401);
      assert.equal(
        (await request('/push/subscriptions', 'POST', subscription, recipient.cookie)).status,
        200,
      );
      assert.equal(
        (
          await request(
            '/push/subscriptions',
            'POST',
            { ...subscription, endpoint: 'https://127.0.0.1/secret' },
            recipient.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            '/push/subscriptions',
            'POST',
            { ...subscription, expirationTime: Date.now() - 1 },
            recipient.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            '/push/subscriptions',
            'DELETE',
            { endpoint: subscription.endpoint },
            sender.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await db.query('SELECT * FROM web_push_subscriptions')).rowCount,
        1,
        'another account cannot unsubscribe a recipient',
      );
      for (let i = 0; i < 13; i++) {
        assert.equal(
          (
            await request(
              '/push/subscriptions',
              'POST',
              { ...subscription, endpoint: endpoint(`quota-${i}`) },
              recipient.cookie,
            )
          ).status,
          200,
        );
      }
      assert.equal((await db.query('SELECT * FROM web_push_subscriptions')).rowCount, 12);
      assert.equal(
        (await request('/auth/logout', 'POST', undefined, recipient.cookie)).status,
        200,
      );
      assert.equal(
        (await db.query('SELECT * FROM web_push_subscriptions')).rowCount,
        0,
        'logout cascades subscriptions',
      );
      assert.equal(
        (await request('/push/subscriptions', 'POST', subscription, recipient.cookie)).status,
        401,
      );

      // No live worker remains when durable jobs are seeded. All network sends below
      // go to explicit fake transports, even if the developer has real credentials.
      await stopServer();
      await db.query(
        "INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
        [recipient.token, recipient.id],
      );
      const chat = randomUUID();
      await db.query("INSERT INTO chats(id,kind,title,owner_id) VALUES($1,'group','Private',$2)", [
        chat,
        sender.id,
      ]);
      const people = new Map([
        ['sender', sender],
        ['recipient', recipient],
      ]);
      for (const name of ['muted', 'expired', 'blocked', 'removed', 'read', 'revoked'])
        people.set(name, await account(name));
      for (const [name, person] of people) {
        if (name !== 'removed')
          await db.query('INSERT INTO members(chat_id,user_id,read_at,muted) VALUES($1,$2,$3,$4)', [
            chat,
            person.id,
            name === 'read' ? '2099-01-01' : '2000-01-01',
            name === 'muted',
          ]);
        await db.query(
          'INSERT INTO web_push_subscriptions(endpoint,user_id,session_token,p256dh,auth) VALUES($1,$2,$3,$4,$5)',
          [endpoint(name), person.id, person.token, keys.p256dh, keys.auth],
        );
        await db.query('INSERT INTO push_devices(token,user_id,session_token) VALUES($1,$2,$3)', [
          `android-${name}`,
          person.id,
          person.token,
        ]);
      }
      await db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token=$1", [
        people.get('expired')!.token,
      ]);
      await db.query('UPDATE users SET blocked=true WHERE id=$1', [people.get('blocked')!.id]);
      await db.query('DELETE FROM sessions WHERE token=$1', [people.get('revoked')!.token]);
      for (const name of ['temporary', 'gone', 'gone404', 'expired-sub']) {
        await db.query(
          'INSERT INTO web_push_subscriptions(endpoint,user_id,session_token,p256dh,auth,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
          [
            endpoint(name),
            recipient.id,
            recipient.token,
            keys.p256dh,
            keys.auth,
            name === 'expired-sub' ? new Date(1) : null,
          ],
        );
      }
      await db.query(
        'INSERT INTO web_push_subscriptions(endpoint,user_id,session_token,p256dh,auth) VALUES($1,$2,$3,$4,$5)',
        ['https://127.0.0.1/private', recipient.id, recipient.token, keys.p256dh, keys.auth],
      );
      for (const token of ['android-temporary', 'android-gone'])
        await db.query('INSERT INTO push_devices(token,user_id,session_token) VALUES($1,$2,$3)', [
          token,
          recipient.id,
          recipient.token,
        ]);
      async function enqueue() {
        const message = randomUUID();
        await db.query(
          'INSERT INTO messages(id,chat_id,sender_id,body,nonce) VALUES($1,$2,$3,$4,$5)',
          [
            message,
            chat,
            sender.id,
            'SECRET MESSAGE THAT MUST NEVER BE SENT TO PUSH PROVIDERS',
            randomUUID(),
          ],
        );
        await db.query('INSERT INTO push_jobs(message_id) VALUES($1)', [message]);
        return message;
      }
      const message = await enqueue();
      const browserCalls: string[] = [],
        androidCalls: string[] = [];
      let failOnce = true;
      const transports: PushTransports = {
        browser: async (sub, payload) => {
          browserCalls.push(sub.endpoint);
          assert.deepEqual(JSON.parse(payload), {
            title: 'Galinka',
            body: 'Новое сообщение',
            chatId: chat,
            messageId: message,
          });
          if (sub.endpoint === endpoint('gone')) throw { statusCode: 410 };
          if (sub.endpoint === endpoint('gone404')) throw { statusCode: 404 };
          if (sub.endpoint === endpoint('temporary') && failOnce) throw { statusCode: 503 };
        },
        android: async (payload) => {
          assert.deepEqual(payload.notification, { title: 'Galinka', body: 'Новое сообщение' });
          androidCalls.push(...payload.tokens);
          const responses = payload.tokens.map((token) => ({
            success: token !== 'android-gone' && !(token === 'android-temporary' && failOnce),
            ...(token === 'android-gone'
              ? { error: { code: 'messaging/registration-token-not-registered' } as any }
              : {}),
          }));
          return {
            responses,
            successCount: responses.filter((r) => r.success).length,
            failureCount: responses.filter((r) => !r.success).length,
          };
        },
      };
      assert.equal(await deliverPushJob(db, transports), true);
      assert.deepEqual(
        browserCalls.sort(),
        ['recipient', 'temporary', 'gone', 'gone404'].map(endpoint).sort(),
      );
      assert.deepEqual(
        androidCalls.sort(),
        ['android-recipient', 'android-temporary', 'android-gone'].sort(),
      );
      assert.equal(
        (await db.query('SELECT attempts FROM push_jobs WHERE message_id=$1', [message])).rows[0]
          .attempts,
        1,
      );
      assert.equal(
        (await db.query('SELECT * FROM push_deliveries WHERE message_id=$1', [message])).rowCount,
        2,
      );
      assert.equal(
        (
          await db.query('SELECT * FROM web_push_subscriptions WHERE endpoint=ANY($1::text[])', [
            [
              endpoint('gone'),
              endpoint('gone404'),
              endpoint('expired-sub'),
              'https://127.0.0.1/private',
            ],
          ])
        ).rowCount,
        0,
      );
      browserCalls.length = 0;
      androidCalls.length = 0;
      failOnce = false;
      await db.query('UPDATE push_jobs SET available_at=now() WHERE message_id=$1', [message]);
      await deliverPushJob(db, transports);
      assert.deepEqual(
        browserCalls,
        [endpoint('temporary')],
        'successful browser destination must not be repeated',
      );
      assert.deepEqual(
        androidCalls,
        ['android-temporary'],
        'successful Android destination must not be repeated',
      );
      assert.equal((await db.query('SELECT * FROM push_jobs')).rowCount, 0);
      assert.equal((await db.query('SELECT * FROM push_deliveries')).rowCount, 0);

      // Fanout is genuinely parallel but stays within the pool/network budget.
      for (let i = 0; i < 17; i++) {
        await db.query(
          'INSERT INTO web_push_subscriptions(endpoint,user_id,session_token,p256dh,auth) VALUES($1,$2,$3,$4,$5)',
          [endpoint(`fanout-${i}`), recipient.id, recipient.token, keys.p256dh, keys.auth],
        );
      }
      await enqueue();
      let activeSends = 0,
        maximumSends = 0,
        sent = 0;
      await deliverPushJob(db, {
        browser: async () => {
          activeSends++;
          sent++;
          maximumSends = Math.max(maximumSends, activeSends);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeSends--;
        },
      });
      assert.equal(sent, 19);
      assert.ok(maximumSends > 1 && maximumSends <= 8, 'parallel delivery is bounded at eight');

      // One recipient and one destination make the lock race deterministic. A
      // removed member may finish an in-flight generic push, but no later one.
      await db.query('DELETE FROM web_push_subscriptions WHERE endpoint<>$1', [
        endpoint('recipient'),
      ]);
      await enqueue();
      const entered = Promise.withResolvers<void>(),
        release = Promise.withResolvers<void>();
      const delivery = deliverPushJob(db, {
        browser: async () => {
          entered.resolve();
          await release.promise;
        },
      });
      await entered.promise;
      const mutation = await db.connect();
      let removalFinished = false;
      const removal = (async () => {
        await mutation.query('BEGIN');
        await mutation.query('SELECT id FROM chats WHERE id=$1 FOR UPDATE', [chat]);
        await mutation.query('DELETE FROM members WHERE chat_id=$1 AND user_id=$2', [
          chat,
          recipient.id,
        ]);
        await mutation.query('COMMIT');
        removalFinished = true;
        mutation.release();
      })();
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(removalFinished, false, 'removal serializes with an in-flight delivery');
      release.resolve();
      await Promise.all([delivery, removal]);
      await enqueue();
      let afterRemoval = 0;
      await deliverPushJob(db, {
        browser: async () => {
          afterRemoval++;
        },
      });
      assert.equal(afterRemoval, 0, 'queued messages must not reach removed members');
      assert.equal(await deliverPushJob(db, transports), false);
    } finally {
      await stopServer();
      await db.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
