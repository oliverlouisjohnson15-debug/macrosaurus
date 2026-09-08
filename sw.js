/* Macrosaurus service worker.
   Strategy:
   - App shell / navigations: CACHE-FIRST out of a build-scoped cache. The shell is one ~3.4MB
     self-contained bundle, so re-fetching it on every launch was the whole of our bandwidth bill:
     an installed PWA navigates on every single app open. It is now downloaded ONCE PER BUILD,
     at install time, and served from cache until a new build replaces it.
   - Freshness does not depend on that fetch. The page polls sw.js (a few KB) through
     registration.update(), and VERSION below is a content hash of index.html written by build.mjs,
     so any new deploy produces a byte-different worker, a new cache, and the app's reload banner.
   - Static assets (icons, manifest, CDN scripts, fonts): CACHE-FIRST, filled from the network,
     so the app loads fully offline.
   - API traffic (Supabase, Anthropic, Open Food Facts): never cached - always straight to the
     network; offline reads/writes are handled by the app's own IndexedDB store.
   VERSION is written by build.mjs. Do not edit it by hand: a stale VERSION would pin users to a
   cached shell, which is exactly what the content hash exists to make impossible. */
const VERSION = 'd7a5ba43d748';
const CORE = 'macrosaurus-core-v' + VERSION;
// The runtime cache holds sprites, fonts, icons, foods-uk.json and the Supabase CDN bundle: assets
// at stable URLs whose contents do not change from one deploy to the next. It deliberately does NOT
// carry VERSION. Namespacing it by the build hash threw all of them away on every single deploy and
// re-downloaded them - hundreds of KB per user per deploy, for bytes that were already correct.
// Bump ASSET_VERSION BY HAND, and only when an asset actually changes at a URL it already had.
const ASSET_VERSION = '1';
const RUNTIME = 'macrosaurus-rt-v' + ASSET_VERSION;
// The shell is deliberately NOT in this list: it is big, and addAll would fetch it twice (once
// for '/' and once for '/index.html'). It is fetched once below and stored under both keys.
const CORE_ASSETS = [
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
];
const NO_CACHE_HOSTS = ['supabase.co', 'anthropic.com', 'openfoodfacts.org'];

// A Response whose `redirected` flag is set CANNOT be used to satisfy a navigation: the browser
// rejects it and the page fails to load outright. That matters here because vercel.json sets
// cleanUrls, which redirects /index.html to /, so fetching the shell by the wrong URL would fill
// the cache with a response that can never be served - and a shell cache that cannot be served is
// the difference between a cheap app and a broken one. Two belts: SHELL_URL is '/', which does not
// redirect, and anything redirected is rebuilt into a plain response before it is cached.
const SHELL_URL = '/';

function navigable(res) {
  if (!res || !res.redirected) return Promise.resolve(res);
  return res.blob().then(function (body) {
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  });
}

// Precache the shell exactly once for this build, under both the keys a navigation can ask for.
// 'no-store' so the freshly deployed HTML wins over anything sitting in the browser's HTTP cache.
function precacheShell(cache) {
  return fetch(SHELL_URL, { cache: 'no-store' }).then(function (res) {
    if (!res || !res.ok) throw new Error('shell fetch failed: ' + (res && res.status));
    return navigable(res);
  }).then(function (res) {
    return Promise.all([cache.put('/index.html', res.clone()), cache.put('/', res)]);
  });
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CORE)
      .then(function (c) {
        return Promise.allSettled(
          [precacheShell(c)].concat(CORE_ASSETS.map(function (u) { return c.add(u); }))
        );
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) {
          // Only sweep our own versioned caches. Matching everything else took the share-target
          // cache with it, and now that RUNTIME outlives a deploy it must survive this sweep too.
          return (k.indexOf('macrosaurus-core-v') === 0 || k.indexOf('macrosaurus-rt-v') === 0)
            && k !== CORE && k !== RUNTIME;
        }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Which build is controlling this page? The app asks on load and again whenever the controller
// changes, and only offers a reload when the answer actually differs from the one it booted with.
// A controller change on its own means nothing: the worker gets torn down and restarted, evicted
// and re-registered, or re-claims the page, all without a line of code having changed.
self.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'VERSION') return;
  var port = e.ports && e.ports[0];
  if (port) port.postMessage({ type: 'VERSION', version: VERSION });
});

// Web Push: the push-nudge edge function sends a JSON payload {title, body, url, tag}. Show it as a
// notification even when the app is closed. This is the whole point of the feature: the buddy can
// reach you outside the app. Never fires without a payload the user opted into.
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; }
  catch (_) { data = { body: e.data ? e.data.text() : '' }; }
  var title = data.title || 'Macrosaurus';
  var opts = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'macrosaurus-nudge',
    data: { url: data.url || '/' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// Tapping the notification focuses an open tab (navigating it to the deep link) or opens a new one.
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ('focus' in c) { try { c.navigate && c.navigate(target); } catch (_) {} return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
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
    // Cache-first. The cached copy is always this exact build's shell: CORE is namespaced by
    // VERSION, which is a content hash of index.html, so a new deploy can never be served an old
    // page out of a new build's cache - the cache simply does not exist yet and gets filled at
    // install. Serving from cache here is what keeps an app open from costing a megabyte.
    e.respondWith(
      caches.open(CORE).then(function (c) { return c.match('/index.html'); }).then(function (cached) {
        if (cached) return cached;
        // Cache miss: first ever load, an evicted cache, or an install that failed offline.
        // Fetch it and fill the cache so the next launch is free again.
        return fetch(SHELL_URL, { cache: 'no-store' }).then(navigable).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CORE).then(function (c) { c.put('/index.html', copy); });
          }
          return res;
        }).catch(function () {
          return caches.match('/').then(function (r) {
            return r || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
          });
        });
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
