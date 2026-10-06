// deploy-loadout.test.ts — Hans's real barracks force on the battle scene.
import { describe, expect, test } from "bun:test";
import {
  buildChorusLineup,
  buildPlayerScene,
  CHORUS_GRADES,
  clampPicksToRoster,
  DEFAULT_CHORUS_GRADE,
  DEPLOY_CAP,
  deploySeedFor,
  escortWarning,
  forceReverb,
  garrisonReverb,
  picksCount,
  picksPower,
  picksReverb,
  previewGarrisonReverb,
  type ChorusGrade,
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
    expect(scene.defenderName).toBe("Chorus Garrison — Bulwark"); // default G3
    expect(scene.chorusGrade).toBe(3);
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

describe("chorus defense grades", () => {
  const grades: ChorusGrade[] = [1, 2, 3, 4, 5];
  const foePowerOf = (seed: number, grade: ChorusGrade) => {
    const p = picks();
    const scene = buildPlayerScene(p, { attackerName: "x", nowMs: 1, seed, grade });
    const foe = scene.units.filter((u) => u.side === "defender");
    return {
      foe,
      ratio: foe.reduce((s, u) => s + supplyWeight(u.kind as "bulwark") * tierPowerMult(u.tier), 0) / picksPower(p),
    };
  };

  test("five grades, named, easiest to hardest", () => {
    expect(DEFAULT_CHORUS_GRADE).toBe(3);
    expect(grades.map((g) => CHORUS_GRADES[g].name)).toEqual([
      "Screen",
      "Picket",
      "Bulwark",
      "Fortress",
      "Bastion",
    ]);
    const ratios = grades.map((g) => CHORUS_GRADES[g].powerRatio);
    expect(ratios).toEqual([0.6, 0.8, 1.0, 1.25, 1.5]);
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeGreaterThan(ratios[i - 1]);
  });

  test("power ratios land in their bands", () => {
    for (const g of grades) {
      const ratio = CHORUS_GRADES[g].powerRatio;
      for (const seed of [11, 42, 777]) {
        const { ratio: got } = foePowerOf(seed, g);
        expect(got >= ratio * 0.9).toBe(true);
        expect(got <= ratio * 1.35).toBe(true);
      }
    }
  });

  test("each grade is a valid doctrinal defense", () => {
    for (const g of grades) {
      const { placed } = buildChorusLineup(picksPower(picks()), deploySeedFor(picks()), g);
      expect(placed.length).toBeGreaterThan(0);
      for (const u of placed) {
        if (u.type === "bulwark") expect(["MAIN", "RESERVE"].includes(u.vector)).toBe(true);
        if (u.type === "reaver")
          expect(["FLANK_LEFT", "FLANK_RIGHT", "RESERVE"].includes(u.vector)).toBe(true);
        if (u.type === "longeye" || u.type === "warden") expect(u.vector).toBe("REAR");
        if (u.type === "thunder") expect(["REAR", "RESERVE"].includes(u.vector)).toBe(true);
      }
    }
  });

  test("G1 Screen: no siege, no reserve — easiest to crack", () => {
    const { placed } = buildChorusLineup(picksPower(picks()), 42, 1);
    expect(placed.some((u) => u.type === "thunder")).toBe(false);
    expect(placed.some((u) => u.vector === "RESERVE")).toBe(false);
  });

  test("G5 Bastion: strike package — siege held in the deep reserve", () => {
    // Big force so the reserve actually fills.
    const big = picksPower([{ type: "bulwark", tier: 3, count: 60 }]);
    const { placed } = buildChorusLineup(big, 42, 5);
    const siegeReserve = placed.filter((u) => u.type === "thunder" && u.vector === "RESERVE");
    expect(siegeReserve.length).toBeGreaterThan(0);
    expect(placed.some((u) => u.vector === "RESERVE" && u.type === "reaver")).toBe(true);
    expect(CHORUS_GRADES[5].hunts).toBe(true);
    expect(CHORUS_GRADES[5].counterThreshold).toBe(0.75);
  });

  test("G4/G5 refuse a flank — one wing stages deep", () => {
    for (const g of [4, 5] as ChorusGrade[]) {
      let found = false;
      for (let seed = 1; seed < 40 && !found; seed++) {
        const { placed } = buildChorusLineup(picksPower(picks()), seed, g);
        found = placed.some((u) => u.deep === true);
      }
      expect(found).toBe(true);
    }
    // G1–G3 never refuse.
    for (const g of [1, 2, 3] as ChorusGrade[]) {
      const { placed } = buildChorusLineup(picksPower(picks()), 42, g);
      expect(placed.some((u) => u.deep === true)).toBe(false);
    }
  });

  test("reverb is computed from the built force and climbs with grade", () => {
    const p = picks();
    const revs = grades.map((g) =>
      garrisonReverb(buildChorusLineup(picksPower(p), deploySeedFor(p), g).placed),
    );
    for (const r of revs) expect(r).toBeGreaterThan(0);
    for (let i = 1; i < revs.length; i++) expect(revs[i]).toBeGreaterThan(revs[i - 1]);
    // The preview matches the real build — the number Hans sees is the number he fights.
    expect(previewGarrisonReverb(p, 3)).toBe(revs[2]);
    expect(picksReverb(p)).toBe(forceReverb(p));
    expect(picksReverb(p)).toBeGreaterThan(0);
  });

  test("grade flows into the scene; picker defaults to G3", () => {
    const scene = buildPlayerScene(picks(), { attackerName: "x", nowMs: 1, grade: 5 });
    expect(scene.chorusGrade).toBe(5);
    expect(scene.defenderName).toBe("Chorus Garrison — Bastion");
    const def = buildPlayerScene(picks(), { attackerName: "x", nowMs: 1 });
    expect(def.chorusGrade).toBe(DEFAULT_CHORUS_GRADE);
  });

  test("deterministic per seed per grade", () => {
    for (const g of grades) {
      const a = buildChorusLineup(100, 99, g).placed;
      const b = buildChorusLineup(100, 99, g).placed;
      expect(a.map((u) => [u.type, u.tier, u.vector])).toEqual(b.map((u) => [u.type, u.tier, u.vector]));
    }
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
