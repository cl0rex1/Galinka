import { spawn } from 'node:child_process';
import { mkdir, readdir, rename, stat, unlink, utimes } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const maxInputBytes = 20 * 1024 * 1024;
const maxOutputBytes = 8 * 1024 * 1024;
const cacheLimit = 128 * 1024 * 1024;
const maxSeconds = 305;
const audioTypes = new Map([
  ['audio/webm', 'matroska'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'mov'],
]);
export const isRecordedAudio = (mime: string) => audioTypes.has(mime);
export class AudioError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let active = 0;
const waiting: (() => void)[] = [];
async function bounded<T>(work: () => Promise<T>) {
  if (active >= 2) {
    if (waiting.length >= 8)
      throw new AudioError(
        503,
        'Сейчас обрабатываются другие голосовые. Попробуйте ещё раз через несколько секунд.',
      );
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else active++;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
function command(binary: 'ffmpeg' | 'ffprobe', args: string[], timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const executable = process.env[binary === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'] || binary;
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '',
      settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(
        new AudioError(
          422,
          'Не удалось обработать голосовое вовремя. Попробуйте более короткую запись.',
        ),
      );
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 16384) {
        child.kill('SIGKILL');
        finish(new AudioError(422, 'Некорректный аудиофайл.'));
      }
    });
    child.on('error', () =>
      finish(new AudioError(503, 'Обработка голосовых временно недоступна. Попробуйте позже.')),
    );
    child.on('close', (code) =>
      finish(
        code === 0
          ? undefined
          : new AudioError(
              422,
              'Не удалось прочитать аудиозапись. Запишите её ещё раз или скачайте исходный файл.',
            ),
      ),
    );
  });
}
async function encode(source: string, target: string, mime: string) {
  const input = await stat(source).catch(() => null);
  if (!input?.isFile()) throw new AudioError(404, 'Аудиофайл не найден.');
  if (!input.size || input.size > maxInputBytes)
    throw new AudioError(422, 'Запись пуста или превышает 20 МБ.');
  const demuxer = audioTypes.get(mime);
  if (!demuxer) throw new AudioError(422, 'Неподдерживаемый формат голосового.');
  try {
    // Fixed demuxers and protocols prevent uploaded playlists/reference files from
    // becoming network requests. Bound both decoding time and the generated file.
    await command(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-max_alloc',
        '67108864',
        '-threads',
        '1',
        '-filter_threads',
        '1',
        '-protocol_whitelist',
        'file,pipe',
        '-probesize',
        '2097152',
        '-analyzeduration',
        '5000000',
        '-f',
        demuxer,
        '-i',
        source,
        '-map',
        '0:a:0',
        '-vn',
        '-sn',
        '-dn',
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-t',
        String(maxSeconds + 1),
        '-c:a',
        'aac',
        '-ac',
        '1',
        '-ar',
        '48000',
        '-b:a',
        '64k',
        '-threads',
        '1',
        '-movflags',
        '+faststart',
        '-fs',
        String(maxOutputBytes),
        '-f',
        'mp4',
        target,
      ],
      45_000,
    );
    const output = await stat(target);
    if (!output.size || output.size > maxOutputBytes)
      throw new AudioError(422, 'Некорректный размер голосового.');
    const metadata = JSON.parse(
      await command(
        'ffprobe',
        [
          '-v',
          'error',
          '-f',
          'mov',
          '-protocol_whitelist',
          'file,pipe',
          '-select_streams',
          'a:0',
          '-show_entries',
          'format=duration:stream=codec_name',
          '-of',
          'json',
          target,
        ],
        5000,
      ),
    );
    const duration = Number(metadata.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || metadata.streams?.[0]?.codec_name !== 'aac')
      throw new AudioError(422, 'Аудиозапись повреждена. Запишите её ещё раз.');
    if (duration > maxSeconds)
      throw new AudioError(422, 'Голосовое слишком длинное. Максимум — 5 минут.');
    return { size: output.size, duration };
  } catch (error) {
    await unlink(target).catch(() => {});
    throw error;
  }
}

// Newly uploaded audio becomes one universally playable file before the database
// row is committed. An interrupted/failed conversion leaves no partial attachment.
export async function normalizeUploadedAudio(filename: string, mime: string) {
  if (!isRecordedAudio(mime)) return null;
  return bounded(async () => {
    const temporary = `${filename}.${randomUUID()}.m4a`;
    try {
      const result = await encode(filename, temporary, mime);
      await rename(temporary, filename);
      return result;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  });
}

const leases = new Map<string, number>();
const conversions = new Map<string, Promise<void>>();
let trimming = Promise.resolve();
let reserved = 0;
async function cacheSpace(directory: string, reserve = 0) {
  const trim = async () => {
    const names = await readdir(directory);
    const files = (
      await Promise.all(
        names
          .filter((name) => /^[a-f0-9-]{36}\.m4a$/.test(name))
          .map(async (name) => {
            const filename = path.join(directory, name);
            const info = await stat(filename).catch(() => null);
            return info?.isFile() ? { filename, size: info.size, modified: info.mtimeMs } : null;
          }),
      )
    )
      .filter((file) => file !== null)
      .sort((left, right) => left.modified - right.modified);
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files) {
      if (total + reserved + reserve <= cacheLimit) break;
      if (leases.has(file.filename) || conversions.has(file.filename)) continue;
      await unlink(file.filename);
      total -= file.size;
    }
    if (total + reserved + reserve > cacheLimit)
      throw new AudioError(
        503,
        'Обработка голосовых занята. Повторите попытку через несколько секунд.',
      );
    reserved += reserve;
    // A process crash can leave bounded partial conversions; never remove a
    // current conversion, whose deadline is only 45 seconds.
    for (const name of names.filter((value) => value.endsWith('.part'))) {
      const filename = path.join(directory, name);
      const info = await stat(filename).catch(() => null);
      if (info && info.mtimeMs < Date.now() - 600_000) await unlink(filename).catch(() => {});
    }
  };
  const operation = trimming.then(trim, trim);
  trimming = operation.catch(() => {});
  await operation;
  return () => {
    reserved -= reserve;
  };
}

// Existing recordings remain byte-for-byte intact. Only this expendable, bounded
// AAC cache is evicted; the same authenticated endpoint can recreate it later.
export async function audioPreview(filename: string, mime: string) {
  const directory = path.join(path.dirname(filename), '.voice-cache-aac-v1');
  const target = path.join(directory, path.basename(filename) + '.m4a');
  // An eviction may already have issued unlink before a new reader arrives.
  // Acquire the lease only after that serialized operation has completed.
  await trimming;
  leases.set(target, (leases.get(target) || 0) + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const remaining = (leases.get(target) || 1) - 1;
    if (remaining) leases.set(target, remaining);
    else leases.delete(target);
  };
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const cached = await stat(target).catch(() => null);
    if (!cached?.isFile() || !cached.size || cached.size > maxOutputBytes) {
      let conversion = conversions.get(target);
      if (!conversion) {
        conversion = bounded(async () => {
          const temporary = `${target}.${randomUUID()}.part`;
          const releaseReservation = await cacheSpace(directory, maxOutputBytes);
          try {
            await encode(filename, temporary, mime);
            await rename(temporary, target);
          } finally {
            await unlink(temporary).catch(() => {});
            releaseReservation();
          }
        }).finally(() => conversions.delete(target));
        conversions.set(target, conversion);
      }
      await conversion;
    }
    const now = new Date();
    await utimes(target, now, now).catch(() => {});
    await cacheSpace(directory);
    return { path: target, release };
  } catch (error) {
    release();
    throw error;
  }
}

export async function removeAudioPreview(filename: string) {
  const target = path.join(path.dirname(filename), '.voice-cache-aac-v1', path.basename(filename) + '.m4a');
  // The original is removed first by the caller. A decoder which already opened
  // it can still finish, so remove its output after the in-flight conversion.
  await conversions.get(target)?.catch(() => {});
  await unlink(target).catch(() => {});
}
