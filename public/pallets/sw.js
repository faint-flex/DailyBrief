// Pallet Router offline shell: network first, cached copy when the dock has no signal.
const CACHE = 'pallet-router-v20';
const SHELL = ['/pallets/', '/pallets/pallets.css', '/pallets/app.js', '/pallets/match.js', '/pallets/merge.js', '/pallets/photos.js',
  '/pallets/html5-qrcode.min.js', '/pallets/manifest.webmanifest', '/pallets/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pallet-router-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/pallets')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(request);
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    } catch {
      const hit = await cache.match(request) || (request.mode === 'navigate' ? await cache.match('/pallets/') : null);
      if (hit) return hit;
      throw new Error('offline');
    }
  })());
});
