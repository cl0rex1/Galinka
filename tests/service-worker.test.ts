import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CHAT = '11111111-1111-4111-8111-111111111111';
const MESSAGE = '22222222-2222-4222-8222-222222222222';

/** Runs public/sw.js against a stub of the worker scope and returns its handlers. */
function load(respond: (url: string, init: any) => { ok: boolean }) {
  const handlers: Record<string, (event: any) => void> = {};
  const calls: { url: string; body: any }[] = [];
  const shown: { title: string; options: any }[] = [];
  const opened: string[] = [];
  const self: any = {
    location: { origin: 'https://example.test' },
    addEventListener: (type: string, handler: (event: any) => void) => (handlers[type] = handler),
    registration: {
      showNotification: async (title: string, options: any) => void shown.push({ title, options }),
      getNotifications: async () => [],
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url: string) => void opened.push(url),
      claim: async () => {},
    },
    skipWaiting: () => {},
  };
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self,
    URL,
    Response,
    crypto,
    caches: { open: async () => ({ addAll: async () => {} }), keys: async () => [] },
    fetch: async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return respond(url, init);
    },
  });
  // Every handler hands its work to waitUntil: collect it so a test can await it.
  const fire = async (type: string, event: any) => {
    const work: Promise<unknown>[] = [];
    handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => work.push(p) });
    await Promise.all(work);
  };
  return { fire, calls, shown, opened };
}

const click = (action: string, reply?: string, data: any = { chatId: CHAT, messageId: MESSAGE }) => ({
  action,
  reply,
  notification: { close() {}, data },
});

test('a push offers Reply and Mark as read, and nothing without a message to answer', async () => {
  const sw = load(() => ({ ok: true }));
  await sw.fire('push', { data: { json: () => ({ title: 'Аня', body: 'привет', chatId: CHAT, messageId: MESSAGE }) } });
  assert.deepEqual(Array.from(sw.shown[0].options.actions, (a: any) => a.action), ['reply', 'read']);
  assert.equal(sw.shown[0].options.actions[0].type, 'text');
  await sw.fire('push', { data: { json: () => ({ title: 'x' }) } });
  assert.equal(sw.shown[1].options.actions.length, 0);
});

test('replying from the notification sends the text as a reply and marks the chat read', async () => {
  const sw = load(() => ({ ok: true }));
  await sw.fire('notificationclick', click('reply', '  Уже иду  '));
  assert.equal(sw.calls.length, 2);
  assert.equal(sw.calls[0].url, `/messenger/chats/${CHAT}/messages`);
  assert.equal(sw.calls[0].body.body, 'Уже иду');
  assert.equal(sw.calls[0].body.replyTo, MESSAGE);
  assert.match(sw.calls[0].body.nonce, /^[0-9a-f-]{36}$/);
  assert.deepEqual(sw.calls[1], {
    url: `/messenger/chats/${CHAT}/read`,
    body: { lastMessageId: MESSAGE },
  });
  assert.equal(sw.shown.length, 0, 'nothing to report: it worked');
  assert.equal(sw.opened.length, 0, 'and the app stays closed');
});

test('a failed reply says so instead of vanishing, and a tap opens the chat', async () => {
  const sw = load(() => ({ ok: false }));
  await sw.fire('notificationclick', click('reply', 'Не потеряй меня'));
  assert.equal(sw.shown[0].title, 'Не отправлено');
  assert.equal(sw.shown[0].options.body, 'Не потеряй меня');
  assert.equal(sw.shown[0].options.data.chatId, CHAT);
  await sw.fire('notificationclick', click('', undefined, sw.shown[0].options.data));
  assert.equal(sw.opened[0], `https://example.test/app?chat=${CHAT}`);
});

test('Mark as read does only that; Reply without text (no inline input) opens the chat', async () => {
  const sw = load(() => ({ ok: true }));
  await sw.fire('notificationclick', click('read'));
  assert.deepEqual(sw.calls, [{ url: `/messenger/chats/${CHAT}/read`, body: { lastMessageId: MESSAGE } }]);
  assert.equal(sw.opened.length, 0);
  await sw.fire('notificationclick', click('reply'));
  assert.equal(sw.calls.length, 1, 'no text, nothing sent');
  assert.equal(sw.opened.length, 1);
});

test('ids from a notification are validated before they reach a URL', async () => {
  const sw = load(() => ({ ok: true }));
  await sw.fire('notificationclick', click('read', undefined, { chatId: '../admin', messageId: MESSAGE }));
  assert.equal(sw.calls.length, 0);
});
