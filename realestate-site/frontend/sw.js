// Service Worker حداقلی — فقط برای فعال شدن قابلیت «نصب اپلیکیشن» لازم است.
const CACHE_NAME = 'atlas-amlak-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// عبور ساده‌ی درخواست‌ها از شبکه؛ در صورت قطعی، از کش (در صورت وجود) استفاده می‌شود.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
