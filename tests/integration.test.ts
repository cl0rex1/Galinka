import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { digest } from '../server/security.js';
const database = process.env.TEST_DATABASE_URL;
test(
  'real PostgreSQL: accounts, access boundaries, groups, files, Nelya and cross-replica events',
  { skip: !database, timeout: 60000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-test-'));
    const servers: ChildProcess[] = [],
      accounts: string[] = [],
      db = new Pool({ connectionString: database });
    const invite = 'only-for-this-integration-test',
      base = 'http://localhost:3008';
    let logs = '';
    async function start(port: number) {
      const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
        env: {
          ...process.env,
          DATABASE_URL: database,
          PORT: String(port),
          INVITE_CODE: invite,
          APP_ORIGIN: base,
          UPLOAD_DIR: directory,
          NODE_ENV: 'test',
          PUSH_ENABLED: 'false',
        },
        stdio: 'pipe',
      });
      servers.push(child);
      child.stderr?.on('data', (chunk) => {
        logs += chunk;
      });
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(`http://localhost:${port}/api/health`)).ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw Error('API did not start: ' + logs);
    }
    async function request(
      url: string,
      method = 'GET',
      body?: unknown,
      cookie = '',
      target = base,
    ) {
      const response = await fetch(target + '/api' + url, {
        method,
        headers: {
          ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...(cookie ? { Cookie: cookie } : {}),
          Origin: base,
        },
        body:
          body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
      });
      let data: any;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      return {
        status: response.status,
        data,
        cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
      };
    }
    try {
      await start(3008);
      await start(3009);
      const apiPrefix = await fetch(base + '/messenger/version', { headers: { Origin: base } });
      assert.equal(apiPrefix.status, 200);
      assert.equal(apiPrefix.headers.get('access-control-allow-origin'), base);
      const preflight = await fetch(base + '/messenger/chats', {
        method: 'OPTIONS',
        headers: {
          Origin: base,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      });
      assert.equal(preflight.status, 204);
      const blockedPreflight = await fetch(base + '/messenger/chats', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example' },
      });
      assert.equal(blockedPreflight.status, 403);
      const suffix = randomUUID().slice(0, 8);
      const register = async (name: string) => {
        const r = await request('/auth/register', 'POST', {
          username: name + suffix,
          name,
          password: 'test-password-strong',
          invite,
        });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        accounts.push(r.data.id);
        return r;
      };
      assert.equal(
        (
          await request('/auth/register', 'POST', {
            username: 'bad' + suffix,
            name: 'Bad',
            password: 'test-password-strong',
            invite: 'wrong',
          })
        ).status,
        403,
      );
      const alice = await register('alice'),
        bob = await register('bob'),
        eve = await register('eve');
      assert.match(alice.cookie, /galinka=/);
      assert.equal((await request('/me')).status, 401);
      assert.equal(
        (
          await request('/auth/login', 'POST', {
            username: 'alice' + suffix,
            password: 'wrong-password',
          })
        ).status,
        401,
      );
      const login = await request('/auth/login', 'POST', {
        username: 'alice' + suffix,
        password: 'test-password-strong',
      });
      assert.equal(login.status, 200);
      const session = await db.query('SELECT token FROM sessions WHERE user_id=$1', [
        alice.data.id,
      ]);
      assert.ok(session.rows.every((s) => s.token !== alice.cookie.split('=')[1]));
      assert.equal((await request('/push/status')).status, 401);
      assert.deepEqual((await request('/push/status', 'GET', undefined, alice.cookie)).data, {
        enabled: false,
      });
      assert.equal(
        (
          await request(
            '/push/devices',
            'POST',
            { token: 'test-device-token-long-enough' },
            alice.cookie,
          )
        ).status,
        503,
      );
      const deviceToken = 'test-device-' + suffix + '-long-enough';
      const deviceSession = digest(alice.cookie.split('=')[1]);
      await db.query('INSERT INTO push_devices(token,user_id,session_token) VALUES($1,$2,$3)', [
        deviceToken,
        alice.data.id,
        deviceSession,
      ]);
      assert.equal(
        (await request('/push/devices', 'DELETE', { token: deviceToken }, bob.cookie)).status,
        200,
      );
      assert.equal(
        (await db.query('SELECT token FROM push_devices WHERE token=$1', [deviceToken])).rowCount,
        1,
      );
      const direct = await request(
        '/chats',
        'POST',
        { kind: 'direct', userIds: [bob.data.id] },
        alice.cookie,
      );
      assert.equal(direct.status, 201);
      const repeated = await request(
        '/chats',
        'POST',
        { kind: 'direct', userIds: [alice.data.id] },
        bob.cookie,
      );
      assert.equal(repeated.data.id, direct.data.id);
      const group = await request(
        '/chats',
        'POST',
        { kind: 'group', title: 'Тестовая компания', userIds: [bob.data.id] },
        alice.cookie,
      );
      const id = group.data.id;
      assert.equal(group.status, 201);
      assert.equal(
        (await request(`/chats/${id}/messages`, 'GET', undefined, eve.cookie)).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/chats/${id}/messages`,
            'POST',
            { body: 'intrusion', nonce: randomUUID() },
            eve.cookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (await request(`/chats/${id}`, 'PATCH', { nelya: true }, bob.cookie)).status,
        403,
      );
      assert.equal(
        (await request(`/chats/${id}`, 'PATCH', { nelya: true }, alice.cookie)).status,
        200,
      );
      const controller = new AbortController();
      const eventResponse = await fetch('http://localhost:3009/api/events', {
        headers: { Cookie: bob.cookie },
        signal: controller.signal,
      });
      assert.equal(eventResponse.status, 200);
      const reader = eventResponse.body!.getReader();
      await reader.read();
      const nonce = randomUUID();
      const sent = await request(
        `/chats/${id}/messages`,
        'POST',
        { body: '@неля выбери чай | кофе', nonce },
        alice.cookie,
      );
      assert.equal(sent.status, 201);
      const event = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error('No cross-replica event')), 4000).unref(),
        ),
      ]);
      assert.match(new TextDecoder().decode(event.value), new RegExp(id));
      controller.abort();
      const retry = await request(
        `/chats/${id}/messages`,
        'POST',
        { body: '@неля выбери чай | кофе', nonce },
        alice.cookie,
      );
      assert.equal(retry.data.id, sent.data.id);
      const messages = await request(`/chats/${id}/messages`, 'GET', undefined, bob.cookie);
      assert.equal(messages.data.length, 2);
      assert.match(messages.data[1].body, /Я выбираю/);
      assert.equal(messages.data[1].sender_id, null);
      assert.equal(
        (
          await request(
            `/chats/${id}/messages/${sent.data.id}/reactions`,
            'POST',
            { emoji: '❤' },
            bob.cookie,
          )
        ).status,
        200,
      );
      let reacted = await request(`/chats/${id}/messages`, 'GET', undefined, bob.cookie);
      assert.equal(reacted.data[0].reactions[0].mine, true);
      await request(
        `/chats/${id}/messages/${sent.data.id}/reactions`,
        'POST',
        { emoji: '❤' },
        bob.cookie,
      );
      reacted = await request(`/chats/${id}/messages`, 'GET', undefined, bob.cookie);
      assert.equal(reacted.data[0].reactions.length, 0);
      const list = await request('/chats', 'GET', undefined, bob.cookie);
      assert.equal(list.data.find((c: any) => c.id === id).unread, 2);
      await request(
        `/chats/${id}/read`,
        'POST',
        { lastMessageId: messages.data.at(-1).id },
        bob.cookie,
      );
      const readList = await request('/chats', 'GET', undefined, bob.cookie);
      assert.equal(readList.data.find((c: any) => c.id === id).unread, 0);
      const form = new FormData();
      form.set('file', new Blob(['test file contents']), 'план.txt');
      const uploaded = await request(`/chats/${id}/files`, 'POST', form, alice.cookie);
      assert.equal(uploaded.status, 201);
      assert.equal(uploaded.data.name, 'план.txt');
      const file = await fetch(base + '/api/files/' + uploaded.data.id, {
        headers: { Cookie: bob.cookie },
      });
      assert.equal(await file.text(), 'test file contents');
      assert.match(file.headers.get('content-disposition')!, /^attachment/);
      assert.equal(
        (await request('/files/' + uploaded.data.id, 'GET', undefined, eve.cookie)).status,
        404,
      );
      const invitation = await request(`/chats/${id}/invite`, 'POST', {}, alice.cookie);
      assert.equal(invitation.status, 200);
      const token = new URL(invitation.data.url).searchParams.get('join');
      assert.equal(
        (await request('/join', 'POST', { token: 'not-valid-but-long-enough' }, eve.cookie)).status,
        404,
      );
      assert.equal((await request('/join', 'POST', { token }, eve.cookie)).status, 200);
      assert.equal(
        (await request(`/chats/${id}/messages`, 'GET', undefined, eve.cookie)).status,
        200,
      );
      assert.equal(
        (await request(`/chats/${id}/messages/${sent.data.id}`, 'DELETE', undefined, bob.cookie))
          .status,
        404,
      );
      assert.equal(
        (await request(`/chats/${id}/messages/${sent.data.id}`, 'DELETE', undefined, alice.cookie))
          .status,
        200,
      );
      // Force equal timestamps to verify pagination does not lose messages on a cursor boundary.
      await db.query(
        "INSERT INTO messages(id,chat_id,sender_id,body,nonce,created_at) SELECT gen_random_uuid(),$1,$2,'paging',gen_random_uuid(),'2026-01-01T00:00:00Z'::timestamptz FROM generate_series(1,65)",
        [id, alice.data.id],
      );
      const first = await request(`/chats/${id}/messages`, 'GET', undefined, bob.cookie);
      assert.equal(first.data.length, 60);
      const second = await request(
        `/chats/${id}/messages?before=${first.data[0].id}`,
        'GET',
        undefined,
        bob.cookie,
      );
      assert.equal(second.data.length, 6);
      assert.equal(new Set([...first.data, ...second.data].map((m) => m.id)).size, 66);
      const csrf = await fetch(base + '/api/chats', {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ kind: 'group', title: 'bad', userIds: [] }),
      });
      assert.equal(csrf.status, 403);
      await request('/auth/logout', 'POST', {}, alice.cookie);
      assert.equal(
        (await db.query('SELECT token FROM push_devices WHERE token=$1', [deviceToken])).rowCount,
        0,
      );
      assert.equal((await request('/me', 'GET', undefined, alice.cookie)).status, 401);
    } finally {
      for (const server of servers) server.kill('SIGTERM');
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              if (server.exitCode !== null) resolve();
              else server.once('exit', () => resolve());
            }),
        ),
      );
      if (accounts.length) {
        await db.query('DELETE FROM chats WHERE owner_id=ANY($1::uuid[])', [accounts]);
        await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [accounts]);
      }
      await db.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
