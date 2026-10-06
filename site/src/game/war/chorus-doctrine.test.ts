// chorus-doctrine.test.ts — the Chorus fights like a survivor (owner 2026-10-06).
import { describe, expect, test } from "bun:test";
import {
  CHORUS_HOLD_REDUCTION,
  counterattackOrders,
  COUNTERATTACK_STRENGTH_FRAC,
  doctrinePower,
  evaluateCounterattack,
  evaluateEnvelopment,
  evaluateSpoilingAttack,
  holdingBonusApplies,
  spoilingAttackOrders,
  type DoctrineUnit,
} from "./chorus-doctrine";

let n = 0;
const unit = (over: Partial<DoctrineUnit>): DoctrineUnit => ({
  id: `u${n++}`,
  side: "attacker",
  kind: "bulwark",
  tier: 2,
  vector: "MAIN",
  state: "holding",
  x: 0.4,
  y: 0.5,
  ...over,
});

/** A healthy attacker force: 10 per vector, 5 vectors, all holding. */
const healthyAttackers = (): DoctrineUnit[] => {
  const out: DoctrineUnit[] = [];
  for (const v of ["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"] as const)
    for (let i = 0; i < 10; i++) out.push(unit({ vector: v }));
  return out;
};

/** A Chorus defense: front line holding, reserve staged deep. */
const chorusDefense = (): DoctrineUnit[] => {
  const out: DoctrineUnit[] = [];
  for (let i = 0; i < 12; i++)
    out.push(unit({ side: "defender", kind: "bulwark", vector: "MAIN", x: 0.6, y: 0.5 }));
  for (let i = 0; i < 6; i++)
    out.push(unit({ side: "defender", kind: "longeye", vector: "REAR", x: 0.68, y: 0.5 }));
  for (let i = 0; i < 6; i++)
    out.push(unit({ side: "defender", kind: "reaver", vector: "RESERVE", state: "staging", x: 0.94, y: 0.5 }));
  return out;
};

describe("holding bonus", () => {
  test("applies only while a defender holds in posture", () => {
    expect(CHORUS_HOLD_REDUCTION >= 0.1).toBe(true);
    expect(CHORUS_HOLD_REDUCTION <= 0.15).toBe(true);
    expect(holdingBonusApplies(unit({ side: "defender", state: "holding" }))).toBe(true);
    expect(holdingBonusApplies(unit({ side: "defender", state: "engaged" }))).toBe(false);
    expect(holdingBonusApplies(unit({ side: "defender", state: "advancing" }))).toBe(false);
    expect(holdingBonusApplies(unit({ side: "attacker", state: "holding" }))).toBe(false);
  });
});

describe("counterattack evaluation", () => {
  test("quiet while the player is healthy", () => {
    const ev = evaluateCounterattack([...healthyAttackers(), ...chorusDefense()]);
    expect(ev.trigger).toBe(false);
    expect(ev.playerStrength).toBeCloseTo(1, 6);
    expect(ev.brokenVectors).toEqual([]);
  });

  test("triggers when the player bleeds below the threshold", () => {
    const attackers = healthyAttackers();
    // Kill 45% — strength 0.55 < 0.6.
    attackers.slice(0, 23).forEach((u) => (u.state = "dead"));
    const ev = evaluateCounterattack([...attackers, ...chorusDefense()]);
    expect(ev.playerStrength).toBeLessThan(COUNTERATTACK_STRENGTH_FRAC);
    expect(ev.trigger).toBe(true);
  });

  test("threshold differs by grade — G5 smells blood earlier", () => {
    const attackers = healthyAttackers();
    // 3 dead per vector: strength 0.7, no vector broken.
    for (const v of ["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"] as const)
      attackers.filter((u) => u.vector === v).slice(0, 3).forEach((u) => (u.state = "dead"));
    const units = [...attackers, ...chorusDefense()];
    expect(evaluateCounterattack(units, 0.6).trigger).toBe(false);
    expect(evaluateCounterattack(units, 0.75).trigger).toBe(true);
  });

  test("a broken vector triggers even at high strength", () => {
    const attackers = healthyAttackers();
    // Wipe 6 of 10 on FLANK_LEFT — the vector breaks, strength still 0.88.
    attackers.filter((u) => u.vector === "FLANK_LEFT").slice(0, 6).forEach((u) => (u.state = "dead"));
    const ev = evaluateCounterattack([...attackers, ...chorusDefense()]);
    expect(ev.playerStrength).toBeGreaterThan(0.8);
    expect(ev.brokenVectors).toEqual(["FLANK_LEFT"]);
    expect(ev.trigger).toBe(true);
  });

  test("orders push the reserve at the weakest vector, staging reserve enters now", () => {
    const attackers = healthyAttackers();
    attackers.slice(0, 23).forEach((u) => (u.state = "dead"));
    const units = [...attackers, ...chorusDefense()];
    const orders = counterattackOrders(units);
    expect(orders.length).toBe(6); // the staged reserve
    expect(orders.every((o) => o.enterNow)).toBe(true); // not yet on the field — commit NOW
    // Weakest living vector: FLANK_RIGHT lost 3 of 10 (MAIN/FLANK_LEFT are gone entirely).
    const weakest = evaluateCounterattack(units).weakestVector;
    expect(weakest).toBe("FLANK_RIGHT");
  });

  test("no orders without a trigger", () => {
    expect(counterattackOrders([...healthyAttackers(), ...chorusDefense()])).toEqual([]);
  });

  test("deterministic per snapshot", () => {
    const mk = () => {
      const a = healthyAttackers();
      a.slice(0, 23).forEach((u) => (u.state = "dead"));
      return [...a, ...chorusDefense()];
    };
    const strip = (us: DoctrineUnit[]) => us.map(({ id, ...rest }) => rest);
    const stripO = (os: { unitId: string }[]) => os.map(({ unitId, ...rest }) => rest);
    // Ids come from a global counter, so strip them — the doctrine is what's pinned.
    expect(strip(mk()).length).toBe(strip(mk()).length);
    expect(JSON.stringify(evaluateCounterattack(mk()))).toBe(JSON.stringify(evaluateCounterattack(mk())));
    expect(JSON.stringify(stripO(counterattackOrders(mk())))).toBe(
      JSON.stringify(stripO(counterattackOrders(mk()))),
    );
  });
});

describe("G5 spoiling attack", () => {
  test("quiet before first contact develops", () => {
    const units = [...healthyAttackers(), ...chorusDefense()];
    expect(evaluateSpoilingAttack(units, 30, "weapons-free").trigger).toBe(false);
    expect(evaluateSpoilingAttack(units, 120, "approach").trigger).toBe(false);
  });

  test("fires on an overextended vector — the Bastion comes looking", () => {
    const attackers = healthyAttackers();
    // FLANK_RIGHT pushes deep into the Chorus half (north, low y) while the line holds.
    attackers.filter((u) => u.vector === "FLANK_RIGHT").forEach((u) => (u.y = 0.3));
    const units = [...attackers, ...chorusDefense()];
    const sp = evaluateSpoilingAttack(units, 120, "weapons-free");
    expect(sp.trigger).toBe(true);
    expect(sp.targetVector).toBe("FLANK_RIGHT");
    const orders = spoilingAttackOrders(units, sp.targetVector!);
    expect(orders.length).toBe(6);
    expect(orders.every((o) => o.enterNow)).toBe(true);
    expect(orders[0].tx).toBeCloseTo(0.4, 6); // at the overextended vector
  });

  test("fires on a stalled attack — healthy but not winning late", () => {
    const units = [...healthyAttackers(), ...chorusDefense()];
    const sp = evaluateSpoilingAttack(units, 200, "weapons-free");
    expect(sp.trigger).toBe(true); // t>=180, strength 1.0 >= 0.75
    expect(sp.targetVector).not.toBeNull();
  });

  test("no spoiling when the player is already bleeding out", () => {
    const attackers = healthyAttackers();
    attackers.slice(0, 30).forEach((u) => (u.state = "dead")); // strength 0.4
    const units = [...attackers, ...chorusDefense()];
    // Stalled requires strength >= 0.75; overextension needs live vectors.
    const sp = evaluateSpoilingAttack(units, 200, "weapons-free");
    expect(sp.trigger).toBe(false);
  });
});

describe("G5 envelopment", () => {
  test("no envelopment against healthy flanks", () => {
    const def = chorusDefense();
    def.push(unit({ side: "defender", kind: "reaver", vector: "FLANK_LEFT", state: "engaged", x: 0.5, y: 0.22 }));
    expect(evaluateEnvelopment([...healthyAttackers(), ...def])).toEqual([]);
  });

  test("swings AROUND a weakened engaged flank", () => {
    const attackers = healthyAttackers();
    // Player's FLANK_LEFT collapses to 4 of 10 — weakened.
    attackers.filter((u) => u.vector === "FLANK_LEFT").slice(0, 6).forEach((u) => (u.state = "dead"));
    const def = chorusDefense();
    def.push(unit({ side: "defender", kind: "reaver", vector: "FLANK_LEFT", state: "engaged", x: 0.45, y: 0.22 }));
    const orders = evaluateEnvelopment([...attackers, ...def]);
    expect(orders.length).toBe(1);
    expect(orders[0].flank).toBe("FLANK_LEFT");
    // Push around, not back: target is past the weakened flank toward the
    // attacker's rear (south, high y) — cut them off instead of shoving back.
    const aliveY = attackers
      .filter((u) => u.vector === "FLANK_LEFT" && u.state !== "dead")
      .reduce((s, u) => s + u.y, 0) / 4;
    expect(orders[0].ty).toBeGreaterThan(aliveY);
  });
});

describe("doctrinePower", () => {
  test("prices elites — tier-weighted, not headcount", () => {
    const chaff = [unit({ tier: 1 }), unit({ tier: 1 })];
    const elite = [unit({ tier: 4 })];
    expect(doctrinePower(elite)).toBeGreaterThan(doctrinePower(chaff));
  });
});
