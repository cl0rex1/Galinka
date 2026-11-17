import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';

const database = process.env.TEST_DATABASE_URL;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test(
  'real PostgreSQL (0.16.0): several files go out as an album, once, and a retry adds nothing',
  { skip: !database, timeout: 60000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-016-test-'));
    const db = new Pool({ connectionString: database });
    const invite = 'test-016-invite-code';
    const port = 3016;
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
    const request = async (url: string, method = 'GET', body?: unknown, cookie = '') => {
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
    };
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
        return r;
      };
      const alice = await register('alice');
      const bob = await register('bob');
      const chat = await request(
        '/chats',
        'POST',
        { kind: 'group', title: 'Album', userIds: [bob.data.id] },
        alice.cookie,
      );
      const chatId = chat.data.id as string;
      const upload = async () => {
        const form = new FormData();
        form.append('file', new Blob([PNG], { type: 'image/png' }), 'photo.png');
        const response = await fetch(`${base}/api/chats/${chatId}/files`, {
          method: 'POST',
          headers: { Cookie: alice.cookie, Origin: base },
          body: form,
        });
        assert.equal(response.status, 201);
        return ((await response.json()) as { id: string }).id;
      };
      const files = [await upload(), await upload(), await upload()];
      const nonce = randomUUID();
      const send = () =>
        request(
          `/chats/${chatId}/messages`,
          'POST',
          { body: 'Поездка', fileIds: files, album: true, nonce },
          alice.cookie,
        );
      const sent = await send();
      assert.equal(sent.status, 201, JSON.stringify(sent.data));
      // A lost response and a retry: still one album.
      assert.equal((await send()).status, 201);
      const list = (await request(`/chats/${chatId}/messages`, 'GET', undefined, bob.cookie)).data;
      const album = list.filter((m: any) => m.file);
      assert.equal(album.length, 3);
      assert.deepEqual(album.map((m: any) => m.file.id), files, 'in the order they were attached');
      assert.equal(new Set(album.map((m: any) => m.album_id)).size, 1);
      assert.ok(album[0].album_id);
      assert.deepEqual(album.map((m: any) => m.body), ['', '', 'Поездка'], 'the text goes last');
      assert.equal(sent.data.id, album[2].id, 'the answer names the last message');
      // Without `album` the files are separate messages with no group.
      const loose = await request(
        `/chats/${chatId}/messages`,
        'POST',
        { body: '', fileIds: [await upload(), await upload()], nonce: randomUUID() },
        alice.cookie,
      );
      assert.equal(loose.status, 201);
      const after = (await request(`/chats/${chatId}/messages`, 'GET', undefined, bob.cookie)).data;
      assert.equal(after.length, 5);
      assert.equal(after.slice(3).filter((m: any) => m.album_id).length, 0);
      // The chat profile's media list: newest first, one kind at a time, paged by cursor.
      const media = (await request(`/chats/${chatId}/media?type=media`, 'GET', undefined, bob.cookie))
        .data;
      assert.equal(media.items.length, 5);
      assert.equal(media.more, false);
      assert.deepEqual(media.items[4].file.id, files[0], 'oldest last');
      const older = (
        await request(
          `/chats/${chatId}/media?type=media&before=${encodeURIComponent(media.items[1].cursor)}`,
          'GET',
          undefined,
          bob.cookie,
        )
      ).data;
      assert.deepEqual(
        older.items.map((item: any) => item.id),
        media.items.slice(2).map((item: any) => item.id),
      );
      assert.equal(
        (await request(`/chats/${chatId}/media?type=file`, 'GET', undefined, bob.cookie)).data.items
          .length,
        0,
      );
      assert.equal(
        (await request(`/chats/${chatId}/media?type=link`, 'GET', undefined, bob.cookie)).data.items
          .length,
        0,
      );
      assert.equal((await request(`/chats/${chatId}/media?type=nope`, 'GET', undefined, bob.cookie)).status, 400);
      const outsider = await register('carol');
      assert.ok(
        [403, 404].includes(
          (await request(`/chats/${chatId}/media?type=media`, 'GET', undefined, outsider.cookie))
            .status,
        ),
        'only members see a chat\'s media',
      );
      // Someone else's file cannot be attached.
      const foreign = await request(
        `/chats/${chatId}/messages`,
        'POST',
        { body: '', fileIds: [files[0], randomUUID()], nonce: randomUUID() },
        alice.cookie,
      );
      assert.equal(foreign.status, 400);
      assert.equal(
        (
          await request(
            `/chats/${chatId}/messages`,
            'POST',
            { body: '', fileIds: Array(11).fill(files[0]).map(() => randomUUID()), nonce: randomUUID() },
            alice.cookie,
          )
        ).status,
        400,
        'at most ten files',
      );
    } finally {
      server.kill();
      if (accounts.length)
        await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [accounts]).catch(() => {});
      await db.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
