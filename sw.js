/* Macrosaurus service worker.
   Strategy:
   - App shell / navigations: NETWORK-FIRST, so a fresh deploy reaches you immediately when online;
     falls back to the cached page only when there's no connection.
   - Static assets (icons, manifest, CDN scripts, fonts): CACHE-FIRST, filled from the network,
     so the app loads fully offline.
   - API traffic (Supabase, Anthropic, Open Food Facts): never cached — always straight to the
     network; offline reads/writes are handled by the app's own IndexedDB store.
   Bump VERSION to force old caches to clear on the next activate. */
const VERSION = '11';
const CORE = 'macrosaurus-core-v' + VERSION;
const RUNTIME = 'macrosaurus-rt-v' + VERSION;
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
];
const NO_CACHE_HOSTS = ['supabase.co', 'anthropic.com', 'openfoodfacts.org'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CORE)
      .then(function (c) { return Promise.allSettled(CORE_ASSETS.map(function (u) { return c.add(u); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CORE && k !== RUNTIME; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);

  // Web Share Target: receive photos/text shared from other apps, stash them in a temp cache,
  // then hand off to the app which picks them up on load (/?shared=1) and opens the meal estimator.
  if (req.method === 'POST' && url.pathname === '/share-target') {
    e.respondWith((async function () {
      try {
        var form = await req.formData();
        var files = (form.getAll('photos') || []).filter(Boolean);
        var text = form.get('text') || form.get('title') || form.get('url') || '';
        var cache = await caches.open('share-incoming');
        var old = await cache.keys();
        await Promise.all(old.map(function (k) { return cache.delete(k); }));
        for (var i = 0; i < files.length; i++) {
          await cache.put('/shared-file-' + i, new Response(files[i], { headers: { 'content-type': files[i].type || 'image/jpeg' } }));
        }
        await cache.put('/shared-meta', new Response(JSON.stringify({ count: files.length, text: String(text || '') }), { headers: { 'content-type': 'application/json' } }));
      } catch (err) { /* fall through to the app either way */ }
      return Response.redirect('/?shared=1', 303);
    })());
    return;
  }

  if (req.method !== 'GET') return; // never intercept other POSTs (Anthropic, Supabase writes)
  if (NO_CACHE_HOSTS.some(function (h) { return url.hostname === h || url.hostname.endsWith('.' + h); })) return;

  var isShell = req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';
  if (isShell) {
    // Network-first: fresh page when online, cached page when offline.
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CORE).then(function (c) { c.put('/index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('/index.html').then(function (r) { return r || caches.match('/'); });
      })
    );
    return;
  }

  // Cache-first for everything else (icons, CDN scripts, fonts).
  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        if (res && res.status === 200 && (url.protocol === 'https:' || url.protocol === 'http:')) {
          var copy = res.clone();
          caches.open(RUNTIME).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
    })
  );
});
