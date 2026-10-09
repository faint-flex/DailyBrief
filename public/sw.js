// Offline shell. The last brief is kept in localStorage, so once the shell is
// cached the app opens and shows it with no signal.
const VERSION = 'v6';
const CACHE = `daily-brief-${VERSION}`;
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/js/app.js',
  '/js/weather.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // The brief and the weather always come from the network; the page keeps its own copy.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Network first so a deploy is picked up, cache as the offline fallback.
      try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(request)
          || (request.mode === 'navigate' ? await cache.match('/index.html') : null);
        if (cached) return cached;
        throw new Error('offline and not cached');
      }
    })(),
  );
});
