import { test, expect } from '@playwright/test';

// Chromium's fake camera and microphone: never the user's real devices.
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['camera', 'microphone'],
  viewport: { width: 1280, height: 820 },
});

test('round video: record, attach, send and play', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Fake capture devices are a Chromium switch.');
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('tab', { name: 'Голос и видео', exact: true }).click();
  await page.getByRole('switch', { name: 'Отзеркалить камеру', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Отзеркалить камеру', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Чаты', exact: true }).click();
  await page.locator('.chat-item', { hasText: 'На выходные' }).click();
  await page.getByRole('button', { name: 'Записать кружок', exact: true }).click();
  const recorder = page.getByRole('dialog', { name: 'Запись кружка', exact: true });
  await expect(recorder.locator('video')).toHaveClass('camera-mirrored');
  await expect(recorder.locator('.recording-time')).toHaveText('0:02', { timeout: 10000 });
  await recorder.getByRole('button', { name: 'Завершить кружок', exact: true }).click();
  await expect(recorder).toHaveCount(0);
  await expect(page.locator('.pending-file')).toContainText('Кружок');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  const note = page.locator('.video-note').last();
  // The recorder writes no length into the header; the player still finds it.
  await expect(note.locator('.video-note-time')).toHaveText(/^0:0[1-3]$/);
  await note.click();
  await expect(note).toHaveClass(/playing/);
  await expect(page.locator('.chat-item').first()).toContainText('Вы: Кружок');
});

test('video keeps its position and element when fullscreen rotates', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'The test records a fixture with Chromium fake capture.');
  await page.goto('/?demo=1');
  await page.locator('.chat-item', { hasText: 'На выходные' }).click();
  const bytes = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    try {
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const data = new Promise<Blob>((resolve) => {
        recorder.ondataavailable = ({ data }) => resolve(data);
      });
      recorder.start();
      // Long enough that a click lands before the clip ends.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      recorder.stop();
      return Array.from(new Uint8Array(await (await data).arrayBuffer()));
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'video.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('.pending-file .video-inline button')).toHaveCount(1);
  await expect(page.getByRole('slider', { name: 'Позиция видео' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Громкость видео' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  const video = page.locator('.video-player video');
  await expect(video).toHaveCount(1);
  await page.getByRole('button', { name: 'Воспроизвести видео', exact: true }).click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.05);
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  const position = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  await video.evaluate((element) => {
    element.dataset.original = 'true';
  });
  // The middle of the picture is the play button; anywhere else opens the full player.
  await page
    .getByRole('button', { name: 'Открыть видео', exact: true })
    .click({ position: { x: 24, y: 40 } });
  await expect(page.locator('.video-player:modal')).toBeVisible();
  // The volume slider grows out of the sound button under the pointer.
  await page.getByRole('button', { name: 'Выключить звук', exact: true }).hover();
  await page.getByRole('slider', { name: 'Громкость видео' }).fill('35');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.volume)).toBe(0.35);
  await page.getByRole('combobox', { name: 'Скорость видео' }).selectOption('1.5');
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.playbackRate))
    .toBe(1.5);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.video-player:modal video')).toHaveAttribute('data-original', 'true');
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(
    position,
    2,
  );
  await page.getByRole('button', { name: 'Выйти из полноэкранного режима', exact: true }).click();
  await expect(page.locator('.video-player:modal')).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Громкость видео' })).toHaveCount(0);
  await expect(video).toHaveAttribute('data-original', 'true');
});

test('photo viewer zooms and resets; dialogs survive a text selection dragged outside', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await page.locator('.chat-item', { hasText: 'На выходные' }).click();
  await page.getByLabel('Прикрепить файл', { exact: true }).click();
  const fileChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Галерея', exact: true }).click();
  const chooser = await fileChooser;
  expect(await chooser.element().getAttribute('accept')).toBe('image/*,video/*');
  await chooser.setFiles({
    name: 'zoom.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWT0AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть фото zoom.png', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'Просмотр фото zoom.png', exact: true });
  await page.setViewportSize({ width: 320, height: 640 });
  for (const name of ['Уменьшить', 'Увеличить', 'Скачать фотографию', 'Закрыть фотографию']) {
    await expect(viewer.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await page.setViewportSize({ width: 1280, height: 820 });
  const image = viewer.locator('.media-full-image');
  await viewer.getByRole('button', { name: 'Увеличить', exact: true }).click();
  await expect.poll(() => image.evaluate((el) => el.style.transform)).toContain('scale(1.5)');
  await page.keyboard.press('0');
  await expect.poll(() => image.evaluate((el) => el.style.transform)).toContain('scale(1)');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  // Select text in a field and release the mouse over the backdrop: the dialog stays.
  await page.getByRole('button', { name: 'Новый чат', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Новый чат', exact: true });
  const field = dialog.getByLabel('Найти пользователя', { exact: true });
  await field.fill('выделяемый текст');
  const box = (await field.boundingBox())!;
  await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(4, 4, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(dialog).toBeVisible();
  // A real click on the backdrop still closes it.
  await page.mouse.click(4, 4);
  await expect(dialog).toHaveCount(0);
});

test('chat rows share one height whatever the preview length', async ({ page }) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.chat-item').nth(3)).toBeVisible();
  const heights = await page
    .locator('.chat-item')
    .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  expect(heights.length).toBeGreaterThan(2);
  expect(new Set(heights).size).toBe(1);
});
