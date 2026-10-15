// Site origin — the public origin THIS build is served from.
//
// One codebase ships every surface (portal, six worlds, the Draconians test
// world), and the share/search head (og:url, canonical, og:image) must name
// the surface's OWN origin — a Draconians link shared from the test build
// must not claim the portal's URL, and vice versa. The build already knows
// which world it is (WORLD_ID, baked by vite.config's __WORLD_ENV__ define
// and read at runtime from process.env on the server — the same dual
// resolution world-config.ts uses), so the origin is derived from it:
//
//   1. SITE_ORIGIN env wins when a deploy sets it explicitly.
//   2. Otherwise the worldId → origin map below (mirrors servers.ts).
//   3. Otherwise the portal origin — the hub is the safe default for a
//      build whose identity is unset (local dev, future surfaces).
//
// The Draconians TEST world is also identified here so the root head can
// keep it out of search indexes (noindex) while production surfaces stay
// indexable — keyed on the test world's identity ONLY, never on
// DEBUG_WORLD (the production Watchers build also runs a debug-flagged
// world id, and noindexing production would be a self-inflicted wound).

/** The hub every surface links back to; also the fallback origin. */
export const PORTAL_ORIGIN = "https://the-unbound-portal.vercel.app";

/** worldId → the origin that world is served from (mirrors servers.ts). */
const WORLD_ORIGINS: Record<string, string> = {
  "watchers-beta": "https://the-unbound-chi.vercel.app",
  "draconians-world": "https://the-unbound-draconians.vercel.app",
  "grays-world": "https://the-unbound-grays.vercel.app",
  "nephilim-world": "https://the-unbound-nephilim.vercel.app",
  "anunnaki-world": "https://the-unbound-anunnaki.vercel.app",
  "ashtar-world": "https://the-unbound-ashtar.vercel.app",
};

export interface SiteOriginEnvMap {
  SITE_ORIGIN?: string;
  WORLD_ID?: string;
}

function trimTrailingSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

/** Pure factory — resolves the serving origin from an explicit env map. */
export function resolveSiteOrigin(e: SiteOriginEnvMap): string {
  if (e.SITE_ORIGIN) return trimTrailingSlash(e.SITE_ORIGIN);
  if (e.WORLD_ID && WORLD_ORIGINS[e.WORLD_ID]) return WORLD_ORIGINS[e.WORLD_ID];
  return PORTAL_ORIGIN;
}

/** Pure: true only for the Draconians test world (by id or by origin). */
export function resolveIsTestSurface(e: SiteOriginEnvMap): boolean {
  if (e.WORLD_ID === "draconians-world") return true;
  return resolveSiteOrigin(e) === WORLD_ORIGINS["draconians-world"];
}

/** Read env the same way world-config.ts does: process.env (server/SSR
 *  runtime) first, then the Vite-baked __WORLD_ENV__ literals (client). */
declare const __WORLD_ENV__: Record<string, string> | undefined;
function env(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env?.[key] !== undefined) {
    return process.env[key];
  }
  if (typeof __WORLD_ENV__ !== "undefined" && __WORLD_ENV__[key] !== undefined) {
    return __WORLD_ENV__[key];
  }
  return undefined;
}

const BUILD_ENV: SiteOriginEnvMap = {
  SITE_ORIGIN: env("SITE_ORIGIN"),
  WORLD_ID: env("WORLD_ID"),
};

/** This build's public origin, e.g. "https://the-unbound-draconians.vercel.app". */
export const SITE_ORIGIN: string = resolveSiteOrigin(BUILD_ENV);

/** True only on the Draconians test build — drives the noindex head meta. */
export const IS_TEST_SURFACE: boolean = resolveIsTestSurface(BUILD_ENV);

/** Absolute URL of this surface's share card (see public/og-card.jpg). */
export const OG_IMAGE_URL = `${SITE_ORIGIN}/og-card.jpg`;
