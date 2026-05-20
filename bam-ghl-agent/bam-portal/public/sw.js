// BAM Portal service worker.
//
// Purpose: make the client portal installable as a PWA (it gives Chrome
// a real fetch handler). It is deliberately NETWORK-ONLY — it caches
// nothing, so it can never serve a stale page or fight the portal's
// own deploy-detection. Safe to update or remove at any time.
//
// Only same-origin GET requests are handled (passed straight to the
// network). Cross-origin requests (fonts, CDN, Supabase) fall through
// to the browser untouched.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => Response.error()));
});
