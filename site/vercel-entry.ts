// Vercel Build Output API function entry.
//
// The Build Output Node launcher invokes the default export as a classic Node
// `(req, res)` handler — NOT a web handler. TanStack Start emits a portable web
// fetch handler (dist/server/server.js), so we adapt: Node IncomingMessage → web
// Request, run the fetch handler, stream the web Response back onto ServerResponse.
// Node 22 has global Request/Response/Headers/ReadableStream.
//
// Bundled (with its deps + the SSR handler's dynamic ./assets chunks) into
// .vercel/output/functions/render.func/index.mjs by build-vercel.sh.
import type { IncomingMessage, ServerResponse } from "node:http";

import handler from "./dist/server/server.js";
import {
  XSOLLA_WEBHOOK_PATH,
  handleXsollaWebhookRequest,
  webhookResponse,
} from "./src/game/payments/webhook-route";

const fetchHandler = handler as {
  fetch: (request: Request) => Response | Promise<Response>;
};

const toWebRequest = (req: IncomingMessage): Request => {
  const host = req.headers.host ?? "localhost";
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value != null) headers.set(key, value);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    ...(hasBody ? { body: req as unknown as ReadableStream, duplex: "half" } : {}),
  } as RequestInit);
};

export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const pathname = new URL(
      req.url ?? "/",
      `https://${req.headers.host ?? "localhost"}`
    ).pathname;
    // Health check endpoint for server-select UI.
    // Returns { status: "up" } if DB reachable, 503 { status: "down" } if not.
    if (pathname === "/api/health") {
      const worldId = process.env.WORLD_ID || "watchers-beta";
      const worldName = process.env.WORLD_NAME || "The Shattered Academies";
      const raceLock = process.env.RACE_LOCK || "watchers";
      const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      if (!dbUrl) {
        res.statusCode = 503;
        res.end(JSON.stringify({
          status: "down",
          reason: "database_not_configured",
          worldId,
          timestamp: new Date().toISOString(),
        }));
        return;
      }
      try {
        const { neon } = await import("@neondatabase/serverless");
        const sql = neon(dbUrl);
        await sql`select 1`;
        let playerCount = 0;
        try {
          const rows = await sql`SELECT COUNT(*) as count FROM accounts`;
          playerCount = Number((rows as any)[0]?.count ?? 0);
        } catch {}
        res.statusCode = 200;
        res.end(JSON.stringify({
          status: "up",
          worldId,
          worldName,
          raceLock,
          playerCount,
          reverb: 0,
          timestamp: new Date().toISOString(),
        }));
      } catch {
        res.statusCode = 503;
        res.end(JSON.stringify({
          status: "down",
          reason: "database",
          worldId,
          timestamp: new Date().toISOString(),
        }));
      }
      return;
    }
    // The Xsolla webhook is intercepted at the transport layer, exactly like
    // serve.ts does: TanStack Start route files are not the seam for a route
    // that must read the UNPARSED body (the signature is over the exact bytes)
    // and answer with status codes rather than a page.
    if (pathname === XSOLLA_WEBHOOK_PATH) {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.setHeader("allow", "POST");
        res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const rawBody = Buffer.concat(chunks).toString("utf-8");
      const signatureHeader =
        typeof req.headers.authorization === "string"
          ? req.headers.authorization
          : null;
      const webRes = webhookResponse(
        await handleXsollaWebhookRequest({ rawBody, signatureHeader })
      );
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(await webRes.text());
      return;
    }
    const webRes = await fetchHandler.fetch(toWebRequest(req));
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    if (webRes.body) {
      const reader = webRes.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (error) {
    // Log the detail server-side (captured by the host's function logs); never
    // return a stack trace to the public visitor of the site.
    console.error("[team-site] SSR request failed", error);
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain");
    res.end("Internal Server Error");
  }
}
