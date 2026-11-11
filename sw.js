// Folio service worker: offline app shell (books themselves live in IndexedDB).
const V = 'folio-v22';
const SHELL = ['app.html', 'app.css', 'manifest.webmanifest', 'icons/48.png', 'icons/192.png', 'icons/512.png',
  'js/app.js', 'js/ui.js', 'js/db.js', 'js/epub.js', 'js/zip.js', 'js/inflate.js', 'js/reader.js', 'js/pdf.js', 'js/sync.js', 'js/update.js', 'oauth.html',
  'lib/pdf.min.js', 'lib/pdf.worker.min.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// network-first so updates show up, falling back to the cache when offline
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(V).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((m) => m || caches.match('app.html'))));
});






