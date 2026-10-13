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

describe("Exit Law — battle end screens are never a trap (owner 2026-10-13, second sweep)", () => {
  // The first audit swept sheets/modals and MISSED the battle result
  // sheet: it offered Retry / Re-challenge / Report / replay / save and
  // NO exit, while the only door was an 11px header pill labeled for the
  // Arena. Hans stood on it asking "where's my exit."
  const scene = read("BattleScene/BattleScene.tsx");

  test("the result sheet carries its own full-size EXIT (44px floor)", () => {
    expect(has(scene, 'data-testid="battle-result-exit"')).toBe(true);
    expect(has(scene, "min-h-[44px] w-full items-center justify-center")).toBe(true);
    expect(has(scene, "🚪 Exit battle")).toBe(true);
    // The exit sits OUTSIDE the actions/report/save view switch (it is
    // rendered after the save view closes), so it is present in every
    // sheet view — pin its position after the report view marker.
    const exitAt = scene.indexOf('data-testid="battle-result-exit"');
    const reportAt = scene.indexOf('data-testid="battle-report-view"');
    expect(reportAt).toBeGreaterThan(-1);
    expect(exitAt).toBeGreaterThan(reportAt);
  });

  test("the header close is a plainly-labeled 44px exit, not '✕ Arena' at py-1.5", () => {
    expect(has(scene, "✕ Arena")).toBe(false);
    expect(has(scene, 'aria-label="Exit the battle"')).toBe(true);
    expect(has(scene, "flex min-h-[44px] flex-none items-center rounded-full")).toBe(true);
  });

  test("the replay viewer's ✕ meets the floor too", () => {
    const viewer = read("BattleScene/BattleReplayViewer.tsx");
    expect(has(viewer, "flex h-11 w-11 flex-none items-center justify-center rounded-lg")).toBe(true);
  });

  test("browser back exits the battle one step — it never dumps to landing", () => {
    const fs = read("BattleScene/BattleSceneFullscreen.tsx");
    // The scene owns one history entry while mounted…
    expect(has(fs, "unboundBattleScene: true")).toBe(true);
    expect(has(fs, 'addEventListener("popstate", onPopState)')).toBe(true);
    // …consumed again on an in-game exit so the stack stays honest.
    expect(has(fs, "if (!exitedViaBack) window.history.back();")).toBe(true);
  });
});
