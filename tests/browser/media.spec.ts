import { test, expect, type Page } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 375, height: 812 } });

async function chat(page: Page) {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /На выходные/ }).click();
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible();
}

// Exercise the browser's real encoder with a synthetic signal, never the user's microphone.
async function syntheticMicrophone(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { testStreams: MediaStream[] };
    state.testStreams = [];
    // WebKit can recreate the MediaDevices wrapper; an own-property stub can disappear.
    // Its prototype remains stable, so the browser's real encoder always receives our signal.
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        oscillator.connect(destination);
        oscillator.start();
        await context.resume();
        state.testStreams.push(destination.stream);
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            stop();
            void context.close().catch(() => {});
          };
        }
        return destination.stream;
      },
    });
  });
}

test('photo attachment opens full-screen and keeps touch controls inside a narrow viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await chat(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWT0AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  const image = page.locator('.image-preview img');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Открыть фото photo.png', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Просмотр фото photo.png', exact: true }),
  ).toBeVisible();
  const close = page.getByRole('button', { name: 'Закрыть фотографию', exact: true });
  const box = (await close.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath('photo-viewer.png'), animations: 'disabled' });
  await close.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('voice recording produces playable audio; cancelling and changing chat release all tracks', async ({
  page,
}, testInfo) => {
  await syntheticMicrophone(page);
  await chat(page);
  await page.getByRole('button', { name: 'Записать голосовое сообщение', exact: true }).click();
  await expect(page.locator('.recording-time')).toHaveText('00:01', { timeout: 10000 });
  await page.screenshot({
    path: testInfo.outputPath('voice-recording.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Завершить запись', exact: true }).click();
  await expect(page.locator('.pending-file')).toContainText('Голосовое-');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await expect(page.locator('.audio-attachment audio')).toBeVisible();
  await expect
    .poll(() => page.locator('audio').evaluate((element) => element.readyState))
    .toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Записать голосовое сообщение', exact: true }).click();
  await expect(page.locator('.recording-time')).toBeVisible();
  await page.getByRole('button', { name: 'Отменить запись', exact: true }).click();
  await expect(page.locator('.voice-recording')).toHaveCount(0);
  await expect(page.locator('.pending-file')).toHaveCount(0);
  await page.getByRole('button', { name: 'Записать голосовое сообщение', exact: true }).click();
  await expect(page.locator('.recording-time')).toBeVisible();
  await page.getByRole('button', { name: 'Назад к чатам', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { testStreams: MediaStream[] }).testStreams.length,
    ),
  ).toBe(3);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { testStreams: MediaStream[] }).testStreams.every((stream) =>
          stream.getTracks().every((track) => track.readyState === 'ended'),
        ),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: /Аня.*плейлист/ }).click();
  await expect(page.locator('.pending-file')).toHaveCount(0);
});

test('microphone denial gives a recoverable error without losing a text draft', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
      configurable: true,
      value: async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      },
    });
  });
  await chat(page);
  await page.getByRole('button', { name: 'Записать голосовое сообщение', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Разрешите доступ к микрофону');
  await expect(
    page.getByRole('button', { name: 'Записать голосовое сообщение', exact: true }),
  ).toBeEnabled();
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Тогда напишу текстом');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await expect(page.locator('.bubble').last()).toContainText('Тогда напишу текстом');
});
