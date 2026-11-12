/* Nous — service worker : notifications push et ouverture hors connexion. */
const CACHE = 'nous-v3';
const SHELL = ['/', '/style.css', '/questions.js', '/core.js', '/views1.js', '/views2.js', '/views3.js', '/boot.js', '/icon-192.png', '/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch (err) { d = { title: 'Nous', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Nous', { body: d.body || '', tag: d.tag, renotify: !!d.tag, icon: '/icon-192.png', badge: '/badge.png', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if ('focus' in c) { c.navigate(url).catch(() => { }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
