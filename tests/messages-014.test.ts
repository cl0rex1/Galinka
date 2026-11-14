import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';

const database = process.env.TEST_DATABASE_URL;
const VALID_MP4 = Buffer.from(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMVbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAACgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAA',
  'base64',
);

function startMockUpstream(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer(async (req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'POST' && reqUrl.pathname === '/tiktok-api') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const params = new URLSearchParams(body);
        if (!params.get('url')?.includes('tiktok.com')) {
          res.statusCode = 400;
          res.end(JSON.stringify({ code: -1 }));
          return;
        }
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            code: 0,
            data: {
              title: 'Production TikTok Video',
              play: `http://127.0.0.1:${port}/video.mp4`,
            },
          }),
        );
        return;
      }
      if (req.method === 'GET' && reqUrl.pathname === '/video.mp4') {
        res.setHeader('Content-Type', 'video/mp4');
        res.end(VALID_MP4);
        return;
      }
      if (req.method === 'GET' && reqUrl.pathname === '/gif-api') {
        const q = reqUrl.searchParams.get('q') || '';
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            items: [
              {
                id: 'upstream-gif-1',
                title: q ? `GIF: ${q}` : 'Танцы',
                previewUrl: 'https://example.com/media/dance.gif',
              },
            ],
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('Invalid server address'));
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

test(
  'real PostgreSQL (0.14.0): delete scope/undo, details, edit history, scheduled, polls, auto-delete, drafts, previews, tiktok',
  { skip: !database, timeout: 60000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-014-test-'));
    const servers: ChildProcess[] = [];
    const accounts: string[] = [];
    const db = new Pool({ connectionString: database });
    const upstream = await startMockUpstream();
    const invite = 'test-014-invite-code';
    const port = 3014;
    const base = `http://localhost:${port}`;
    let logs = '';

    async function start() {
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
          WEB_PUSH_PUBLIC_KEY: '',
          WEB_PUSH_PRIVATE_KEY: '',
          TIKTOK_API_URL: `${upstream.url}/tiktok-api`,
          GIF_API_URL: `${upstream.url}/gif-api`,
        },
        stdio: 'pipe',
      });
      servers.push(child);
      child.stderr?.on('data', (chunk) => {
        logs += chunk;
      });
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(`${base}/api/health`)).ok) return;
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
      await start();
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
        return r;
      };

      const alice = await register('alice');
      const bob = await register('bob');

      // Group chat with Alice (owner) and Bob
      const group = await request(
        '/chats',
        'POST',
        { kind: 'group', title: 'QA 0.14.0', userIds: [bob.data.id] },
        alice.cookie,
      );
      assert.equal(group.status, 201);
      const chatId = group.data.id as string;

      // 1. Delete for me + undo restore, delete for all + undo restore, and legacy hard delete
      const msg1 = await request(
        `/chats/${chatId}/messages`,
        'POST',
        { body: 'Первое сообщение', nonce: randomUUID() },
        alice.cookie,
      );
      assert.equal(msg1.status, 201);

      const delMe = await request(
        `/chats/${chatId}/messages/${msg1.data.id}?scope=me&undo=1`,
        'DELETE',
        undefined,
        bob.cookie,
      );
      assert.equal(delMe.status, 200);
      assert.equal(
        (await request(`/chats/${chatId}/messages`, 'GET', undefined, bob.cookie)).data.some(
          (m: any) => m.id === msg1.data.id,
        ),
        false,
      );
      assert.equal(
        (await request(`/chats/${chatId}/messages`, 'GET', undefined, alice.cookie)).data.some(
          (m: any) => m.id === msg1.data.id,
        ),
        true,
      );

      const restoreMe = await request(
        `/chats/${chatId}/messages/${msg1.data.id}/restore`,
        'POST',
        {},
        bob.cookie,
      );
      assert.equal(restoreMe.status, 200);
      assert.equal(
        (await request(`/chats/${chatId}/messages`, 'GET', undefined, bob.cookie)).data.some(
          (m: any) => m.id === msg1.data.id,
        ),
        true,
      );

      const delAll = await request(
        `/chats/${chatId}/messages/${msg1.data.id}?scope=all&undo=1`,
        'DELETE',
        undefined,
        alice.cookie,
      );
      assert.equal(delAll.status, 200);
      assert.equal(
        (await request(`/chats/${chatId}/messages`, 'GET', undefined, alice.cookie)).data.some(
          (m: any) => m.id === msg1.data.id,
        ),
        false,
      );
      const restoreAll = await request(
        `/chats/${chatId}/messages/${msg1.data.id}/restore`,
        'POST',
        {},
        alice.cookie,
      );
      assert.equal(restoreAll.status, 200);
      assert.equal(
        (await request(`/chats/${chatId}/messages`, 'GET', undefined, bob.cookie)).data.some(
          (m: any) => m.id === msg1.data.id,
        ),
        true,
      );

      // Legacy hard delete without undo=1 still removes the uploaded file immediately
      const form = new FormData();
      form.set('file', new Blob(['temp-file']), 'temp.txt');
      const uploaded = await request(`/chats/${chatId}/files`, 'POST', form, alice.cookie);
      assert.equal(uploaded.status, 201);
      const fileMsg = await request(
        `/chats/${chatId}/messages`,
        'POST',
        { body: '', fileId: uploaded.data.id, nonce: randomUUID() },
        alice.cookie,
      );
      assert.equal(
        (await request(`/chats/${chatId}/messages/${fileMsg.data.id}`, 'DELETE', undefined, alice.cookie))
          .status,
        200,
      );
      const fetchedDeletedFile = await fetch(`${base}/api/files/${uploaded.data.id}`, {
        headers: { Cookie: alice.cookie },
      });
      assert.equal(fetchedDeletedFile.status, 404);

      // 2. Expanded emoji reaction + read receipt + /details modal data
      assert.equal(
        (await request(`/chats/${chatId}/read`, 'POST', { lastMessageId: msg1.data.id }, bob.cookie))
          .status,
        200,
      );
      assert.equal(
        (
          await request(
            `/chats/${chatId}/messages/${msg1.data.id}/reactions`,
            'POST',
            { emoji: '👨‍👩‍👧' },
            alice.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            `/chats/${chatId}/messages/${msg1.data.id}/reactions`,
            'POST',
            { emoji: '🚀' },
            bob.cookie,
          )
        ).status,
        200,
      );
      const details = await request(
        `/chats/${chatId}/messages/${msg1.data.id}/details`,
        'GET',
        undefined,
        alice.cookie,
      );
      assert.equal(details.status, 200);
      assert.equal(
        details.data.readers.some((r: any) => r.id === bob.data.id),
        true,
      );
      assert.equal(
        details.data.reactions.some(
          (g: any) =>
            g.emoji === '👨‍👩‍👧' && g.users.some((u: any) => u.id === alice.data.id),
        ),
        true,
      );
      assert.equal(
        details.data.reactions.some(
          (g: any) => g.emoji === '🚀' && g.users.some((u: any) => u.id === bob.data.id),
        ),
        true,
      );

      // 3. Message edit history
      assert.equal(
        (
          await request(
            `/chats/${chatId}/messages/${msg1.data.id}`,
            'PATCH',
            { body: 'Вторая версия' },
            alice.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            `/chats/${chatId}/messages/${msg1.data.id}`,
            'PATCH',
            { body: 'Третья версия' },
            alice.cookie,
          )
        ).status,
        200,
      );
      const edits = await request(
        `/chats/${chatId}/messages/${msg1.data.id}/edits`,
        'GET',
        undefined,
        bob.cookie,
      );
      assert.equal(edits.status, 200);
      assert.equal(edits.data.current, 'Третья версия');
      assert.deepEqual(
        edits.data.edits.map((e: any) => e.previous_body).sort(),
        ['Вторая версия', 'Первое сообщение'].sort(),
      );

      // 4. Scheduled messages and Saved Messages reminders
      const futureIso = new Date(Date.now() + 60_000).toISOString();
      const sched = await request(
        `/chats/${chatId}/scheduled`,
        'POST',
        { body: 'По расписанию', scheduledFor: futureIso },
        alice.cookie,
      );
      assert.equal(sched.status, 201);
      const sched2 = await request(
        `/chats/${chatId}/scheduled`,
        'POST',
        { body: 'Отменить это', scheduledFor: futureIso },
        alice.cookie,
      );
      assert.equal(sched2.status, 201);
      const schedList = await request(`/chats/${chatId}/scheduled`, 'GET', undefined, alice.cookie);
      assert.equal(schedList.data.length, 2);
      assert.equal(
        (await request(`/chats/${chatId}/scheduled/${sched2.data.id}`, 'DELETE', undefined, alice.cookie))
          .status,
        200,
      );
      assert.equal(
        (await request(`/chats/${chatId}/scheduled/${sched.data.id}/send`, 'POST', {}, alice.cookie))
          .status,
        201,
      );
      assert.equal(
        (await request(`/chats/${chatId}/scheduled`, 'GET', undefined, alice.cookie)).data.length,
        0,
      );
      assert.equal(
        (await request(`/chats/${chatId}/messages`, 'GET', undefined, bob.cookie)).data.some(
          (m: any) => m.body === 'По расписанию',
        ),
        true,
      );
      const aliceChats = await request('/chats', 'GET', undefined, alice.cookie);
      const savedChat = aliceChats.data.find((c: any) => c.kind === 'saved');
      assert.ok(savedChat);
      const reminder = await request(
        `/chats/${savedChat.id}/scheduled`,
        'POST',
        { body: 'Напомнить про релиз', scheduledFor: futureIso, isReminder: true },
        alice.cookie,
      );
      assert.equal(reminder.status, 201);
      assert.equal(reminder.data.is_reminder, true);

      // 5. Polls: creation, single/multiple choice enforcement, anonymous voters hidden, closing
      const pollRes = await request(
        `/chats/${chatId}/polls`,
        'POST',
        {
          question: 'Куда идём?',
          options: ['Парк', 'Кафе'],
          multiple: false,
          anonymous: false,
          nonce: randomUUID(),
        },
        alice.cookie,
      );
      assert.equal(pollRes.status, 201);
      assert.equal(
        (
          await request(
            `/chats/${chatId}/polls/${pollRes.data.pollId}/vote`,
            'POST',
            { optionIndices: [0, 1] },
            bob.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            `/chats/${chatId}/polls/${pollRes.data.pollId}/vote`,
            'POST',
            { optionIndices: [1] },
            bob.cookie,
          )
        ).status,
        200,
      );
      const msgsAfterVote = await request(`/chats/${chatId}/messages`, 'GET', undefined, alice.cookie);
      const pollMsg = msgsAfterVote.data.find((m: any) => m.poll?.id === pollRes.data.pollId);
      assert.equal(pollMsg.poll.total_votes, 1);
      assert.equal(pollMsg.poll.options[1].votes, 1);
      assert.equal(pollMsg.poll.options[1].voters[0].id, bob.data.id);

      assert.equal(
        (
          await request(
            `/chats/${chatId}/polls/${pollRes.data.pollId}/close`,
            'POST',
            {},
            bob.cookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            `/chats/${chatId}/polls/${pollRes.data.pollId}/close`,
            'POST',
            {},
            alice.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            `/chats/${chatId}/polls/${pollRes.data.pollId}/vote`,
            'POST',
            { optionIndices: [0] },
            bob.cookie,
          )
        ).status,
        400,
      );

      // Anonymous poll hides voter identities
      const anonPoll = await request(
        `/chats/${chatId}/polls`,
        'POST',
        {
          question: 'Анонимно?',
          options: ['Да', 'Нет'],
          multiple: true,
          anonymous: true,
          nonce: randomUUID(),
        },
        alice.cookie,
      );
      assert.equal(anonPoll.status, 201);
      assert.equal(
        (
          await request(
            `/chats/${chatId}/polls/${anonPoll.data.pollId}/vote`,
            'POST',
            { optionIndices: [0, 1] },
            bob.cookie,
          )
        ).status,
        200,
      );
      const anonMsg = (
        await request(`/chats/${chatId}/messages`, 'GET', undefined, alice.cookie)
      ).data.find((m: any) => m.poll?.id === anonPoll.data.pollId);
      assert.equal(anonMsg.poll.options[0].voters == null, true);

      // 6. Auto-delete timer + expiration hiding
      assert.equal(
        (await request(`/chats/${chatId}`, 'PATCH', { autoDeleteSeconds: 60 }, alice.cookie))
          .status,
        200,
      );
      const expiringMsg = await request(
        `/chats/${chatId}/messages`,
        'POST',
        { body: 'Временное сообщение', nonce: randomUUID() },
        alice.cookie,
      );
      assert.equal(expiringMsg.status, 201);
      const beforeExpire = (
        await request(`/chats/${chatId}/messages`, 'GET', undefined, alice.cookie)
      ).data.find((m: any) => m.id === expiringMsg.data.id);
      assert.ok(beforeExpire.expires_at);
      await db.query("UPDATE messages SET expires_at = now() - interval '2 seconds' WHERE id = $1", [
        expiringMsg.data.id,
      ]);
      assert.equal(
        (await request(`/chats/${chatId}/messages`, 'GET', undefined, alice.cookie)).data.some(
          (m: any) => m.id === expiringMsg.data.id,
        ),
        false,
      );
      assert.equal(
        (await request(`/chats/${chatId}`, 'PATCH', { autoDeleteSeconds: null }, alice.cookie))
          .status,
        200,
      );

      // 7. Cross-device synced drafts (REST + SSE event). Alice's phone listens while her
      // computer types; the computer gets no echo of its own draft.
      const phone = await request('/auth/login', 'POST', {
        username: `alice_${suffix}`,
        password: 'test-password-strong',
      });
      assert.equal(phone.status, 200, JSON.stringify(phone.data));
      const listen = async (cookie: string) => {
        const controller = new AbortController();
        const response = await fetch(`${base}/api/events`, {
          headers: { Cookie: cookie },
          signal: controller.signal,
        });
        assert.equal(response.status, 200);
        const reader = response.body!.getReader();
        await reader.read(); // connected event
        return { reader, controller };
      };
      const phoneEvents = await listen(phone.cookie);
      const computerEvents = await listen(alice.cookie);
      // Longer than a pg_notify payload may carry (8000 bytes), so the text is not inlined.
      const longDraft = `синхронный черновик ${'я'.repeat(7000)}`;
      assert.equal(
        (await request(`/chats/${chatId}/draft`, 'PUT', { draft: longDraft }, alice.cookie))
          .status,
        200,
      );
      let draftChunk = '';
      while (!draftChunk.includes('"type":"draft"'))
        draftChunk += new TextDecoder().decode((await phoneEvents.reader.read()).value);
      while (!draftChunk.endsWith('\n\n'))
        draftChunk += new TextDecoder().decode((await phoneEvents.reader.read()).value);
      assert.equal(JSON.parse(draftChunk.trim().split('\n').at(-1)!.slice(6)).draft, longDraft);
      const echo = await Promise.race([
        computerEvents.reader.read().then(({ value }) => new TextDecoder().decode(value)),
        new Promise<string>((done) => setTimeout(() => done(''), 500)),
      ]);
      assert.doesNotMatch(echo, /"type":"draft"/);
      phoneEvents.controller.abort();
      computerEvents.controller.abort();
      const chatsAfterDraft = await request('/chats', 'GET', undefined, alice.cookie);
      assert.equal(chatsAfterDraft.data.find((c: any) => c.id === chatId)?.draft, longDraft);

      // 8. Link previews (YouTube/Spotify) & SSRF rejection
      const ytPreview = await request(
        `/link-preview?url=${encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ')}`,
        'GET',
        undefined,
        alice.cookie,
      );
      assert.equal(ytPreview.status, 200);
      assert.equal(ytPreview.data.preview.provider, 'youtube');
      assert.equal(ytPreview.data.preview.site, 'YouTube');

      const spPreview = await request(
        `/link-preview?url=${encodeURIComponent('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')}`,
        'GET',
        undefined,
        alice.cookie,
      );
      assert.equal(spPreview.status, 200);
      assert.equal(spPreview.data.preview.provider, 'spotify');

      assert.equal(
        (
          await request(
            `/link-preview?url=${encodeURIComponent('http://127.0.0.1:1234/secret')}`,
            'GET',
            undefined,
            alice.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            `/link-preview/image?url=${encodeURIComponent('http://127.0.0.1:1234/secret.png')}`,
            'GET',
            undefined,
            alice.cookie,
          )
        ).status,
        400,
      );

      // 9. TikTok download endpoint + SSRF check
      assert.equal(
        (
          await request(
            `/chats/${chatId}/tiktok`,
            'POST',
            { url: 'http://127.0.0.1:1234/tt.mp4' },
            alice.cookie,
          )
        ).status,
        400,
      );
      const ttRes = await request(
        `/chats/${chatId}/tiktok`,
        'POST',
        { url: 'https://www.tiktok.com/@galinka/video/7000000000000000001' },
        alice.cookie,
      );
      assert.equal(ttRes.status, 201);
      assert.equal(ttRes.data.file.mime, 'video/mp4');
      const ttFile = await fetch(`${base}/api/files/${ttRes.data.file.id}?inline=1`, {
        headers: { Cookie: bob.cookie },
      });
      assert.equal(ttFile.status, 200);
      assert.equal(ttFile.headers.get('content-type')?.includes('video/mp4'), true);

      // Link preview cache persistence + skipPreview flag
      const previewCache = await db.query<{ c: number }>('SELECT count(*)::int AS c FROM link_previews');
      assert.ok(previewCache.rows[0].c >= 1);
      const skippedMsg = await request(
        `/chats/${chatId}/messages`,
        'POST',
        {
          body: 'Проверьте https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          nonce: randomUUID(),
          skipPreview: true,
        },
        alice.cookie,
      );
      assert.equal(skippedMsg.status, 201);
      const msgsAfterSkip = await request(`/chats/${chatId}/messages`, 'GET', undefined, alice.cookie);
      const skippedRow = msgsAfterSkip.data.find((m: any) => m.id === skippedMsg.data.id);
      assert.equal(skippedRow.link_preview, null);
      // A link whose card is cached gets it with the message, without waiting on the site.
      const linked = await request(
        `/chats/${chatId}/messages`,
        'POST',
        { body: 'Ещё раз https://www.youtube.com/watch?v=dQw4w9WgXcQ', nonce: randomUUID() },
        alice.cookie,
      );
      assert.equal(linked.status, 201);
      const linkedRow = (
        await request(`/chats/${chatId}/messages`, 'GET', undefined, bob.cookie)
      ).data.find((m: any) => m.id === linked.data.id);
      assert.equal(linkedRow.link_preview.provider, 'youtube');

      // 10. GIF search endpoint and emoji-only reactions
      // Reactions take emoji only.
      const reactTarget = linked.data.id;
      for (const emoji of ['ab', '12', '#', '<b>'])
        assert.equal(
          (
            await request(
              `/chats/${chatId}/messages/${reactTarget}/reactions`,
              'POST',
              { emoji },
              bob.cookie,
            )
          ).status,
          400,
          emoji,
        );
      assert.equal(
        (
          await request(
            `/chats/${chatId}/messages/${reactTarget}/reactions`,
            'POST',
            { emoji: '👍🏽' },
            bob.cookie,
          )
        ).status,
        200,
      );

      const gifs = await request('/gifs?q=dance', 'GET', undefined, alice.cookie);
      assert.equal(gifs.status, 200);
      assert.equal(gifs.data.items[0].id, 'upstream-gif-1');
    } finally {
      await upstream.close();
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
