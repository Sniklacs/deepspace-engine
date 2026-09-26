import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

/**
 * THE STRIPE WEBHOOK, ON THE DEV SERVER.
 *
 * `serve.ts` owns this route in the published build; the dev server is a
 * different HTTP server and would otherwise answer 404 for the URL we hand
 * Stripe, which makes the one thing that must work in production the one thing
 * that cannot be tested before it does. This middleware gives the dev host the
 * same handler, so a delivery can be replayed against the local (or the
 * published -dev) host byte for byte.
 *
 * The path literal is repeated here because a Vite config cannot import app
 * modules at load time; `payments-tests` pins this string to
 * STRIPE_WEBHOOK_PATH in webhook-route.ts, so the two cannot drift apart.
 *
 * The handler is loaded through `ssrLoadModule` (Vite's own server-side module
 * loader) rather than a static import: the app module imports the game store,
 * which is a runtime concern of the request, not of the config.
 */
const STRIPE_WEBHOOK_PATH = "/api/dse-stripe-webhook";
const STRIPE_WEBHOOK_MODULE = "/src/game/payments/webhook-route.ts";

function stripeWebhookDevRoute(): Plugin {
  return {
    name: "deepspace-stripe-webhook",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== STRIPE_WEBHOOK_PATH) return next();
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
          return;
        }
        // The RAW body, exactly as it arrived: the signature is over these bytes.
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const rawBody = Buffer.concat(chunks).toString("utf8");
        const header = req.headers["stripe-signature"];
        try {
          const mod = (await server.ssrLoadModule(STRIPE_WEBHOOK_MODULE)) as {
            handleStripeWebhookRequest: (input: { rawBody: string; signatureHeader: string | null }) => Promise<{
              status: number;
              body: Record<string, unknown>;
            }>;
          };
          const result = await mod.handleStripeWebhookRequest({
            rawBody,
            signatureHeader: typeof header === "string" ? header : null,
          });
          res.statusCode = result.status;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          res.end(JSON.stringify(result.body));
        } catch (err) {
          // A broken dev-time module must not look like a Stripe problem.
          console.error("[dev stripe-webhook]", err);
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: false, error: "dev_route_failure" }));
        }
      });
    },
  };
}

export default defineConfig({
  server: {
    port: 3000,
    host: true,
    // The site is reverse-proxied behind <label>.<PUBLIC_SITE_DOMAIN>; the proxy
    // masks the Host to localhost:3000, but accept any host so a dev server never
    // rejects a proxied request with "Blocked request".
    allowedHosts: true,
    // The dev server is reachable through the TLS proxy, so the HMR websocket
    // must dial back on 443, not the dev port. If the socket can't connect,
    // pages still serve — hot reload degrades, never breaks.
    hmr: { clientPort: 443 },
    // The dev server can serve source files; never let it serve local secrets,
    // and never let it serve anything outside the site dir. Gotchas this list
    // encodes: a custom `deny` REPLACES Vite's defaults (so .git must be
    // restated), patterns containing "/" match the ABSOLUTE path (so dir
    // patterns need a leading **/), and `allow` left to its default widens to
    // the nearest workspace root — a stray .git or workspaces package.json in
    // /home/team/shared would expose the whole shared dir.
    fs: {
      strict: true,
      allow: [import.meta.dirname],
      deny: [".env", ".env.*", "*.{crt,pem,key}", "**/.run/**", "**/.git/**"],
    },
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tanstackStart(),
    viteReact(),
    stripeWebhookDevRoute(),
  ],
});
