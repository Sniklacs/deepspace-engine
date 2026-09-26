/* sw.js — the installable app shell's service worker.
 *
 * WHAT IT IS FOR: a home-screen launch has to work as an app. That means the
 * shell (the document, the manifest, the icons) comes up without a network trip,
 * and a launch with no signal still shows the game rather than the browser's
 * dinosaur.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: touch the game. Colonies live in Postgres and
 * every state read is a server function (`/_serverFn/…`) — caching one would hand
 * a player a stale colony and call it the truth. Those requests are never
 * intercepted here; they fail loudly instead, which is honest.
 *
 * THREE STRATEGIES, ONE PER KIND OF REQUEST:
 *   1. NAVIGATIONS  — network-FIRST, cached shell only as an offline fallback.
 *      This app is server-rendered: the HTML is the state's carriage, so serving
 *      a saved copy as though it were current would lie about which build, which
 *      language and which colony the player is looking at. The cached copy is
 *      only ever a last resort, and it is never refreshed from a navigation.
 *   2. /assets/*    — cache-FIRST. Vite fingerprints every file it emits
 *      (index-A1B2C3.js), so a hit can never be stale: a new build ships new
 *      names. This is what makes a repeat launch instant.
 *   3. the shell     — the manifest and the icons, precached at install, served
 *      from the cache and replaced wholesale by the next version.
 *
 * VERSIONING: @@BUILD@@ is replaced by the production server with a hash of the
 * deployed client assets (serve.ts). Because a new deploy therefore produces a
 * DIFFERENT sw.js, the browser sees an update, the new worker precaches, and
 * `skipWaiting` + `clients.claim` move the next launch onto it — no stale shell
 * survives a deploy. In dev the token stays literal, which is harmless.
 */

const BUILD = "@@BUILD@@";
const SHELL_CACHE = `dse-shell-${BUILD}`;
const ASSET_CACHE = `dse-assets-${BUILD}`;
const KEEP = [SHELL_CACHE, ASSET_CACHE];

/** The document every offline navigation falls back to. Only ever precached. */
const SHELL_DOCUMENT = "/";

/** Precached at install: the manifest and the icons an install needs. */
const SHELL_FILES = [
  SHELL_DOCUMENT,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon-180.png",
];

/**
 * NEVER INTERCEPTED — the game's own data. A server function is always a network
 * request, even when the player is offline and it will fail; there is no cached
 * answer that is not a lie. `/api/` and `/__` are the same promise for anything
 * added later.
 */
const NEVER = [/^\/_serverFn(\/|$)/, /^\/api(\/|$)/, /^\/__/];

/** Server functions can also arrive as a query parameter on another path. */
const SERVER_FN_PARAM = ["_serverFnId", "serverFnId"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        SHELL_FILES.map(async (url) => {
          try {
            // `reload` skips the HTTP cache: the install-time copy must be the
            // build that registered this worker, not a stale browser entry.
            const res = await fetch(url, { cache: "reload", credentials: "same-origin" });
            if (res && res.ok) await cache.put(url, res.clone());
          } catch {
            /* Offline at install: precache what is reachable, never fail the
               install — a half-cached shell still beats no worker at all. */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // The clean update: every cache from an older build goes, so a new deploy
      // can never be served out of the old shell.
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok && res.type === "basic") await cache.put(request, res.clone());
  return res;
}

async function navigationNetworkFirst(request) {
  try {
    return await fetch(request);
  } catch (err) {
    // Offline. Serve the precached shell if there is one; if there is not, let
    // the request fail so the browser shows its own offline page — this worker
    // invents no copy of its own to put in front of a player.
    const cache = await caches.open(SHELL_CACHE);
    const shell = await cache.match(SHELL_DOCUMENT);
    if (shell) return shell;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Anything that is not a plain same-origin GET is left completely alone:
  // POSTs, and every server-function call, go straight to the network.
  if (request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((re) => re.test(url.pathname))) return;
  if (SERVER_FN_PARAM.some((p) => url.searchParams.has(p))) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationNetworkFirst(request));
    return;
  }

  // Fingerprinted build output only — a cache hit cannot be stale.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // The precached shell files, served offline-capable.
  if (SHELL_FILES.includes(url.pathname) && url.search === "") {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});
