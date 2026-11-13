import { test, expect, type Page } from '@playwright/test';

const self = { id: 'unread-self', username: 'reader', name: 'Читатель', color: 0 };
const friend = { id: 'unread-friend', username: 'friend', name: 'Друг', color: 1 };

async function chatWithUnread(page: Page, unread: number, total: number) {
  const chat = {
    id: 'unread-chat',
    title: 'Непрочитанное',
    kind: 'group',
    owner_id: friend.id,
    member_count: 2,
    peer: null,
    nelya: false,
    unread,
    last_message: null,
    created_at: new Date().toISOString(),
  };
  const messages = Array.from({ length: total }, (_, i) => ({
    id: `m${i}`,
    chat_id: chat.id,
    // Own messages in between do not count as unread.
    sender_id: i === total - 2 ? self.id : friend.id,
    sender: i === total - 2 ? self : friend,
    body: `Сообщение номер ${i}`,
    created_at: new Date(Date.now() - (total - i) * 60000).toISOString(),
    nonce: `m${i}`,
    reactions: [],
    file: null,
  }));
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') return route.fulfill({ json: self });
    if (url.pathname === '/api/chats') return route.fulfill({ json: [chat] });
    if (url.pathname.endsWith('/messages')) return route.fulfill({ json: messages });
    if (url.pathname.endsWith('/members')) return route.fulfill({ json: [self, friend] });
    if (url.pathname.endsWith('/events')) return route.abort();
    if (url.pathname.endsWith('/announcements'))
      return route.fulfill({ json: { items: [], total: 0, page: 1 } });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/app');
  await page.locator('.chat-item', { hasText: 'Непрочитанное' }).click();
}

test.use({ viewport: { width: 1100, height: 600 } });

test('a chat opens on its first unread message under a "new messages" divider', async ({
  page,
}) => {
  await chatWithUnread(page, 3, 40);
  const divider = page.locator('.unread-divider');
  await expect(divider).toHaveCount(1);
  // Three unread from the friend: m39, m37 and m36 (m38 is ours), so the divider sits above m36.
  await expect(
    page.locator('.unread-divider + .message-row, .unread-divider + * .message-row').first(),
  ).toContainText('Сообщение номер 36');
  await expect(divider).toBeInViewport();
  await expect(page.getByText('Сообщение номер 10', { exact: true })).not.toBeInViewport();
});

test('with more unread than fits, the chat opens at the divider instead of the bottom', async ({
  page,
}) => {
  await chatWithUnread(page, 30, 40);
  await expect(page.locator('.unread-divider')).toBeInViewport();
  await expect(page.getByText('Сообщение номер 39', { exact: true })).not.toBeInViewport();
  await expect(page.getByRole('button', { name: /вниз|последн/i })).toBeVisible();
});

test('a fully read chat has no divider and opens at the bottom', async ({ page }) => {
  await chatWithUnread(page, 0, 40);
  await expect(page.getByText('Сообщение номер 39', { exact: true })).toBeInViewport();
  await expect(page.locator('.unread-divider')).toHaveCount(0);
});
