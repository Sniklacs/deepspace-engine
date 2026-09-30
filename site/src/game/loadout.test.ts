// Tests for the LOADOUT layer — ForgeItem.equippedBy, equip/unequip,
// loadoutOf, resolveHeroEquipment, and the battle power seam.
// Run: bun test src/game/loadout.test.ts
import { describe, expect, test } from "bun:test";
import {
  equipForgeItem,
  unequipForgeItem,
  loadoutOf,
  meltForgeItem,
  newGame,
  resolveHeroEquipment,
} from "./engine";
import { heroUnitPower } from "./war/battle-engine";
import type { BattleHeroSnapshot } from "./war/war-types";
import type { ForgeItem } from "./forge";
import type { GameState } from "./types";

function piece(over: Partial<ForgeItem> = {}): ForgeItem {
  return {
    id: "fg-test-1",
    kind: "assault",
    recipeId: "r1",
    family: "frontline",
    name: "Test Blade",
    grade: "tempered",
    stats: { power: 10, precision: 5, guard: 2, logistics: 1 },
    power: 12,
    ceilingAtRoll: 20,
    floorAtRoll: 1,
    warplateSpent: 4,
    suppliesSpent: 10,
    embersSpent: 0,
    ownerId: "c1",
    ownerName: "Colony",
    location: "cradle",
    locationSince: 0,
    equippedBy: null,
    provenance: { rolledAt: 0, gameId: "g1", race: "watchers", seq: 1 },
    ...over,
  };
}

function fakeState(): GameState {
  const st = newGame("Tester", "watchers", 1_000);
  st.forgeItems = [];
  // The prologue seeds heroes; guarantee our test bearer exists.
  const heroes = (st.prologue as never as { heroes: { id: string; name: string }[] }).heroes;
  if (!heroes.some((h) => h.id === "hero-1")) heroes.push({ id: "hero-1", name: "Ash" } as never);
  if (!st.leaders.some((l) => l.id === "leader-1")) st.leaders.push({ id: "leader-1", name: "Vey" } as never);
  return st;
}

describe("equipForgeItem", () => {
  test("equips an assault piece into the weapon slot", () => {
    const st = fakeState();
    st.forgeItems = [piece()];
    const res = equipForgeItem(st, "fg-test-1", { kind: "hero", id: "hero-1" }, "weapon", 1_000);
    expect(res.ok).toBe(true);
    expect(st.forgeItems[0].equippedBy).toEqual({ kind: "hero", id: "hero-1", slot: "weapon" });
  });

  test("rejects a defence piece in the weapon slot", () => {
    const st = fakeState();
    st.forgeItems = [piece({ id: "fg-d", kind: "defence" })];
    const res = equipForgeItem(st, "fg-d", { kind: "hero", id: "hero-1" }, "weapon", 1_000);
    expect(res.ok).toBe(false);
    expect(st.forgeItems[0].equippedBy).toBeNull();
  });

  test("one body, one item — the same piece can't be worn twice", () => {
    const st = fakeState();
    st.forgeItems = [piece()];
    equipForgeItem(st, "fg-test-1", { kind: "hero", id: "hero-1" }, "weapon", 1_000);
    const res = equipForgeItem(st, "fg-test-1", { kind: "leader", id: "leader-1" }, "weapon", 1_001);
    expect(res.ok).toBe(false);
  });

  test("swap is atomic — the displaced piece returns to the racks", () => {
    const st = fakeState();
    st.forgeItems = [piece({ id: "fg-a" }), piece({ id: "fg-b" })];
    equipForgeItem(st, "fg-a", { kind: "hero", id: "hero-1" }, "weapon", 1_000);
    const res = equipForgeItem(st, "fg-b", { kind: "hero", id: "hero-1" }, "weapon", 1_001);
    expect(res.ok).toBe(true);
    expect(res.swappedId).toBe("fg-a");
    expect(st.forgeItems.find((i) => i.id === "fg-a")!.equippedBy).toBeNull();
    expect(st.forgeItems.find((i) => i.id === "fg-b")!.equippedBy).toEqual({ kind: "hero", id: "hero-1", slot: "weapon" });
  });

  test("module and relic slots stay honestly locked", () => {
    const st = fakeState();
    st.forgeItems = [piece()];
    for (const slot of ["module1", "module2", "relic"] as const) {
      const res = equipForgeItem(st, "fg-test-1", { kind: "hero", id: "hero-1" }, slot, 1_000);
      expect(res.ok).toBe(false);
    }
    expect(st.forgeItems[0].equippedBy).toBeNull();
  });

  test("unknown bearer is rejected", () => {
    const st = fakeState();
    st.forgeItems = [piece()];
    const res = equipForgeItem(st, "fg-test-1", { kind: "hero", id: "ghost" }, "weapon", 1_000);
    expect(res.ok).toBe(false);
  });
});

describe("unequipForgeItem", () => {
  test("returns the piece to the racks", () => {
    const st = fakeState();
    st.forgeItems = [piece({ kind: "defence" })];
    equipForgeItem(st, "fg-test-1", { kind: "leader", id: "leader-1" }, "armor", 1_000);
    expect(st.forgeItems[0].equippedBy).not.toBeNull();
    const res = unequipForgeItem(st, "fg-test-1", 1_001);
    expect(res.ok).toBe(true);
    expect(st.forgeItems[0].equippedBy).toBeNull();
  });

  test("already racked is idempotent", () => {
    const st = fakeState();
    st.forgeItems = [piece()];
    expect(unequipForgeItem(st, "fg-test-1", 1_000).ok).toBe(true);
  });
});

describe("melt + supply-run guards", () => {
  test("a worn piece cannot be melted", () => {
    const st = fakeState();
    st.forgeItems = [piece()];
    equipForgeItem(st, "fg-test-1", { kind: "hero", id: "hero-1" }, "weapon", 1_000);
    const res = meltForgeItem(st, "fg-test-1", 1_001);
    expect(res.ok).toBe(false);
    expect(st.forgeItems.length).toBe(1);
  });
});

describe("resolveHeroEquipment + battle seam", () => {
  test("resolves worn power/guard deltas; heroUnitPower folds them in", () => {
    const st = fakeState();
    st.forgeItems = [
      piece({ id: "fg-w", kind: "assault", stats: { power: 10, precision: 0, guard: 0, logistics: 0 } }),
      piece({ id: "fg-a", kind: "defence", stats: { power: 0, precision: 0, guard: 6, logistics: 0 } }),
    ];
    equipForgeItem(st, "fg-w", { kind: "hero", id: "hero-1" }, "weapon", 1_000);
    equipForgeItem(st, "fg-a", { kind: "hero", id: "hero-1" }, "armor", 1_000);
    const eq = resolveHeroEquipment(st, { kind: "hero", id: "hero-1" });
    expect(eq).toBeDefined();
    expect(eq!.attrs).toEqual({ power: 10, guard: 6 });
    expect(eq!.weapon!.name).toBe("Test Blade");

    const snap: BattleHeroSnapshot = {
      id: "hero-1",
      name: "Ash",
      role: "damage",
      level: 1,
      attributes: { power: 5, guard: 5, craft: 0, presence: 0 },
      specialization: null,
      skills: [],
      equipped: eq,
    };
    const bare: BattleHeroSnapshot = { ...snap, equipped: undefined };
    expect(heroUnitPower(snap)).toBeGreaterThan(heroUnitPower(bare));
  });

  test("no gear worn -> no equipped block", () => {
    const st = fakeState();
    st.forgeItems = [piece()];
    expect(resolveHeroEquipment(st, { kind: "hero", id: "hero-1" })).toBeUndefined();
  });

  test("loadoutOf shows the worn slots", () => {
    const st = fakeState();
    st.forgeItems = [piece()];
    equipForgeItem(st, "fg-test-1", { kind: "hero", id: "hero-1" }, "weapon", 1_000);
    const lo = loadoutOf(st, { kind: "hero", id: "hero-1" });
    expect(lo.weapon!.id).toBe("fg-test-1");
    expect(lo.armor).toBeUndefined();
  });
});
