// exit-law.test.ts — THE EXIT LAW (owner 2026-10-13): "If there's no exit
// then it's a fucking freeze up." Every page, sheet, overlay and modal carries
// its own visible, working exit; nothing relies on the OS/browser back (in
// fullscreen it may not even exist). These source pins follow the
// PlanetSheet.test.ts precedent and guard the audit fixes of 2026-10-13:
//
//  1. play.tsx toasts are pointer-events-none — a toast is a message, never a
//     lid: it must not swallow taps or swipes along the bottom edge.
//  2. The router's 404 is not a dead end — it carries a real door back into
//     the game (a full-load anchor, so a stale bundle can't keep itself).
//  3. Custom-sheet close buttons meet the codebase's own 44px floor (the
//     SheetHeader standard: h-11 w-11). A 32px ✕ on a phone in fullscreen is,
//     for a player who can't land it, no exit at all.
//
// (Assertions use .includes() + toBe per the PlanetSheet.test.ts precedent —
// bun:test's Matchers type in this tree has no toContain.)
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf-8");
const has = (src: string, needle: string) => src.includes(needle);

describe("Exit Law — toasts never block the bottom edge (play.tsx)", () => {
  const src = read("../routes/play.tsx");

  test("every toast render is pointer-events-none", () => {
    const renders = src.match(/\{toast && <div className="[^"]*"/g) ?? [];
    expect(renders.length).toBe(4);
    for (const r of renders) expect(r.includes("pointer-events-none")).toBe(true);
  });
});

describe("Exit Law — the 404 page is a door, not a dead end (__root.tsx)", () => {
  const src = read("../routes/__root.tsx");

  test("notFoundComponent links back into the game", () => {
    expect(has(src, 'href="/"')).toBe(true);
    expect(has(src, "Back to the game")).toBe(true);
  });

  test("the old bare-text 404 is gone", () => {
    expect(has(src, "<div>Page not found</div>")).toBe(false);
  });
});

describe("Exit Law — custom close buttons meet the 44px floor", () => {
  test("PlanetSheet ✕ is h-11 w-11 (was h-8 w-8)", () => {
    const src = read("PlanetSheet.tsx");
    expect(has(src, "flex h-11 w-11 items-center justify-center rounded-full")).toBe(true);
    expect(has(src, "flex h-8 w-8")).toBe(false);
  });

  test("ModuleOverlay ✕ is h-11 w-11 (was h-8 w-8)", () => {
    const src = read("ModuleOverlay.tsx");
    expect(has(src, "flex h-11 w-11 items-center justify-center rounded-full")).toBe(true);
    expect(has(src, "flex h-8 w-8")).toBe(false);
  });

  test("StarMap gate + planet panels: both ✕ are 44px (were 32px)", () => {
    const src = read("StarMap.tsx");
    expect(src.match(/width: 44, height: 44/g)?.length).toBe(2);
    expect(has(src, "width: 32, height: 32")).toBe(false);
  });

  test("WorldMapView colony card ✕ carries a 44px floor (was ~26px)", () => {
    const src = read("WorldMapView.tsx");
    expect(has(src, "flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/10")).toBe(true);
  });

  test("MemberProfile ✕ carries a 44px floor (was ~28px)", () => {
    const src = read("alliance/MemberProfile.tsx");
    expect(has(src, "flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line")).toBe(true);
  });

  test("play.tsx RiskModal + CodexModal ✕ carry a 44px floor", () => {
    const src = read("../routes/play.tsx");
    const hits = src.match(/flex min-h-11 min-w-11 items-center justify-center rounded border border-white\/15/g) ?? [];
    expect(hits.length).toBe(2);
  });
});
