import { test, expect, type Page } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true });

async function openChat(page: Page) {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /На выходные/ }).click();
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible();
}

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
    await menu.locator('summary').click();
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
    await insideViewport(page, '.mobile-nav');
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
  await page.locator('.messages').evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(
    page.getByRole('button', { name: 'К последним сообщениям', exact: true }),
  ).toBeVisible();
  const anchor = page.getByText('История 30', { exact: true });
  const before = (await anchor.boundingBox())!.y;
  await page.getByRole('button', { name: 'Более ранние сообщения', exact: true }).click();
  await expect(page.locator('.message-row')).toHaveCount(90);
  await expect
    .poll(async () => Math.abs((await anchor.boundingBox())!.y - before))
    .toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'К последним сообщениям', exact: true }).click();
  await expect(page.getByText('История 89', { exact: true })).toBeInViewport();
  await expect(input).toHaveValue('Продолжу этот разговор позже');
});
