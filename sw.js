// Service worker: makes the app installable and opens instantly / offline.
// Bump VERSION after you change any app file so phones pick up the update.
const VERSION = 'kotletka-v24';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/config.js', 'js/i18n.js', 'js/messages.js', 'js/badges.js', 'js/api.js', 'js/app.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'icons/favicon-32.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;            // API calls are POST — never cached here
  if (url.origin === location.origin) {
    // app files: network first (fresh after deploys), cache as fallback
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
  } else if ((url.hostname === 'tile.openstreetmap.org' || url.hostname.endsWith('basemaps.cartocdn.com'))) {
    // map tiles: cache first
    e.respondWith(caches.open(VERSION + '-tiles').then(c => c.match(e.request).then(hit => hit ||
      fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
  }
});
