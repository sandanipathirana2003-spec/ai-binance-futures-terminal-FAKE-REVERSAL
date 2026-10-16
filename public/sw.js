// Minimal service worker. Trading data must always be fresh, so this does NOT
// cache /api/market — it only exists so the browser considers the site
// "installable" as a PWA and the app shell loads instantly on relaunch.
const SHELL_CACHE = 'terminal-shell-v2'
const SHELL_ASSETS = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // Never intercept API calls or Binance requests — always go to network.
  if (url.pathname.startsWith('/api/')) return
  if (event.request.method !== 'GET') return

  // Page loads: network first so a new deploy shows up on the next open (cache only as an offline fallback).
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/')))
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  )
})
