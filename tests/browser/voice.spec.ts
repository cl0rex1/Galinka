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

test('a recording plays directly in the profile and stops when leaving its tab', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await voiceChat(page, true);
  const body = await readFile('tests/fixtures/voice-webkit.m4a');
  await page.route('**/api/files/slow?inline=1', (route) =>
    route.fulfill({ body, contentType: 'audio/mp4' }),
  );
  await page.route('**/api/chats/voice-chat/media?*', (route) =>
    route.fulfill({
      json: {
        more: false,
        items: route.request().url().includes('type=voice')
          ? [
              {
                id: 'slow',
                cursor: 'slow',
                sender_name: 'Друг',
                created_at: new Date().toISOString(),
                body: '',
                file: {
                  id: 'slow',
                  mime: 'audio/mp4',
                  size: body.length,
                  name: 'Голосовое-пример.m4a',
                },
              },
            ]
          : [],
      },
    }),
  );
  await page.locator('.chat-heading').click();
  const section = page.locator('.chat-media');
  await section.getByRole('tab', { name: 'Голосовые' }).click();
  await section.locator('.voice-play').click();
  const audio = await section.locator('audio').elementHandle();
  await expect.poll(() => audio!.evaluate((el) => el.currentTime)).toBeGreaterThan(0);
  await section.getByRole('tab', { name: 'Файлы' }).click();
  await expect(section.locator('audio')).toHaveCount(0);
  expect(await audio!.evaluate((el) => el.paused)).toBe(true);
});
