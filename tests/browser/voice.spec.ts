import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { voiceChat, voiceTests } from './helpers/voice-suite';
voiceTests();

test('an attached audio file above the old 20 MB limit plays in the chat', async ({ page }) => {
  const audio = await readFile('tests/fixtures/voice-webkit.m4a');
  // A valid MP4 free-space box keeps the audio short and the upload above the old limit.
  const padding = Buffer.alloc(21 * 1024 * 1024);
  padding.writeUInt32BE(padding.length);
  padding.write('free', 4);
  await page.route('**/api/files/slow?inline=1', (route) =>
    route.fulfill({ contentType: 'audio/mp4', body: Buffer.concat([audio, padding]) }),
  );
  await voiceChat(page);
  const player = page.locator('.messages .audio-attachment').first();
  await player.locator('.voice-play').click();
  await expect
    .poll(() => player.locator('audio').evaluate((element) => element.currentTime))
    .toBeGreaterThan(0);
});
