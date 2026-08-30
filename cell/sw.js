// sw.js — офлайн-кэш оболочки. Все пути относительные: игра живёт в подпапке.

const CACHE = 'celldrift-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './src/main.js',
  './src/spine.js',
  './src/render.js',
  './src/noise.js',
  './src/rng.js',
  './src/palette.js',
  './src/parts.js',
  './src/player.js',
  './src/creature.js',
  './src/spawner.js',
  './src/background.js',
  './src/particles.js',
  './src/editor.js',
  './src/stats.js',
  './src/input.js',
  './src/audio.js',
  './src/save.js',
  './src/ui.js',
  './src/i18n.js',
  './src/icons.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Кэш-первым: игра целиком статична, обновление кэша — при следующем визите.
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        // Тихо обновляем в фоне.
        fetch(req).then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        }).catch(() => {});
        return hit;
      }
      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
