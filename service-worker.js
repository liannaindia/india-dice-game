
const CACHE = 'ganeshcasino-pwa-v1';   // 以后有更新把这个版本号改大
const ASSETS = [
  '/', '/index.html',
  '/ab.html',                // 你站点里需要离线打开的页面可以继续加
  '/dice.html',
  '/mini-wheel.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-icon-180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // 只缓存同源 GET 静态资源；Supabase 等跨域/POST 不拦截
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetcher = fetch(e.request).then((res) => {
        caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached || caches.match('/index.html'));
      return cached || fetcher;
    })
  );
});
