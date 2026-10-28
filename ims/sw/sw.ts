/// <reference lib="esnext" />
/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist";

/**
 * IMS service worker (spec §10.4).
 * - Precaches the field app shell (/field), its JS/CSS, fonts, and the scanner's WASM.
 * - Any /field?... navigation gets the precached shell, so the field app opens offline.
 * - /api/* is never cached: private data lives in IndexedDB (Dexie), not in caches.
 * - Updates wait until the person taps "Update" (no skipWaiting), so a count is never interrupted.
 */
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const sameOrigin = (url: URL) => url.origin === self.location.origin;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    navigateFallback: "/field",
    navigateFallbackAllowlist: [/^\/field(?:\?.*)?$/],
  },
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  disableDevLogs: true,
  runtimeCaching: [
    { matcher: ({ url }) => sameOrigin(url) && url.pathname.startsWith("/api/"), handler: new NetworkOnly() },
    // Office pages always come from the server (never cached). The route exists so
    // that when the network fails, `fallbacks` below can show /offline.html instead
    // of the browser's error page. (/field navigations are served by the precache.)
    { matcher: ({ url, request }) => sameOrigin(url) && request.mode === "navigate", handler: new NetworkOnly() },
    {
      matcher: ({ url, request }) =>
        sameOrigin(url) && ["font", "image"].includes(request.destination) && !url.pathname.startsWith("/api/"),
      handler: new StaleWhileRevalidate({ cacheName: "ims-static" }),
    },
  ],
  fallbacks: {
    entries: [{ url: "/offline.html", matcher: ({ request }) => request.destination === "document" }],
  },
});

serwist.addEventListeners();
