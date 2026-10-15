// site-origin.test.ts — the share head must name the surface's OWN origin.
//
// Born with the SEO/share-card fix (2026-10-15): before this, no og:url or
// canonical existed at all. These tests pin the derivation so a future
// surface can never silently inherit another surface's URL — and so the
// noindex that keeps the Draconians TEST world out of search results can
// never leak onto a production build (the production Watchers world also
// runs a debug-flagged world id; keying noindex on anything but the test
// world's identity would noindex the real game).
import { describe, expect, test } from "bun:test";
import { PORTAL_ORIGIN, resolveIsTestSurface, resolveSiteOrigin } from "./site-origin";

describe("resolveSiteOrigin", () => {
  test("draconians build resolves to the test world's own origin", () => {
    expect(resolveSiteOrigin({ WORLD_ID: "draconians-world" })).toBe(
      "https://the-unbound-draconians.vercel.app",
    );
  });

  test("watchers build resolves to the production Watchers origin", () => {
    expect(resolveSiteOrigin({ WORLD_ID: "watchers-beta" })).toBe("https://the-unbound-chi.vercel.app");
  });

  test("every race world resolves to its own origin", () => {
    expect(resolveSiteOrigin({ WORLD_ID: "grays-world" })).toBe("https://the-unbound-grays.vercel.app");
    expect(resolveSiteOrigin({ WORLD_ID: "nephilim-world" })).toBe("https://the-unbound-nephilim.vercel.app");
    expect(resolveSiteOrigin({ WORLD_ID: "anunnaki-world" })).toBe("https://the-unbound-anunnaki.vercel.app");
    expect(resolveSiteOrigin({ WORLD_ID: "ashtar-world" })).toBe("https://the-unbound-ashtar.vercel.app");
  });

  test("an explicit SITE_ORIGIN wins over the world map", () => {
    expect(resolveSiteOrigin({ SITE_ORIGIN: "https://example.com", WORLD_ID: "draconians-world" })).toBe(
      "https://example.com",
    );
  });

  test("a trailing slash on SITE_ORIGIN is trimmed", () => {
    expect(resolveSiteOrigin({ SITE_ORIGIN: "https://example.com/" })).toBe("https://example.com");
  });

  test("unset or unknown identity falls back to the portal origin", () => {
    expect(resolveSiteOrigin({})).toBe(PORTAL_ORIGIN);
    expect(resolveSiteOrigin({ WORLD_ID: "some-future-world" })).toBe(PORTAL_ORIGIN);
  });
});

describe("resolveIsTestSurface", () => {
  test("the draconians test world is the test surface", () => {
    expect(resolveIsTestSurface({ WORLD_ID: "draconians-world" })).toBe(true);
  });

  test("production surfaces are NOT test surfaces", () => {
    expect(resolveIsTestSurface({ WORLD_ID: "watchers-beta" })).toBe(false);
    expect(resolveIsTestSurface({ WORLD_ID: "grays-world" })).toBe(false);
    expect(resolveIsTestSurface({})).toBe(false);
  });

  test("an explicit test origin also marks the test surface", () => {
    expect(resolveIsTestSurface({ SITE_ORIGIN: "https://the-unbound-draconians.vercel.app" })).toBe(true);
    expect(resolveIsTestSurface({ SITE_ORIGIN: "https://the-unbound-chi.vercel.app" })).toBe(false);
  });
});
