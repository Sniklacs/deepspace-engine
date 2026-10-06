// tactical-combat.test.ts — round-based tactical battle tests.
import { describe, expect, test } from "bun:test";
import {
  attackerSurvivors,
  battleSummary,
  defenderAIOrders,
  engagementTarget,
  quickResolve,
  resolveRound,
  startTacticalBattle,
  validateOrders,
  vectorHeadcount,
  TACTICAL_CONFIG,
  type OrdersMap,
  type TacticalBattle,
} from "./tactical-combat";
import type { TroopType } from "./troops";
import type { ManeuverVector } from "./war-types";

function makeBattle(overrides?: Partial<Parameters<typeof startTacticalBattle>[0]>): TacticalBattle {
  return startTacticalBattle({
    battleId: "tb-test-1",
    raidId: "raid-1",
    deployment: {
      MAIN: { bulwark: 400, reaver: 200 } as Partial<Record<TroopType, number>>,
      FLANK_LEFT: { reaver: 200, warden: 60 } as Partial<Record<TroopType, number>>,
      FLANK_RIGHT: { longeye: 150 } as Partial<Record<TroopType, number>>,
      REAR: { warden: 60, thunder: 40 } as Partial<Record<TroopType, number>>,
      RESERVE: { bulwark: 200 } as Partial<Record<TroopType, number>>,
    },
    defenderTroops: 1200,
    shipsHoldOrbit: true,
    shipFirepower: 500,
    now: 1_000_000,
    ...overrides,
  });
}

const HOLD_ALL: OrdersMap = {
  MAIN: { order: "hold" },
  FLANK_LEFT: { order: "hold" },
  FLANK_RIGHT: { order: "hold" },
  REAR: { order: "hold" },
};

describe("tactical combat setup", () => {
  test("deployment maps onto the 5 vectors", () => {
    const b = makeBattle();
    expect(vectorHeadcount(b.attacker.vectors.MAIN)).toBe(600);
    expect(vectorHeadcount(b.attacker.vectors.RESERVE)).toBe(200);
    expect(b.round).toBe(0);
    expect(b.status).toBe("active");
  });

  test("defender gets troops across zones with fortification", () => {
    const b = makeBattle();
    const total = (["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"] as ManeuverVector[])
      .reduce((n, v) => n + vectorHeadcount(b.defender.vectors[v]), 0);
    expect(total).toBeGreaterThan(1000);
    expect(total).not.toBeGreaterThan(1200);
    expect(b.defender.vectors.MAIN.fortLevel).toBeGreaterThan(0);
    expect(b.attacker.vectors.MAIN.fortLevel).toBe(0);
  });

  test("orbiting ships grant orbital strike charges; landed ships don't", () => {
    expect(makeBattle().orbitalStrikesLeft).toBe(TACTICAL_CONFIG.orbitalStrikeCharges);
    const landed = makeBattle({ shipsHoldOrbit: false });
    expect(landed.orbitalStrikesLeft).toBe(0);
  });
});

describe("engagement targeting", () => {
  test("flanks cross over to opposite sides", () => {
    const b = makeBattle();
    expect(engagementTarget("FLANK_LEFT", b.defender)).toBe("FLANK_RIGHT");
    expect(engagementTarget("FLANK_RIGHT", b.defender)).toBe("FLANK_LEFT");
    expect(engagementTarget("MAIN", b.defender)).toBe("MAIN");
  });

  test("rear breakthrough: empty defender rear → hits main", () => {
    const b = makeBattle({ defenderTroops: 0 });
    expect(engagementTarget("REAR", b.defender)).toBe("MAIN");
  });

  test("rear engages rear guard when defended", () => {
    const b = makeBattle();
    expect(vectorHeadcount(b.defender.vectors.REAR)).toBeGreaterThan(0);
    expect(engagementTarget("REAR", b.defender)).toBe("REAR");
  });
});

describe("round resolution", () => {
  test("a round resolves: round counter, log, casualties", () => {
    const b = makeBattle();
    const res = resolveRound(b, HOLD_ALL);
    expect(res.ok).toBe(true);
    expect(b.round).toBe(1);
    expect(b.log).toHaveLength(1);
    expect(b.log[0].events.length).toBeGreaterThan(0);
  });

  test("deterministic: same orders → identical outcome", () => {
    const a = makeBattle({ battleId: "det-1" });
    const c = makeBattle({ battleId: "det-1" });
    resolveRound(a, HOLD_ALL);
    resolveRound(c, HOLD_ALL);
    expect(JSON.stringify(a.attacker.vectors)).toBe(JSON.stringify(c.attacker.vectors));
    expect(JSON.stringify(a.defender.vectors)).toBe(JSON.stringify(c.defender.vectors));
    expect(a.log[0].events).toEqual(c.log[0].events);
  });

  test("different battle ids diverge", () => {
    const a = makeBattle({ battleId: "det-a" });
    const c = makeBattle({ battleId: "det-b" });
    resolveRound(a, HOLD_ALL);
    resolveRound(c, HOLD_ALL);
    // Casualty jitter differs — vectors should not be byte-identical.
    expect(JSON.stringify(a.attacker.vectors) === JSON.stringify(c.attacker.vectors)).toBe(false);
  });

  test("advance deals more damage than hold (all else equal)", () => {
    const adv = makeBattle({ battleId: "ord-adv" });
    const hld = makeBattle({ battleId: "ord-adv" });
    const advOrders: OrdersMap = { ...HOLD_ALL, MAIN: { order: "advance" } };
    resolveRound(adv, advOrders);
    resolveRound(hld, HOLD_ALL);
    const advDealt = adv.log[0].defenderCasualties;
    const hldDealt = hld.log[0].defenderCasualties;
    const sum = (o: Partial<Record<TroopType, number>>) =>
      (Object.values(o) as number[]).reduce((n, x) => n + x, 0);
    expect(sum(advDealt)).toBeGreaterThan(sum(hldDealt));
  });

  test("withdraw ends the battle as a defender win with no loot", () => {
    const b = makeBattle();
    const res = resolveRound(b, { MAIN: { order: "withdraw" } });
    expect(res.ok).toBe(true);
    expect(b.status).toBe("defender_won");
    expect(b.lootTier).toBe(0);
  });

  test("orbital strike consumes a charge and hits the target", () => {
    const b = makeBattle();
    const before = b.orbitalStrikesLeft;
    const res = resolveRound(b, { MAIN: { order: "hold", orbitalStrike: "MAIN" } });
    expect(res.ok).toBe(true);
    expect(b.orbitalStrikesLeft).toBe(before - 1);
    expect(b.log[0].events.some((e) => e.includes("ORBITAL STRIKE"))).toBe(true);
  });

  test("reinforce moves troops from reserve to the ordering vector", () => {
    const b = makeBattle();
    const reserveBefore = vectorHeadcount(b.attacker.vectors.RESERVE);
    const mainBefore = vectorHeadcount(b.attacker.vectors.MAIN);
    // Reinforce is ordered ON the receiving vector (it pulls from RESERVE).
    const res = resolveRound(b, {
      ...HOLD_ALL,
      MAIN: { order: "reinforce", count: 100 },
    });
    expect(res.ok).toBe(true);
    expect(vectorHeadcount(b.attacker.vectors.RESERVE)).toBeLessThan(reserveBefore);
    // MAIN grew by the reinforcement minus its round casualties.
    expect(vectorHeadcount(b.attacker.vectors.MAIN)).toBeGreaterThan(mainBefore - 200);
  });
});

describe("order validation", () => {
  test("flank requires 20% warden escort", () => {
    const b = makeBattle();
    const err = validateOrders(b, "attacker", { FLANK_RIGHT: { order: "flank" } });
    expect(err ?? "").toMatch(/warden/);
  });

  test("flank passes with enough wardens", () => {
    const b = makeBattle();
    // FLANK_LEFT has 200 reaver + 60 warden = 23% wardens.
    const err = validateOrders(b, "attacker", { FLANK_LEFT: { order: "flank" } });
    expect(err).toBeNull();
  });

  test("can't reinforce from an empty reserve", () => {
    const b = makeBattle({
      deployment: { MAIN: { bulwark: 500 } as Partial<Record<TroopType, number>> },
    });
    const err = validateOrders(b, "attacker", {
      MAIN: { order: "hold" },
      RESERVE: { order: "reinforce", target: "MAIN", count: 50 },
    });
    // RESERVE has no force to order at all.
    expect(err).not.toBeNull();
  });

  test("orbital strike needs charges", () => {
    const b = makeBattle({ shipsHoldOrbit: false });
    const err = validateOrders(b, "attacker", { MAIN: { order: "hold", orbitalStrike: "MAIN" } });
    expect(err ?? "").toMatch(/landed/);
  });
});

describe("defender AI", () => {
  test("produces valid orders for a fresh battle", () => {
    const b = makeBattle();
    const orders = defenderAIOrders(b);
    expect(validateOrders(b, "defender", orders)).toBeNull();
  });

  test("AI orders are deterministic", () => {
    const a = makeBattle({ battleId: "ai-1" });
    const c = makeBattle({ battleId: "ai-1" });
    expect(JSON.stringify(defenderAIOrders(a))).toBe(JSON.stringify(defenderAIOrders(c)));
  });
});

describe("battle end", () => {
  test("overwhelming attacker wins and earns a loot tier", () => {
    const b = makeBattle({ defenderTroops: 50 });
    quickResolve(b);
    expect(b.status).toBe("attacker_won");
    expect(b.lootTier).not.toBeLessThan(2);
    expect(b.endedAt).toBeDefined();
  });

  test("overwhelming defender repulses the raid", () => {
    const b = makeBattle({ defenderTroops: 20000 });
    quickResolve(b);
    expect(b.status).toBe("defender_won");
    expect(b.lootTier).toBe(0);
  });

  test("quickResolve always terminates", () => {
    const b = makeBattle();
    quickResolve(b);
    expect(b.status).not.toBe("active");
    expect(b.round).not.toBeGreaterThan(TACTICAL_CONFIG.maxRounds + 1);
  });

  test("battle summary reports casualties and tier", () => {
    const b = makeBattle({ defenderTroops: 50 });
    quickResolve(b);
    const s = battleSummary(b);
    expect(s.rounds).toBeGreaterThan(0);
    expect(s.defenderLosses).toBeGreaterThan(0);
    expect(s.status).toBe("attacker_won");
  });

  test("survivors exclude routed vectors", () => {
    const b = makeBattle({ defenderTroops: 50 });
    quickResolve(b);
    const surv = attackerSurvivors(b);
    const total = (Object.values(surv) as number[]).reduce((n, c) => n + c, 0);
    expect(total).toBeGreaterThan(0);
  });

  test("can't resolve rounds after the battle ends", () => {
    const b = makeBattle({ defenderTroops: 50 });
    quickResolve(b);
    const res = resolveRound(b, HOLD_ALL);
    expect(res.ok).toBe(false);
  });
});

describe("morale and routing", () => {
  test("sustained casualties break morale and rout vectors", () => {
    // Outmatched attacker: 400 troops vs a 3000-strong garrison. Casualties
    // mount faster than the line can absorb → morale breaks before wipeout.
    const b = makeBattle({
      battleId: "rout-1",
      deployment: { MAIN: { bulwark: 400 } as Partial<Record<TroopType, number>> },
      defenderTroops: 3000,
    });
    quickResolve(b);
    expect(b.attacker.vectors.MAIN.routed).toBe(true);
    expect(b.status).toBe("defender_won");
  });
});

// ============================================================================
// TROOP TIERS (owner 2026-10-05): tier-weighted battle power.
// ============================================================================
import {
  moveTierMix,
  scaleTierMix,
  tieredTypePower,
  vectorPower,
  type TacticalVectorState,
} from "./tactical-combat";

describe("tier-weighted battle power", () => {
  test("vectorPower reads T1 without a tierMix (legacy/Chorus ghosts)", () => {
    const v: TacticalVectorState = {
      troops: { bulwark: 100 },
      morale: 100, routed: false, fortified: false, fortLevel: 0,
    };
    expect(vectorPower(v)).toBe(100); // 100 × weight 1 × power 1
  });
  test("tierMix weights power by tier — T4s hit 3.2x", () => {
    const v: TacticalVectorState = {
      troops: { reaver: 100 },
      tierMix: { reaver: { 2: 50, 4: 50 } },
      morale: 100, routed: false, fortified: false, fortLevel: 0,
    };
    // 50 × 1.5 + 50 × 3.2 = 75 + 160 = 235
    expect(vectorPower(v)).toBeCloseTo(235, 6);
  });
  test("tieredTypePower covers headcount missing from the mix as T1", () => {
    expect(tieredTypePower("bulwark", 100, { 4: 60 })).toBeCloseTo(60 * 3.2 + 40 * 1, 6);
  });
  test("thunder's double weight stacks with its tier", () => {
    expect(tieredTypePower("thunder", 10, { 3: 10 })).toBeCloseTo(10 * 2 * 2.2, 6);
  });
  test("scaleTierMix pro-rates the mix when troops die", () => {
    const v: TacticalVectorState = {
      troops: { bulwark: 100 },
      tierMix: { bulwark: { 1: 60, 4: 40 } },
      morale: 100, routed: false, fortified: false, fortLevel: 0,
    };
    scaleTierMix(v, "bulwark", 100, 50);
    const mix = v.tierMix?.bulwark ?? {};
    expect((mix[1] ?? 0) + (mix[4] ?? 0)).toBe(50);
    expect(mix[1] ?? 0).toBeGreaterThan(28); // ~30 of 50
    expect(mix[4] ?? 0).toBeLessThan(22);    // ~20 of 50
  });
  test("moveTierMix shifts a proportional slice between vectors", () => {
    const from: TacticalVectorState = {
      troops: { reaver: 100 },
      tierMix: { reaver: { 2: 60, 3: 40 } },
      morale: 100, routed: false, fortified: false, fortLevel: 0,
    };
    const to: TacticalVectorState = {
      troops: {},
      morale: 100, routed: false, fortified: false, fortLevel: 0,
    };
    moveTierMix(from, to, "reaver", 50);
    const f = from.tierMix?.reaver ?? {};
    const d = to.tierMix?.reaver ?? {};
    expect((f[2] ?? 0) + (f[3] ?? 0)).toBe(50);
    expect((d[2] ?? 0) + (d[3] ?? 0)).toBe(50);
  });
  test("startTacticalBattle accepts deploymentTiers and weights attacker power", () => {
    const b = makeBattle({
      battleId: "tiers-1",
      deployment: { MAIN: { bulwark: 100 } as Partial<Record<TroopType, number>> },
      deploymentTiers: { MAIN: { bulwark: { 4: 100 } } },
      defenderTroops: 100,
    });
    const v = b.attacker.vectors.MAIN;
    expect(v.tierMix?.bulwark?.[4]).toBe(100);
    expect(vectorPower(v)).toBeCloseTo(320, 6); // 100 × 1 × 3.2
    // Same battle without tiers fights at T1 power.
    const plain = makeBattle({
      battleId: "tiers-2",
      deployment: { MAIN: { bulwark: 100 } as Partial<Record<TroopType, number>> },
      defenderTroops: 100,
    });
    expect(vectorPower(plain.attacker.vectors.MAIN)).toBe(100);
  });
});
