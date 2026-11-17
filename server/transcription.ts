import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import { writeVoiceWav } from './audio.js';

const run = promisify(execFile);

export async function transcribeVoice(
  source: string,
  mime: string,
  model: string,
  signal?: AbortSignal,
) {
  const dir = await mkdtemp(path.join(tmpdir(), 'galinka-whisper-'));
  try {
    const wav = path.join(dir, 'voice.wav');
    await writeVoiceWav(source, mime, wav);
    const output = path.join(dir, 'result');
    await run(
      process.env.WHISPER_PATH || 'whisper-cli',
      [
        '-m',
        model,
        '-l',
        'auto',
        '-t',
        '2',
        '-ng',
        '-np',
        '-nt',
        '-sns',
        '-otxt',
        '-of',
        output,
        '-f',
        wav,
      ],
      {
        signal,
        timeout: 5 * 60_000,
        killSignal: 'SIGKILL',
        maxBuffer: 128 * 1024,
        windowsHide: true,
      },
    );
    // The CLI can exit successfully after rejecting input without writing a transcript.
    return (await readFile(output + '.txt', 'utf8')).trim().replace(/\s+/gu, ' ');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** One recognition at a time per server. An interrupted job can be claimed after its lease. */
export function startTranscriptionWorker(pool: Pool, directory: string, model: string | undefined) {
  const stop = new AbortController();
  let working: Promise<void> | undefined;
  async function next(modelPath: string) {
    const { rows } = await pool.query(
      `UPDATE voice_transcripts t SET state='running',updated_at=clock_timestamp() FROM files f
         WHERE t.file_id=(SELECT file_id FROM voice_transcripts WHERE state='pending'
           OR (state='running' AND updated_at<now()-interval '7 minutes')
           ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED) AND f.id=t.file_id
         RETURNING f.id,f.mime,t.updated_at::text AS lease`,
    );
    const job = rows[0];
    if (!job) return;
    let transcript: string | null = null;
    try {
      transcript = await transcribeVoice(
        path.join(directory, job.id),
        job.mime,
        modelPath,
        stop.signal,
      );
    } catch {
      if (!stop.signal.aborted) console.error('Voice transcription failed for file', job.id);
    }
    const state = stop.signal.aborted ? 'pending' : transcript === null ? 'failed' : 'ready';
    await pool.query(
      `UPDATE voice_transcripts SET state=$2,transcript=$3,updated_at=now()
         WHERE file_id=$1 AND state='running' AND updated_at=$4`,
      [job.id, state, state === 'ready' ? transcript : null, job.lease],
    );
  }
  const timer = setInterval(() => {
    if (model && !working)
      working = next(model)
        .catch(() => console.error('Voice transcription queue unavailable'))
        .finally(() => {
          working = undefined;
        });
  }, 2000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    stop.abort();
    await working;
  };
}
