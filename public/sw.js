/* global self, caches, URL, location, fetch */

const CACHE_NAME = 'app-proveedores-v1';
const OFFLINE_URL = '/offline.html';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  OFFLINE_URL,
  '/icons/icon.svg',
  '/assets/hero-services.jpg',
  '/assets/category-albanileria.webp',
  '/assets/category-albercas.webp',
  '/assets/category-carpinteria.webp',
  '/assets/category-cctv.webp',
  '/assets/category-cerrajeria.webp',
  '/assets/category-climatizacion.webp',
  '/assets/category-jardineria.webp',
  '/assets/category-plomeria.webp'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api') || url.pathname.startsWith('/events')) return;

  if (request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
