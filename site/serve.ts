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
import { STRIPE_WEBHOOK_PATH, handleStripeWebhookRequest, webhookResponse } from "./src/game/payments/webhook-route";

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

/**
 * THE WEIGHTS ROUTE — where the bundled translator's model is served from.
 *
 * WHY A ROUTE OF OUR OWN AND NOT `public/`: everything in `public/` is copied into
 * `dist/client` and therefore into the build id (`fingerprintClient` below reads
 * the name + size of every file in that directory). A 603 MB model there would
 * make EVERY deploy look like a new build AND be re-fetched by every player — the
 * opposite of the owner's "updates stay incremental" rule. `site/models/` is
 * outside the build, is gitignored, and is served by this function instead.
 *
 * RANGE SUPPORT IS NOT OPTIONAL: the loader downloads the model in chunks
 * (`src/game/translate/weights.ts`) so a dropped connection resumes from the
 * chunks already in Cache Storage rather than restarting 603 MB. That needs
 * `accept-ranges` and honest 206 responses with `content-range`. A client that
 * asks for a range we cannot satisfy gets a 416 and an honest `bytes *／size`,
 * never a truncated 200 that would be cached as a whole file.
 *
 * CACHE-CONTROL: the file name carries the model AND its version, so the bytes at
 * a given URL never change — immutable for a year, which also keeps the browser's
 * own HTTP cache from re-fetching what Cache Storage already holds.
 */
const WEIGHTS_PREFIX = "/models/";
const WEIGHTS_DIR = `${import.meta.dir}/models`;

function weightsHeaders(name: string): Record<string, string> {
  return {
    "content-type": "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
    "x-deepspace-weights": name,
  };
}

/**
 * Serve one weights file, byte ranges honoured. Exported so `translate-tests` can
 * drive the real response builder (206 shape, 416 shape, resumable slices) over a
 * real socket without binding port 3000. Returns null for any other path.
 */
export async function serveWeights(req: Request, dir = WEIGHTS_DIR): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith(WEIGHTS_PREFIX)) return null;
  const name = pathname.slice(WEIGHTS_PREFIX.length);
  // One flat file name, no traversal: the manifest names the file, nothing else does.
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name) || name.startsWith(".")) {
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  }
  const file = Bun.file(`${dir}/${name}`);
  if (!(await file.exists())) {
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  }
  const size = file.size;
  const headers = weightsHeaders(name);
  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const first = match[1] ?? "";
      const last = match[2] ?? "";
      const start = first === "" ? 0 : Number(first);
      const wantedEnd = last === "" ? size - 1 : Number(last);
      if (Number.isInteger(start) && Number.isInteger(wantedEnd) && start < size && wantedEnd >= start) {
        const end = Math.min(wantedEnd, size - 1);
        const length = end - start + 1;
        return new Response(file.slice(start, end + 1).stream(), {
          status: 206,
          headers: {
            ...headers,
            "content-range": `bytes ${String(start)}-${String(end)}/${String(size)}`,
            "content-length": String(length),
          },
        });
      }
      return new Response(null, {
        status: 416,
        headers: { ...headers, "content-range": `bytes */${String(size)}` },
      });
    }
    // An unparsable Range is not a reason to fail: send the whole file, which is
    // what a Range-ignoring server does, and the loader reports ranged:false.
  }
  return new Response(file, {
    headers: { ...headers, "content-length": String(size) },
  });
}

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
  /**
   * THE STRIPE WEBHOOK — the one POST route this server owns.
   *
   * Why here and not a TanStack Start route file: the signature is computed over
   * the EXACT bytes Stripe sent, so this handler must read the request body
   * itself, before any framework parses it, and it must answer with status codes
   * (400/500 tell Stripe to retry and show the failure in their dashboard)
   * instead of a page. A route file renders HTML through the app shell; this is
   * transport, so it sits in the transport layer — the same module the dev
   * server's middleware calls, so both hosts behave identically.
   */
  if (pathname === STRIPE_WEBHOOK_PATH) {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
        status: 405,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", allow: "POST" },
      });
    }
    return webhookResponse(
      await handleStripeWebhookRequest({
        rawBody: await req.text(),
        signatureHeader: req.headers.get("stripe-signature"),
      }),
    );
  }
  // The bundled translator's weights live outside dist/client (see serveWeights).
  const weights = await serveWeights(req);
  if (weights) return weights;
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
