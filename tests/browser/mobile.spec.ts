import { test, expect, type Page } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true });

async function openChat(page: Page) {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /На выходные/ }).click();
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible();
}

// The conversation slides in on phones; wait for finite animations before measuring positions.
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity,
      ),
  );

async function insideViewport(page: Page, selector: string) {
  const viewport = page.viewportSize()!;
  await expect
    .poll(
      async () => {
        const box = await page.locator(selector).last().boundingBox();
        if (!box) return false;
        return (
          box.x >= -1 &&
          box.y >= -1 &&
          box.x + box.width <= viewport.width + 1 &&
          box.y + box.height <= viewport.height + 1
        );
      },
      { message: `${selector} must fit in the viewport after its entrance` },
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [320, 375, 414, 768]) {
  test(`touch conversation, menus and settings fit at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 740 });
    await openChat(page);
    await insideViewport(page, '.composer');
    const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await input.fill('Оченьдлинноесловобезпробелов'.repeat(8));
    await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect(input).toHaveValue('');
    await insideViewport(page, '.message-row:last-of-type');
    const menu = page.locator('.message-menu').last();
    await page.locator('.message-row').last().locator('.bubble').click({ button: 'right' });
    await insideViewport(page, '.message-menu[open] .message-menu-content');
    await page.keyboard.press('Escape');
    await expect(menu).not.toHaveAttribute('open');
    await page.locator('.chat-heading').click();
    await insideViewport(page, '.chat-info');
    await page.getByRole('button', { name: 'Закрыть информацию' }).click();
    await page.screenshot({ path: testInfo.outputPath(`chat-${width}.png`) });
    await page.getByRole('button', { name: 'Назад к чатам', exact: true }).click();
    await page
      .getByRole('button', { name: 'Настройки', exact: true })
      .filter({ visible: true })
      .click();
    await insideViewport(page, '.app-nav');
    await page.getByRole('button', { name: 'Оформление', exact: true }).click();
    await page.getByRole('button', { name: 'Тёмная', exact: false }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: testInfo.outputPath(`settings-${width}.png`) });
  });
}

test('composer stays accessible when keyboard shrinks the visual viewport and in landscape', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openChat(page);
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Черновик с открытой клавиатурой');
  await input.focus();
  await page.evaluate(() => {
    Object.defineProperty(visualViewport!, 'height', { configurable: true, value: 430 });
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect
    .poll(async () => {
      const composer = await page.locator('.composer').boundingBox();
      return composer!.y + composer!.height;
    })
    .toBeLessThanOrEqual(430);
  await expect(input).toHaveValue('Черновик с открытой клавиатурой');
  await page.evaluate(() => {
    delete (visualViewport as unknown as Record<string, unknown>).height;
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await insideViewport(page, '.composer');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await expect(page.locator('.bubble').last()).toContainText('Черновик с открытой клавиатурой');
});

test('reduced motion keeps navigation and modal controls usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Новый чат', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый чат', exact: true });
  await expect(dialog).toBeVisible();
  await insideViewport(page, 'dialog');
  const animations = await dialog.evaluate((el) =>
    el.getAnimations().map((animation) => animation.effect?.getTiming().duration),
  );
  expect(animations.every((duration) => typeof duration === 'number' && duration <= 150)).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('text drafts survive reload and loading older messages preserves the reading position', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await openChat(page);
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await input.fill('Продолжу этот разговор позже');
  await page.reload();
  await page.getByRole('button', { name: /На выходные/ }).click();
  await expect(input).toHaveValue('Продолжу этот разговор позже');
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('galinka-demo-v1')!);
    const template = state.messages.find(
      (message: { chat_id: string }) => message.chat_id === 'weekend',
    );
    state.messages = [
      ...state.messages.filter((message: { chat_id: string }) => message.chat_id !== 'weekend'),
      ...Array.from({ length: 90 }, (_, i) => ({
        ...template,
        id: `history-${i}`,
        nonce: `history-${i}`,
        body: `История ${i}`,
        created_at: new Date(Date.now() - (90 - i) * 60_000).toISOString(),
        reactions: [],
      })),
    ];
    localStorage.setItem('galinka-demo-v1', JSON.stringify(state));
  });
  await page.reload();
  await page.getByRole('button', { name: /На выходные/ }).click();
  await expect(page.locator('.message-row')).toHaveCount(60);
  await settled(page);
  const anchor = page.getByText('История 30', { exact: true });
  const before = await page.locator('.messages').evaluate((element) => {
    element.scrollTop = 0;
    return element
      .querySelector('[data-message-id="history-30"] .message-text')!
      .getBoundingClientRect().y;
  });
  await expect(
    page.getByRole('button', { name: 'К последним сообщениям', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.message-row')).toHaveCount(90);
  await expect
    .poll(async () => Math.abs((await anchor.boundingBox())!.y - before))
    .toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'К последним сообщениям', exact: true }).click();
  await expect(page.getByText('История 89', { exact: true })).toBeInViewport();
  await expect(input).toHaveValue('Продолжу этот разговор позже');
});

test('Файл keeps a video downloadable on a narrow touch screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 690 });
  await openChat(page);
  await page.getByLabel('Прикрепить файл', { exact: true }).tap();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Файл', exact: true }).tap();
  const name = 'Исходное-видео-для-монтажа.mp4';
  const bytes = Buffer.from('original video bytes');
  await (await chooser).setFiles({ name, mimeType: 'video/mp4', buffer: bytes });
  await expect(page.locator('.pending-file')).toContainText(name);
  await expect(page.getByRole('dialog', { name: /^Отправить/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).tap();
  await expect(page.locator('.messages .file-attachment')).toContainText(name);
  await page.locator('.chat-heading').tap();
  const section = page.locator('.chat-media');
  await expect(section.locator('.media-grid button')).toHaveCount(0);
  for (const tab of ['Файлы', 'Ссылки', 'Голосовые', 'Медиа', 'Файлы']) {
    const button = section.getByRole('tab', { name: tab, exact: true });
    await button.tap();
    await expect(button).toHaveAttribute('aria-selected', 'true');
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  const download = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Скачать ' + name }).tap();
  const result = await download;
  expect(result.suggestedFilename()).toBe(name);
  const stream = await result.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(bytes);
  await insideViewport(page, '.media-list');
  await page.screenshot({ path: testInfo.outputPath('mobile-files.png') });
  await section.getByRole('button', { name: 'Показать в чате' }).tap();
  await expect(page.locator('.message-row.flash')).toContainText(name);
});

// Real touch input: Playwright's mouse would not be a touch pointer.
async function touchDrag(page: Page, from: [number, number], to: [number, number], release = true) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  await send('touchStart', ...from);
  for (let step = 1; step <= 10; step++)
    await send(
      'touchMove',
      from[0] + ((to[0] - from[0]) * step) / 10,
      from[1] + ((to[1] - from[1]) * step) / 10,
    );
  if (release) await send('touchEnd', ...to);
  return () => send('touchEnd', ...to);
}

test.describe('gestures on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a chat follows the finger back to the list and settles if let go early', async ({ page }) => {
    await openChat(page);
    await settled(page);
    // Half way: the chat moved with the finger and the list shows underneath.
    const release = await touchDrag(page, [6, 500], [150, 502], false);
    const shift = await page
      .locator('.workspace')
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41 || parseFloat(getComputedStyle(el).translate));
    expect(shift).toBeGreaterThan(100);
    await expect(page.locator('.sidebar')).toBeVisible();
    await release();
    // 150 of 390 is past a third: the chat leaves.
    await expect(page.locator('.app-shell.has-active')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /На выходные/ })).toBeVisible();

    // A short pull returns the chat to its place.
    await page.getByRole('button', { name: /На выходные/ }).click();
    await settled(page);
    await touchDrag(page, [6, 500], [60, 501]);
    await expect(page.locator('.app-shell.has-active')).toHaveCount(1);
    await expect.poll(() => page.locator('.workspace').getAttribute('style')).toBeFalsy();
  });

  test('the chat profile closes by a swipe from its left edge', async ({ page }) => {
    await openChat(page);
    await page.locator('.chat-heading').click();
    await expect(page.locator('.chat-info')).toBeVisible();
    await settled(page);
    await touchDrag(page, [6, 400], [220, 402]);
    await expect(page.locator('.chat-info')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible();
  });

  test('a sheet is pulled down by its head and closes', async ({ page }) => {
    await page.goto('/?demo=1');
    await page.getByRole('button', { name: 'Новый чат', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Новый чат', exact: true });
    await expect(dialog).toBeVisible();
    await settled(page);
    const head = (await dialog.locator('.modal-head').boundingBox())!;
    // Pulling the content (not the head) does nothing.
    const field = (await dialog.getByRole('textbox', { name: 'Найти пользователя' }).boundingBox())!;
    await touchDrag(page, [field.x + 20, field.y + 10], [field.x + 20, field.y + 200]);
    await expect(dialog).toBeVisible();
    await touchDrag(page, [head.x + 100, head.y + 20], [head.x + 100, head.y + 260]);
    await expect(dialog).not.toBeVisible();
  });
});

test('"Назад" on a phone slides the chat away and brings the list in from under it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page);
  await settled(page);
  await page.getByRole('button', { name: 'Назад к чатам', exact: true }).click();
  // Mid-way both screens are on show.
  await expect(page.locator('.app-shell[data-swipe="back"]')).toHaveCount(1);
  await expect(page.locator('.sidebar')).toBeVisible();
  const sidebar = (await page.locator('.sidebar').boundingBox())!;
  const nav = (await page.locator('.app-nav').boundingBox())!;
  expect(Math.abs(sidebar.y + sidebar.height - nav.y)).toBeLessThanOrEqual(1);
  await expect(page.locator('.app-shell.has-active')).toHaveCount(0);
  await expect(page.locator('.app-shell[data-swipe]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /На выходные/ })).toBeVisible();
});
