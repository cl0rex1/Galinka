import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 1100, height: 800 }, actionTimeout: 5000 });

const row = (page: Page, text: string) => page.locator('.message-row', { hasText: text }).first();
async function menu(page: Page, text: string, action: string) {
  await row(page, text).locator('.message-text').click({ button: 'right' });
  await page.getByRole('button', { name: action, exact: true }).click();
}

test.describe('in the demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('galinka-demo-v1'));
    await page.goto('/?demo=1');
    await expect(row(page, 'Я за!')).toBeVisible();
  });

  test('a pinned message shows above the chat, opens on click and unpins', async ({ page }) => {
    await menu(page, 'Я за!', 'Закрепить');
    const bar = page.locator('.pinned-bar');
    await expect(bar).toContainText('Я за! Хочется гор');
    await bar.getByRole('button', { name: /Закреплённое сообщение/ }).click();
    await expect(row(page, 'Я за!')).toHaveClass(/flash/);
    // The highlight goes away, so the message's menu is not trapped under its neighbours.
    await expect(row(page, 'Я за!')).not.toHaveClass(/flash/);
    await menu(page, 'Я за!', 'Открепить');
    await expect(bar).toHaveCount(0);
    await menu(page, 'Я за!', 'Закрепить');
    await page.getByRole('button', { name: 'Открепить сообщение', exact: true }).click();
    await expect(bar).toHaveCount(0);
  });

  test('a forwarded message lands in the chosen chat with its author', async ({ page }) => {
    await menu(page, 'Я за!', 'Переслать');
    const dialog = page.getByRole('dialog', { name: 'Переслать сообщение' });
    await dialog.getByPlaceholder('Найти чат').fill('ан');
    await expect(dialog.getByRole('button', { name: /Макс/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: /Аня/ }).click();
    await expect(page.getByRole('heading', { name: 'Аня', exact: true }).first()).toBeVisible();
    const copy = row(page, 'Я за! Хочется гор');
    await expect(copy).toContainText('Переслано от Макс');
    await expect(copy).toHaveClass(/own/);
  });

  test('several messages are selected, forwarded together and deleted together', async ({
    page,
  }) => {
    await menu(page, 'Я за!', 'Выбрать');
    const header = page.locator('.selection-header');
    await expect(header).toContainText('1 сообщение');
    // While selecting, a click toggles a message instead of opening anything.
    await row(page, 'Звучит как идеальный план').click();
    await expect(header).toContainText('2 сообщения');
    await row(page, 'Я за!').click();
    await expect(header).toContainText('1 сообщение');
    await row(page, 'Я за!').click();
    await header.getByRole('button', { name: 'Переслать выбранные' }).click();
    await page
      .getByRole('dialog', { name: 'Переслать 2 сообщения' })
      .getByRole('button', { name: /Избранное/ })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Избранное', exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator('.forwarded-from')).toHaveCount(2);
    await expect(page.locator('.message-row').last()).toContainText('Звучит как идеальный план');
    await expect(header).toHaveCount(0);

    await menu(page, 'Я за!', 'Выбрать');
    await row(page, 'Звучит как идеальный план').click();
    await header.getByRole('button', { name: 'Удалить выбранные' }).click();
    await page
      .getByRole('dialog', { name: 'Удалить 2 сообщения?' })
      .getByRole('button', { name: 'Удалить', exact: true })
      .click();
    await expect(page.locator('.forwarded-from')).toHaveCount(0);
    await expect(header).toHaveCount(0);
  });

  test('Escape leaves selection mode', async ({ page }) => {
    await menu(page, 'Я за!', 'Выбрать');
    await expect(page.locator('.selection-header')).toBeVisible();
    await expect(page.locator('details.message-menu[open]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.selection-header')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'На выходные', exact: true }).first(),
    ).toBeVisible();
  });

  test('formatting marks render as formatting, links stay whole, spoilers open on tap', async ({
    page,
  }) => {
    const field = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await field.fill('план жирный');
    // Ctrl+B wraps the selection in bold marks.
    await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(5, 11));
    await field.press('Control+b');
    await expect(field).toHaveValue('план **жирный**');
    await field.press('End');
    await field.pressSequentially(
      ' __курсив__ ~~нет~~ `код` ||тайна|| https://example.com/__init__',
    );
    await field.press('Shift+Enter');
    await field.pressSequentially('> цитата');
    await field.press('Shift+Enter');
    await field.pressSequentially('```');
    await field.press('Shift+Enter');
    await field.pressSequentially('let x = **1**');
    await field.press('Shift+Enter');
    await field.pressSequentially('```');
    await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    const text = page.locator('.message-row').last().locator('.message-text');
    await expect(text.locator('strong')).toHaveText('жирный');
    await expect(text.locator('em')).toHaveText('курсив');
    await expect(text.locator('s')).toHaveText('нет');
    await expect(text.locator(':not(pre) > code')).toHaveText('код');
    await expect(text.locator('blockquote')).toHaveText('цитата');
    // Nothing is formatted inside a code block.
    await expect(text.locator('pre')).toHaveText('let x = **1**');
    await expect(text.getByRole('link')).toHaveAttribute('href', 'https://example.com/__init__');
    const spoiler = text.getByRole('button', { name: /Скрытый текст/ });
    await expect(spoiler).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
    await spoiler.click();
    await expect(text.locator('.spoiler.shown')).toHaveText('тайна');
    // Previews show the words without marks and keep the spoiler hidden.
    await expect(page.locator('.chat-item.selected .chat-item-preview')).toContainText(
      'план жирный курсив нет код •••',
    );
  });
});

test('typing and recording show in the chat header and the chat list', async ({ page }) => {
  const self = { id: 'typing-self', username: 'me', name: 'Я', color: 0 };
  const chat = {
    id: 'typing-chat',
    title: 'Компания',
    kind: 'group',
    owner_id: self.id,
    member_count: 3,
    peer: null,
    nelya: false,
    unread: 0,
    last_message: null,
    created_at: new Date().toISOString(),
  };
  const event = (data: object) => `data: ${JSON.stringify(data)}\n\n`;
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') return route.fulfill({ json: self });
    if (url.pathname === '/api/chats') return route.fulfill({ json: [chat] });
    if (url.pathname.endsWith('/messages')) return route.fulfill({ json: [] });
    if (url.pathname.endsWith('/members')) return route.fulfill({ json: [self] });
    if (url.pathname.endsWith('/events'))
      return route.fulfill({
        headers: { 'Content-Type': 'text/event-stream' },
        body:
          event({ type: 'connected' }) +
          event({ type: 'typing', chatId: chat.id, userId: 'a', name: 'Аня', action: 'typing' }) +
          event({ type: 'typing', chatId: chat.id, userId: 'm', name: 'Макс', action: 'voice' }),
      });
    if (url.pathname.endsWith('/announcements'))
      return route.fulfill({ json: { items: [], total: 0, page: 1 } });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/app');
  await expect(page.locator('.chat-heading p')).toHaveText('Аня и Макс записывают голосовое…');
  await expect(page.locator('.chat-item .chat-typing')).toHaveText(
    'Аня и Макс записывают голосовое…',
  );
  // Our own typing is announced to the chat, at most every few seconds.
  const announced = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith(`/chats/${chat.id}/typing`),
  );
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('привет');
  expect((await announced).postDataJSON()).toEqual({ action: 'typing' });
  // Right click on send offers sending without a notification.
  const posted = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url().endsWith(`/chats/${chat.id}/messages`),
  );
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click({
    button: 'right',
  });
  await page.getByRole('menuitem', { name: 'Отправить без звука' }).click();
  expect((await posted).postDataJSON()).toMatchObject({ body: 'привет', silent: true });
  await expect(page.getByRole('menuitem', { name: 'Отправить без звука' })).toHaveCount(0);
});
