import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { mediaMetaSchema, needsVideoWork, peaks, videoArgs, visualMeta } from '../server/media.js';

const database = process.env.TEST_DATABASE_URL;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

test('voice waveform: 48 bars scaled to the loudest slice', () => {
  const pcm = Buffer.alloc(96 * 2);
  for (let i = 0; i < 96; i++) pcm.writeInt16LE(i < 48 ? 1000 : -16000, i * 2);
  const bars = peaks(pcm);
  assert.equal(bars.length, 48);
  assert.equal(bars[0], 2);
  assert.equal(bars[47], 31);
  assert.deepEqual(peaks(Buffer.alloc(0)), []);
  assert.ok(
    peaks(Buffer.alloc(40)).every((bar) => bar === 0),
    'silence stays flat',
  );
});

test('video work: WebM always, MP4 only when big; ffmpeg reads local files only', () => {
  assert.equal(needsVideoWork('video/webm', 1000), true);
  assert.equal(needsVideoWork('video/mp4', 5 * 1024 * 1024), false);
  assert.equal(needsVideoWork('video/mp4', 30 * 1024 * 1024), true);
  assert.equal(needsVideoWork('image/png', 30 * 1024 * 1024), false);
  const args = videoArgs('in', 'video/webm', 'out', true);
  assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'file,pipe');
  assert.equal(args[args.indexOf('-f') + 1], 'matroska', 'a fixed demuxer, never guessed');
  assert.equal(args.at(-1), 'out');
});

test('picture metadata: only sane sizes and image data URLs, only for pictures and videos', () => {
  assert.equal(
    mediaMetaSchema.safeParse({ width: '640', height: '480', thumb: THUMB }).success,
    true,
  );
  for (const bad of [
    { width: 0 },
    { width: 30000 },
    { thumb: 'javascript:alert(1)' },
    { thumb: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { thumb: `data:image/jpeg;base64,${'A'.repeat(5000)}` },
  ])
    assert.equal(mediaMetaSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
  assert.deepEqual(visualMeta('image/png', { width: 2, height: 1, thumb: THUMB }), {
    width: 2,
    height: 1,
    thumb: THUMB,
  });
  assert.deepEqual(visualMeta('application/pdf', { width: 2, height: 1 }), {
    width: null,
    height: null,
    thumb: null,
  });
});

test(
  'real PostgreSQL (0.16.0): picture sizes reach the feed; big files resume after a break',
  { skip: !database, timeout: 60000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-016-media-'));
    const db = new Pool({ connectionString: database });
    const invite = 'test-016-media-invite';
    const port = 3017;
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
        // The conversion worker must fail quietly where ffmpeg is missing.
        FFMPEG_PATH: path.join(directory, 'no-ffmpeg'),
      },
      stdio: 'pipe',
    });
    server.stderr?.on('data', (chunk) => {
      logs += chunk;
    });
    const call = async (url: string, init: RequestInit & { cookie?: string } = {}) => {
      const response = await fetch(`${base}/api${url}`, {
        ...init,
        headers: {
          ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
          ...(init.cookie ? { Cookie: init.cookie } : {}),
          Origin: base,
          ...(init.headers as Record<string, string>),
        },
      });
      return {
        status: response.status,
        data: await response.json().catch(() => null),
        cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
      };
    };
    const json = (method: string, body: unknown, cookie: string) => ({
      method,
      body: JSON.stringify(body),
      cookie,
    });
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
        const r = await call(
          '/auth/register',
          json(
            'POST',
            { username: `${name}_${suffix}`, name, password: 'test-password-strong', invite },
            '',
          ),
        );
        assert.equal(r.status, 201, JSON.stringify(r.data));
        accounts.push(r.data.id);
        return r.cookie;
      };
      const alice = await register('alice');
      const bob = await register('bob');
      const bobId = accounts[1];
      const chat = await call(
        '/chats',
        json('POST', { kind: 'group', title: 'Media', userIds: [bobId] }, alice),
      );
      const chatId = chat.data.id as string;

      // A photo sent in one request carries its size and blurred preview.
      const form = new FormData();
      form.append('width', '1600');
      form.append('height', '1200');
      form.append('thumb', THUMB);
      form.append('file', new Blob([PNG], { type: 'image/png' }), 'photo.png');
      const photo = await call(`/chats/${chatId}/files`, {
        method: 'POST',
        body: form,
        cookie: alice,
      });
      assert.equal(photo.status, 201, JSON.stringify(photo.data));
      assert.equal(photo.data.width, 1600);
      assert.equal(photo.data.thumb, THUMB);
      const bad = new FormData();
      bad.append('thumb', 'javascript:alert(1)');
      bad.append('file', new Blob([PNG], { type: 'image/png' }), 'photo.png');
      const ignored = await call(`/chats/${chatId}/files`, {
        method: 'POST',
        body: bad,
        cookie: alice,
      });
      assert.equal(ignored.status, 201, 'a bad preview is dropped, the photo still goes');
      assert.equal(ignored.data.thumb, null);

      // A 21 MB "video" in two parts, with a broken connection in between.
      const size = 21 * 1024 * 1024;
      const video = Buffer.alloc(size, 7);
      Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).copy(video);
      const created = await call(
        `/chats/${chatId}/uploads`,
        json(
          'POST',
          { name: 'Поездка.mp4', type: 'video/mp4', size, width: 1920, height: 1080, thumb: THUMB },
          alice,
        ),
      );
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const id = created.data.id as string;
      const put = (offset: number, part: Buffer, cookie = alice) =>
        call(`/uploads/${id}?offset=${offset}`, {
          method: 'PUT',
          body: part,
          cookie,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      const half = 12 * 1024 * 1024;
      assert.equal((await put(0, video.subarray(0, half))).data.offset, half);
      // The client thinks nothing arrived: the server names the real offset.
      const stale = await put(0, video.subarray(0, half));
      assert.equal(stale.status, 409);
      assert.equal(stale.data.offset, half);
      assert.equal((await call(`/uploads/${id}`, { cookie: alice })).data.offset, half);
      assert.equal((await call(`/uploads/${id}`, { cookie: bob })).status, 404, 'only the sender');
      assert.equal((await put(half, video.subarray(half), bob)).status, 404);
      assert.equal(
        (await call(`/uploads/${id}/finish`, { method: 'POST', cookie: alice })).status,
        409,
        'not finished before every byte arrived',
      );
      // More than declared is refused and cut back.
      const over = await put(half, Buffer.concat([video.subarray(half), Buffer.alloc(10)]));
      assert.equal(over.status, 413);
      assert.equal((await call(`/uploads/${id}`, { cookie: alice })).data.offset, half);
      assert.equal((await put(half, video.subarray(half))).data.offset, size);
      const finished = await call(`/uploads/${id}/finish`, { method: 'POST', cookie: alice });
      assert.equal(finished.status, 201, JSON.stringify(finished.data));
      assert.equal(finished.data.id, id);
      assert.equal(finished.data.mime, 'video/mp4');
      assert.equal(finished.data.height, 1080);
      const again = await call(`/uploads/${id}/finish`, { method: 'POST', cookie: alice });
      assert.equal(again.data.id, id, 'a repeated finish returns the same file');
      assert.ok(!(await readdir(directory)).some((name) => name.endsWith('.part')));
      const job = await db.query('SELECT 1 FROM media_jobs WHERE file_id=$1', [id]);
      assert.equal(job.rowCount, 1, 'a big video waits for conversion');

      const sent = await call(
        `/chats/${chatId}/messages`,
        json(
          'POST',
          { body: '', fileIds: [photo.data.id, id], album: true, nonce: randomUUID() },
          alice,
        ),
      );
      assert.equal(sent.status, 201, JSON.stringify(sent.data));
      const list = (await call(`/chats/${chatId}/messages`, { cookie: bob })).data;
      const files = list.filter((m: any) => m.file).map((m: any) => m.file);
      assert.deepEqual(
        files.map((f: any) => [f.width, f.height, Boolean(f.thumb)]),
        [
          [1600, 1200, true],
          [1920, 1080, true],
        ],
      );
      assert.equal(
        (
          await call(
            `/chats/${chatId}/uploads`,
            json('POST', { name: 'big.bin', size: 101 * 1024 * 1024 }, alice),
          )
        ).status,
        400,
        'at most 100 MB',
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
