const CACHE_NAME = 'poolpi-shell-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './img/Logo.png',
  './img/icon-192.png',
  './img/icon-512.png',
  './img/piscina1.png',
  './img/panelsolar3.png',
  './img/wifi.svg',
  './img/Diana99.svg',
  './img/matraz3.svg',
  './img/Conductividad.svg',
  './img/QRP.svg',
  './img/clorolibre.svg',
  './img/solar_power.svg',
  './img/valvula.svg',
  './img/Depuradora.svg',
  './img/termometro.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })
    ))
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (url.pathname.includes('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() => {
        return new Response(JSON.stringify({ disponible: false, error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
  } else {
    e.respondWith(
      caches.match(e.request).then((res) => res || fetch(e.request))
    );
  }
});
