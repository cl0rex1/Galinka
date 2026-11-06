import { test, expect } from '@playwright/test';
import type { Attachment, Chat, Message, Person } from '../../src/types';

test('typing skips timeline React work and drafts still survive an immediate reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Use the development React profiling hook, without production instrumentation.
    const samples: { rendered: boolean; reusedProps: boolean; duration: number }[] = [];
    (window as any).timelineSamples = samples;
    const hook = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer: unknown) {
        hook.renderers.set(1, renderer);
        return 1;
      },
      onCommitFiberUnmount() {},
      onCommitFiberRoot(_id: number, root: any) {
        function visit(fiber: any) {
          if (!fiber) return;
          const name = fiber.type?.name || fiber.type?.type?.name;
          if (name?.startsWith('MessageList'))
            samples.push({
              rendered: Boolean(fiber.flags & 1), // React's PerformedWork flag.
              reusedProps: fiber.memoizedProps === fiber.alternate?.memoizedProps,
              duration: fiber.actualDuration,
            });
          visit(fiber.child);
          visit(fiber.sibling);
        }
        visit(root.current);
      },
    };
    (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  });
  await page.goto('/?demo=1');
  await expect(page.locator('.message-row')).not.toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).timelineSamples.length))
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    (window as any).timelineSamples.length = 0;
  });
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  const text = 'Черновик без повторной отрисовки переписки';
  await input.pressSequentially(text, { delay: 10 });
  const samples: { rendered: boolean; reusedProps: boolean; duration: number }[] =
    await page.evaluate(() => (window as any).timelineSamples);
  expect(samples.length).toBeGreaterThan(0);
  // Profile time includes the memo comparison itself; assert render bailouts, not wall time.
  expect(
    samples.every((sample) => !sample.rendered && sample.reusedProps),
    JSON.stringify(samples),
  ).toBe(true);
  await page.reload();
  await expect(input).toHaveValue(text);
});

test('returning to a conversation restores its history and reading position before the network responds', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?demo=1');
  await expect(page.locator('.message-row')).not.toHaveCount(0);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('galinka-demo-v1')!);
    const template = state.messages.find((message: any) => message.chat_id === 'weekend');
    state.messages = [
      ...state.messages.filter((message: any) => message.chat_id !== 'weekend'),
      ...Array.from({ length: 90 }, (_, index) => ({
        ...template,
        id: `cache-${index}`,
        nonce: `cache-${index}`,
        body: `История ${index}`,
        created_at: new Date(Date.now() - (90 - index) * 60000).toISOString(),
        reactions: [],
      })),
    ];
    localStorage.setItem('galinka-demo-v1', JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator('.message-row')).toHaveCount(60);
  await page.locator('.messages').evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.locator('.message-row')).toHaveCount(90);
  await page.locator('.messages').evaluate((element) => {
    element.scrollTop = 220;
  });
  await expect(
    page.getByRole('button', { name: 'К последним сообщениям', exact: true }),
  ).toBeVisible();
  const before = await page.locator('.messages').evaluate((element) => element.scrollTop);
  await page.locator('.chat-item').filter({ hasText: 'Аня' }).click();
  await expect(page.locator('.messages-loading')).toHaveCount(0);
  await expect(page.locator('.chat-header')).toContainText('Аня');
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 200);
  await page.locator('.chat-item').filter({ hasText: 'На выходные' }).click();
  await expect(page.locator('.message-row')).toHaveCount(90);
  await expect(page.locator('.messages-loading')).toHaveCount(0);
  expect(await page.locator('.messages').evaluate((element) => element.scrollTop)).toBeCloseTo(
    before,
    0,
  );
  await page.clock.resume();
});

test('a mention can be selected with Enter and opens the member profile', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.locator('.chat-item').filter({ hasText: 'На выходные' }).click();
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Привет @an');
  await expect(page.getByRole('group', { name: 'Упомянуть участника' })).toContainText('@anya');
  await input.press('Enter');
  await expect(input).toHaveValue('Привет @anya ');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await page.getByRole('link', { name: '@anya', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Аня', exact: true }),
  ).toBeVisible();
});

test('right click and a touch hold open message actions, while scrolling does not', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Real touch input is dispatched through Chromium CDP.');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto('/?demo=1');
    await page.locator('.chat-item').filter({ hasText: 'На выходные' }).click();
    const bubble = page.locator('.message-row').last().locator('.bubble');
    await bubble.click({ button: 'right' });
    await expect(page.locator('.message-menu[open]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    const box = (await bubble.boundingBox())!;
    const touch = await context.newCDPSession(page);
    const point = { x: box.x + 30, y: box.y + box.height / 2 };
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(500);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.message-menu[open]')).toHaveCount(1);
    await page
      .locator('.message-menu[open]')
      .getByRole('button', { name: 'Ответить', exact: true })
      .click();
    await expect(page.locator('.composer-context')).toBeVisible();
    await page.getByRole('button', { name: 'Отменить ответ', exact: true }).click();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x + 2, y: point.y - 55 }],
    });
    await page.waitForTimeout(500);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.message-menu[open]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a failed message keeps its voice preview and retries the same upload and nonce', async ({
  page,
}) => {
  const me: Person = { id: 'voice-author', name: 'Автор', username: 'author', color: 0 };
  const attachment: Attachment = {
    id: 'uploaded-voice',
    name: 'voice.m4a',
    mime: 'audio/mp4',
    size: 8044,
  };
  const chat: Chat = {
    id: 'voice-chat',
    kind: 'saved',
    title: 'Избранное',
    owner_id: me.id,
    nelya: false,
    member_count: 1,
    peer: null,
    unread: 0,
    created_at: new Date().toISOString(),
    last_message: null,
  };
  const messages: Message[] = [];
  const attempts: { nonce: string; fileId: string; body: string }[] = [];
  let uploads = 0;
  let confirm!: () => void;
  const confirmation = new Promise<void>((resolve) => {
    confirm = resolve;
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') return route.fulfill({ json: me });
    if (path === '/api/chats') return route.fulfill({ json: [chat] });
    if (path.endsWith('/members')) return route.fulfill({ json: [me] });
    if (path.endsWith('/files')) {
      uploads++;
      return route.fulfill({ status: 201, json: attachment });
    }
    if (path.endsWith('/messages')) {
      if (route.request().method() === 'GET') return route.fulfill({ json: messages });
      const attempt = route.request().postDataJSON();
      attempts.push(attempt);
      if (attempts.length === 1)
        return route.fulfill({ status: 503, json: { error: 'Соединение прервалось.' } });
      await confirmation;
      const message: Message = {
        id: 'sent-voice',
        chat_id: chat.id,
        sender_id: me.id,
        sender: me,
        body: attempt.body,
        created_at: new Date().toISOString(),
        nonce: attempt.nonce,
        file: attachment,
        reactions: [],
      };
      messages.push(message);
      chat.last_message = message;
      return route.fulfill({ status: 201, json: message });
    }
    if (path.endsWith('/events'))
      return route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' });
    if (path.endsWith('/announcements'))
      return route.fulfill({ json: { items: [], total: 0, page: 1 } });
    return route.fulfill({ json: { ok: true, enabled: false, publicKey: null } });
  });
  await page.goto('/app');
  await expect(page.locator('.chat-header')).toContainText('Избранное');
  // A real, half-second PCM file exercises the before-send player without a microphone.
  const wav = Buffer.alloc(8044);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(8036, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(8000, 40);
  await page.locator('.composer input[type=file]').setInputFiles({
    name: 'voice.wav',
    mimeType: 'audio/wav',
    buffer: wav,
  });
  const preview = page.locator('.pending-voice');
  await expect(preview.locator('.voice-player')).toBeVisible();
  const firstSource = await preview.locator('audio').getAttribute('src');
  const firstPlayer = await preview.locator('audio').elementHandle();
  await page.locator('.composer input[type=file]').setInputFiles({
    name: 'voice-take-two.wav',
    mimeType: 'audio/wav',
    buffer: wav,
  });
  await expect(preview.locator('audio')).not.toHaveAttribute('src', firstSource!);
  expect(
    await firstPlayer!.evaluate((element) => element.paused && !element.hasAttribute('src')),
  ).toBe(true);
  const source = await preview.locator('audio').getAttribute('src');
  expect(source).toMatch(/^blob:/);
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await expect(preview).toContainText('Не отправлено');
  await expect(preview.locator('audio')).toHaveAttribute('src', source!);
  await page.getByRole('button', { name: 'Повторить отправку', exact: true }).click();
  await expect(preview).toContainText('Отправка');
  await expect.poll(() => attempts.length).toBe(2);
  expect(uploads).toBe(1);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[1].fileId).toBe(attachment.id);
  await expect(preview.locator('audio')).toHaveAttribute('src', source!);
  confirm();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('.message-row .voice-player')).toHaveCount(1);
  await expect(page.locator('.chat-item')).toContainText('Голосовое сообщение');
});
