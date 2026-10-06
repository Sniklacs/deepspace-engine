// battle-scene-model.test.ts — the scene view model is pure and stable.
import { describe, expect, test } from "bun:test";
import {
  BATTLE_CLOCK_BUDGET_S,
  buildDemoScene,
  CLOCK_END_S,
  COVER_REDUCTION,
  coverAt,
  demoBreakVictor,
  DEMO_BREAK_FRAC,
  ESCALATION_INTERVAL_S,
  FLYBY_START_S,
  fmtSceneClock,
  MAX_REINFORCE_WAVES,
  mulberry32,
  REVEAL_S,
  SHOOTDOWN_S,
  terrainFor,
  waveDueAt,
  weakestVector,
  WORLD_H,
  WORLD_W,
  sceneClockS,
  sceneNightFactor,
  scenePhaseAt,
  scoutStatusAt,
  scoutSurvives,
  SCENE_PHASES,
  TROOP_KINDS,
  UNIT_KIND_LABEL,
  VECTOR_LANES,
  type SceneUnit,
} from "./battle-scene-model";

describe("unit kind labels", () => {
  test("every renderable kind has a display name, troops in doctrine order", () => {
    expect(TROOP_KINDS).toEqual(["bulwark", "reaver", "longeye", "thunder", "warden"]);
    for (const kind of [...TROOP_KINDS, "dropship", "turret"] as const) {
      expect(UNIT_KIND_LABEL[kind]).toMatch(/^[A-Z][a-z]+$/);
    }
    expect(UNIT_KIND_LABEL.thunder).toBe("Thunder");
  });
});

describe("scene phases", () => {
  test("doctrine boundaries: 30/75/90", () => {
    expect(scenePhaseAt(0)).toBe("approach");
    expect(scenePhaseAt(29.9)).toBe("approach");
    expect(scenePhaseAt(30)).toBe("touchdown");
    expect(scenePhaseAt(74.9)).toBe("touchdown");
    expect(scenePhaseAt(75)).toBe("contact");
    expect(scenePhaseAt(89.9)).toBe("contact");
    expect(scenePhaseAt(90)).toBe("weapons-free");
    expect(scenePhaseAt(3600)).toBe("weapons-free");
  });

  test("phase table matches boundaries", () => {
    expect(SCENE_PHASES.map((p) => p.atS)).toEqual([0, 30, 75, 90]);
  });
});

describe("demo scene", () => {
  test("builds a renderable battle: units on both sides, all five vectors, turrets", () => {
    const s = buildDemoScene(1_000_000);
    expect(s.units.length).toBeGreaterThan(40);
    expect(s.units.some((u) => u.side === "attacker")).toBe(true);
    expect(s.units.some((u) => u.side === "defender")).toBe(true);
    const vectors = new Set(s.units.map((u) => u.vector));
    for (const v of ["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"] as const) {
      expect(vectors.has(v)).toBe(true);
    }
    expect(s.turrets.length).toBe(4);
    // REAR carries thunder siege + warden escort (the doctrine).
    const rear = s.units.filter((u) => u.vector === "REAR");
    expect(rear.some((u) => u.kind === "thunder")).toBe(true);
    expect(rear.some((u) => u.kind === "warden")).toBe(true);
    // Delayed entries exist.
    expect(Math.max(...s.units.map((u) => u.enterAtS))).toBeGreaterThan(60);
    // Coords are sane (world is 1.5 x 1.5 — north-south battles).
    for (const u of s.units) {
      expect(u.x >= 0 && u.x <= WORLD_W).toBe(true);
      expect(u.y >= 0 && u.y <= WORLD_H).toBe(true);
      expect(u.hp01).toBe(1);
    }
  });

  test("deterministic per seed", () => {
    const a = buildDemoScene(5_000);
    const b = buildDemoScene(9_999);
    expect(a.units.map((u) => u.id)).toEqual(b.units.map((u) => u.id));
    expect(a.units.map((u) => u.tx)).toEqual(b.units.map((u) => u.tx));
  });

  test("vector lanes cover the map", () => {
    for (const v of Object.keys(VECTOR_LANES)) {
      const lane = VECTOR_LANES[v as keyof typeof VECTOR_LANES];
      expect(lane.x > 0 && lane.x < WORLD_W).toBe(true);
      expect(lane.spread > 0).toBe(true);
    }
  });
});

describe("night factor", () => {
  test("returns 0..1 and varies with longitude", () => {
    // Noon UTC: subsolar lon ≈ 0. A battle at lon 0 is midday; at lon 180, midnight.
    const noon = Date.UTC(2026, 5, 21, 12, 0, 0);
    const day = sceneNightFactor(0, noon);
    const night = sceneNightFactor(180, noon);
    expect(day >= 0 && day <= 1).toBe(true);
    expect(night >= 0 && night <= 1).toBe(true);
    expect(night).toBeGreaterThan(day);
    expect(night).toBeGreaterThan(0.8);
  });
});

describe("clock", () => {
  test("sceneClockS and fmtSceneClock", () => {
    const s = buildDemoScene(1_000_000);
    expect(sceneClockS(s, 1_061_000)).toBe(61);
    expect(fmtSceneClock(61)).toBe("1:01");
    expect(fmtSceneClock(3599)).toBe("59:59");
  });

  test("mulberry32 is deterministic", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("demo break threshold", () => {
  const mk = (side: string, dead: number, alive: number) => [
    ...Array.from({ length: dead }, () => ({ side, state: "dead" })),
    ...Array.from({ length: alive }, () => ({ side, state: "holding" })),
  ];
  test("no victor while both sides fight", () => {
    const units = [...mk("attacker", 0, 40), ...mk("defender", 0, 40)];
    expect(demoBreakVictor(units)).toBeNull();
  });
  test("no victor just under the threshold", () => {
    // 64% < 65%: still fighting.
    const units = [...mk("attacker", 25, 15), ...mk("defender", 0, 40)];
    expect(25 / 40).toBeLessThan(DEMO_BREAK_FRAC);
    expect(demoBreakVictor(units)).toBeNull();
  });
  test("attacker breaks at the threshold — defender holds the field", () => {
    const units = [...mk("attacker", 26, 14), ...mk("defender", 5, 35)];
    expect(demoBreakVictor(units)).toBe("defender");
  });
  test("defender breaks at the threshold — attacker holds the field", () => {
    const units = [...mk("attacker", 5, 35), ...mk("defender", 26, 14)];
    expect(demoBreakVictor(units)).toBe("attacker");
  });
  test("empty force never breaks", () => {
    expect(demoBreakVictor([])).toBeNull();
  });
});

describe("demo unit tiers", () => {
  test("every unit carries a tier 1-4", () => {
    const s = buildDemoScene(1_000_000);
    expect(s.units.length).toBeGreaterThan(0);
    for (const u of s.units) {
      expect(u.tier >= 1 && u.tier <= 4).toBe(true);
    }
  });
  test("tier mix weights T2/T3 with some T1 chaff and few T4 elites", () => {
    const s = buildDemoScene(1_000_000);
    const n = [0, 0, 0, 0];
    for (const u of s.units) n[u.tier - 1] += 1;
    const total = s.units.length;
    // T2+T3 are the bulk of the force.
    expect((n[1] + n[2]) / total).toBeGreaterThan(0.5);
    // Some chaff, few elites.
    expect(n[0] / total).toBeGreaterThan(0.1);
    expect(n[3] / total).toBeLessThan(0.25);
  });
  test("thunder siege is never T1 chaff", () => {
    const s = buildDemoScene(1_000_000);
    for (const u of s.units) {
      if (u.kind === "thunder") expect(u.tier).toBeGreaterThan(1);
    }
  });
  test("tier assignment is deterministic per seed", () => {
    const a = buildDemoScene(1_000_000).units.map((u) => u.tier).join(",");
    const b = buildDemoScene(1_000_000).units.map((u) => u.tier).join(",");
    expect(a).toBe(b);
  });
});

describe("scout flyby", () => {
  const liveSeed = (): number => {
    let s = 1;
    while (!scoutSurvives(s)) s++;
    return s;
  };
  const deadSeed = (): number => {
    let s = 1;
    while (scoutSurvives(s)) s++;
    return s;
  };

  test("success: pending → flying → revealed, never lost", () => {
    const s = liveSeed();
    expect(scoutStatusAt(s, 0)).toBe("pending");
    expect(scoutStatusAt(s, FLYBY_START_S)).toBe("flying");
    expect(scoutStatusAt(s, REVEAL_S - 0.1)).toBe("flying");
    expect(scoutStatusAt(s, REVEAL_S)).toBe("revealed");
    expect(scoutStatusAt(s, 9999)).toBe("revealed");
  });

  test("shoot-down: flying until the kill, then lost — layout never revealed", () => {
    const s = deadSeed();
    expect(scoutStatusAt(s, FLYBY_START_S)).toBe("flying");
    expect(scoutStatusAt(s, SHOOTDOWN_S - 0.1)).toBe("flying");
    expect(scoutStatusAt(s, SHOOTDOWN_S)).toBe("lost");
    expect(scoutStatusAt(s, 9999)).toBe("lost");
  });

  test("shoot-down rate is ~20% across seeds", () => {
    let lost = 0;
    const N = 1000;
    for (let s = 0; s < N; s++) if (!scoutSurvives(s)) lost++;
    const rate = lost / N;
    expect(rate > 0.12 && rate < 0.28).toBe(true);
  });

  test("deterministic per seed — replays stay stable", () => {
    expect(scoutSurvives(42)).toBe(scoutSurvives(42));
    expect(scoutStatusAt(42, 100)).toBe(scoutStatusAt(42, 100));
    expect(scoutStatusAt(4242, 100)).toBe(scoutStatusAt(4242, 100));
  });
});

describe("terrain", () => {
  test("deterministic per seed — replays match", () => {
    expect(terrainFor(1234)).toEqual(terrainFor(1234));
  });

  test("varies across battles", () => {
    expect(terrainFor(1234)).not.toEqual(terrainFor(9999));
  });

  test("features sit inside the world with sane radii and kinds", () => {
    const t = terrainFor(77);
    expect(t.length >= 6 && t.length <= 8).toBe(true);
    for (const f of t) {
      expect(f.x >= 0 && f.x <= WORLD_W).toBe(true);
      expect(f.y >= 0 && f.y <= WORLD_H).toBe(true);
      expect(f.r > 0 && f.r < 0.3).toBe(true);
      expect(["ridge", "rocks", "ruins"].includes(f.kind)).toBe(true);
    }
  });

  test("coverAt detects in/near cover; the bonus is ~12%", () => {
    const t = terrainFor(77);
    const f = t[0];
    expect(coverAt(f.x, f.y, t)).toBe(true);
    expect(coverAt(-1, -1, t)).toBe(false);
    expect(COVER_REDUCTION).toBe(0.12);
  });
});

describe("north-south orientation", () => {
  test("attacker stages on the south edge, defender holds the north", () => {
    const s = buildDemoScene(1_000_000);
    for (const u of s.units) {
      if (u.side === "attacker") expect(u.y > WORLD_H / 2).toBe(true);
      else expect(u.y < WORLD_H / 2).toBe(true);
    }
  });

  test("the positioning window is 45 sim-seconds: T+30 to T+75", () => {
    const td = SCENE_PHASES.find((p) => p.phase === "touchdown")!.atS;
    const fc = SCENE_PHASES.find((p) => p.phase === "contact")!.atS;
    expect(td).toBe(30);
    expect(fc).toBe(75);
    expect(fc - td).toBe(45);
  });
});

describe("battle clock", () => {
  test("constants: ~11min budget at 1x, timeline ends T+750", () => {
    expect(BATTLE_CLOCK_BUDGET_S).toBe(660);
    expect(CLOCK_END_S).toBe(750);
    expect(ESCALATION_INTERVAL_S).toBe(180);
    expect(MAX_REINFORCE_WAVES).toBe(3);
  });

  test("waveDueAt: on schedule, capped, never double-lands", () => {
    expect(waveDueAt(0, 0)).toBe(0);
    expect(waveDueAt(179, 0)).toBe(0);
    expect(waveDueAt(180, 0)).toBe(1);
    expect(waveDueAt(180, 1)).toBe(0);
    expect(waveDueAt(360, 1)).toBe(2);
    expect(waveDueAt(540, 2)).toBe(3);
    expect(waveDueAt(720, 3)).toBe(0);
    expect(waveDueAt(9999, 3)).toBe(0);
  });

  test("weakestVector feeds the thinnest defensive line", () => {
    const units = [
      { side: "defender", vector: "MAIN", state: "holding" },
      { side: "defender", vector: "MAIN", state: "holding" },
      { side: "defender", vector: "FLANK_LEFT", state: "holding" },
      { side: "attacker", vector: "FLANK_LEFT", state: "holding" },
      { side: "defender", vector: "REAR", state: "dead" },
    ] as Pick<SceneUnit, "side" | "vector" | "state">[];
    // REAR's only unit is dead — 0 living, the weakest line.
    expect(weakestVector(units, ["MAIN", "FLANK_LEFT", "REAR"])).toBe("REAR");
  });
});
