// BATTLE PLAYBOOK tests — slots, gating, validation, scene building.

import { describe, expect, test } from "bun:test";
import {
  PLAYBOOK,
  blankSlots,
  buildFormationScene,
  clampLoadsToRoster,
  emptyWarRoomState,
  entryLabel,
  formationCount,
  formationPicks,
  formationSlots,
  playById,
  playsForLevel,
  slotsToPlaced,
  suggestedFormationName,
  validateLoads,
  type SavedFormation,
  type SlotLoads,
} from "./playbook";
import type { TroopRoster } from "./troops";

const ROSTER: TroopRoster = {
  cohorts: [
    { type: "bulwark", tier: 1, count: 50 },
    { type: "reaver", tier: 2, count: 30 },
    { type: "longeye", tier: 1, count: 20 },
    { type: "thunder", tier: 3, count: 5 },
    { type: "warden", tier: 1, count: 10 },
  ],
  musterQueue: [],
  seq: 1,
} as unknown as TroopRoster;

function formation(loads: SlotLoads, playId = "mixed-wedge"): SavedFormation {
  return {
    id: "f1",
    name: "Test Wedge",
    playId,
    locked: true,
    loads,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("playbook catalog", () => {
  test("starter plays exist with slots on real vectors", () => {
    expect(PLAYBOOK.length >= 3).toBe(true);
    for (const p of PLAYBOOK) {
      expect(p.slots.length).toBeGreaterThan(0);
      for (const s of p.slots) {
        expect(["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"].includes(s.vector)).toBe(true);
      }
    }
  });
  test("mixed wedge matches the owner's spec slots", () => {
    const w = playById("mixed-wedge")!;
    expect(w).toBeDefined();
    const names = w.slots.map((s) => s.name);
    for (const n of ["Wedge", "Middle", "Left Flank", "Right Flank", "Rear", "Reserve"]) {
      expect(names.includes(n)).toBe(true);
    }
    const reserve = w.slots.find((s) => s.id === "reserve")!;
    expect(reserve.entry.kind).toBe("oncall");
    const rear = w.slots.find((s) => s.id === "rear")!;
    expect(rear.entry.kind).toBe("delayed");
  });
  test("level gating: L1 sees generics, advanced plays locked with requirement", () => {
    const l1 = playsForLevel(1);
    const locked = l1.filter((a) => a.locked);
    expect(locked.length).toBeGreaterThan(0);
    for (const a of locked) expect(a.requiredLevel).toBeGreaterThan(1);
    const l10 = playsForLevel(10);
    expect(l10.every((a) => !a.locked)).toBe(true);
  });
});

describe("slot loads", () => {
  const loads: SlotLoads = {
    wedge: [
      { type: "reaver", tier: 2, count: 10 },
      { type: "bulwark", tier: 1, count: 10 },
    ],
    middle: [{ type: "longeye", tier: 1, count: 8 }],
    reserve: [{ type: "reaver", tier: 2, count: 4 }],
  };
  test("counts and flattening", () => {
    const f = formation(loads);
    expect(formationCount(f)).toBe(32);
    expect(formationPicks(f).length).toBe(4);
  });
  test("validateLoads passes a legal load", () => {
    expect(validateLoads(loads, ROSTER)).toEqual([]);
  });
  test("validateLoads catches over-roster across slots", () => {
    const bad: SlotLoads = {
      a: [{ type: "bulwark", tier: 1, count: 40 }],
      b: [{ type: "bulwark", tier: 1, count: 40 }],
    };
    const errs = validateLoads(bad, ROSTER);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/owns 50/);
  });
  test("clampLoadsToRoster trims to owned and drops empties", () => {
    const over: SlotLoads = {
      a: [{ type: "thunder", tier: 3, count: 99 }],
      b: [{ type: "bulwark", tier: 1, count: 10 }],
    };
    const clamped = clampLoadsToRoster(over, ROSTER);
    expect(clamped.a[0].count).toBe(5);
    expect(clamped.b[0].count).toBe(10);
  });
  test("custom slot renames apply via slotMeta", () => {
    const f = formation(loads);
    f.slotMeta = { wedge: { name: "The Teeth" } };
    const slots = formationSlots(f);
    expect(slots.find((s) => s.id === "wedge")!.name).toBe("The Teeth");
  });
  test("blankSlots gives a workable custom set", () => {
    expect(blankSlots().length).toBe(6);
  });
  test("entry labels read for badges", () => {
    expect(entryLabel({ kind: "start" })).toBe("T+0");
    expect(entryLabel({ kind: "delayed", atS: 300 })).toBe("T+300s");
    expect(entryLabel({ kind: "oncall", atS: 240 })).toMatch(/on-call/);
  });
  test("suggestedFormationName pre-fills play + date", () => {
    expect(suggestedFormationName("mixed-wedge", Date.UTC(2026, 9, 6))).toBe("Mixed Wedge 10/06");
    expect(suggestedFormationName("custom", Date.UTC(2026, 9, 6))).toBe("Custom 10/06");
  });
});

describe("slots to scene", () => {
  const loads: SlotLoads = {
    wedge: [{ type: "bulwark", tier: 1, count: 4 }],
    rear: [{ type: "thunder", tier: 3, count: 2 }],
    reserve: [{ type: "reaver", tier: 2, count: 2 }],
  };
  test("slotsToPlaced maps vectors, entry times, on-call flags", () => {
    const placed = slotsToPlaced(formation(loads));
    expect(placed.length).toBe(8);
    const wedge = placed.filter((p) => p.vector === "MAIN");
    expect(wedge.length).toBe(4);
    expect(wedge.every((p) => p.enterAtS === 30)).toBe(true);
    const rear = placed.filter((p) => p.vector === "REAR");
    expect(rear.every((p) => p.enterAtS === 300)).toBe(true);
    const res = placed.filter((p) => p.vector === "RESERVE");
    expect(res.length).toBe(2);
    expect(res.every((p) => p.onCall === true)).toBe(true);
  });
  test("buildFormationScene fields the formation against a graded garrison", () => {
    const scene = buildFormationScene(formation(loads), { attackerName: "T", nowMs: 1 }, 3);
    expect(scene.units.filter((u) => u.side === "attacker").length).toBe(8);
    expect(scene.units.some((u) => u.side === "defender")).toBe(true);
    expect(scene.chorusGrade).toBe(3);
    const onCall = scene.units.filter((u) => u.side === "attacker" && u.onCall);
    expect(onCall.length).toBe(2);
  });
  test("stale slot ids never crash a deploy", () => {
    const f = formation({ nope: [{ type: "bulwark", tier: 1, count: 5 }] });
    expect(slotsToPlaced(f)).toEqual([]);
  });
  test("empty war room state", () => {
    expect(emptyWarRoomState()).toEqual({ formations: [], seq: 1 });
  });
});
