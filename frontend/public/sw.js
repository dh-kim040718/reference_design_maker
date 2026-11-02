// Only the anonymous offline help page is cached. API responses and account data are not.
const offlineCache = 'reference-maker-offline-v1'
self.addEventListener('install', event => {
  event.waitUntil(caches.open(offlineCache).then(cache => cache.add('/offline.html')).then(() => self.skipWaiting()))
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('reference-maker-offline-') && key !== offlineCache).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && event.request.mode === 'navigate' && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith(fetch(event.request).catch(async () => {
      const fallback = await caches.match('/offline.html')
      return fallback || new Response('인터넷 연결 후 다시 시도해 주세요.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}})
    }))
  }
})
