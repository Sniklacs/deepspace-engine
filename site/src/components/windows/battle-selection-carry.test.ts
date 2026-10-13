// battle-selection-carry.test.ts — selection carries across battle
// surfaces (owner 2026-10-13, second battle-command sweep).
//
// Hans, live: "the selectables are in these controls, they don't carry
// over to the squads per se." He was right about the surfaces: the squad
// rows in the Controls window toggled the shared selection, but the
// quick-pick (the visible answer + the orders) rendered ONLY in the
// Squads window — which window exclusivity had parked in the tray. And
// at phone size the foregrounded window physically covered the HUD
// launcher strip, so the two windows couldn't even reach each other.
//
// These pins follow the exit-law.test.ts precedent (source pins for UI
// wiring that a pure-logic suite can't mount):
//  1. BattleControlsBody renders the SAME SquadQuickPick for the
//     selected squad — wherever you pick the squad, its orders show.
//  2. WindowHost renders battle-window switch chips (window-switch-*)
//     so a foregrounded battle window never buries the way to its
//     siblings, and the tray rides above the frame when they show.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf-8");
const has = (src: string, needle: string) => src.includes(needle);

describe("selection carries — the quick-pick lives in the Controls window too", () => {
  const src = read("BattleControlsBody.tsx");

  test("imports and renders SquadQuickPick for the selected squad", () => {
    expect(has(src, 'import { SquadQuickPick } from "../BattleScene/SquadQuickPick"')).toBe(true);
    expect(has(src, 'data-testid="controls-quickpick"')).toBe(true);
    expect(has(src, "<SquadQuickPick squad={sel} />")).toBe(true);
  });

  test("the quick-pick is driven by the shared selection, not local state", () => {
    expect(has(src, "ui.squads.find((s) => s.id === ui.selectedSquadId)")).toBe(true);
  });
});

describe("battle windows can always reach each other (WindowHost switcher)", () => {
  const src = read("WindowHost.tsx");

  test("switch chips render for sibling battle kinds", () => {
    expect(has(src, "window-switch-${kind}")).toBe(true);
    expect(has(src, "BATTLE_WINDOW_KINDS.filter(")).toBe(true);
    expect(has(src, "onClick={() => openWindow(kind)}")).toBe(true);
  });

  test("the tray rides above the foregrounded frame while switch chips show", () => {
    expect(has(src, "style={switchKinds.length > 0 ? { zIndex: 9999 } : undefined}")).toBe(true);
  });
});
