import { test, expect, type Page } from '@playwright/test';
import type { Chat } from '../../src/types';

const userId = '10000000-0000-4000-8000-000000000001';
const friendId = '10000000-0000-4000-8000-000000000002';
const activeId = '20000000-0000-4000-8000-000000000001';
const mutedId = '20000000-0000-4000-8000-000000000002';
const otherId = '20000000-0000-4000-8000-000000000003';
const newId = '20000000-0000-4000-8000-000000000004';
const person = { id: userId, name: 'Саша', username: 'sasha', color: 1 };

function chat(id: string, title: string, muted = false): Chat {
  return {
    id,
    title,
    muted,
    kind: 'group',
    owner_id: userId,
    nelya: false,
    member_count: 2,
    peer: null,
    unread: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    last_message: null,
  };
}

async function desktopSession(page: Page) {
  const state = {
    chats: [
      chat(activeId, 'Текущий чат'),
      chat(mutedId, 'Без звука', true),
      chat(otherId, 'Другой чат'),
    ],
    chatReads: 0,
    revoked: false,
  };
  await page.addInitScript(() => {
    const openListeners = new Set<(id: string) => void>();
    const statusListeners = new Set<(status: unknown) => void>();
    const sources: FakeEventSource[] = [];
    const status = {
      phase: 'current',
      mode: 'automatic',
      installedVersion: '0.5.0',
      autoDownload: true,
    };
    const state = {
      focused: true,
      visibility: 'visible',
      shown: [] as { chatId: string }[],
      cleared: 0,
      emit: (value: unknown) => {
        const source = sources.findLast((item) => !item.closed);
        if (!source?.onmessage) throw new Error('No active event stream');
        source.onmessage({ data: JSON.stringify(value) } as MessageEvent);
      },
      disconnect: () => sources.findLast((item) => !item.closed)?.onerror?.(),
      open: (id: string) => openListeners.forEach((callback) => callback(id)),
      listeners: () => openListeners.size,
      streams: () => sources.filter((item) => !item.closed).length,
      updateListeners: () => statusListeners.size,
    };
    class FakeEventSource {
      closed = false;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        sources.push(this);
      }
      close() {
        this.closed = true;
      }
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: FakeEventSource });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state.visibility,
    });
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => state.focused });
    Object.defineProperty(window, 'galinkaDesktop', {
      configurable: true,
      value: {
        status: async () => status,
        check: async () => status,
        download: async () => status,
        install: async () => true,
        releases: async () => {},
        setAutoDownload: async () => status,
        onStatus: (callback: (value: unknown) => void) => {
          statusListeners.add(callback);
          return () => statusListeners.delete(callback);
        },
        notifications: {
          status: async () => ({ supported: true, enabled: true, background: true }),
          setEnabled: async (enabled: boolean) => ({ supported: true, enabled, background: true }),
          show: async (value: { chatId: string }) => {
            state.shown.push(value);
            return true;
          },
          clear: async () => {
            state.cleared++;
          },
          onOpen: (callback: (id: string) => void) => {
            openListeners.add(callback);
            return () => openListeners.delete(callback);
          },
        },
      },
    });
    (window as any).desktopTest = state;
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me' && state.revoked)
      return route.fulfill({ status: 401, json: { error: 'Сессия завершена.' } });
    if (path === '/api/chats') {
      state.chatReads++;
      return route.fulfill({ json: state.chats });
    }
    const json =
      path === '/api/me'
        ? person
        : path.endsWith('/messages') || path.endsWith('/members') || path === '/api/announcements'
          ? []
          : { ok: true };
    await route.fulfill({ json });
  });
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Текущий чат', exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Настройки', exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.getByRole('switch', { name: 'Пуш-уведомления' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('button', { name: 'Чаты', exact: true }).filter({ visible: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).desktopTest.streams())).toBe(1);
  return state;
}

async function emit(page: Page, chatId: string, senderId = friendId) {
  await page.evaluate((change) => (window as any).desktopTest.emit(change), {
    type: 'messages',
    event: 'message.created',
    chatId,
    senderId,
    messageId: '30000000-0000-4000-8000-000000000001',
    // Event bodies are untrusted and must never become native notification text.
    body: 'Private message body',
    title: 'Private group name',
  });
}

test('desktop notifications ignore own, muted and actively read messages; background notifications carry only a chat ID', async ({
  page,
}) => {
  await desktopSession(page);
  await emit(page, activeId);
  await page.evaluate(() => {
    (window as any).desktopTest.focused = false;
  });
  await emit(page, otherId, userId);
  await emit(page, mutedId);
  expect(await page.evaluate(() => (window as any).desktopTest.shown)).toEqual([]);
  await emit(page, activeId);
  await expect
    .poll(() => page.evaluate(() => (window as any).desktopTest.shown))
    .toEqual([{ chatId: activeId }]);
  await page.evaluate(() => {
    (window as any).desktopTest.focused = true;
    (window as any).desktopTest.visibility = 'hidden';
  });
  await emit(page, otherId);
  await expect
    .poll(() => page.evaluate(() => (window as any).desktopTest.shown))
    .toEqual([{ chatId: activeId }, { chatId: otherId }]);
});

test('new conversation notifications refresh membership and clicking the notification opens its conversation', async ({
  page,
}) => {
  const state = await desktopSession(page);
  await expect(page.getByRole('button', { name: /Новая компания/ })).toHaveCount(0);
  const reads = state.chatReads;
  state.chats.push(chat(newId, 'Новая компания'));
  await emit(page, newId);
  await expect.poll(() => state.chatReads).toBeGreaterThan(reads);
  await expect
    .poll(() => page.evaluate(() => (window as any).desktopTest.shown))
    .toEqual([{ chatId: newId }]);
  await page
    .getByRole('button', { name: 'Настройки', exact: true })
    .filter({ visible: true })
    .click();
  await page.evaluate((id) => (window as any).desktopTest.open(id), newId);
  await expect(page.getByRole('heading', { name: 'Новая компания', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).desktopTest.open('javascript:alert(1)'));
  await expect(page.getByRole('heading', { name: 'Новая компания', exact: true })).toBeVisible();
});

test('revoking the session closes the event stream and removes native notification listeners', async ({
  page,
}) => {
  const state = await desktopSession(page);
  expect(await page.evaluate(() => (window as any).desktopTest.listeners())).toBe(1);
  state.revoked = true;
  await page.evaluate(() => (window as any).desktopTest.disconnect());
  await expect(page.getByRole('heading', { name: 'С возвращением', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        cleared: (window as any).desktopTest.cleared,
        streams: (window as any).desktopTest.streams(),
        listeners: (window as any).desktopTest.listeners(),
      })),
    )
    .toEqual({ cleared: 1, streams: 0, listeners: 0 });
});
