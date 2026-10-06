// deploy-loadout.test.ts — Hans's real barracks force on the battle scene.
import { describe, expect, test } from "bun:test";
import {
  buildPlayerScene,
  clampPicksToRoster,
  DEPLOY_CAP,
  escortWarning,
  picksCount,
  picksPower,
  type DeploymentPick,
} from "./deploy-loadout";
import { addCohort, emptyRoster, supplyWeight, tierPowerMult } from "./troops";

const picks = (): DeploymentPick[] => [
  { type: "bulwark", tier: 2, count: 10 },
  { type: "reaver", tier: 3, count: 8 },
  { type: "longeye", tier: 1, count: 4 },
  { type: "thunder", tier: 2, count: 2 },
  { type: "warden", tier: 2, count: 4 },
];

describe("picks power + count", () => {
  test("picksPower prices forces on the tier curve", () => {
    const p = picks();
    const expected = p.reduce((s, k) => s + k.count * supplyWeight(k.type) * tierPowerMult(k.tier), 0);
    expect(picksPower(p)).toBeCloseTo(expected, 6);
    expect(picksPower(p)).toBeGreaterThan(picksCount(p)); // tiers add power
  });
  test("picksCount sums headcount", () => {
    expect(picksCount(picks())).toBe(28);
  });
});

describe("buildPlayerScene", () => {
  const throws = (fn: () => void): boolean => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  test("throws on an empty force", () => {
    expect(throws(() => buildPlayerScene([], { attackerName: "x", nowMs: 1 }))).toBe(true);
    expect(
      throws(() => buildPlayerScene([{ type: "bulwark", tier: 1, count: 0 }], { attackerName: "x", nowMs: 1 })),
    ).toBe(true);
  });
  test("throws past the field cap", () => {
    expect(
      throws(() =>
        buildPlayerScene([{ type: "bulwark", tier: 1, count: DEPLOY_CAP + 1 }], { attackerName: "x", nowMs: 1 }),
      ),
    ).toBe(true);
  });
  test("every picked troop lands on the field 1:1 with real type + tier", () => {
    const p = picks();
    const scene = buildPlayerScene(p, { attackerName: "Hans", nowMs: 1000 });
    const mine = scene.units.filter((u) => u.side === "attacker");
    expect(mine.length).toBe(picksCount(p));
    for (const k of p) {
      const have = mine.filter((u) => u.kind === k.type && u.tier === k.tier).length;
      expect(have).toBe(k.count);
    }
    expect(scene.troops.attacker).toBe(picksCount(p));
    expect(scene.attackerName).toBe("Hans");
    expect(scene.defenderName).toBe("Chorus Garrison");
  });
  test("doctrine vector assignment", () => {
    const scene = buildPlayerScene(picks(), { attackerName: "x", nowMs: 1 });
    const mine = scene.units.filter((u) => u.side === "attacker");
    const vec = (kind: string) => new Set(mine.filter((u) => u.kind === kind).map((u) => u.vector));
    expect([...vec("bulwark")].every((v) => v === "MAIN" || v === "RESERVE")).toBe(true);
    expect(vec("thunder")).toEqual(new Set(["REAR"]));
    expect([...vec("reaver")].every((v) => v.startsWith("FLANK") || v === "RESERVE")).toBe(true);
    expect(vec("longeye")).toEqual(new Set(["REAR"]));
    expect(vec("warden")).toEqual(new Set(["REAR"]));
    // Siege gets the delayed entry — doctrine.
    expect(mine.filter((u) => u.kind === "thunder").every((u) => u.enterAtS === 300)).toBe(true);
    // Squads ride the vector buses.
    expect(new Set(mine.map((u) => u.squadId)).size >= 4).toBe(true);
  });
  test("enemy is scaled to a real fight, not a slaughter", () => {
    const p = picks();
    const scene = buildPlayerScene(p, { attackerName: "x", nowMs: 1 });
    const foe = scene.units.filter((u) => u.side === "defender");
    const foePower = foe.reduce((s, u) => s + supplyWeight(u.kind as "bulwark") * tierPowerMult(u.tier), 0);
    const mine = picksPower(p);
    expect(foePower >= mine * 0.9).toBe(true);
    expect(foePower <= mine * 1.35).toBe(true); // one-unit overshoot at most
    expect(foe.length).toBeGreaterThan(0);
    expect(foe.every((u) => u.squadId === "D")).toBe(true); // Chorus AI, one mind
    expect(scene.troops.defender).toBe(foe.length);
  });
  test("bloodless: the builder never mutates its inputs", () => {
    const p = picks();
    const frozen = JSON.stringify(p);
    buildPlayerScene(p, { attackerName: "x", nowMs: 1 });
    expect(JSON.stringify(p)).toBe(frozen);
  });
  test("deterministic per seed", () => {
    const a = buildPlayerScene(picks(), { attackerName: "x", nowMs: 1, seed: 42 });
    const b = buildPlayerScene(picks(), { attackerName: "x", nowMs: 1, seed: 42 });
    expect(a.units.map((u) => [u.x, u.y, u.kind, u.tier])).toEqual(b.units.map((u) => [u.x, u.y, u.kind, u.tier]));
  });
});

describe("clampPicksToRoster", () => {
  test("clamps to owned cohorts by type×tier, drops empties", () => {
    const r = emptyRoster();
    addCohort(r, "bulwark", 5, 1, 0, 2);
    addCohort(r, "reaver", 3, 1, 0, 1);
    const out = clampPicksToRoster(
      [
        { type: "bulwark", tier: 2, count: 10 },
        { type: "bulwark", tier: 3, count: 4 },
        { type: "reaver", tier: 1, count: 2 },
      ],
      r,
    );
    expect(out).toEqual([
      { type: "bulwark", tier: 2, count: 5 },
      { type: "reaver", tier: 1, count: 2 },
    ]);
  });
  test("bloodless: roster untouched by clamping", () => {
    const r = emptyRoster();
    addCohort(r, "bulwark", 5, 1, 0, 2);
    const frozen = JSON.stringify(r);
    clampPicksToRoster([{ type: "bulwark", tier: 2, count: 99 }], r);
    expect(JSON.stringify(r)).toBe(frozen);
  });
});

describe("escortWarning", () => {
  test("warns when siege deploys without Warden escort", () => {
    expect(escortWarning([{ type: "thunder", tier: 2, count: 2 }]) ?? "").toMatch(/Warden/);
  });
  test("quiet when the escort rides along", () => {
    expect(
      escortWarning([
        { type: "thunder", tier: 2, count: 2 },
        { type: "warden", tier: 2, count: 4 },
      ]),
    ).toBeNull();
  });
  test("quiet with no siege", () => {
    expect(escortWarning([{ type: "bulwark", tier: 1, count: 10 }])).toBeNull();
  });
});
