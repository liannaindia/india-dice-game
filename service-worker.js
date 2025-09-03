// 每次更新都要改版本号，避免旧缓存干扰
const CACHE = 'ganeshcasino-pwa-v2';
const ASSETS = [
  '/', '/index.html',
  '/ab.html',
  '/dice.html',
  '/mini-wheel.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-icon-180.png'
];

// 安装：预缓存静态资源
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 判断是否要绕过缓存（比如 Supabase / API）
function isBypass(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('supabase.co')) return true;
    if (u.pathname.startsWith('/functions/') || u.pathname.startsWith('/rest/')) return true;
    return false;
  } catch {
    return false;
  }
}

// fetch 拦截
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // 只处理 GET + 同源静态资源
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // Supabase / API 绕过缓存
  if (isBypass(req.url)) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // HTML 页面：网络优先
  if (req.destination === 'document' || req.headers.get('accept')?.includes('text/html')) {
    e.respondWith((async () => {
      try {
        const netRes = await fetch(req);
        const copy = netRes.clone(); // 先 clone
        caches.open(CACHE).then(c => c.put(req, copy));
        return netRes;
      } catch {
        return caches.match(req) || caches.match('/index.html');
      }
    })());
    return;
  }

  // 其他静态文件：缓存优先，后台更新
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      // 后台更新
      fetch(req).then((netRes) => {
        if (netRes && netRes.status === 200) {
          const copy = netRes.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
      });
      return cached;
    } else {
      try {
        const netRes = await fetch(req);
        const copy = netRes.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return netRes;
      } catch {
        return caches.match('/index.html');
      }
    }
  })());
});
