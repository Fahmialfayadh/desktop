const CACHE_COVERS = "liner-covers-v2";
const CACHE_SHELL = "liner-shell-v1";
const MAX_COVER_ENTRIES = 600;

const COVER_HOSTS = [
  "yt3.googleusercontent.com",
  "lh3.googleusercontent.com",
  "covers.tryliner.fun",
  "i1.sndcdn.com",
  "i2.sndcdn.com",
  "i3.sndcdn.com",
  "i4.sndcdn.com",
  "img.sndcdn.com",
  "a1.sndcdn.com",
  "i.pinimg.com",
  "images.genius.com",
  "yandex-images.clstorage.net",
];

const inFlightCovers = new Map();

function isIgnoredDomain(hostname) {
  const ignored = ["supabase.co", "googlevideo.com", "lrclib.net"];
  return ignored.some((d) => hostname === d || hostname.endsWith("." + d));
}

function isCoverRequest(parsedUrl) {
  if (
    !parsedUrl.pathname ||
    parsedUrl.pathname === "/" ||
    parsedUrl.pathname === "/health"
  ) {
    return false;
  }
  return COVER_HOSTS.some(
    (h) => parsedUrl.hostname === h || parsedUrl.hostname.endsWith("." + h),
  );
}

function isShellAsset(parsedUrl) {
  if (parsedUrl.origin !== self.location.origin) return false;
  const path = parsedUrl.pathname;
  if (path.startsWith("/assets/")) return true;
  if (path === "/manifest.webmanifest" || path === "/icon.png") return true;
  return /\.(?:js|css|woff2|svg|png)$/.test(path);
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_COVERS && k !== CACHE_SHELL)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function enforceQuota(cache, maxEntries) {
  try {
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      const toDelete = keys.slice(0, keys.length - maxEntries);
      await Promise.all(toDelete.map((req) => cache.delete(req)));
    }
  } catch {}
}

async function fetchAndCacheCover(request, cache, cacheKey) {
  let pending = inFlightCovers.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(request);
      if (response.ok && response.type !== "opaque") {
        await cache.put(cacheKey, response.clone());
        void enforceQuota(cache, MAX_COVER_ENTRIES);
      }
      return response;
    })().finally(() => inFlightCovers.delete(cacheKey));
    inFlightCovers.set(cacheKey, pending);
  }
  return (await pending).clone();
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.headers.has("range")) return;

  let parsedUrl;
  try {
    parsedUrl = new URL(event.request.url);
  } catch {
    return;
  }

  // Bypass ignored domains and endpoints
  if (
    isIgnoredDomain(parsedUrl.hostname) ||
    parsedUrl.pathname.startsWith("/api/") ||
    parsedUrl.pathname === "/health"
  ) {
    return;
  }

  // 1. Cover images caching
  if (isCoverRequest(parsedUrl)) {
    const cacheKey = event.request.url;
    event.respondWith(
      caches.open(CACHE_COVERS).then(async (cache) => {
        const cached = await cache.match(cacheKey, { ignoreVary: true });
        if (cached) return cached;
        try {
          return await fetchAndCacheCover(event.request, cache, cacheKey);
        } catch (err) {
          const stale = await cache.match(cacheKey, { ignoreVary: true });
          if (stale) return stale;
          throw err;
        }
      }),
    );
    return;
  }

  // 2. Navigation HTML requests (Network-First)
  if (
    event.request.mode === "navigate" ||
    (parsedUrl.origin === self.location.origin &&
      (parsedUrl.pathname === "/" || parsedUrl.pathname === "/index.html"))
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_SHELL);
        try {
          const response = await fetch(event.request);
          if (response.ok) {
            void cache.put(event.request, response.clone());
          }
          return response;
        } catch (err) {
          const cached =
            (await cache.match(event.request)) || (await cache.match("/"));
          if (cached) return cached;
          throw err;
        }
      })(),
    );
    return;
  }

  // 3. Same-origin static assets (Stale-While-Revalidate)
  if (isShellAsset(parsedUrl)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_SHELL);
        const cached = await cache.match(event.request);
        const fetchPromise = fetch(event.request)
          .then((response) => {
            if (response.ok) {
              void cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      })(),
    );
    return;
  }
});
