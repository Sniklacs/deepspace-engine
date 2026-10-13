// health-contract.test.ts — portal health endpoint pins (Oct 13 2026).
//
// The portal page polls every world's /api/health cross-origin. These
// source pins keep the contract from silently regressing: CORS on the
// health endpoint only, the accepting + war fields in the up payload,
// and no return of the stub war feed in StarMap (the war viz is fed by
// the polled health payload now — game/portal-health.ts).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("portal health contract (2026-10-13)", () => {
  const entry = readFileSync(join(SITE_ROOT, "vercel-entry.ts"), "utf-8");
  const healthBlock = entry.slice(entry.indexOf('pathname === "/api/health"'));

  test("health endpoint answers cross-origin (portal is deployment-agnostic)", () => {
    expect(healthBlock).toMatch(/Access-Control-Allow-Origin", "\*"/);
    expect(healthBlock).toMatch(/Access-Control-Allow-Methods", "GET, OPTIONS"/);
    expect(healthBlock).toMatch(/req\.method === "OPTIONS"/);
  });

  test("up payload carries the portal fields: accepting + war + reverb", () => {
    expect(healthBlock).toMatch(/accepting,/);
    expect(healthBlock).toMatch(/war: agg\.war/);
    expect(healthBlock).toMatch(/reverb: agg\.reverb/);
    expect(healthBlock).toMatch(/WORLD_ACCEPTING/);
  });

  test("StarMap polls the portal monitor — the null war stub is retired", () => {
    const starMap = readFileSync(join(SITE_ROOT, "src", "components", "StarMap.tsx"), "utf-8");
    expect(starMap).not.toMatch(/fetchWarState/);
    expect(starMap).toMatch(/warStateFromPortal/);
    expect(starMap).toMatch(/nextPortalPollDelay/);
    expect(starMap).toMatch(/visibilitychange/);
  });
});
