import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { mentionsSQL } from '../server/push.js';

const database = process.env.TEST_DATABASE_URL;

test(
  'real PostgreSQL (0.15.0): @mentions are counted, listed, and reach a muted chat',
  { skip: !database, timeout: 60000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-015-test-'));
    const db = new Pool({ connectionString: database });
    const invite = 'test-015-invite-code';
    const port = 3015;
    const base = `http://localhost:${port}`;
    const accounts: string[] = [];
    let logs = '';
    const server: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      env: {
        ...process.env,
        DATABASE_URL: database,
        PORT: String(port),
        INVITE_CODE: invite,
        APP_ORIGIN: base,
        UPLOAD_DIR: directory,
        NODE_ENV: 'test',
        PUSH_ENABLED: 'false',
        WEB_PUSH_PUBLIC_KEY: '',
        WEB_PUSH_PRIVATE_KEY: '',
      },
      stdio: 'pipe',
    });
    server.stderr?.on('data', (chunk) => {
      logs += chunk;
    });

    async function request(url: string, method = 'GET', body?: unknown, cookie = '') {
      const response = await fetch(`${base}/api${url}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
          Origin: base,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        data: await response.json().catch(() => null),
        cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
      };
    }

    try {
      for (let i = 0; ; i++) {
        try {
          if ((await fetch(`${base}/api/health`)).ok) break;
        } catch {}
        if (i > 100) throw Error('API did not start: ' + logs);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const suffix = randomUUID().slice(0, 8);
      const register = async (name: string) => {
        const r = await request('/auth/register', 'POST', {
          username: `${name}_${suffix}`,
          name,
          password: 'test-password-strong',
          invite,
        });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        accounts.push(r.data.id);
        return { ...r, username: `${name}_${suffix}` };
      };
      const alice = await register('alice');
      const bob = await register('bob');

      const group = await request(
        '/chats',
        'POST',
        { kind: 'group', title: 'Mentions', userIds: [bob.data.id] },
        alice.cookie,
      );
      const chatId = group.data.id as string;
      // Bob mutes the chat: only a mention should get through.
      await request(`/chats/${chatId}/preferences`, 'PATCH', { muted: true }, bob.cookie);

      const say = async (body: string) =>
        (
          await request(
            `/chats/${chatId}/messages`,
            'POST',
            { body, nonce: randomUUID() },
            alice.cookie,
          )
        ).data.id as string;
      const plain = await say('просто привет');
      const named = await say(`привет, @${bob.username.toUpperCase()}!`);
      await say(`@${bob.username}x не он`);
      await say(`почта a@${bob.username}.ru`);

      const bobChat = async () =>
        (await request('/chats', 'GET', undefined, bob.cookie)).data.find(
          (chat: any) => chat.id === chatId,
        );
      const before = await bobChat();
      assert.equal(before.unread, 4);
      assert.equal(before.unread_mentions, 1, 'only the exact, case-blind @login counts');
      assert.deepEqual(
        (await request(`/chats/${chatId}/mentions`, 'GET', undefined, bob.cookie)).data,
        [named],
      );
      // The sender is never told about their own mention.
      assert.equal((await request('/chats', 'GET', undefined, alice.cookie)).data[0].unread_mentions, 0);

      // The desktop notification says whether a muted chat should speak up.
      const loud = await request(`/messages/${named}/notification`, 'GET', undefined, bob.cookie);
      const quiet = await request(`/messages/${plain}/notification`, 'GET', undefined, bob.cookie);
      assert.equal(loud.data.mention, true);
      assert.equal(quiet.data.mention, false);

      // Push uses the same rule in SQL.
      const { rows } = await db.query(
        `SELECT ${mentionsSQL('m', '$2::uuid')} AS yes FROM (SELECT $1::text AS body,false AS mention_all,$3::uuid AS sender_id) m`,
        [`эй @${bob.username}`, bob.data.id, alice.data.id],
      );
      assert.deepEqual(rows[0], { yes: true });

      // Reading the chat clears the badge.
      const last = (await request(`/chats/${chatId}/messages`, 'GET', undefined, bob.cookie)).data.at(-1);
      await request(`/chats/${chatId}/read`, 'POST', { lastMessageId: last.id }, bob.cookie);
      assert.equal((await bobChat()).unread_mentions, 0);
      assert.deepEqual(
        (await request(`/chats/${chatId}/mentions`, 'GET', undefined, bob.cookie)).data,
        [],
      );

      // A direct chat has no mentions.
      const direct = await request('/chats', 'POST', { kind: 'direct', userIds: [bob.data.id] }, alice.cookie);
      await request(
        `/chats/${direct.data.id}/messages`,
        'POST',
        { body: `@${bob.username}`, nonce: randomUUID() },
        alice.cookie,
      );
      const directChat = (await request('/chats', 'GET', undefined, bob.cookie)).data.find(
        (chat: any) => chat.id === direct.data.id,
      );
      assert.equal(directChat.unread, 1);
      assert.equal(directChat.unread_mentions, 0);

      // ---- Who may mention you: everyone, people you have a personal chat with, nobody.
      const carol = await register('carol');
      const team = (
        await request(
          '/chats',
          'POST',
          { kind: 'group', title: 'Team', userIds: [bob.data.id, carol.data.id] },
          alice.cookie,
        )
      ).data.id as string;
      const post = async (cookie: string, body: string) =>
        request(`/chats/${team}/messages`, 'POST', { body, nonce: randomUUID() }, cookie);
      const teamMentions = async () =>
        (await request('/chats', 'GET', undefined, bob.cookie)).data.find(
          (chat: any) => chat.id === team,
        ).unread_mentions;
      const settings = (change: object, cookie = bob.cookie) =>
        request('/me/settings', 'PATCH', change, cookie);
      assert.equal((await settings({ mention_policy: 'known' })).status, 200);
      await post(carol.cookie, `@${bob.username} от незнакомки`);
      assert.equal(await teamMentions(), 0, 'carol has no personal chat with bob');
      await post(alice.cookie, `@${bob.username} от знакомой`);
      assert.equal(await teamMentions(), 1, 'alice does');
      await settings({ mention_policy: 'none' });
      assert.equal(await teamMentions(), 0);
      await settings({ mention_policy: 'all' });
      assert.equal(await teamMentions(), 2);

      // ---- @все: the owner mentions everyone, once per ten minutes; from others it is text.
      const everyone = await post(alice.cookie, '@все собрание в 15:00');
      assert.equal(everyone.status, 201);
      assert.equal(await teamMentions(), 3);
      assert.equal((await post(alice.cookie, 'ещё раз @all')).status, 429);
      const fromCarol = await post(carol.cookie, '@все привет');
      assert.equal(fromCarol.status, 201);
      assert.equal(await teamMentions(), 3);
      const shown = (await request(`/chats/${team}/messages`, 'GET', undefined, bob.cookie)).data;
      assert.equal(shown.find((m: any) => m.id === everyone.data.id).mention_all, true);
      assert.equal(shown.find((m: any) => m.id === fromCarol.data.id).mention_all, false);

      // ---- Notifications per chat kind, chat sound and quiet hours: what a notification does.
      const note = async (messageId: string) =>
        (await request(`/messages/${messageId}/notification`, 'GET', undefined, bob.cookie)).data;
      const plainTeam = (await post(carol.cookie, 'просто так')).data.id;
      assert.deepEqual(
        [(await note(plainTeam)).notify, (await note(plainTeam)).quiet],
        [true, false],
      );
      await settings({ notify_groups: false });
      assert.equal((await note(plainTeam)).notify, false, 'groups are off');
      assert.equal((await note(everyone.data.id)).notify, true, 'a mention still gets through');
      await settings({ notify_groups: true, notify_direct: false });
      assert.equal((await note(plainTeam)).notify, true);
      const directNote = (
        await request(`/chats/${direct.data.id}/messages`, 'GET', undefined, bob.cookie)
      ).data.at(-1).id;
      assert.equal((await note(directNote)).notify, false, 'personal chats are off');
      await settings({ notify_direct: true });

      await request(`/chats/${team}/preferences`, 'PATCH', { sound: 'silent' }, bob.cookie);
      assert.equal(
        (await request('/chats', 'GET', undefined, bob.cookie)).data.find((c: any) => c.id === team)
          .sound,
        'silent',
      );
      assert.equal((await note(plainTeam)).quiet, true, 'a silent chat notifies quietly');
      await request(`/chats/${team}/preferences`, 'PATCH', { sound: 'default' }, bob.cookie);
      const minute = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
      const window = { from: minute, to: (minute + 60) % 1440 };
      assert.equal(
        (await settings({ quiet_hours: window, time_zone: 'Etc/UTC' })).data.quiet_from,
        minute,
      );
      assert.equal((await note(plainTeam)).quiet, true, 'inside quiet hours');
      await settings({ quiet_hours: { from: (minute + 60) % 1440, to: (minute + 120) % 1440 } });
      assert.equal((await note(plainTeam)).quiet, false, 'outside them');
      assert.equal((await settings({ quiet_hours: null })).data.quiet_from, null);
      assert.equal((await settings({ time_zone: 'Mars/Olympus' })).status, 400);
      assert.equal((await settings({ mention_policy: 'friends' })).status, 400);

      // ---- Search filters: author, type, date; a filter alone is enough.
      await post(alice.cookie, 'смотри https://example.com/page');
      const search = async (query: string, cookie = alice.cookie) =>
        request(`/search?${query}`, 'GET', undefined, cookie);
      const links = (await search('type=link&from=me')).data;
      assert.equal(links.length, 1);
      assert.match(links[0].body, /example\.com/);
      assert.equal((await search(`from=${carol.data.id}&q=${encodeURIComponent('привет')}`)).data.length, 1);
      assert.equal((await search(`from=${carol.data.id}&q=${encodeURIComponent('собрание')}`)).data.length, 0);
      assert.equal((await search(`from=me&after=${new Date(Date.now() + 86400_000).toISOString()}`)).data.length, 0);
      assert.equal((await search('q=x')).status, 400);
      assert.equal((await search('type=photo')).data.length, 0);

      // ---- One request loads from a message (or a date) up to what is already on screen.
      const all = (await request(`/chats/${team}/messages`, 'GET', undefined, bob.cookie)).data;
      const target = all[1];
      const latest = all.at(-1);
      const window1 = (
        await request(
          `/chats/${team}/messages?through=${target.id}&before=${latest.id}`,
          'GET',
          undefined,
          bob.cookie,
        )
      ).data;
      assert.deepEqual(
        window1.messages.map((m: any) => m.id),
        all.slice(0, -1).map((m: any) => m.id),
        'one message of context before the target, everything up to `before`',
      );
      assert.equal(window1.hasOlder, false);
      const byDate = (
        await request(
          `/chats/${team}/messages?since=${encodeURIComponent(all[2].created_at)}`,
          'GET',
          undefined,
          bob.cookie,
        )
      ).data;
      assert.equal(byDate.messages.at(-1).id, latest.id);
      assert.ok(byDate.messages.some((m: any) => m.id === all[2].id));
    } finally {
      server.kill();
      if (accounts.length)
        await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [accounts]).catch(() => {});
      await db.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
