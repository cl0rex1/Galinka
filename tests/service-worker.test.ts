import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const chatId = '055481ff-c62a-4b88-bf38-03498ede092f';
const messageId = 'fc9a82b2-1c74-4c60-837b-32a65d5ad13c';
function worker(windows: unknown[] = []) {
  const handlers = new Map<string, (event: any) => void>();
  const notifications: { title: string; options: any }[] = [];
  const opened: string[] = [];
  runInNewContext(source, {
    URL,
    Response,
    Set,
    encodeURIComponent,
    self: {
      location: { origin: 'https://mess.quiby.me' },
      addEventListener: (name: string, handler: (event: any) => void) =>
        handlers.set(name, handler),
      registration: {
        showNotification: async (title: string, options: unknown) => {
          notifications.push({ title, options });
        },
      },
      clients: {
        matchAll: async () => windows,
        openWindow: async (url: string) => {
          opened.push(url);
        },
      },
    },
  });
  async function emit(name: string, event: Record<string, unknown>) {
    const waits: Promise<unknown>[] = [];
    handlers.get(name)!({
      ...event,
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    });
    await Promise.all(waits);
  }
  return { emit, notifications, opened };
}

test('service worker shows the server-written preview, bounded, and opens exact safe chat URLs', async () => {
  const sw = worker();
  // The text is what the recipient chose in settings; the server writes it.
  await sw.emit('push', {
    data: { json: () => ({ chatId, messageId, title: 'Свои люди', body: 'Макс: буду к восьми' }) },
  });
  assert.equal(sw.notifications[0].title, 'Свои люди');
  assert.equal(sw.notifications[0].options.body, 'Макс: буду к восьми');
  assert.equal(sw.notifications[0].options.data.chatId, chatId);
  await sw.emit('push', {
    data: { json: () => ({ chatId, messageId, title: ' ', body: 'x'.repeat(5000) }) },
  });
  assert.equal(sw.notifications[1].title, 'Galinka');
  assert.equal(sw.notifications[1].options.body.length, 200);
  await sw.emit('push', { data: { json: () => ({ chatId, messageId }) } });
  assert.equal(sw.notifications[2].options.body, 'Новое сообщение');
  let closed = false;
  await sw.emit('notificationclick', {
    notification: {
      data: { chatId },
      close() {
        closed = true;
      },
    },
  });
  assert.equal(closed, true);
  assert.deepEqual(sw.opened, [`https://mess.quiby.me/app?chat=${chatId}`]);
  await sw.emit('notificationclick', {
    notification: { data: { chatId: '//evil.test/secret' }, close() {} },
  });
  assert.equal(sw.opened[1], 'https://mess.quiby.me/app');
});

test('notification clicks focus an existing app and only dispatch a validated chat identifier', async () => {
  const received: any[] = [];
  let focused = false;
  const sw = worker([
    { url: 'https://evil.test/app', postMessage: () => assert.fail('cross-origin notification') },
    {
      url: 'https://mess.quiby.me/app',
      postMessage: (value: unknown) => received.push(value),
      focus: async () => {
        focused = true;
      },
    },
  ]);
  await sw.emit('notificationclick', { notification: { data: { chatId }, close() {} } });
  assert.equal(focused, true);
  assert.equal(received[0].type, 'OPEN_CHAT');
  assert.equal(received[0].chatId, chatId);
  assert.equal(sw.opened.length, 0);
});

test('service worker never intercepts API, attachments or arbitrary image paths for caching', async () => {
  const sw = worker();
  for (const pathname of [
    '/api/chats',
    '/messenger/chats',
    '/messenger/files/private.png',
    '/private.png',
    '/uploads/photo.svg',
  ]) {
    let intercepted = false;
    await sw.emit('fetch', {
      request: { method: 'GET', url: 'https://mess.quiby.me' + pathname, mode: 'cors' },
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, pathname);
  }
});
