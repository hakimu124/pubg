const CACHE = 'gitaru-shell-v3';
const ASSETS = ['/', '/index.html', '/offline.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const requestUrl = new URL(event.request.url);
	if (requestUrl.pathname.startsWith('/api/')) return;
	event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/offline.html'))));
});
