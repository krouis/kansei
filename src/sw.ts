/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CONTENT_CACHE, DEFAULT_CONTENT_BASE_URL } from './content/cacheNames';

declare const self: ServiceWorkerGlobalScope;

// Shell assets have build revisions. Content has its own verified cache and is
// never removed when Workbox activates a new shell version.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${import.meta.env.BASE_URL}index.html`)));
registerRoute(({ url }) => url.origin === self.location.origin && url.pathname.startsWith(DEFAULT_CONTENT_BASE_URL), async ({ request }) => {
  const cache = await caches.open(CONTENT_CACHE);
  const cached = await cache.match(request.url);
  if (!cached) return fetch(request); // Never populate verified storage here.
  const range = request.headers.get('range');
  if (!range) return cached;
  // HTMLAudioElement may request a byte range from an offline recording.
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416 });
  const bytes = await cached.arrayBuffer();
  const start = match[1] ? Number(match[1]) : Math.max(0, bytes.byteLength - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.byteLength - 1) : bytes.byteLength - 1;
  if (start > end || start >= bytes.byteLength) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.byteLength}` } });
  const headers = new Headers(cached.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${bytes.byteLength}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
// Only an explicit page request applies an update. A first install can claim
// its client without reloading and interrupting onboarding.
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
