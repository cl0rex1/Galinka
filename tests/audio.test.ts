import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, readdir, stat, rm, open, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { AudioError, audioPreview, normalizeUploadedAudio } from '../server/audio';

const run = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const available = await run(ffmpeg, ['-version']).then(
  () => true,
  () => false,
);
const options = {
  skip: available ? false : 'Install ffmpeg/ffprobe to verify actual audio conversion.',
  timeout: 120000,
};
const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
async function signal(filename: string, seconds = 2) {
  // A real Opus stream with the same missing duration as MediaRecorder WebM.
  await run(ffmpeg, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    String(seconds),
    '-c:a',
    'libopus',
    '-b:a',
    '32k',
    '-f',
    'webm',
    '-live',
    '1',
    filename,
  ]);
}
async function metadata(filename: string) {
  const { stdout } = await run(ffprobe, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'format=duration:stream=codec_name',
    '-of',
    'json',
    filename,
  ]);
  return JSON.parse(stdout);
}

test(
  'voice: real durationless WebM becomes seekable AAC and existing originals remain unchanged',
  options,
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-audio-'));
    try {
      const original = path.join(directory, randomUUID());
      await signal(original);
      const bytes = await readFile(original);
      const input = await metadata(original);
      assert.equal(input.streams[0].codec_name, 'opus');
      assert.equal(input.format.duration, undefined);
      const [first, second] = await Promise.all([
        audioPreview(original, 'audio/webm'),
        audioPreview(original, 'audio/webm'),
      ]);
      try {
        assert.equal(first.path, second.path);
        assert.equal(digest(await readFile(original)), digest(bytes));
        const output = await metadata(first.path);
        assert.equal(output.streams[0].codec_name, 'aac');
        assert.ok(Number(output.format.duration) > 1.9);
        assert.equal(
          (await readdir(path.dirname(first.path))).filter((name) => name.endsWith('.m4a')).length,
          1,
        );
      } finally {
        first.release();
        second.release();
      }
      const uploaded = path.join(directory, randomUUID());
      await writeFile(uploaded, bytes);
      const result = await normalizeUploadedAudio(uploaded, 'audio/webm');
      assert.ok(result && result.duration > 1.9);
      assert.equal((await metadata(uploaded)).streams[0].codec_name, 'aac');
      assert.equal((await stat(uploaded)).size, result.size);
      assert.equal((await readdir(directory)).filter((name) => name.endsWith('.m4a')).length, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'voice: corrupted and overlong input fail without saving partial or silently truncated audio',
  options,
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-audio-invalid-'));
    try {
      const invalid = path.join(directory, randomUUID());
      await writeFile(invalid, Buffer.from('not an audio recording'));
      await assert.rejects(
        normalizeUploadedAudio(invalid, 'audio/mp4'),
        (error: unknown) => error instanceof AudioError && error.status === 422,
      );
      const long = path.join(directory, randomUUID());
      await signal(long, 307);
      const before = digest(await readFile(long));
      await assert.rejects(normalizeUploadedAudio(long, 'audio/webm'), /слишком длинное/);
      assert.equal(digest(await readFile(long)), before);
      assert.equal((await readdir(directory)).length, 2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'voice: conversion queue is bounded and cache eviction preserves an active response',
  options,
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'galinka-audio-bounds-'));
    try {
      const original = path.join(directory, randomUUID());
      await signal(original, 0.25);
      const bytes = await readFile(original);
      const filenames = Array.from({ length: 11 }, () => path.join(directory, randomUUID()));
      await Promise.all(filenames.map((name) => writeFile(name, bytes)));
      const results = await Promise.allSettled(
        filenames.map((name) => normalizeUploadedAudio(name, 'audio/webm')),
      );
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 10);
      const rejected = results.filter((result) => result.status === 'rejected');
      assert.equal(rejected.length, 1);
      assert.ok(rejected[0].reason instanceof AudioError);
      assert.equal(rejected[0].reason.status, 503);
      const active = await audioPreview(original, 'audio/webm');
      try {
        const cacheDirectory = path.dirname(active.path);
        for (let i = 0; i < 16; i++) {
          const filename = path.join(cacheDirectory, `${randomUUID()}.m4a`);
          const file = await open(filename, 'w');
          await file.truncate(8 * 1024 * 1024);
          await file.close();
          await utimes(filename, new Date(0), new Date(0));
        }
        const secondOriginal = path.join(directory, randomUUID());
        await writeFile(secondOriginal, bytes);
        const another = await audioPreview(secondOriginal, 'audio/webm');
        another.release();
        assert.ok((await stat(active.path)).size > 0);
        const entries = await readdir(cacheDirectory);
        const sizes = await Promise.all(
          entries.map((name) => stat(path.join(cacheDirectory, name)).then((info) => info.size)),
        );
        assert.ok(sizes.reduce((a, b) => a + b, 0) <= 128 * 1024 * 1024);
      } finally {
        active.release();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
