// BATTLE PLAYBOOK tests — slots, gating, validation, scene building.

import { describe, expect, test } from "bun:test";
import {
  PLAYBOOK,
  autoloadSuggested,
  blankSlots,
  buildFormationScene,
  clampLoadsToRoster,
  deficitHeadline,
  emptyWarRoomState,
  entryLabel,
  formationCount,
  formationPicks,
  formationSlots,
  playById,
  playsForLevel,
  slotsToPlaced,
  suggestedComposition,
  suggestedFormation,
  suggestedFormationName,
  suggestedTotal,
  validateLoads,
  type Play,
  type SavedFormation,
  type SlotLoads,
} from "./playbook";
import { DEPLOY_CAP, escortWarning } from "./deploy-loadout";
import {
  TACTICAL_CONFIG,
  battleSummary,
  resolveRound,
  startTacticalBattle,
  vectorHeadcount,
  type OrdersMap,
} from "./tactical-combat";
import type { ManeuverVector } from "./war-types";
import type { TroopRoster, TroopTier, TroopType } from "./troops";

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

// ============================================================================
// SUGGESTED LOADS — every play's ready-made assignment + the autoload that
// fills it from the real roster (owner 2026-10-06).
// ============================================================================

function rosterOf(cohorts: { type: TroopType; tier: TroopTier; count: number }[]): TroopRoster {
  return { cohorts, musterQueue: [], seq: 1 } as unknown as TroopRoster;
}

/** A roster holding exactly a play's suggestion (all T1). */
function exactRoster(play: Play): TroopRoster {
  const comp = suggestedComposition(play).byType;
  return rosterOf(
    (Object.entries(comp) as [TroopType, number][])
      .filter(([, n]) => n > 0)
      .map(([type, count]) => ({ type, tier: 1 as TroopTier, count })),
  );
}

/** Mid-game roster: T2 bulk, T3 spine — the force the suggestions size for. */
function midRoster(): TroopRoster {
  return rosterOf([
    { type: "bulwark", tier: 1, count: 40 }, { type: "bulwark", tier: 2, count: 30 }, { type: "bulwark", tier: 3, count: 10 },
    { type: "reaver", tier: 1, count: 25 }, { type: "reaver", tier: 2, count: 25 }, { type: "reaver", tier: 3, count: 8 },
    { type: "longeye", tier: 1, count: 20 }, { type: "longeye", tier: 2, count: 15 }, { type: "longeye", tier: 3, count: 5 },
    { type: "thunder", tier: 2, count: 6 }, { type: "thunder", tier: 3, count: 4 },
    { type: "warden", tier: 1, count: 20 }, { type: "warden", tier: 2, count: 12 }, { type: "warden", tier: 3, count: 4 },
  ]);
}

function slotTypeCount(loads: SlotLoads, slotId: string, type: TroopType): number {
  return (loads[slotId] ?? []).filter((p) => p.type === type).reduce((n, p) => n + p.count, 0);
}

describe("suggested load catalog", () => {
  test("every play ships a suggestion on real slots, sized 80–100", () => {
    expect(PLAYBOOK.length).toBe(6);
    for (const p of PLAYBOOK) {
      const slotIds = new Set(p.slots.map((s) => s.id));
      expect(p.suggested.length).toBe(p.slots.length);
      for (const s of p.suggested) expect(slotIds.has(s.slotId)).toBe(true);
      const total = suggestedTotal(p);
      expect(total >= 80 && total <= 100).toBe(true);
    }
  });
  test("the book has real choice: two L2 plays join the L1 generics", () => {
    expect(playById("pincer")?.category).toBe("Offensive");
    expect(playById("pincer")?.minLeaderLevel).toBe(2);
    expect(playById("redoubt")?.category).toBe("Defensive");
    expect(playById("redoubt")?.minLeaderLevel).toBe(2);
  });
  test("suggested loads obey doctrine: escort warning stays quiet at full strength", () => {
    for (const p of PLAYBOOK) {
      const auto = autoloadSuggested(p, exactRoster(p));
      expect(escortWarning(formationPicks({ ...formation({}), loads: auto.loads }))).toBeNull();
    }
  });
});

describe("autoloadSuggested", () => {
  test("a covering roster reproduces the suggestion exactly — no deficits", () => {
    for (const p of PLAYBOOK) {
      const auto = autoloadSuggested(p, exactRoster(p));
      expect(auto.scaled).toBe(false);
      expect(auto.deficits).toEqual([]);
      expect(auto.loadedTotal).toBe(auto.suggestedTotal);
      for (const s of p.suggested) {
        for (const it of s.items) {
          expect(slotTypeCount(auto.loads, s.slotId, it.type)).toBe(it.count);
        }
      }
      expect(validateLoads(auto.loads, exactRoster(p))).toEqual([]);
    }
  });
  test("never exceeds owned counts on a skewed roster", () => {
    const weird = rosterOf([
      { type: "bulwark", tier: 1, count: 7 },
      { type: "reaver", tier: 3, count: 3 },
      { type: "thunder", tier: 2, count: 2 },
    ]);
    for (const p of PLAYBOOK) {
      const auto = autoloadSuggested(p, weird);
      expect(validateLoads(auto.loads, weird)).toEqual([]);
      expect(auto.loadedTotal <= 12).toBe(true);
      expect(auto.scaled).toBe(true);
      expect(auto.deficits.length).toBeGreaterThan(0);
    }
  });
  test("the 100-unit field cap holds under a huge roster", () => {
    const huge = rosterOf(
      (["bulwark", "reaver", "longeye", "thunder", "warden"] as TroopType[]).flatMap((type) =>
        ([1, 2, 3, 4] as TroopTier[]).map((tier) => ({ type, tier, count: 500 })),
      ),
    );
    for (const p of PLAYBOOK) {
      const auto = autoloadSuggested(p, huge);
      expect(auto.loadedTotal <= DEPLOY_CAP).toBe(true);
      expect(auto.loadedTotal).toBe(auto.suggestedTotal);
    }
  });
  test("small roster scales down, frontline first, deficits named per slot", () => {
    const wedge = playById("mixed-wedge")!;
    const half = rosterOf(
      (Object.entries(suggestedComposition(wedge).byType) as [TroopType, number][])
        .filter(([, n]) => n > 0)
        .map(([type, n]) => ({ type, tier: 1 as TroopTier, count: Math.floor(n / 2) })),
    );
    const auto = autoloadSuggested(wedge, half);
    expect(auto.scaled).toBe(true);
    // everything the roster holds gets used (no silent waste)...
    expect(auto.loadedTotal).toBe(46);
    // ...the wedge keeps at least its proportional share...
    expect(slotTypeCount(auto.loads, "wedge", "reaver") >= 8).toBe(true);
    // ...and every missing troop is accounted in the deficits.
    const missing = auto.deficits.reduce((n, d) => n + d.missing, 0);
    expect(missing).toBe(auto.suggestedTotal - auto.loadedTotal);
    expect(auto.deficits.some((d) => d.slotId === "wedge")).toBe(true);
    expect(deficitHeadline(auto.deficits)).toMatch(/need \+\d+ Bulwarks/);
  });
  test("prime slots draw the highest tiers first; support takes what's left", () => {
    const wedge = playById("mixed-wedge")!;
    const roster = rosterOf([
      { type: "reaver", tier: 4, count: 8 },
      { type: "reaver", tier: 1, count: 20 },
      { type: "bulwark", tier: 1, count: 40 },
      { type: "longeye", tier: 1, count: 12 },
      { type: "warden", tier: 1, count: 12 },
      { type: "thunder", tier: 1, count: 6 },
    ]);
    const auto = autoloadSuggested(wedge, roster);
    const wedgeT4 = (auto.loads["wedge"] ?? []).find((p) => p.type === "reaver" && p.tier === 4);
    expect(wedgeT4?.count).toBe(8); // the teeth get the elites
    const reserveTiers = (auto.loads["reserve"] ?? []).filter((p) => p.type === "reaver").map((p) => p.tier);
    expect(reserveTiers.every((t) => t === 1)).toBe(true);
  });
  test("locked plays expose no suggested deploy at low leader level", () => {
    const deployableAt = (level: number) =>
      playsForLevel(level).filter((a) => !a.locked).map((a) => a.play.id);
    expect(deployableAt(1)).toEqual(["mixed-wedge", "line-advance", "shield-wall"]);
    expect(deployableAt(2)).toEqual(["mixed-wedge", "line-advance", "pincer", "shield-wall", "redoubt"]);
    expect(deployableAt(3).length).toBe(6);
    // locked plays still show their requirement
    const l1 = playsForLevel(1).filter((a) => a.locked);
    expect(l1.map((a) => a.play.id).sort()).toEqual(["hammer-anvil", "pincer", "redoubt"]);
    for (const a of l1) expect(a.requiredLevel).toBeGreaterThan(1);
  });
  test("suggestedFormation builds a scene-ready formation (bloodless)", () => {
    const wedge = playById("mixed-wedge")!;
    const f = suggestedFormation(wedge, midRoster(), 42);
    expect(f.playId).toBe("mixed-wedge");
    expect(f.locked).toBe(false);
    expect(formationCount(f)).toBe(suggestedTotal(wedge));
    const scene = buildFormationScene(f, { attackerName: "T", nowMs: 1 }, 3);
    expect(scene.units.filter((u) => u.side === "attacker").length).toBe(formationCount(f));
  });
});

// ----------------------------------------------------------------------------
// Headless sanity: the tactical war engine referees. Each play's suggested
// load (driven the way auto mode drives: advance + commit the reserve) must
// out-fight a naive even deployment of the IDENTICAL troops against the
// engine's equal-headcount garrison. Deterministic — battle ids are seeds.
// ----------------------------------------------------------------------------

const TVECTORS: ManeuverVector[] = ["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"];
type DepMap = Partial<Record<ManeuverVector, Partial<Record<TroopType, number>>>>;
type DepTierMap = Partial<Record<ManeuverVector, Partial<Record<TroopType, Partial<Record<TroopTier, number>>>>>>;

function deploymentOf(play: Play, loads: SlotLoads): { dep: DepMap; tiers: DepTierMap; total: number } {
  const f = { id: "t", name: "t", playId: play.id, locked: false, loads, createdAt: 0, updatedAt: 0 } as SavedFormation;
  const dep: DepMap = {};
  const tiers: DepTierMap = {};
  let total = 0;
  for (const s of formationSlots(f)) {
    for (const p of loads[s.id] ?? []) {
      (dep[s.vector] ??= {})[p.type] = ((dep[s.vector] ?? {})[p.type] ?? 0) + p.count;
      const tm = ((tiers[s.vector] ??= {})[p.type] ??= {});
      tm[p.tier] = (tm[p.tier] ?? 0) + p.count;
      total += p.count;
    }
  }
  return { dep, tiers, total };
}

function naiveDeploymentOf(loads: SlotLoads): { dep: DepMap; tiers: DepTierMap; total: number } {
  const dep: DepMap = {};
  const tiers: DepTierMap = {};
  let total = 0;
  for (const picks of Object.values(loads)) {
    for (const p of picks) {
      let left = p.count;
      TVECTORS.forEach((v, i) => {
        const n = i === TVECTORS.length - 1 ? left : Math.floor(p.count * 0.2);
        left -= n;
        if (n <= 0) return;
        (dep[v] ??= {})[p.type] = ((dep[v] ?? {})[p.type] ?? 0) + n;
        const tm = ((tiers[v] ??= {})[p.type] ??= {});
        tm[p.tier] = (tm[p.tier] ?? 0) + n;
        total += n;
      });
    }
  }
  return { dep, tiers, total };
}

function drivenBattle(id: string, dep: DepMap, tiers: DepTierMap, defenderTroops: number) {
  const b = startTacticalBattle({
    battleId: id, raidId: id, deployment: dep, deploymentTiers: tiers,
    defenderTroops, shipsHoldOrbit: true, shipFirepower: 0, now: 1_700_000_000_000,
  });
  let guard = 0;
  while (b.status === "active" && guard < TACTICAL_CONFIG.maxRounds + 1) {
    const orders: OrdersMap = {};
    for (const v of TVECTORS) {
      if (v === "RESERVE") continue;
      const vec = b.attacker.vectors[v];
      if (!vec.routed && vectorHeadcount(vec) > 0) orders[v] = { order: "advance" };
    }
    const reserve = b.attacker.vectors.RESERVE;
    if (!reserve.routed && vectorHeadcount(reserve) > 0 && b.round >= 2) {
      let weakest: ManeuverVector | null = null;
      let weakestN = Infinity;
      for (const v of TVECTORS) {
        if (v === "RESERVE") continue;
        const vec = b.attacker.vectors[v];
        if (vec.routed || vectorHeadcount(vec) === 0) continue;
        if (vectorHeadcount(vec) < weakestN) { weakestN = vectorHeadcount(vec); weakest = v; }
      }
      if (weakest) orders[weakest] = { order: "reinforce", count: Math.floor(vectorHeadcount(reserve) / 2) };
    }
    if (!resolveRound(b, orders, undefined, 1_700_000_000_000).ok) break;
    guard++;
  }
  return battleSummary(b);
}

describe("suggested loads — headless sanity vs naive deployment", () => {
  test("every play's suggestion out-fights an even spread of the same troops", () => {
    for (const p of PLAYBOOK) {
      const auto = autoloadSuggested(p, midRoster());
      expect(auto.scaled).toBe(false);
      const sug = deploymentOf(p, auto.loads);
      const nai = naiveDeploymentOf(auto.loads);
      let sugWins = 0, naiWins = 0, sugEx = 0, naiEx = 0;
      for (let i = 0; i < 6; i++) {
        const s = drivenBattle(`${p.id}-sug-test-${i}`, sug.dep, sug.tiers, sug.total);
        if (s.status === "attacker_won") sugWins++;
        sugEx += s.defenderLosses - s.attackerLosses;
        const n = drivenBattle(`${p.id}-nai-test-${i}`, nai.dep, nai.tiers, nai.total);
        if (n.status === "attacker_won") naiWins++;
        naiEx += n.defenderLosses - n.attackerLosses;
      }
      expect(sugWins).toBeGreaterThan(naiWins);
      expect(sugEx).toBeGreaterThan(naiEx);
    }
  });
});
