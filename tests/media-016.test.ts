import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { mediaMetaSchema, needsVideoWork, peaks, videoArgs, visualMeta } from '../server/media.js';

const database = process.env.TEST_DATABASE_URL;
const run = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
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
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-016-media-'));
    // Other integration servers have their own upload directories. Their
    // background workers must not claim the videos this server is verifying.
    const admin = new Pool({ connectionString: database });
    const dbName = 'galinka_media_' + randomUUID().replaceAll('-', '');
    const url = new URL(database!);
    url.pathname = '/' + dbName;
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const db = new Pool({ connectionString: url.href });
    const invite = 'test-016-media-invite';
    const port = 3047;
    const base = `http://localhost:${port}`;
    const accounts: string[] = [];
    let logs = '';
    const server: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      env: {
        ...process.env,
        DATABASE_URL: url.href,
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
      const simultaneous = await Promise.all([
        put(0, video.subarray(0, half)),
        put(0, video.subarray(0, half)),
      ]);
      assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 409]);
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
      // A recoverable storage failure must leave the completed parts available to retry.
      const occupied = randomUUID();
      await db.query(
        "INSERT INTO files(id,chat_id,user_id,name,size) VALUES($1,$2,$3,'existing',524288000)",
        [occupied, chatId, accounts[0]],
      );
      const finish = () => call(`/uploads/${id}/finish`, { method: 'POST', cookie: alice });
      assert.equal((await finish()).status, 413);
      assert.equal((await call(`/uploads/${id}`, { cookie: alice })).data.offset, size);
      await db.query('DELETE FROM files WHERE id=$1', [occupied]);
      const [finished, concurrentFinish] = await Promise.all([finish(), finish()]);
      assert.equal(finished.status, 201, JSON.stringify(finished.data));
      assert.deepEqual(concurrentFinish.data, finished.data);
      assert.equal(finished.data.id, id);
      assert.equal(finished.data.mime, 'video/mp4');
      assert.equal(finished.data.height, 1080);
      const again = await call(`/uploads/${id}/finish`, { method: 'POST', cookie: alice });
      assert.equal(again.data.id, id, 'a repeated finish returns the same file');
      assert.deepEqual(
        (await call(`/uploads/${id}`, { cookie: alice })).data.file,
        finished.data,
        'a lost finish response resumes without uploading again',
      );
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
      const reserve = () =>
        call(
          `/chats/${chatId}/uploads`,
          json('POST', { name: 'document', size: 100 * 1024 * 1024 }, alice),
        );
      const reservations = await Promise.all(Array.from({ length: 5 }, reserve));
      assert.deepEqual(reservations.map((r) => r.status).sort(), [201, 201, 201, 201, 413]);
      for (const upload of reservations.filter((r) => r.status === 201))
        assert.equal(
          (await call(`/uploads/${upload.data.id}`, { method: 'DELETE', cookie: alice })).status,
          200,
        );

      await t.test(
        'real codecs: voice gets a waveform; WebM notes and large MP4 become playable H.264',
        {
          skip: !(await run(ffmpeg, ['-version']).then(
            () => true,
            () => false,
          )),
        },
        async () => {
          const upload = async (name: string, mime: string, bytes: Buffer) => {
            const form = new FormData();
            form.append('file', new Blob([bytes], { type: mime }), name);
            const r = await call(`/chats/${chatId}/files`, {
              method: 'POST',
              cookie: alice,
              body: form,
            });
            assert.equal(r.status, 201, JSON.stringify(r.data));
            return r.data;
          };
          const voice = await upload(
            'Голосовое-тест.webm',
            'audio/webm',
            await readFile('tests/fixtures/voice-chromium.webm'),
          );
          assert.equal(voice.mime, 'audio/mp4');
          assert.equal(voice.waveform.length, 48);
          assert.equal(Math.max(...voice.waveform), 31);
          const clips = [
            { extension: 'webm', encoder: 'libvpx', name: 'Кружок-тест.webm' },
            { extension: 'mp4', encoder: 'libx264', name: 'Видео.mp4' },
          ];
          for (const { extension, encoder, name } of clips) {
            const source = path.join(directory, 'fixture.' + extension);
            await run(ffmpeg, [
              '-v',
              'error',
              '-f',
              'lavfi',
              '-i',
              'testsrc2=size=1440x810:rate=4',
              '-t',
              '0.5',
              '-c:v',
              encoder,
              '-threads',
              '2',
              source,
            ]);
            let bytes = await readFile(source);
            let file;
            if (extension === 'webm') {
              // Fail exactly at COMMIT, after the encoded bytes have been written.
              await db.query(`CREATE FUNCTION refuse_video() RETURNS trigger LANGUAGE plpgsql AS $$
              BEGIN RAISE EXCEPTION 'simulated commit failure'; END $$;
              CREATE CONSTRAINT TRIGGER refuse_video AFTER UPDATE ON files DEFERRABLE INITIALLY DEFERRED
              FOR EACH ROW WHEN (NEW.converted_video) EXECUTE FUNCTION refuse_video()`);
              file = await upload(name, 'video/webm', bytes);
            } else {
              // A valid MP4 free-space atom exercises the real >20 MB threshold.
              const padding = Buffer.alloc(21 * 1024 * 1024 - bytes.length);
              padding.writeUInt32BE(padding.length);
              padding.write('free', 4);
              bytes = Buffer.concat([bytes, padding]);
              const created = await call(
                `/chats/${chatId}/uploads`,
                json('POST', { name, type: 'video/mp4', size: bytes.length }, alice),
              );
              const chunk = await call(`/uploads/${created.data.id}?offset=0`, {
                method: 'PUT',
                cookie: alice,
                headers: { 'Content-Type': 'application/octet-stream' },
                body: bytes,
              });
              assert.equal(chunk.status, 200);
              const finished = await call(`/uploads/${created.data.id}/finish`, {
                method: 'POST',
                cookie: alice,
              });
              assert.equal(finished.status, 201);
              file = finished.data;
            }
            const sent = await call(
              `/chats/${chatId}/messages`,
              json('POST', { fileId: file.id, nonce: randomUUID() }, alice),
            );
            assert.equal(sent.status, 201);
            if (extension === 'webm') {
              for (let i = 0; i < 120; i++) {
                if ((await readdir(directory)).includes(file.id + '.mp4')) break;
                await new Promise((r) => setTimeout(r, 100));
              }
              assert.ok(
                (await readdir(directory)).includes(file.id + '.mp4'),
                'the encoded candidate was prepared',
              );
              const old = await fetch(`${base}/api/files/${file.id}?inline=1`, {
                headers: { Cookie: bob },
              });
              assert.equal(old.headers.get('content-type'), 'video/webm');
              assert.deepEqual(
                Buffer.from(await old.arrayBuffer()),
                bytes,
                'rollback retains the original bytes',
              );
              await db.query('DROP TRIGGER refuse_video ON files');
              await db.query('UPDATE media_jobs SET started_at=NULL WHERE file_id=$1', [file.id]);
            }
            for (let i = 0; i < 200; i++) {
              if (
                !(await db.query('SELECT 1 FROM media_jobs WHERE file_id=$1', [file.id])).rowCount
              )
                break;
              await new Promise((r) => setTimeout(r, 100));
            }
            const messages = await call(`/chats/${chatId}/messages`, { cookie: bob });
            const converted = messages.data.find((m: any) => m.id === sent.data.id).file;
            assert.equal(converted.id, file.id);
            assert.equal(converted.mime, 'video/mp4');
            assert.match(converted.name, /\.mp4$/);
            const inline = await fetch(`${base}/api/files/${file.id}?inline=1`, {
              headers: { Cookie: bob },
            });
            assert.equal(inline.status, 200);
            assert.equal(inline.headers.get('content-type'), 'video/mp4');
            assert.equal((await inline.arrayBuffer()).byteLength, converted.size);
            const download = await fetch(`${base}/api/files/${file.id}`, {
              headers: { Cookie: bob, Range: 'bytes=0-11' },
            });
            assert.equal(download.status, 206);
            assert.equal(Buffer.from(await download.arrayBuffer()).toString('ascii', 4, 8), 'ftyp');
            const encoded = path.join(directory, file.id + '.mp4');
            assert.ok(
              !(await readdir(directory)).includes(file.id),
              'the retired original is released',
            );
            const { stdout } = await run(ffprobe, [
              '-v',
              'error',
              '-show_entries',
              'stream=codec_name,width,height',
              '-of',
              'json',
              encoded,
            ]);
            const [video] = JSON.parse(stdout).streams;
            assert.deepEqual([video.codec_name, video.width, video.height], ['h264', 1280, 720]);
            if (extension === 'mp4') assert.ok(converted.size < bytes.length);
          }
        },
      );
    } finally {
      server.kill();
      await db.end();
      await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
