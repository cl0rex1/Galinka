import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';

const database = process.env.TEST_DATABASE_URL;
test(
  'messenger: replies, edits, receipts, private media, preferences and group ownership',
  {
    skip: !database,
    timeout: 60000,
  },
  async () => {
    const db = new Pool({ connectionString: database });
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-messenger-'));
    const base = 'http://localhost:3016';
    const invite = 'messenger-feature-test-invite';
    const accounts: string[] = [];
    const servers: ChildProcess[] = [];
    const streamAbort = new AbortController();
    let logs = '';
    async function start(port: number) {
      const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
        env: {
          ...process.env,
          DATABASE_URL: database,
          PORT: String(port),
          INVITE_CODE: invite,
          APP_ORIGIN: base,
          PUBLIC_API_ORIGIN: port === 3017 ? 'http://api.localhost:3017' : '',
          UPLOAD_DIR: directory,
          NODE_ENV: 'test',
          PUSH_ENABLED: 'false',
          WEB_PUSH_PUBLIC_KEY: '',
          WEB_PUSH_PRIVATE_KEY: '',
          COOKIE_SECURE: 'false',
        },
        stdio: 'pipe',
      });
      servers.push(server);
      server.stderr?.on('data', (chunk) => {
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
    async function request(url: string, method = 'GET', body?: unknown, cookie = '') {
      const response = await fetch(`${base}/api${url}`, {
        method,
        headers: {
          ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          Cookie: cookie,
          Origin: base,
        },
        body:
          body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        data: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
      };
    }
    try {
      await start(3016);
      await start(3017);
      const policyResponse = await fetch('http://localhost:3017/api/health');
      const policy = policyResponse.headers.get('content-security-policy')!;
      assert.match(policy, /img-src [^;]*http:\/\/api\.localhost:3017/);
      assert.match(policy, /media-src [^;]*http:\/\/api\.localhost:3017/);
      assert.doesNotMatch(policy, /(?:img-src|media-src) [^;]*\*/);
      await policyResponse.arrayBuffer();
      const suffix = randomUUID().slice(0, 8);
      async function register(name: string) {
        const result = await request('/auth/register', 'POST', {
          username: name + suffix,
          name,
          password: 'messenger-password-strong',
          invite,
        });
        assert.equal(result.status, 201);
        accounts.push(result.data.id);
        return result;
      }
      const alice = await register('alice'),
        bob = await register('bob'),
        carol = await register('carol'),
        blocked = await register('blocked');
      const a = alice.data.id,
        b = bob.data.id,
        c = carol.data.id;
      const group = await request(
        '/chats',
        'POST',
        { kind: 'group', title: 'Friends', userIds: [b] },
        alice.cookie,
      );
      const other = await request(
        '/chats',
        'POST',
        { kind: 'group', title: 'Private', userIds: [] },
        alice.cookie,
      );
      assert.equal(group.status, 201);
      const chat = group.data.id,
        privateChat = other.data.id;
      const first = await request(
        `/chats/${chat}/messages`,
        'POST',
        { body: 'Original', nonce: randomUUID() },
        bob.cookie,
      );
      const messageId = first.data.id;
      const nonce = randomUUID();
      const reply = await request(
        `/chats/${chat}/messages`,
        'POST',
        { body: 'Answer', replyTo: messageId, nonce },
        alice.cookie,
      );
      assert.equal(reply.status, 201);
      assert.equal(
        (
          await request(
            `/chats/${privateChat}/messages`,
            'POST',
            { body: 'Leak', replyTo: messageId, nonce: randomUUID() },
            alice.cookie,
          )
        ).status,
        400,
      );
      const list = () =>
        request(`/chats/${chat}/messages`, 'GET', undefined, alice.cookie).then(
          (result) => result.data,
        );
      let messages = await list();
      assert.equal(messages.at(-1).reply.body, 'Original');
      assert.equal(messages.at(-1).reply.sender.id, b);
      assert.equal(messages.at(-1).read_by, 0);
      assert.equal(
        (
          await request(
            `/chats/${chat}/messages/${messageId}`,
            'PATCH',
            { body: 'Forged' },
            alice.cookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (await request(`/chats/${chat}/messages/${messageId}`, 'PATCH', { body: '' }, bob.cookie))
          .status,
        400,
      );
      assert.equal(
        (
          await request(
            `/chats/${chat}/messages/${messageId}`,
            'PATCH',
            { body: 'Corrected' },
            bob.cookie,
          )
        ).status,
        200,
      );
      messages = await list();
      assert.equal(messages[0].body, 'Corrected');
      assert.ok(messages[0].edited_at);
      assert.equal(messages.at(-1).reply.body, 'Corrected');
      await request(`/chats/${chat}/read`, 'POST', { lastMessageId: reply.data.id }, bob.cookie);
      assert.equal((await list()).at(-1).read_by, 1);
      await request(`/chats/${chat}/read`, 'POST', { lastMessageId: messageId }, bob.cookie);
      assert.equal((await list()).at(-1).read_by, 1, 'read receipts must never move backwards');
      await request(`/chats/${chat}/messages/${messageId}`, 'DELETE', undefined, bob.cookie);
      assert.equal((await list()).at(-1).reply, null);
      const retry = await request(
        `/chats/${chat}/messages`,
        'POST',
        { body: 'Answer', replyTo: messageId, nonce },
        alice.cookie,
      );
      assert.equal(
        retry.status,
        201,
        'a committed retry remains valid after the source is deleted',
      );
      assert.equal(retry.data.id, reply.data.id);

      await request(
        `/chats/${chat}/preferences`,
        'PATCH',
        { pinned: true, muted: true, archived: true },
        alice.cookie,
      );
      await request(`/chats/${chat}/preferences`, 'PATCH', { pinned: false }, alice.cookie);
      const ownPreferences = (await request('/chats', 'GET', undefined, alice.cookie)).data.find(
        (item: { id: string }) => item.id === chat,
      );
      const peerPreferences = (await request('/chats', 'GET', undefined, bob.cookie)).data.find(
        (item: { id: string }) => item.id === chat,
      );
      assert.deepEqual(
        [ownPreferences.pinned, ownPreferences.muted, ownPreferences.archived],
        [false, true, true],
      );
      assert.deepEqual(
        [peerPreferences.pinned, peerPreferences.muted, peerPreferences.archived],
        [false, false, false],
      );
      assert.equal(
        (await request(`/chats/${chat}/preferences`, 'PATCH', {}, alice.cookie)).status,
        400,
      );
      assert.equal(
        (await request(`/chats/${chat}/preferences`, 'PATCH', { muted: true }, carol.cookie))
          .status,
        404,
      );

      const imageBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64',
      );
      const form = new FormData();
      form.append(
        'file',
        new Blob([imageBytes], { type: 'application/octet-stream' }),
        'photo.png',
      );
      const file = await request(`/chats/${chat}/files`, 'POST', form, alice.cookie);
      assert.equal(file.status, 201);
      assert.equal(file.data.mime, 'image/png', 'media detection ignores client-provided MIME');
      const inline = await fetch(`${base}/api/files/${file.data.id}?inline=1`, {
        headers: { Cookie: bob.cookie },
      });
      assert.equal(inline.status, 200);
      assert.equal(inline.headers.get('content-type'), 'image/png');
      assert.equal(inline.headers.get('content-disposition'), 'inline');
      assert.equal(inline.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(inline.headers.get('cache-control'), 'no-store');
      assert.equal(inline.headers.get('cross-origin-resource-policy'), 'same-origin');
      assert.equal(inline.headers.get('content-security-policy'), "default-src 'none'; sandbox");
      assert.deepEqual(Buffer.from(await inline.arrayBuffer()), imageBytes);
      const alternateOrigin = await fetch(
        `http://localhost:3017/api/files/${file.data.id}?inline=1`,
        {
          headers: { Cookie: bob.cookie, Origin: base },
        },
      );
      assert.equal(alternateOrigin.status, 200);
      assert.equal(alternateOrigin.headers.get('cross-origin-resource-policy'), 'same-site');
      assert.equal(alternateOrigin.headers.get('access-control-allow-origin'), base);
      assert.equal(alternateOrigin.headers.get('cache-control'), 'no-store');
      assert.deepEqual(Buffer.from(await alternateOrigin.arrayBuffer()), imageBytes);
      assert.equal((await request(`/files/${file.data.id}?inline=1`)).status, 401);
      const range = await fetch(`${base}/api/files/${file.data.id}?inline=1`, {
        headers: { Cookie: bob.cookie, Range: 'bytes=0-7' },
      });
      assert.equal(range.status, 206);
      await range.arrayBuffer();
      assert.equal(
        (await request(`/files/${file.data.id}?inline=1`, 'GET', undefined, carol.cookie)).status,
        404,
      );
      const fakeImage = new FormData();
      fakeImage.append(
        'file',
        new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' }),
        'fake.png',
      );
      const fake = await request(`/chats/${chat}/files`, 'POST', fakeImage, alice.cookie);
      assert.equal(fake.data.mime, 'application/octet-stream');
      const download = await fetch(`${base}/api/files/${fake.data.id}?inline=1`, {
        headers: { Cookie: alice.cookie },
      });
      assert.match(download.headers.get('content-disposition')!, /^attachment/);
      await download.arrayBuffer();
      const mp4Container = Buffer.from('00000018667479704d344120000000004d34412069736f6d', 'hex');
      for (const declared of ['audio/mp4', 'video/mp4']) {
        const media = new FormData();
        media.append('file', new Blob([mp4Container], { type: declared }), 'container.mp4');
        const uploaded = await request(`/chats/${chat}/files`, 'POST', media, alice.cookie);
        if (declared === 'audio/mp4') {
          assert.equal(
            uploaded.status,
            422,
            'A container header without decodable audio is rejected',
          );
        } else {
          assert.equal(uploaded.status, 201);
          assert.equal(uploaded.data.mime, 'application/octet-stream');
        }
      }
      const fakeAudio = new FormData();
      fakeAudio.append(
        'file',
        new Blob(['<html>Not an audio container</html>'], { type: 'audio/mp4' }),
        'fake.m4a',
      );
      assert.equal(
        (await request(`/chats/${chat}/files`, 'POST', fakeAudio, alice.cookie)).data.mime,
        'application/octet-stream',
      );
      // This is a real Chromium MediaRecorder recording with no WebM duration.
      // Existing uploads must remain downloadable unchanged while private inline
      // playback uses a seekable AAC derivative, including range requests.
      const voiceBytes = await readFile('tests/fixtures/voice-chromium.webm');
      const legacyId = randomUUID();
      await writeFile(path.join(directory, legacyId), voiceBytes);
      await db.query(
        'INSERT INTO files(id,chat_id,user_id,name,size,mime) VALUES($1,$2,$3,$4,$5,$6)',
        [legacyId, chat, a, 'legacy.webm', voiceBytes.length, 'audio/webm'],
      );
      const legacyUrl = `${base}/api/files/${legacyId}?inline=1`;
      assert.equal((await fetch(legacyUrl)).status, 401);
      assert.equal((await fetch(legacyUrl, { headers: { Cookie: carol.cookie } })).status, 404);
      const legacyInline = await fetch(legacyUrl, {
        headers: { Cookie: bob.cookie, Range: 'bytes=0-31' },
      });
      assert.equal(legacyInline.status, 206, logs);
      assert.equal(legacyInline.headers.get('content-type'), 'audio/mp4');
      assert.match(legacyInline.headers.get('content-range')!, /^bytes 0-31\//);
      assert.equal((await legacyInline.arrayBuffer()).byteLength, 32);
      const legacyDownload = await fetch(`${base}/api/files/${legacyId}`, {
        headers: { Cookie: bob.cookie },
      });
      assert.deepEqual(Buffer.from(await legacyDownload.arrayBuffer()), voiceBytes);
      assert.deepEqual(await readFile(path.join(directory, legacyId)), voiceBytes);
      const newVoice = new FormData();
      newVoice.append('file', new Blob([voiceBytes], { type: 'audio/webm' }), 'new-voice.webm');
      const normalizedVoice = await request(`/chats/${chat}/files`, 'POST', newVoice, alice.cookie);
      assert.equal(normalizedVoice.status, 201);
      assert.equal(normalizedVoice.data.mime, 'audio/mp4');
      assert.equal(normalizedVoice.data.name, 'new-voice.m4a');
      assert.equal(
        (await db.query('SELECT audio_ready FROM files WHERE id=$1', [normalizedVoice.data.id]))
          .rows[0].audio_ready,
        true,
      );
      const photoMessage = await request(
        `/chats/${chat}/messages`,
        'POST',
        { body: 'Caption', fileId: file.data.id, nonce: randomUUID() },
        alice.cookie,
      );
      assert.equal(
        (
          await request(
            `/chats/${chat}/messages/${photoMessage.data.id}`,
            'PATCH',
            { body: '' },
            alice.cookie,
          )
        ).status,
        200,
      );

      assert.equal(
        (await request(`/chats/${chat}/members`, 'POST', { userIds: [c] }, bob.cookie)).status,
        403,
      );
      await db.query('UPDATE users SET blocked=true WHERE id=$1', [blocked.data.id]);
      assert.equal(
        (
          await request(
            `/chats/${chat}/members`,
            'POST',
            { userIds: [blocked.data.id] },
            alice.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (await request(`/chats/${chat}/members`, 'POST', { userIds: [c] }, alice.cookie)).status,
        200,
      );
      assert.equal(
        (await list()).find((message: { id: string }) => message.id === reply.data.id).read_by,
        1,
        'joining does not fabricate read receipts',
      );
      assert.equal(
        (await request(`/chats/${chat}/members/${a}`, 'DELETE', undefined, alice.cookie)).status,
        409,
      );
      assert.equal(
        (await request(`/chats/${chat}`, 'PATCH', { ownerId: blocked.data.id }, alice.cookie))
          .status,
        400,
      );
      const invitation = await request(`/chats/${chat}/invite`, 'POST', undefined, alice.cookie);
      const inviteToken = new URL(invitation.data.url).searchParams.get('join');

      const events = await fetch('http://localhost:3017/api/events', {
        headers: { Cookie: alice.cookie },
        signal: streamAbort.signal,
      });
      const reader = events.body!.getReader();
      await reader.read();
      assert.equal(
        (await request(`/chats/${chat}`, 'PATCH', { ownerId: c, title: 'New name' }, alice.cookie))
          .status,
        200,
      );
      assert.equal(
        (await request(`/chats/${chat}/members/${b}`, 'DELETE', undefined, alice.cookie)).status,
        403,
      );
      assert.equal(
        (await request(`/chats/${chat}/members/${a}`, 'DELETE', undefined, carol.cookie)).status,
        200,
      );
      const timeout = setTimeout(() => streamAbort.abort(), 4000);
      try {
        let updates = '';
        while (!updates.includes(`"removedUserId":"${a}"`)) {
          const chunk = await reader.read();
          assert.equal(chunk.done, false);
          updates += new TextDecoder().decode(chunk.value);
        }
      } finally {
        clearTimeout(timeout);
        streamAbort.abort();
      }
      assert.equal(
        (await request(`/chats/${chat}/messages`, 'GET', undefined, alice.cookie)).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/chats/${chat}/messages`,
            'POST',
            { body: 'Removed', nonce: randomUUID() },
            alice.cookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (await request(`/files/${file.data.id}?inline=1`, 'GET', undefined, alice.cookie)).status,
        404,
      );
      assert.equal((await fetch(legacyUrl, { headers: { Cookie: alice.cookie } })).status, 404);
      assert.equal(
        (await request('/join', 'POST', { token: inviteToken }, alice.cookie)).status,
        404,
      );

      // The chat lock makes the 100-person cap hold when two owners' requests overlap.
      const seedIds = Array.from({ length: 97 }, () => randomUUID());
      accounts.push(...seedIds);
      await db.query(
        `INSERT INTO users(id,username,name,password)
      SELECT id,'capacity_'||replace(id::text,'-',''),'Capacity', 'not-a-login-password'
      FROM unnest($1::uuid[]) id`,
        [seedIds],
      );
      await db.query('INSERT INTO members(chat_id,user_id) SELECT $1,unnest($2::uuid[])', [
        chat,
        seedIds,
      ]);
      await db.query('UPDATE users SET blocked=false WHERE id=$1', [blocked.data.id]);
      const addA = request(`/chats/${chat}/members`, 'POST', { userIds: [a] }, carol.cookie);
      const addBlocked = request(
        `/chats/${chat}/members`,
        'POST',
        { userIds: [blocked.data.id] },
        carol.cookie,
      );
      const statuses = (await Promise.all([addA, addBlocked]))
        .map((result) => result.status)
        .sort();
      assert.deepEqual(statuses, [200, 400]);
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM members WHERE chat_id=$1', [chat])).rows[0]
          .n,
        100,
      );
      assert.equal(
        (await request(`/chats/${privateChat}/members/${a}`, 'DELETE', undefined, alice.cookie))
          .status,
        200,
      );
      assert.equal(
        (await request(`/chats/${privateChat}/messages`, 'GET', undefined, alice.cookie)).status,
        404,
      );
    } finally {
      streamAbort.abort();
      for (const server of servers) server.kill('SIGTERM');
      await Promise.all(
        servers
          .filter((server) => server.exitCode === null && server.signalCode === null)
          .map((server) => new Promise((resolve) => server.once('exit', resolve))),
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
