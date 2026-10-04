import { describe, expect, test } from "bun:test";
import { targetBlockReason } from "./raid-targeting";
import { createRaid, setRaidTarget, newGame, advance } from "./engine";
import { colonyKey, ensureWorldMap } from "./worldmap";
import type { KnownColony } from "./worldmap";
import type { GameState } from "./types";

/**
 * RAID TARGET REGRESSION (owner 2026-10-04 bug report):
 * Live QA tapped an ABANDONED colony card (card entered pressed state, dialog
 * opened) then hit "Target this colony" — and nothing happened. The button
 * silently failed its `status === "active"` gate and showed the misleading
 * hint "Tap a colony card on the map first" even though a card WAS tapped.
 *
 * Fix: the UI gate now mirrors engine.setRaidTarget exactly (via
 * targetBlockReason) and explains the real reason inline:
 * "Raids hit ACTIVE colonies — this one's abandoned. Glean it instead."
 */

function colony(status: KnownColony["status"], extra: Partial<KnownColony> = {}): KnownColony {
  return {
    id: "col-x",
    serverId: "draconians-world",
    ownerName: "Enemy",
    race: "draconians",
    status,
    lastScouted: Date.now(),
    ...extra,
  } as KnownColony;
}

describe("targetBlockReason (UI gate mirrors engine)", () => {
  test("no selection → noColonySelected", () => {
    expect(targetBlockReason(null, null, "me")).toBe("noColonySelected");
    expect(targetBlockReason(null, "k", "me")).toBe("noColonySelected");
    expect(targetBlockReason(colony("active"), null, "me")).toBe("noColonySelected");
  });
  test("active colony → targetable", () => {
    expect(targetBlockReason(colony("active"), "k", "me")).toBeNull();
  });
  test("abandoned colony → notRaidable (the reported bug)", () => {
    expect(targetBlockReason(colony("abandoned"), "k", "me")).toBe("notRaidable");
  });
  test("husk → notRaidable", () => {
    expect(targetBlockReason(colony("husk"), "k", "me")).toBe("notRaidable");
  });
  test("rival sub colony → targetable (matches engine)", () => {
    const c = colony("sub_colony", { subClaim: { claimedBy: "rival", claimedAt: 1 } as any });
    expect(targetBlockReason(c, "k", "me")).toBeNull();
  });
  test("own sub colony → notRaidable", () => {
    const c = colony("sub_colony", { subClaim: { claimedBy: "me", claimedAt: 1 } as any });
    expect(targetBlockReason(c, "k", "me")).toBe("notRaidable");
  });
});

describe("engine.setRaidTarget (card-select → target simulation)", () => {
  function makeState(): GameState {
    const now = Date.now();
    const st = newGame("TestCommander", "draconians", now);
    advance(st, now);
    const wm = ensureWorldMap(st, now);
    const activeKey = colonyKey("draconians-world", "col-active");
    wm.known[activeKey] = colony("active", { id: "col-active" });
    const abKey = colonyKey("draconians-world", "col-abandoned");
    wm.known[abKey] = colony("abandoned", { id: "col-abandoned" });
    return st;
  }

  test("card-select active colony → target registers (the full tap flow)", () => {
    const st = makeState();
    const now = Date.now();
    // 1. Form raid party (the "Form Raid Party" button)
    const created = createRaid(st, now);
    expect(created.ok).toBe(true);
    const raidId = created.state.worldMap!.raids[0].id;
    // 2. Tap the colony card → selectedKey = the wm.known key
    const selectedKey = colonyKey("draconians-world", "col-active");
    const selectedColony = created.state.worldMap!.known[selectedKey];
    expect(selectedColony).not.toBeNull();
    // 3. UI gate must pass for an active colony…
    expect(targetBlockReason(selectedColony, selectedKey, created.state.gameId ?? undefined)).toBeNull();
    // 4. …and the server call registers the target.
    const targeted = setRaidTarget(created.state, raidId, selectedKey, now);
    expect(targeted.ok).toBe(true);
    const raid = targeted.state.worldMap!.raids.find((r) => r.id === raidId)!;
    expect(raid.targetColonyId).toBe("col-active");
    expect(raid.targetOwnerName).toBe("Enemy");
  });

  test("card-select abandoned colony → UI explains, server rejects with glean hint", () => {
    const st = makeState();
    const now = Date.now();
    const created = createRaid(st, now);
    const raidId = created.state.worldMap!.raids[0].id;
    const selectedKey = colonyKey("draconians-world", "col-abandoned");
    const selectedColony = created.state.worldMap!.known[selectedKey];
    // The UI gate now returns the HONEST reason instead of pretending
    // no card was tapped.
    expect(targetBlockReason(selectedColony, selectedKey, created.state.gameId ?? undefined)).toBe("notRaidable");
    // Even if it reached the server, the engine refuses with the glean hint.
    const targeted = setRaidTarget(created.state, raidId, selectedKey, now);
    expect(targeted.ok).toBe(false);
    expect(targeted.error).toMatch(/glean it instead/);
    const raid = (targeted.state ?? created.state).worldMap!.raids.find((r) => r.id === raidId)!;
    expect(raid.targetColonyId).toBe("");
  });
});
