/* Service Worker - Safe, iOS-compatible */
const CACHE_NAME = "anki_v3_shell";

const ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  console.log("[SW] Installing...");
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        // Try to add all, but don't fail if some are missing (iOS)
        for (const asset of ASSETS) {
          try {
            await cache.add(asset);
          } catch (e) {
            console.warn(`[SW] Cache add failed for ${asset}:`, e.message);
          }
        }
      } catch (e) {
        console.warn("[SW] Cache error during install:", e.message);
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Activating...");
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      for (const key of keys) {
        if (key !== CACHE_NAME) {
          console.log("[SW] Deleting old cache:", key);
          await caches.delete(key);
        }
      }
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and non-same-origin
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // SPA: serve index.html for navigate requests
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match("./index.html");
          if (cached) return cached;
        } catch (e) {
          console.warn("[SW] Cache match failed:", e.message);
        }

        try {
          const fresh = await fetch(request);
          return fresh;
        } catch (e) {
          return new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // Cache-first strategy
  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);

        if (cached) {
          // Background update (optional)
          fetch(request)
            .then(r => {
              if (r && r.ok) cache.put(request, r.clone()).catch(() => {});
            })
            .catch(() => {});
          return cached;
        }

        try {
          const fresh = await fetch(request);
          if (fresh && fresh.ok) {
            cache.put(request, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch (e) {
          return new Response("Offline", { status: 503 });
        }
      } catch (e) {
        return new Response("Offline", { status: 503 });
      }
    })()
  );
});
