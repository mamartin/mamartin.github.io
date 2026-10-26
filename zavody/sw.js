// Hra offline: vlastní soubory jdou ze sítě (novinky se projeví hned) a při výpadku
// z mezipaměti; knihovny a písma z CDN mají pevnou verzi, ty jdou rovnou z mezipaměti.
const CACHE = 'turbo-okruh-v1';
const CORE = [
  './', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  ...['ai', 'audio', 'biomes', 'camera', 'car', 'editor', 'effects', 'garage', 'ghost', 'hud', 'input', 'main', 'medals',
    'pickups', 'post', 'race', 'replay', 'rng', 'scenery', 'store', 'terrain', 'track', 'trackmath', 'tracks'].map((m) => `js/${m}.js`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('turbo-okruh-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// stránka posílá adresy knihoven z CDN, které už načetla; uložíme ty, co ještě nemáme
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'cache' || !Array.isArray(e.data.urls)) return;
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    for (const url of e.data.urls) if (!(await c.match(url))) await c.add(url).catch(() => {});
  }));
});

const store = (req, res) => {
  if (res.ok || res.type === 'opaque') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => store(req, res))));
    return;
  }
  e.respondWith(
    fetch(req)
      .then((res) => store(req, res))
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
