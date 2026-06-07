// 藤井工藝 GT DASH — Service Worker
//
// 設計方針:
//   アプリファイル (HTML / CSS / JS / JSON / アイコン)
//     → Network First: 常に GitHub Pages から最新を取得
//       ネットワーク失敗時のみキャッシュにフォールバック (オフライン対応)
//   上記以外 (外部リソース等)
//     → Cache First: キャッシュ優先で高速化
//
// CACHE_VERSION を上げると古いキャッシュが自動削除される

const CACHE_VERSION = 'fujii-kogei-v3-016';

const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ─── INSTALL ─────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ───────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isAppFile = url.origin === self.location.origin && (
    url.pathname === '/' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.png')
  );

  if (isAppFile) {
    // Network First — 最新ファイルを取得、キャッシュも更新
    // ネットワーク失敗時はキャッシュにフォールバック (オフライン対応)
    event.respondWith(
      fetch(req)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION)
              .then(cache => cache.put(req, clone))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // その他 — Cache First
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});
