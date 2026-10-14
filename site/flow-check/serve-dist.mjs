// Flow Crew dist server — serves the BUILT site (dist/) on the flow port.
// Why not serve.ts: that file owns port 3000 (the published preview) and
// frees the port by killing whoever holds it. The flow crew never touches
// another crew's server. This is the same static-first + SSR-fallback
// transport, on our own port, with one change: /sw.js is answered with a
// no-op worker so a test session can never be pinned to a stale shell by
// the unstamped @@BUILD@@ cache names (the worker itself is gated by the
// pwa-tests suite, not by flow checks).
// Usage: bun flow-check/serve-dist.mjs [port]   (default FLOW_PORT or 4517)
import { existsSync } from "node:fs";

const SITE = new URL("..", import.meta.url).pathname;
const CLIENT = `${SITE}dist/client`;
const PORT = Number(process.argv[2] || process.env.FLOW_PORT || 4517);

if (!existsSync(`${SITE}dist/server/server.js`)) {
  console.error("[flow-serve] no dist build — run `bun x vite build` first");
  process.exit(2);
}
const handler = (await import(`${SITE}dist/server/server.js`)).default;

const NOOP_SW = "self.addEventListener('install', () => self.skipWaiting());\nself.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));\n";

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/sw.js") {
      return new Response(NOOP_SW, { headers: { "content-type": "application/javascript", "cache-control": "no-store" } });
    }
    if (pathname !== "/") {
      const file = Bun.file(CLIENT + pathname);
      if (await file.exists()) return new Response(file, { headers: { "cache-control": "no-cache" } });
    }
    return handler.fetch(req);
  },
});
console.log(`[flow-serve] dist on http://127.0.0.1:${PORT}`);
