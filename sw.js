// ═══════════════════════════════════════════════
// GT DASH / 藤井工藝 — Service Worker
// バージョンを変えるたびに古いキャッシュを自動破棄します
// ═══════════════════════════════════════════════
const CACHE_VERSION = 'fujii-kogeiv-v19';
const CACHE_FILES = [
  './',
  './index.html',
  './icon.png',
  './icon-192.png',
  './manifest.json',
];

// インストール: 全ファイルをキャッシュ
self.addEventListener('install', event => {
  console.log('[SW] install', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(CACHE_FILES))
      .then(() => self.skipWaiting())   // 即座にアクティブ化
  );
});

// アクティベート: 古いキャッシュを全削除
self.addEventListener('activate', event => {
  console.log('[SW] activate', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => {
            console.log('[SW] delete old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())  // 既存タブも即座に乗っ取る
  );
});

// フェッチ: キャッシュ優先、なければネットワーク
self.addEventListener('fetch', event => {
  // BLE / Bluetooth API はキャッシュ対象外
  if (event.request.url.includes('bluetooth')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // 成功レスポンスのみキャッシュに追加
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});