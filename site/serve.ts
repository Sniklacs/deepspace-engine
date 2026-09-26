// Production server for the built site. The TanStack Start build emits a portable
// fetch handler (dist/server/server.js) plus static client assets (dist/client);
// this wraps them in a Bun server on port 3000 — static files first, SSR for the
// rest. Run `bun run build` before starting. Restart it with `bun run publish`.
//
// Starting a new instance supersedes the old one: it frees the port no matter
// which user owns the current server (provisioning starts it as `engine`; a team
// member's `bun run publish` runs as their own user), so publish never collides
// with an already-running server. Every sandbox user has passwordless sudo, so
// the takeover works across user boundaries.
import handler from "./dist/server/server.js";
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";

// Pinned, NOT read from the environment. The published preview URL
// (<label>.<PUBLIC_SITE_DOMAIN>) is reverse-proxied to 0.0.0.0:3000 inside the
// sandbox, so the default site MUST bind there. Bun auto-loads .env files, so
// honouring process.env.PORT/HOST would let a stray env var or a .env in the site
// dir silently move the site off :3000 (or onto loopback) and break the public URL.
const PORT = 3000;
const HOST = "0.0.0.0";
const CLIENT_DIR = `${import.meta.dir}/dist/client`;

/**
 * THE BUILD ID — why the shipped worker cannot be served without one.
 *
 * public/sw.js ships with the literal token `@@BUILD@@` in its two cache names.
 * A worker whose cache name never changes is a worker that never updates: the
 * browser fetches a byte-identical sw.js on every visit, concludes nothing has
 * changed, keeps the old worker, and the player stays pinned to the shell of
 * whatever build installed it — including after we ship a fix or the bundled
 * translator. Stamping a per-deploy id over the token on the way out (below)
 * makes every deploy a different worker: the browser sees the update, the new
 * worker precaches, `skipWaiting` + `clients.claim` move the next launch onto
 * it, and `activate` deletes the older caches.
 *
 * The id is content-derived — the names and sizes of everything this build ships
 * to a browser — not a clock. Restarting the same build keeps the same id (no
 * pointless re-precache on every publish), and any deploy that changes something
 * a browser can fetch gets a new one.
 */
const BUILD_TOKEN = "@@BUILD@@";
const SW_PATH = "/sw.js";
const MANIFEST_PATH = "/manifest.webmanifest";

function fingerprintClient(): string {
  const parts: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, childRel);
      else parts.push(`${childRel}:${String(statSync(`${dir}/${entry.name}`).size)}`);
    }
  };
  try {
    walk(CLIENT_DIR, "");
  } catch {
    /* no build on disk yet — still serve, just with a constant id */
  }
  parts.sort();
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex").slice(0, 16);
}

export const BUILD = fingerprintClient();

/** The worker source as a browser must receive it: the token replaced. */
export function stampBuildToken(source: string, build = BUILD): string {
  return source.split(BUILD_TOKEN).join(build);
}

/**
 * Cache policy, per path. The split is the whole point of this function:
 *
 *   • the WORKER and the MANIFEST must never be frozen in the browser's cache.
 *     A stale worker is a stuck app and a stale manifest is an install that
 *     describes a build nobody is running, so neither is ever stored: no-cache
 *     (the manifest may be kept, but must be revalidated) and no-store for the
 *     worker itself.
 *   • /assets/* is the opposite — Vite fingerprints everything it emits
 *     (index-A1B2C3.js), so a cache hit cannot be stale and a year immutable is
 *     both safe and what makes a repeat launch instant.
 *   • /icons/* is NOT fingerprinted (the designer replaces the art at the same
 *     paths), so it is never `immutable`: a day is fast enough to be quiet and
 *     short enough that new art actually arrives.
 */
export function cacheHeaders(pathname: string, build = BUILD): Record<string, string> {
  if (pathname === SW_PATH) {
    return {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache, no-store, must-revalidate",
      "x-deepspace-build": build,
    };
  }
  if (pathname === MANIFEST_PATH) {
    return {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "no-cache, must-revalidate",
      "x-deepspace-build": build,
    };
  }
  if (pathname.startsWith("/assets/")) {
    return { "cache-control": "public, max-age=31536000, immutable" };
  }
  if (pathname.startsWith("/icons/")) {
    return { "cache-control": "public, max-age=86400" };
  }
  return { "cache-control": "public, max-age=3600" };
}

/**
 * Static file first, SSR for everything else. The worker is the one file that is
 * TRANSFORMED rather than passed through (stampBuildToken).
 */
export async function appFetch(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname !== "/") {
    if (pathname === SW_PATH) {
      const worker = Bun.file(CLIENT_DIR + SW_PATH);
      if (await worker.exists()) {
        return new Response(stampBuildToken(await worker.text()), {
          headers: cacheHeaders(pathname),
        });
      }
    }
    // The manifest is read as text for the same reason: served as a File, Bun
    // attaches a `content-disposition: filename="…"` that no installer asked
    // for. A manifest fetch ignores it today, but a download prompt on the file
    // that decides how the app installs is not a risk worth carrying.
    if (pathname === MANIFEST_PATH) {
      const manifest = Bun.file(CLIENT_DIR + MANIFEST_PATH);
      if (await manifest.exists()) {
        return new Response(await manifest.text(), { headers: cacheHeaders(pathname) });
      }
    }
    const file = Bun.file(CLIENT_DIR + pathname);
    if (await file.exists()) return new Response(file, { headers: cacheHeaders(pathname) });
  }
  return (handler as { fetch: (r: Request) => Response | Promise<Response> }).fetch(req);
}

// Free PORT regardless of which user owns the current listener. lsof runs under
// sudo so it can see (and the kill can signal) a process owned by another user;
// the loop waits for the socket to actually release before we bind.
const freePort =
  `for _ in $(seq 1 25); do ` +
  `pids=$(lsof -t -iTCP:${String(PORT)} -sTCP:LISTEN 2>/dev/null || true); ` +
  `if [ -z "$pids" ]; then exit 0; fi; ` +
  `kill $pids 2>/dev/null || true; sleep 0.2; ` +
  `done`;

// `import.meta.main` guard: serving on import would make this file unusable as a
// seam. `bun run serve.ts` (and therefore `bun run start` after a publish) is the
// entry point, so production starts the server exactly as before, while the
// pwa-tests suite imports BUILD / stampBuildToken / cacheHeaders / appFetch to
// gate the headers and the substitution without binding a port.
if (import.meta.main) {
  // Take over the port, re-freeing and retrying if another publish grabbed it in the
  // gap between freeing and binding (last publish wins). Bun.serve throws EADDRINUSE
  // synchronously, so without this a raced publish would die while the shell already
  // reported success.
  for (let attempt = 1; ; attempt++) {
    await Bun.$`sudo sh -c ${freePort}`.quiet().nothrow();
    try {
      Bun.serve({ port: PORT, hostname: HOST, fetch: appFetch });
      break;
    } catch (err) {
      if (attempt >= 10) throw err;
      await Bun.sleep(200);
    }
  }

  console.log(`team-site serving on http://${HOST}:${String(PORT)} (build ${BUILD})`);
}
