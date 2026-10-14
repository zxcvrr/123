/* 离线壳：只缓存本站自己的静态资源。
 * 绝不拦截跨域请求（api.deepseek.com 的调用必须原样放行）。
 */
const CACHE = 'deepseek-mobile-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // 放行 API 等跨域请求

  // 页面导航：优先网络，离线时回退到缓存的壳
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  // 静态资源：先用缓存，后台顺便更新
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const refresh = fetch(req).then((res) => {
        if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || refresh;
    })
  );
});
