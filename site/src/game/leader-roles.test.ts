// leader-roles.test.ts — "everybody drives their bus" (owner 2026-10-04).
// Each leader specialty maps to a battlefield role with real modifiers on
// the 5-vector tactical system; the modifiers feed combat resolution.
import { describe, expect, test } from "bun:test";
import {
  LEADER_BATTLE_ROLES,
  leaderBattleRole,
  leaderVectorMult,
  leaderHoldReduction,
  leaderRoleCoverageOk,
} from "./leader-roles";
import { resolveRaidBattle, EMPTY_RAID_LOOT } from "./raids";
import type { Specialty } from "./types";
import type { TroopType } from "./war/troops";

const WEIGHTS: Record<TroopType, number> = {
  bulwark: 1, reaver: 1, longeye: 1, thunder: 3, warden: 2,
};
const ALL_SPECIALTIES: Specialty[] = [
  "tactician", "horticulturist", "economist", "engineer", "logistician",
];

describe("leader battle roles", () => {
  test("every specialty has a complete role", () => {
    expect(leaderRoleCoverageOk(ALL_SPECIALTIES)).toBe(true);
    expect(LEADER_BATTLE_ROLES).toHaveLength(5);
    for (const r of LEADER_BATTLE_ROLES) {
      expect(r.roleName.length).toBeGreaterThan(0);
      expect(r.tagline.length).toBeGreaterThan(0);
      expect(r.brief.length).toBeGreaterThan(80); // a real breakdown, not a stub
      expect(r.favoredVectors.length).toBeGreaterThan(0);
      expect(r.holdReduction).toBeGreaterThan(-1);
      expect(r.holdReduction <= 1).toBe(true);
    }
  });

  test("tactician is the flanker: flanks and rear hit harder, main is even", () => {
    const role = leaderBattleRole("tactician");
    expect(role.role).toBe("flanker");
    expect(leaderVectorMult("tactician", "FLANK_LEFT")).toBe(1.2);
    expect(leaderVectorMult("tactician", "FLANK_RIGHT")).toBe(1.2);
    expect(leaderVectorMult("tactician", "REAR")).toBe(1.15);
    expect(leaderVectorMult("tactician", "MAIN")).toBe(1);
  });

  test("logistician is the line-holder: best casualty reduction", () => {
    expect(leaderBattleRole("logistician").role).toBe("line-holder");
    expect(leaderHoldReduction("logistician")).toBe(0.1);
    expect(leaderVectorMult("logistician", "MAIN")).toBe(1.1);
  });

  test("engineer breaks the main line; economist feeds the reserve", () => {
    expect(leaderVectorMult("engineer", "MAIN")).toBe(1.2);
    expect(leaderVectorMult("economist", "RESERVE")).toBe(1.2);
  });

  test("no specialty = no modifiers (even fight)", () => {
    expect(leaderVectorMult(undefined, "FLANK_LEFT")).toBe(1);
    expect(leaderHoldReduction(undefined)).toBe(0);
  });
});

describe("leader roles in resolveRaidBattle", () => {
  const base = {
    weights: WEIGHTS,
    defenderTroops: 1000,
    defenderLoot: { ...EMPTY_RAID_LOOT, supplies: 10_000 },
    cargoCapacity: 1_000_000,
  };

  test("tactician's flank deployment hits harder than no leader", () => {
    const mk = (leaderSpecialty?: Specialty) =>
      resolveRaidBattle({
        ...base,
        attacker: { reaver: 1000 },
        deployment: { FLANK_LEFT: { reaver: 1000 } },
        leaderSpecialty,
      });
    const plain = mk(undefined);
    const led = mk("tactician");
    // 1000 * 1.25 (flank surprise) = 1250 vs 1250 * 1.2 (tactician) = 1500
    expect(led.defenderLosses).toBeGreaterThan(plain.defenderLosses);
  });

  test("logistician brings more people home", () => {
    const mk = (leaderSpecialty?: Specialty) =>
      resolveRaidBattle({
        ...base,
        attacker: { reaver: 1500 }, // win tier: 25% base losses
        leaderSpecialty,
      });
    const plain = mk(undefined);
    const led = mk("logistician");
    expect(plain.attackerLosses.reaver).toBe(375);
    expect(led.attackerLosses.reaver).toBe(Math.floor(375 * 0.9));
  });

  test("engineer on MAIN out-hits economist on MAIN", () => {
    const mk = (leaderSpecialty: Specialty) =>
      resolveRaidBattle({
        ...base,
        attacker: { reaver: 1000 },
        deployment: { MAIN: { reaver: 1000 } },
        leaderSpecialty,
      });
    expect(mk("engineer").defenderLosses).toBeGreaterThan(mk("economist").defenderLosses);
  });
});
