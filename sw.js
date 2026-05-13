// ─── heyaHub Service Worker ───────────────────────────────────────
// Strategy:
//   • API calls  → network only  (always fresh data)
//   • App shell  → network first, fall back to cache (works offline)
//   • CDN assets → stale-while-revalidate (fast load, updates in bg)

var CACHE = 'heyahub-v1';

var SHELL = [
  '/index.html',
  '/condo_portal.html',
  '/condo_manger.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// ── Install: pre-cache the app shell ─────────────────────────────
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// ── Activate: delete old caches ───────────────────────────────────
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// ── Fetch: route requests by type ─────────────────────────────────
self.addEventListener('fetch', function (e) {
  var url = e.request.url;

  // 1. Always skip non-GET requests (POST, PATCH, DELETE)
  if (e.request.method !== 'GET') return;

  // 2. Always skip API calls — these must be live
  if (url.includes('/api/')) return;

  // 3. CDN resources (Google Fonts, etc.) — stale-while-revalidate
  if (
    url.includes('fonts.googleapis.com') ||
    url.includes('fonts.gstatic.com') ||
    url.includes('cdn.')
  ) {
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }

  // 4. App shell files — network first, cache fallback
  e.respondWith(networkFirstThenCache(e.request));
});

// ── Helpers ───────────────────────────────────────────────────────

function networkFirstThenCache(request) {
  return fetch(request)
    .then(function (response) {
      if (response && response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, clone); });
      }
      return response;
    })
    .catch(function () {
      return caches.match(request).then(function (cached) {
        return cached || new Response(
          '<h2 style="font-family:sans-serif;padding:2rem">You are offline. Please reconnect to use heyaHub.</h2>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      });
    });
}

function staleWhileRevalidate(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var networkFetch = fetch(request).then(function (response) {
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function () {});
      return cached || networkFetch;
    });
  });
}
