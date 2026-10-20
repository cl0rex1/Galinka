// Cache only the public app shell. Messages, files and credentials never enter the cache.
const CACHE = 'galinka-shell-v1';
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/icon.svg', '/icon-192.png', '/manifest.webmanifest']))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Galinka · нет сети</title><body><h1>Сейчас нет соединения</h1><p>Сообщения ждут на сервере. Подключитесь к интернету и откройте Galinka снова.</p><button onclick="location.reload()">Повторить</button></body></html>', {headers:{'Content-Type':'text/html; charset=utf-8'}})));
  } else if (/\.(woff2|png|svg)$/.test(url.pathname) || url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => { if(response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); } return response; })));
  }
});
