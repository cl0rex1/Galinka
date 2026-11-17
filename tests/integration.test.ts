import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
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
          WHISPER_MODEL: process.env.TEST_WHISPER_MODEL || path.join(directory, 'missing-model.bin'),
          NODE_ENV: 'test',
          PUSH_ENABLED: 'false',
          WEB_PUSH_PUBLIC_KEY: '',
          WEB_PUSH_PRIVATE_KEY: '',
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
      const preflight = await fetch(base + '/messenger/uploads/' + randomUUID(), {
        method: 'OPTIONS',
        headers: {
          Origin: base,
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      });
      assert.equal(preflight.status, 204);
      assert.ok(preflight.headers.get('access-control-allow-methods')?.split(',').includes('PUT'));
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
        browserAvailable: false,
        publicKey: null,
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
      // The event carries the message row itself, so open chats need no refetch.
      const data = JSON.parse(new TextDecoder().decode(event.value).split('\n')[0].slice(6));
      assert.equal(data.type, 'message');
      assert.equal(data.event, 'message.created');
      assert.equal(data.chatId, id);
      assert.equal(data.senderId, alice.data.id);
      assert.equal(data.message.id, sent.data.id);
      assert.equal(data.message.body, '@неля выбери чай | кофе');
      assert.deepEqual(data.message.reactions, []);
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
      // Search treats % and _ literally, not as LIKE wildcards.
      const q = (text: string) => encodeURIComponent(text);
      const inChat = (text: string) =>
        request(`/chats/${id}/messages?q=${q(text)}`, 'GET', undefined, bob.cookie);
      assert.deepEqual(
        (await inChat('ЧАЙ | к')).data.map((m: any) => m.id),
        [sent.data.id],
      );
      assert.equal((await inChat('%')).data.length, 0);
      assert.equal((await inChat('_')).data.length, 0);
      const global = await request(`/search?q=${q('выбери')}`, 'GET', undefined, bob.cookie);
      assert.deepEqual(
        global.data.map((m: any) => m.id),
        [sent.data.id],
      );
      assert.equal(
        (await request(`/search?q=${q('%%')}`, 'GET', undefined, bob.cookie)).data.length,
        0,
      );
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
      const frame = Buffer.alloc(417);
      frame.set([0xff, 0xfb, 0x90, 0x64]);
      const mp3 = Buffer.concat([frame, frame, frame]);
      const track = new FormData();
      track.set('file', new Blob([mp3]), 'track.mp3');
      const audio = await request(`/chats/${id}/files`, 'POST', track, alice.cookie);
      assert.equal(audio.status, 201);
      assert.equal(audio.data.mime, 'audio/mpeg');
      const inline = () =>
        fetch(`${base}/api/files/${audio.data.id}?inline=1`, {
          headers: { Cookie: bob.cookie, Range: 'bytes=0-3' },
        });
      const part = await inline();
      assert.equal(part.status, 206);
      assert.equal(part.headers.get('content-type'), 'audio/mpeg');
      assert.deepEqual(Buffer.from(await part.arrayBuffer()), mp3.subarray(0, 4));
      await db.query("UPDATE files SET mime='application/octet-stream' WHERE id=$1", [
        audio.data.id,
      ]);
      const legacy = await inline();
      assert.equal(legacy.status, 206);
      assert.equal(legacy.headers.get('content-type'), 'audio/mpeg');
      await legacy.arrayBuffer();
      assert.equal(
        (await request(`/files/${audio.data.id}?inline=1`, 'GET', undefined, eve.cookie)).status,
        404,
      );
      // An old, unnormalized voice note can be transcribed by either member.
      const voiceId = randomUUID();
      const voicePath = path.join(directory, voiceId);
      await copyFile('tests/fixtures/voice-ru.webm', voicePath);
      await db.query(
        "INSERT INTO files(id,chat_id,user_id,name,size,mime) VALUES($1,$2,$3,'Голосовое-тест.webm',$4,'audio/webm')",
        [voiceId, id, alice.data.id, (await stat(voicePath)).size],
      );
      const transcript = (cookie: string, method = 'POST') =>
        request(
          `/files/${voiceId}/transcription`,
          method,
          undefined,
          cookie,
          'http://localhost:3009',
        );
      assert.equal((await transcript(bob.cookie)).status, 404, 'unsent voice');
      const voiceMessage = await request(
        `/chats/${id}/messages`,
        'POST',
        { body: '', fileId: voiceId, nonce: randomUUID() },
        alice.cookie,
      );
      assert.equal(voiceMessage.status, 201);
      assert.equal((await transcript(eve.cookie)).status, 404);
      const starts = await Promise.all([transcript(alice.cookie), transcript(bob.cookie)]);
      assert.ok(starts.every((r) => r.status === 202));
      let result = await transcript(bob.cookie, 'GET');
      const deadline = Date.now() + 30_000;
      while (result.status === 202 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        result = await transcript(bob.cookie, 'GET');
      }
      if (process.env.TEST_WHISPER_MODEL) {
        assert.equal(result.status, 200, JSON.stringify(result.data));
        assert.match(result.data.text, /хорошая погода/iu);
      } else {
        assert.equal(result.status, 422, 'engine failure becomes a retryable error');
        assert.equal((await transcript(bob.cookie)).status, 202);
        await db.query(
          "UPDATE voice_transcripts SET state='ready',transcript='готовый текст' WHERE file_id=$1",
          [voiceId],
        );
      }
      await rm(voicePath);
      assert.equal((await transcript(bob.cookie)).data.state, 'ready', 'uses cached text');
      await db.query('INSERT INTO hidden_messages(message_id,user_id) VALUES($1,$2)', [
        voiceMessage.data.id,
        bob.data.id,
      ]);
      assert.equal((await transcript(bob.cookie, 'GET')).status, 404, 'hidden on this account');
      assert.equal((await transcript(alice.cookie, 'GET')).status, 200);
      await db.query('DELETE FROM messages WHERE id=$1', [voiceMessage.data.id]);
      await db.query('DELETE FROM files WHERE id=$1', [voiceId]);
      assert.equal(
        (await db.query('SELECT 1 FROM voice_transcripts WHERE file_id=$1', [voiceId])).rowCount,
        0,
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
      // The group owner moderates others' messages; other members still cannot.
      const fromEve = await request(
        `/chats/${id}/messages`,
        'POST',
        { body: 'moderated', nonce: randomUUID() },
        eve.cookie,
      );
      const removeEve = (cookie: string) =>
        request(`/chats/${id}/messages/${fromEve.data.id}`, 'DELETE', undefined, cookie);
      assert.equal((await removeEve(bob.cookie)).status, 404);
      assert.equal((await removeEve(alice.cookie)).status, 200);
      const fromBob = await request(
        `/chats/${direct.data.id}/messages`,
        'POST',
        { body: 'direct', nonce: randomUUID() },
        bob.cookie,
      );
      assert.equal(
        (
          await request(
            `/chats/${direct.data.id}/messages/${fromBob.data.id}`,
            'DELETE',
            undefined,
            alice.cookie,
          )
        ).status,
        404,
        'Nobody moderates a direct chat',
      );
      // Pinned message: the group owner pins, the list carries it, deletion clears it.
      const pin = (chat: string, messageId: string | null, cookie: string) =>
        request(`/chats/${chat}/pin`, 'PUT', { messageId }, cookie);
      const pinnedIn = async (chat: string, cookie: string) =>
        (await request('/chats', 'GET', undefined, cookie)).data.find((c: any) => c.id === chat)
          .pinned_message;
      assert.equal((await pin(id, sent.data.id, bob.cookie)).status, 403);
      assert.equal((await pin(id, fromBob.data.id, alice.cookie)).status, 404);
      assert.equal((await pin(id, sent.data.id, alice.cookie)).status, 200);
      assert.equal((await pinnedIn(id, bob.cookie)).id, sent.data.id);
      assert.equal((await pin(direct.data.id, fromBob.data.id, alice.cookie)).status, 200);
      assert.equal((await pin(id, null, alice.cookie)).status, 200);
      assert.equal(await pinnedIn(id, bob.cookie), null);
      // Forwarding: the copy names the author, and its attachment opens for people outside
      // the original chat, also after the original message and its chat are gone.
      const dan = await register('dan');
      const withFile = await request(
        `/chats/${id}/messages`,
        'POST',
        { body: 'с файлом', fileId: uploaded.data.id, nonce: randomUUID() },
        alice.cookie,
      );
      assert.equal(withFile.status, 201);
      const eveDan = await request(
        '/chats',
        'POST',
        { kind: 'direct', userIds: [dan.data.id] },
        eve.cookie,
      );
      const forward = (chat: string, ids: string[], cookie: string) =>
        request(`/chats/${chat}/forward`, 'POST', { messageIds: ids }, cookie);
      assert.equal((await forward(eveDan.data.id, [withFile.data.id], dan.cookie)).status, 404);
      const forwarded = await forward(eveDan.data.id, [withFile.data.id, sent.data.id], eve.cookie);
      assert.equal(forwarded.status, 201, JSON.stringify(forwarded.data));
      const copies = (
        await request(`/chats/${eveDan.data.id}/messages`, 'GET', undefined, dan.cookie)
      ).data;
      assert.deepEqual(
        copies.map((m: any) => [m.body, m.forwarded_from, m.sender_id]),
        [
          ['@неля выбери чай | кофе', 'alice', eve.data.id],
          ['с файлом', 'alice', eve.data.id],
        ],
      );
      const download = (fileId: string, cookie: string) =>
        fetch(`${base}/api/files/${fileId}`, { headers: { Cookie: cookie } });
      assert.equal(
        await (await download(uploaded.data.id, dan.cookie)).text(),
        'test file contents',
      );
      assert.equal(
        (
          await request(
            `/chats/${id}/messages/${withFile.data.id}`,
            'DELETE',
            undefined,
            alice.cookie,
          )
        ).status,
        200,
      );
      assert.equal((await download(uploaded.data.id, dan.cookie)).status, 200);
      // A forward of a forward keeps the first author.
      const again = await forward(id, [copies[1].id], eve.cookie);
      assert.equal(again.status, 201);
      assert.equal(
        (await request(`/chats/${id}/messages`, 'GET', undefined, bob.cookie)).data.at(-1)
          .forwarded_from,
        'alice',
      );
      const solo = await request(
        '/chats',
        'POST',
        { kind: 'group', title: 'solo', userIds: [] },
        dan.cookie,
      );
      const danForm = new FormData();
      danForm.set('file', new Blob(['dan file']), 'dan.txt');
      const danFile = await request(`/chats/${solo.data.id}/files`, 'POST', danForm, dan.cookie);
      const danMessage = await request(
        `/chats/${solo.data.id}/messages`,
        'POST',
        { body: '', fileId: danFile.data.id, nonce: randomUUID() },
        dan.cookie,
      );
      assert.equal((await forward(eveDan.data.id, [danMessage.data.id], dan.cookie)).status, 201);
      assert.equal(
        (
          await request(
            `/chats/${solo.data.id}/members/${dan.data.id}`,
            'DELETE',
            undefined,
            dan.cookie,
          )
        ).status,
        200,
        'Deleting a chat keeps attachments forwarded elsewhere',
      );
      assert.equal(await (await download(danFile.data.id, eve.cookie)).text(), 'dan file');
      // Typing goes to the other members only, through any replica, and is never stored.
      const typingController = new AbortController();
      const typingStream = await fetch('http://localhost:3009/api/events', {
        headers: { Cookie: bob.cookie },
        signal: typingController.signal,
      });
      const typingReader = typingStream.body!.getReader();
      await typingReader.read();
      assert.equal(
        (await request(`/chats/${id}/typing`, 'POST', { action: 'shout' }, alice.cookie)).status,
        400,
      );
      assert.equal(
        (await request(`/chats/${direct.data.id}/typing`, 'POST', { action: 'typing' }, eve.cookie))
          .status,
        404,
      );
      assert.equal(
        (await request(`/chats/${id}/typing`, 'POST', { action: 'voice' }, alice.cookie)).status,
        200,
      );
      const typed = await Promise.race([
        typingReader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error('No typing event')), 4000).unref(),
        ),
      ]);
      const typingEvent = JSON.parse(new TextDecoder().decode(typed.value).split('\n')[0].slice(6));
      assert.deepEqual(
        [
          typingEvent.type,
          typingEvent.chatId,
          typingEvent.userId,
          typingEvent.name,
          typingEvent.action,
        ],
        ['typing', id, alice.data.id, 'alice', 'voice'],
      );
      // A silent message says so in its event, so apps skip the notification.
      await request(
        `/chats/${id}/messages`,
        'POST',
        { body: 'тихо', nonce: randomUUID(), silent: true },
        alice.cookie,
      );
      const quiet = await Promise.race([
        typingReader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error('No silent message event')), 4000).unref(),
        ),
      ]);
      const quietEvent = JSON.parse(new TextDecoder().decode(quiet.value).split('\n')[0].slice(6));
      assert.deepEqual([quietEvent.message.body, quietEvent.silent], ['тихо', true]);
      typingController.abort();
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
      assert.equal(second.data.length, 8);
      assert.equal(new Set([...first.data, ...second.data].map((m) => m.id)).size, 68);
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
      // Administration is checked by the API, including current roles, revocation and draft visibility.
      assert.equal((await request('/admin/users')).status, 401);
      assert.equal((await request('/admin/users', 'GET', undefined, bob.cookie)).status, 403);
      const attempts = await request('/auth/register', 'POST', {
        username: 'role' + suffix,
        name: 'No escalation',
        password: 'test-password-strong',
        invite,
        role: 'admin',
      });
      accounts.push(attempts.data.id);
      assert.equal(attempts.data.role, 'user');
      await db.query("UPDATE users SET role='admin' WHERE id=$1", [alice.data.id]);
      const adminUsers = await request('/admin/users?q=bob', 'GET', undefined, alice.cookie);
      assert.equal(adminUsers.status, 200);
      assert.ok(adminUsers.data.items.some((u: any) => u.id === bob.data.id));
      assert.ok(adminUsers.data.items.every((u: any) => !('password' in u)));
      assert.equal(
        (await request(`/admin/users/${alice.data.id}`, 'PATCH', { blocked: true }, alice.cookie))
          .status,
        409,
      );
      assert.equal(
        (await request(`/admin/users/${alice.data.id}`, 'PATCH', { role: 'user' }, alice.cookie))
          .status,
        409,
      );
      const added = await request(
        '/admin/users',
        'POST',
        {
          username: 'managed' + suffix,
          name: 'Managed account',
          password: 'original-password',
          role: 'user',
        },
        alice.cookie,
      );
      assert.equal(added.status, 201);
      accounts.push(added.data.id);
      assert.equal(
        (
          await request(
            '/chats',
            'GET',
            undefined,
            (
              await request('/auth/login', 'POST', {
                username: added.data.username,
                password: 'original-password',
              })
            ).cookie,
          )
        ).data.length,
        1,
      );
      assert.equal(
        (
          await request(
            `/admin/users/${added.data.id}`,
            'PATCH',
            { name: 'Edited', password: 'updated-password' },
            alice.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request('/auth/login', 'POST', {
            username: added.data.username,
            password: 'original-password',
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request('/auth/login', 'POST', {
            username: added.data.username,
            password: 'updated-password',
          })
        ).status,
        200,
      );
      // Verify open SSE streams on the other replica are closed on block, and push tokens cascade away.
      const revokeController = new AbortController();
      const revokeStream = await fetch('http://localhost:3009/api/events', {
        headers: { Cookie: bob.cookie },
        signal: revokeController.signal,
      });
      const revokeReader = revokeStream.body!.getReader();
      await revokeReader.read();
      assert.equal(
        (await request(`/admin/users/${bob.data.id}`, 'PATCH', { blocked: true }, alice.cookie))
          .status,
        200,
      );
      await Promise.race([
        (async () => {
          while (!(await revokeReader.read()).done) {}
        })(),
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(Error('Blocked SSE stream stayed open')), 4000);
          timer.unref();
        }),
      ]);
      revokeController.abort();
      assert.equal((await request('/me', 'GET', undefined, bob.cookie)).status, 401);
      assert.equal(
        (
          await request('/auth/login', 'POST', {
            username: 'bob' + suffix,
            password: 'test-password-strong',
          })
        ).status,
        403,
      );
      assert.equal(
        (await request(`/admin/users/${bob.data.id}`, 'PATCH', { blocked: false }, alice.cookie))
          .status,
        200,
      );
      assert.equal((await request('/me', 'GET', undefined, bob.cookie)).status, 401);
      const post = await request(
        '/admin/announcements',
        'POST',
        { title: 'Course news', body: 'Draft text' },
        alice.cookie,
      );
      assert.equal(post.status, 201);
      const postId = post.data.id;
      assert.equal(
        (await request('/announcements', 'GET', undefined, eve.cookie)).data.items.some(
          (p: any) => p.id === postId,
        ),
        false,
      );
      assert.equal(
        (await request('/admin/announcements', 'POST', { title: 'No', body: 'No' }, eve.cookie))
          .status,
        403,
      );
      assert.equal(
        (
          await request(
            `/admin/announcements/${postId}`,
            'PATCH',
            { published: true },
            alice.cookie,
          )
        ).status,
        200,
      );
      const edited = await request(
        `/admin/announcements/${postId}`,
        'PATCH',
        { body: 'Published text' },
        alice.cookie,
      );
      assert.equal(edited.data.published, true, 'Editing text preserves publication status');
      assert.equal(
        (await request('/announcements', 'GET', undefined, eve.cookie)).data.items.find(
          (p: any) => p.id === postId,
        ).body,
        'Published text',
      );
      assert.equal(
        (await request(`/admin/announcements/${postId}`, 'DELETE', undefined, eve.cookie)).status,
        403,
      );
      await request(`/admin/announcements/${postId}`, 'PATCH', { published: false }, alice.cookie);
      assert.equal(
        (await request('/announcements', 'GET', undefined, eve.cookie)).data.items.some(
          (p: any) => p.id === postId,
        ),
        false,
      );
      assert.equal(
        (await request(`/admin/announcements/${postId}`, 'DELETE', undefined, alice.cookie)).status,
        200,
      );
      assert.equal(
        (
          await request(
            `/admin/announcements/${postId}`,
            'PATCH',
            { title: 'Missing' },
            alice.cookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (await request('/admin/users?page=0', 'GET', undefined, alice.cookie)).status,
        400,
      );
      // Concurrent attempts to demote both administrators leave exactly one active admin.
      await db.query("UPDATE users SET role='admin' WHERE id=$1", [eve.data.id]);
      const concurrent = await Promise.all([
        request(`/admin/users/${eve.data.id}`, 'PATCH', { role: 'user' }, alice.cookie),
        request(`/admin/users/${alice.data.id}`, 'PATCH', { role: 'user' }, eve.cookie),
      ]);
      assert.equal(concurrent.filter((r) => r.status === 200).length, 1);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM users WHERE id=ANY($1::uuid[]) AND role='admin' AND NOT blocked",
            [accounts],
          )
        ).rows[0].n,
        1,
      );
      // Restore this test account's session to exercise the existing logout/device cleanup below.
      await db.query(
        "INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now()+interval '1 day') ON CONFLICT DO NOTHING",
        [deviceSession, alice.data.id],
      );
      await db.query(
        'INSERT INTO push_devices(token,user_id,session_token) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [deviceToken, alice.data.id, deviceSession],
      );
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
        await db.query('DELETE FROM announcements WHERE author_id=ANY($1::uuid[])', [accounts]);
        await db.query('DELETE FROM chats WHERE owner_id=ANY($1::uuid[])', [accounts]);
        await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [accounts]);
      }
      await db.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
