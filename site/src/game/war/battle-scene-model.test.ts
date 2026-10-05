// battle-scene-model.test.ts — the scene view model is pure and stable.
import { describe, expect, test } from "bun:test";
import {
  buildDemoScene,
  fmtSceneClock,
  mulberry32,
  sceneClockS,
  sceneNightFactor,
  scenePhaseAt,
  SCENE_PHASES,
  VECTOR_LANES,
} from "./battle-scene-model";

describe("scene phases", () => {
  test("doctrine boundaries: 30/45/60", () => {
    expect(scenePhaseAt(0)).toBe("approach");
    expect(scenePhaseAt(29.9)).toBe("approach");
    expect(scenePhaseAt(30)).toBe("touchdown");
    expect(scenePhaseAt(44.9)).toBe("touchdown");
    expect(scenePhaseAt(45)).toBe("contact");
    expect(scenePhaseAt(59.9)).toBe("contact");
    expect(scenePhaseAt(60)).toBe("weapons-free");
    expect(scenePhaseAt(3600)).toBe("weapons-free");
  });

  test("phase table matches boundaries", () => {
    expect(SCENE_PHASES.map((p) => p.atS)).toEqual([0, 30, 45, 60]);
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
    // Coords are sane.
    for (const u of s.units) {
      expect(u.x >= 0 && u.x <= 1).toBe(true);
      expect(u.y >= 0 && u.y <= 1).toBe(true);
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
      expect(lane.y > 0 && lane.y < 1).toBe(true);
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
