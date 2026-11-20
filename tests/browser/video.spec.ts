import { test, expect, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Chromium's fake camera and microphone: never the user's real devices.
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['camera', 'microphone'],
  viewport: { width: 1280, height: 820 },
});

async function flipOf(video: Locator) {
  return video.evaluate((element) => {
    const style = getComputedStyle(element);
    const scaleX = style.scale === 'none' ? 1 : Number(style.scale.split(' ')[0]);
    const transformX = style.transform === 'none' ? 1 : new DOMMatrix(style.transform).a;
    return Math.sign(scaleX * transformX);
  });
}

test('round video preview is not flipped unless the recording is', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Fake capture devices are a Chromium switch.');
  await page.goto('/?demo=1');
  await page.locator('.chat-item', { hasText: 'На выходные' }).click();
  await page.getByRole('button', { name: 'Записать кружок', exact: true }).click();
  const recorder = page.getByRole('dialog', { name: 'Запись кружка', exact: true });
  await expect(recorder.locator('.recording-time')).toHaveText('0:01', { timeout: 10000 });
  expect(await flipOf(recorder.locator('video'))).toBe(1);
  await recorder.getByRole('button', { name: 'Отменить кружок', exact: true }).click();
});

test('round video: record, attach, send and play', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Fake capture devices are a Chromium switch.');
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Голос и видео', exact: true }).click();
  await page.getByRole('switch', { name: 'Отзеркалить камеру', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Отзеркалить камеру', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Чаты', exact: true }).click();
  await page.locator('.chat-item', { hasText: 'На выходные' }).click();
  await page.getByRole('button', { name: 'Записать кружок', exact: true }).click();
  const recorder = page.getByRole('dialog', { name: 'Запись кружка', exact: true });
  await expect(recorder.locator('video')).toHaveClass('camera-mirrored');
  // One flip, not two: the preview shows what the recording will contain.
  expect(await flipOf(recorder.locator('video'))).toBe(-1);
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
  await note.click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'Голосовое-тест.m4a',
    mimeType: 'audio/mp4',
    buffer: await readFile('tests/fixtures/voice-webkit.m4a'),
  });
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  const voice = page.locator('.messages .voice-player');
  await voice.locator('.voice-play').click();
  await expect(voice).toHaveAttribute('data-state', 'playing');
  await note.click();
  await expect(voice).not.toHaveAttribute('data-state', 'playing');
  await expect(note).toHaveClass(/playing/);
  await voice.locator('.voice-play').click();
  await expect(note).not.toHaveClass(/playing/);
  await expect(page.locator('.mini-player-title')).toContainText('Голосовое сообщение');
});

test('a video note switches exclusive cameras and keeps both scenes in one recording', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Uses the Chromium fake microphone and canvas capture.');
  await page.addInitScript(() => {
    const devices = navigator.mediaDevices;
    const microphone = devices.getUserMedia.bind(devices);
    Object.defineProperty(devices, 'enumerateDevices', {
      value: async () => ['front', 'back'].map((deviceId) => ({ kind: 'videoinput', deviceId })),
    });
    let previous: MediaStreamTrack | undefined;
    Object.defineProperty(devices, 'getUserMedia', {
      value: async (constraints: MediaStreamConstraints) => {
        const exact = (
          (constraints.video as MediaTrackConstraints)?.deviceId as ConstrainDOMStringParameters
        )?.exact;
        const id = exact === 'back' ? 'back' : 'front';
        if (previous?.readyState === 'live')
          throw new DOMException('Camera is busy', 'NotReadableError');
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 160;
        const context = canvas.getContext('2d')!;
        const stream = canvas.captureStream(20);
        const track = stream.getVideoTracks()[0];
        previous = track;
        const draw = () => {
          if (track.readyState !== 'live') return;
          context.fillStyle = id === 'front' ? '#e10b0b' : '#0be10b';
          context.fillRect(0, 0, 160, 160);
          requestAnimationFrame(draw);
        };
        draw();
        track.getSettings = () => ({
          deviceId: id,
          facingMode: id === 'front' ? 'user' : 'environment',
        });
        if (constraints.audio)
          (await microphone({ audio: true }))
            .getAudioTracks()
            .forEach((audio) => stream.addTrack(audio));
        return stream;
      },
    });
  });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Записать кружок', exact: true }).click();
  const recording = page.getByRole('dialog', { name: 'Запись кружка' });
  await expect(recording.locator('.recording-time')).toHaveText('0:01');
  await recording.getByRole('button', { name: 'Сменить камеру' }).click();
  await expect
    .poll(() =>
      recording
        .locator('video')
        .evaluate(
          (video) =>
            ((video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0].getSettings()
              .deviceId,
        ),
    )
    .toBe('back');
  await expect(recording.locator('.recording-time')).toHaveText('0:03');
  await recording.getByRole('button', { name: 'Завершить кружок' }).click();
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  const note = page.locator('.video-note video');
  await expect(page.locator('.video-note-time')).toHaveText(/0:0[3-5]/);
  const frames = await note.evaluate(async (element: HTMLVideoElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const frame = async (second: number) => {
      const sought = new Promise<void>((done) =>
        element.addEventListener('seeked', () => done(), { once: true }),
      );
      element.currentTime = second;
      await sought;
      ctx.drawImage(element, 0, 0, 1, 1);
      const [red, green] = ctx.getImageData(0, 0, 1, 1).data;
      return red > green ? 'front' : 'back';
    };
    return [await frame(0.4), await frame(element.duration - 0.3)];
  });
  expect(frames).toEqual(['front', 'back']);
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
  await page
    .getByRole('dialog', { name: /^Отправить/ })
    .getByRole('button', { name: 'Отправить', exact: true })
    .click();
  const video = page.locator('.video-player video');
  await expect(video).toHaveCount(1);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'after-video.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWT0AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page
    .getByRole('dialog', { name: /^Отправить/ })
    .getByRole('button', { name: 'Отправить', exact: true })
    .click();
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

  await page
    .getByRole('button', { name: 'Открыть видео', exact: true })
    .click({ position: { x: 24, y: 40 } });
  await page.keyboard.press('ArrowRight');
  const viewer = page.getByRole('dialog', { name: 'Просмотр фотографии' });
  await expect(viewer).toContainText('2 из 2');
  await viewer.getByRole('button', { name: 'Предыдущее вложение' }).click();
  const galleryVideo = page.getByRole('dialog', { name: 'Видео video.webm' });
  await expect(galleryVideo).toBeVisible();
  await expect(galleryVideo.getByRole('combobox', { name: 'Скорость видео' })).toBeVisible();
  await galleryVideo.getByRole('button', { name: 'Следующее вложение' }).click();
  await expect(viewer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog:modal')).toHaveCount(0);
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
  await page
    .getByRole('dialog', { name: /^Отправить/ })
    .getByRole('button', { name: 'Отправить', exact: true })
    .click();
  await page.getByRole('button', { name: 'Открыть фото zoom.png', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'Просмотр фотографии', exact: true });
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
