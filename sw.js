/* ============================================================
   Service worker — offline cache with automatic updates.

   HTML and app code are fetched network-first so a new deploy is
   picked up as soon as there is a connection; the cache is only a
   fallback for offline use. Icons are served cache-first and
   refreshed in the background.
   ============================================================ */
var VERSION = 'v1';
var CACHE = 'imposter-' + VERSION;

var ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/words.js',
  './js/model.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/mask.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* The page asks us to activate straight away once a new version installs. */
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function networkFirst(request) {
  return fetch(request).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(request, copy); }).catch(function () {});
    }
    return res;
  }).catch(function () {
    return caches.match(request).then(function (hit) {
      return hit || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error());
    });
  });
}

function cacheFirst(request) {
  return caches.match(request).then(function (hit) {
    var network = fetch(request).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(request, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () { return hit; });
    return hit || network;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  var fresh = req.mode === 'navigate' ||
    /\.(html|js|css|webmanifest)$/.test(url.pathname);

  e.respondWith(fresh ? networkFirst(req) : cacheFirst(req));
});
