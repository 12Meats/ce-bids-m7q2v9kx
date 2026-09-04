// CE Bids service worker — cache-first offline support.
// Bump CACHE on every deploy that changes any file in ASSETS.
const CACHE = 'bids-v1';
// Every file the app loads. A missing entry here means that file silently
// falls back to the network, which in a plant with no signal means a blank
// screen. tests/sw.test.js cross-checks this list against index.html.
const ASSETS = [
  'index.html',
  'manifest.json',
  'icon.png',
  'apple-touch-icon.png',
  'logo.png',
  'bidmath.js',
  'storage.js',
  'docmodel.js',
  'keypad.js',
  'dates.js',
  'catalog.js',
  'vendor/jspdf.umd.min.js',
  'vendor/jspdf.plugin.autotable.min.js',
  'photos.js',
  'docgen.js',
  'ui.js',
  'app.js',
  'screens/bids.js',
  'screens/bid.js',
  'screens/walk.js',
  'screens/labor.js',
  'screens/price.js',
  'screens/proposal.js',
  'screens/job.js',
  'screens/settings.js',
  'screens/reports.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
      // Debug hook: with no dev tools available on the owner's iPhone, this line
      // (visible via Safari remote inspect) is how we confirm which cache version
      // is actually active when someone reports "my app looks old".
      .then(() => console.log('CE Bids SW active, cache ' + CACHE))
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== location.origin) return;

  // Navigations (e.g. the bare "/" the home-screen icon launches, or any
  // directory URL) don't have a stable cache key across hosts the way a
  // named file does — './' resolves differently depending on where the app
  // is served from, and a mismatch there fails silently forever. Serve the
  // one page the app has instead of trying to key-match the request.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html').then((cached) => cached || fetch(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request);
    })
  );
});
