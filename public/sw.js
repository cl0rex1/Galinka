// The build inserts a release ID. Only public static assets enter this cache.
const CACHE = 'galinka-shell-__RELEASE__';
const PUBLIC_ASSETS = new Set([
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.webmanifest',
]);
const validId = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

self.addEventListener('install', (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/icon.svg', '/icon-192.png', '/manifest.webmanifest'])),
  ),
);
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_NOTIFICATIONS')
    event.waitUntil(
      self.registration
        .getNotifications()
        .then((notifications) => notifications.forEach((notification) => notification.close())),
    );
});
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('galinka-shell-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/messenger' ||
    url.pathname.startsWith('/messenger/')
  )
    return;
  if (event.request.mode === 'navigate') {
    // Never persist HTML that could contain an authenticated page or private data.
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Galinka · нет сети</title><body><h1>Сейчас нет соединения</h1><p>Подключитесь к интернету и откройте Galinka снова.</p><a href="/app">Повторить</a></body></html>',
            {
              headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
            },
          ),
      ),
    );
  } else if (PUBLIC_ASSETS.has(url.pathname) || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (
              response.ok &&
              response.type !== 'opaque' &&
              !/no-store|private/i.test(response.headers.get('Cache-Control') || '')
            ) {
              const copy = response.clone();
              event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
            }
            return response;
          }),
      ),
    );
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    /* An empty push still gets a safe visible notification. */
  }
  const chatId = validId(data.chatId) ? data.chatId : undefined;
  const messageId = validId(data.messageId) ? data.messageId : undefined;
  event.waitUntil(
    self.registration.showNotification('Galinka', {
      body: 'Новое сообщение',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: chatId ? `galinka-${chatId}` : 'galinka-message',
      data: { chatId, messageId },
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chatId;
  const target = new URL(
    validId(chatId) ? `/app?chat=${encodeURIComponent(chatId)}` : '/app',
    self.location.origin,
  );
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windows.find((window) => {
        const url = new URL(window.url);
        return (
          url.origin === self.location.origin &&
          (url.pathname === '/app' || url.pathname === '/app/')
        );
      });
      if (client) {
        if (validId(chatId)) client.postMessage({ type: 'OPEN_CHAT', chatId });
        await client.focus();
      } else await self.clients.openWindow(target.href);
    })(),
  );
});

// A browser may rotate an expiring endpoint while Galinka is closed. The session
// cookie is still required; after logout the server will refuse registration.
self.addEventListener('pushsubscriptionchange', (event) => {
  if (!event.oldSubscription?.options) return;
  event.waitUntil(
    (async () => {
      try {
        const subscription =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe(event.oldSubscription.options));
        const response = await fetch('/messenger/push/subscriptions', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription.toJSON()),
        });
        if (response.status === 401) await subscription.unsubscribe();
        if (response.ok && event.oldSubscription.endpoint !== subscription.endpoint) {
          await fetch('/messenger/push/subscriptions', {
            method: 'DELETE',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: event.oldSubscription.endpoint }),
          });
        }
      } catch {
        /* The app reconciles its subscription on the next authenticated launch. */
      }
    })(),
  );
});
