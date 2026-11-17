import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

/** Largest file a resumable upload accepts; the single-request upload stays at 20 MB. */
export const maxUploadBytes = 100 * 1024 * 1024;
export const maxAccountFileBytes = 500 * 1024 * 1024;
export async function fileUsage(db: PoolClient, userId: string) {
  const {
    rows: [usage],
  } = await db.query(
    `SELECT (SELECT COALESCE(sum(size),0) FROM files WHERE user_id=$1) + COALESCE(sum(size),0) AS total,
       count(*)::int AS open FROM uploads WHERE user_id=$1`,
    [userId],
  );
  return { bytes: Number(usage.total), open: Number(usage.open) };
}
export const videoPath = (directory: string, id: string) => path.join(directory, id + '.mp4');
const bars = 48;

/** Size and a tiny blurred preview the client measured before sending a photo or video. */
export const mediaMetaSchema = z.object({
  width: z.coerce.number().int().min(1).max(20000).optional(),
  height: z.coerce.number().int().min(1).max(20000).optional(),
  thumb: z
    .string()
    .max(4000)
    .regex(/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+={0,2}$/)
    .optional(),
});
export type MediaMeta = z.infer<typeof mediaMetaSchema>;
/** Only pictures and videos keep their size and preview; anything else drops them. */
export const visualMeta = (mime: string, meta: MediaMeta) =>
  /^(image|video)\//.test(mime) && meta.width && meta.height
    ? { width: meta.width, height: meta.height, thumb: meta.thumb ?? null }
    : { width: null, height: null, thumb: null };

/** Loudness bars (0..31) of mono signed 16-bit PCM, peak per slice, scaled to the loudest. */
export function peaks(pcm: Buffer, count = bars): number[] {
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return [];
  const result: number[] = [];
  for (let bar = 0; bar < count; bar++) {
    const from = Math.floor((bar * samples) / count);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * samples) / count));
    let peak = 0;
    for (let i = from; i < to && i < samples; i++)
      peak = Math.max(peak, Math.abs(pcm.readInt16LE(i * 2)));
    result.push(peak);
  }
  const loudest = Math.max(...result);
  return result.map((value) => (loudest ? Math.round((value / loudest) * 31) : 0));
}

function run(args: string[], timeoutMs: number, collect = 0) {
  return new Promise<Buffer>((resolve, reject) => {
    const executable = process.env.FFMPEG_PATH || 'ffmpeg';
    const child = spawn(executable, args, {
      stdio: ['ignore', collect ? 'pipe' : 'ignore', 'ignore'],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= collect) chunks.push(chunk);
      else child.kill('SIGKILL');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(Error(`ffmpeg exited with ${code}`));
    });
  });
}
const safeInput = (format: string, source: string) => [
  '-nostdin',
  '-hide_banner',
  '-loglevel',
  'error',
  '-threads',
  '2',
  '-filter_threads',
  '1',
  '-protocol_whitelist',
  'file,pipe',
  '-f',
  format,
  '-i',
  source,
];

/** The waveform of a normalized voice message (AAC in MP4); null when it cannot be read. */
export async function voiceWaveform(filename: string) {
  try {
    // 2000 samples a second is plenty for 48 bars; five minutes is 1.2 MB of PCM.
    const pcm = await run(
      [
        ...safeInput('mov', filename),
        '-map',
        '0:a:0',
        '-ac',
        '1',
        '-ar',
        '2000',
        '-f',
        's16le',
        'pipe:1',
      ],
      20_000,
      2 * 1024 * 1024,
    );
    const result = peaks(pcm);
    return result.length ? result : null;
  } catch {
    return null;
  }
}

/** WebM does not play in Safari on older iOS; big videos are made smaller for phones. */
export const needsVideoWork = (mime: string, size: number) =>
  mime === 'video/webm' || (/^video\/(mp4|quicktime)$/.test(mime) && size > 20 * 1024 * 1024);

export function videoArgs(source: string, mime: string, target: string, note: boolean) {
  return [
    ...safeInput(mime === 'video/webm' ? 'matroska' : 'mov', source),
    '-y',
    '-threads',
    '2',
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-map_metadata',
    '-1',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    note ? '26' : '28',
    // Never upscale; at most 1280 px on the long side, even sizes for H.264.
    '-vf',
    "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-movflags',
    '+faststart',
    // A file hitting this cutoff must also exceed the publication limit, since
    // ffmpeg can return success when it stops at -fs before the end of a video.
    '-fs',
    String(2 * maxUploadBytes),
    '-f',
    'mp4',
    target,
  ];
}

/**
 * Converts queued videos one at a time, after the message is already sent: the recipient sees
 * the original at once and the MP4 replaces it in place (same file id). A failed conversion keeps
 * the original after three attempts.
 */
export function startMediaWorker(
  pool: Pool,
  directory: string,
  changed: (fileId: string) => Promise<void>,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  async function next() {
    const { rows } = await pool.query(
      `UPDATE media_jobs j SET started_at=now(),attempts=attempts+1 FROM files f
       WHERE j.file_id=(SELECT mj.file_id FROM media_jobs mj JOIN files mf ON mf.id=mj.file_id
         WHERE (mj.attempts<3 OR mf.converted_video) AND (mj.started_at IS NULL OR mj.started_at<now()-interval '30 minutes')
         ORDER BY mj.created_at LIMIT 1 FOR UPDATE OF mj SKIP LOCKED) AND f.id=j.file_id
       RETURNING f.id,f.mime,f.size,f.name,f.user_id,f.converted_video`,
    );
    const job = rows[0];
    if (!job) {
      const { rows: abandoned } = await pool.query(
        `DELETE FROM media_jobs j USING files f WHERE f.id=j.file_id AND NOT f.converted_video
         AND j.attempts>=3 AND j.started_at<now()-interval '30 minutes' RETURNING j.file_id`,
      );
      for (const row of abandoned) await unlink(videoPath(directory, row.file_id)).catch(() => {});
      return false;
    }
    const source = path.join(directory, job.id);
    const target = `${source}.${randomUUID()}.mp4.part`;
    async function retireOriginal() {
      await unlink(source).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
      });
      await pool.query('DELETE FROM media_jobs WHERE file_id=$1', [job.id]);
    }
    try {
      if (job.converted_video) {
        await retireOriginal();
        return true;
      }
      await run(videoArgs(source, job.mime, target, job.name.startsWith('Кружок')), 15 * 60_000);
      const output = await stat(target);
      // Keep a smaller original unless the format itself is the problem.
      let replace =
        output.size > 0 &&
        output.size <= maxUploadBytes &&
        (job.mime === 'video/webm' || output.size < job.size);
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        if (replace && output.size > job.size) {
          await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [job.user_id]);
          const usage = await fileUsage(db, job.user_id);
          replace = usage.bytes - job.size + output.size <= maxAccountFileBytes;
        }
        const still = await db.query('SELECT 1 FROM files WHERE id=$1 FOR UPDATE', [job.id]);
        replace &&= Boolean(still.rowCount);
        if (replace) {
          // Prepare the new bytes before publishing the pointer. Readers of
          // an uncommitted or rolled-back row still have the intact original.
          await rename(target, videoPath(directory, job.id));
          await db.query(
            `UPDATE files SET converted_video=true,size=$2,mime='video/mp4',name=regexp_replace(name,'\\.[^.]+$','')||'.mp4' WHERE id=$1`,
            [job.id, output.size],
          );
        } else {
          await unlink(videoPath(directory, job.id)).catch(() => {});
          await db.query('DELETE FROM media_jobs WHERE file_id=$1', [job.id]);
        }
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        db.release();
      }
      if (replace) {
        try {
          await changed(job.id);
        } finally {
          // The queued row also records cleanup work after a crash or a reader
          // still holding the old file on Windows.
          await retireOriginal();
        }
      }
    } catch {
      console.error('Video conversion failed');
    } finally {
      await unlink(target).catch(() => {});
    }
    return true;
  }
  async function tick() {
    let more = false;
    try {
      more = await next();
    } catch {
      console.error('Media queue unavailable');
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void tick(), more ? 0 : 5000);
        timer.unref();
      }
    }
  }
  timer = setTimeout(() => void tick(), 1000);
  timer.unref();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
