// Tests for game/war/rendered-fx.ts — the "rendered" explosion composites
// (Seamless World spec §9, Phase 2 slice 9).
//
// NOTE: this repo's bun `Matchers` type stubs only declare a subset of
// matchers — these tests use only toBe / toBeGreaterThan / toBeLessThan /
// toEqual / toBeDefined / toBeCloseTo / toHaveLength / toMatch.
//
// Run: bun test src/game/war/rendered-fx.test.ts
import { describe, test, expect } from "bun:test";
import { Fx } from "../../components/BattleScene/effects";
import { particleBudgetMultiplier } from "../graphics-quality";
import {
  fireballOffsets,
  planExplosion,
  spawnExplosion,
  spawnExplosionDust,
  spawnImpact,
  spawnMuzzleBloom,
  spawnVolumetricDust,
  SPARK_GRAVITY,
  VOL_DUST_LAYERS,
} from "./rendered-fx";

describe("planExplosion", () => {
  test("CINEMATIC gets everything: core + 3 fireball layers + shockwave + bloom", () => {
    const p = planExplosion("cinematic");
    expect(p.core).toBe(true);
    expect(p.fireballLayers).toBe(3);
    expect(p.shockwave).toBe(true);
    expect(p.composite).toBe(false);
    expect(p.sparks).toBe(true);
    expect(p.bloomRadius).toBeGreaterThan(0);
    expect(p.bloomOnTerrain).toBe(true);
    expect(p.smokeColumn).toBeGreaterThan(0);
  });

  test("BALANCED drops the shockwave ring but keeps bloom and smoke", () => {
    const p = planExplosion("balanced");
    expect(p.core).toBe(true);
    expect(p.fireballLayers).toBe(2);
    expect(p.shockwave).toBe(false);
    expect(p.composite).toBe(false);
    expect(p.bloomRadius).toBeGreaterThan(0);
    expect(p.bloomOnTerrain).toBe(false);
    expect(p.smokeColumn).toBeGreaterThan(0);
  });

  test("PERFORMANCE is one shaded composite sprite — no blob, no bloom", () => {
    const p = planExplosion("performance");
    expect(p.composite).toBe(true);
    expect(p.core).toBe(false);
    expect(p.fireballLayers).toBe(0);
    expect(p.shockwave).toBe(false);
    expect(p.bloomRadius).toBe(0);
  });

  test("layer richness strictly decreases down the ladder", () => {
    const c = planExplosion("cinematic");
    const b = planExplosion("balanced");
    const p = planExplosion("performance");
    expect(c.fireballLayers).toBeGreaterThan(b.fireballLayers);
    expect(b.fireballLayers).toBeGreaterThan(p.fireballLayers);
    expect(c.bloomRadius).toBeGreaterThan(b.bloomRadius);
  });
});

describe("spawnExplosion", () => {
  test("cinematic spawns a shockwave ring, a bloom, and sparks", () => {
    const fx = new Fx();
    spawnExplosion(fx, 100, 200, 1, "cinematic");
    expect(fx.booms).toHaveLength(1);
    const shocks = fx.rings.filter((r) => r.kind === "shock");
    expect(shocks).toHaveLength(1);
    expect(shocks[0].maxR).toBeGreaterThan(0);
    expect(fx.blooms).toHaveLength(1);
    expect(fx.blooms[0].radius).toBeGreaterThan(0);
    expect(fx.sparks.length).toBeGreaterThan(0);
  });

  test("balanced spawns no shockwave ring but still blooms", () => {
    const fx = new Fx();
    spawnExplosion(fx, 100, 200, 1, "balanced");
    expect(fx.rings.filter((r) => r.kind === "shock")).toHaveLength(0);
    expect(fx.blooms).toHaveLength(1);
    expect(fx.blooms[0].radius).toBeGreaterThan(0);
  });

  test("performance spawns a composite boom, no bloom, no shockwave", () => {
    const fx = new Fx();
    spawnExplosion(fx, 100, 200, 1, "performance");
    expect(fx.booms).toHaveLength(1);
    expect(fx.booms[0].composite).toBe(true);
    expect(fx.blooms).toHaveLength(0);
    expect(fx.rings.filter((r) => r.kind === "shock")).toHaveLength(0);
  });

  test("PERFORMANCE never exceeds its particle budget", () => {
    const fx = new Fx();
    spawnExplosion(fx, 100, 200, 1, "performance");
    const budget = particleBudgetMultiplier("performance");
    const boom = fx.booms[0];
    expect(boom.particles.length).toBeLessThan(Math.round(26 * budget) + 2);
    expect(boom.smoke.length).toBeLessThan(Math.round(2 * budget) + 2);
    expect(fx.sparks.length).toBeLessThan(Math.round(12 * budget) + 2);
  });

  test("bloom radius scales with explosion scale", () => {
    const fx = new Fx();
    spawnExplosion(fx, 0, 0, 2, "cinematic");
    spawnExplosion(fx, 0, 0, 1, "cinematic");
    expect(fx.blooms[0].radius).toBeGreaterThan(fx.blooms[1].radius);
    expect(fx.blooms[0].radius).toBeCloseTo(fx.blooms[1].radius * 2, 6);
  });

  test("the bloom lives for the explosion's lifetime, not a single frame", () => {
    const fx = new Fx();
    spawnExplosion(fx, 0, 0, 1, "cinematic");
    const bl = fx.blooms[0];
    expect(bl.life).toBeGreaterThan(0.5);
    expect(bl.maxLife).toBe(bl.life);
  });

  test("impact sparks fall under gravity — update integrates SPARK_GRAVITY", () => {
    const fx = new Fx();
    fx.sparks.push({
      x: 0, y: 0, vx: 50, vy: 0,
      life: 2, maxLife: 2, size: 2, color: "#fff6e0",
    });
    fx.update(0.5);
    expect(fx.sparks).toHaveLength(1);
    expect(fx.sparks[0].vy).toBeGreaterThan(0);
    expect(fx.sparks[0].vy).toBeCloseTo(SPARK_GRAVITY * 0.5, 1);
  });
});

describe("spawnMuzzleBloom", () => {
  test("adds a short-lived bloom at the muzzle on cinematic/balanced", () => {
    const fx = new Fx();
    spawnMuzzleBloom(fx, 10, 20, "cinematic");
    expect(fx.blooms).toHaveLength(1);
    expect(fx.blooms[0].radius).toBeGreaterThan(0);
    expect(fx.blooms[0].maxLife).toBeLessThan(0.5);
  });

  test("adds nothing on performance (bloom off)", () => {
    const fx = new Fx();
    spawnMuzzleBloom(fx, 10, 20, "performance");
    expect(fx.blooms).toHaveLength(0);
  });
});

describe("spawnVolumetricDust", () => {
  test("spawns layered soft sprites with positive lifetimes", () => {
    const fx = new Fx();
    spawnVolumetricDust(fx, 50, 60, "cinematic");
    expect(fx.dusts).toHaveLength(VOL_DUST_LAYERS);
    for (const d of fx.dusts) {
      expect(d.life).toBeGreaterThan(0);
      expect(d.maxLife).toBeGreaterThan(0);
      expect(d.maxLife >= d.life).toBe(true);
      expect(d.age).toBe(0);
      expect(d.churn).toBeDefined();
    }
  });

  test("layers spread outward in size — one kick, three depths", () => {
    const fx = new Fx();
    spawnVolumetricDust(fx, 50, 60, "cinematic");
    const sizes = fx.dusts.map((d) => d.size);
    expect(sizes[0] + sizes[1] + sizes[2]).toBeGreaterThan(0);
    // At least one layer is strictly wider than another.
    expect(sizes[0] === sizes[1] && sizes[1] === sizes[2]).toBe(false);
  });

  test("dust hangs longer than the old pop-puff lifetime", () => {
    const fx = new Fx();
    spawnVolumetricDust(fx, 50, 60, "cinematic");
    for (const d of fx.dusts) {
      expect(d.maxLife).toBeGreaterThan(1.5);
    }
  });
});

describe("fireballOffsets", () => {
  test("returns the 3 volumetric layers, bounded and deterministic", () => {
    const a = fireballOffsets(123456, 0.3);
    const b = fireballOffsets(123456, 0.3);
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
    for (const L of a) {
      expect(Math.abs(L.dx)).toBeLessThan(0.4);
      expect(Math.abs(L.dy)).toBeLessThan(0.4);
      expect(L.scale).toBeGreaterThan(0);
    }
  });

  test("churns with time — the interior roils", () => {
    const a = fireballOffsets(999, 0.0);
    const b = fireballOffsets(999, 0.6);
    expect(a[0].dx === b[0].dx && a[0].dy === b[0].dy).toBe(false);
  });

  test("different seeds give different churn", () => {
    const a = fireballOffsets(111, 0.3);
    const b = fireballOffsets(222, 0.3);
    expect(a[0].dx === b[0].dx && a[1].dx === b[1].dx).toBe(false);
  });
});

describe("explosion detail layers (debris, embers, scorch, dust ring)", () => {
  test("CINEMATIC plan includes debris chunks, embers, scorch, and a dust ring", () => {
    const p = planExplosion("cinematic");
    expect(p.debrisChunks).toBeGreaterThan(0);
    expect(p.embers).toBeGreaterThan(0);
    expect(p.scorch).toBe(true);
    expect(p.dustRing).toBeGreaterThan(0);
  });

  test("BALANCED keeps the detail but fewer of each", () => {
    const c = planExplosion("cinematic");
    const b = planExplosion("balanced");
    expect(b.debrisChunks).toBeGreaterThan(0);
    expect(b.debrisChunks).toBeLessThan(c.debrisChunks);
    expect(b.embers).toBeGreaterThan(0);
    expect(b.embers).toBeLessThan(c.embers);
    expect(b.scorch).toBe(true);
    expect(b.dustRing).toBeGreaterThan(0);
    expect(b.dustRing).toBeLessThan(c.dustRing);
  });

  test("PERFORMANCE skips all detail layers (composite only)", () => {
    const p = planExplosion("performance");
    expect(p.debrisChunks).toBe(0);
    expect(p.embers).toBe(0);
    expect(p.scorch).toBe(false);
    expect(p.dustRing).toBe(0);
  });

  test("cinematic spawnExplosion creates chunks, embers, scorch, and lit dust", () => {
    const fx = new Fx();
    spawnExplosion(fx, 100, 200, 1, "cinematic");
    expect(fx.chunks.length).toBeGreaterThan(0);
    expect(fx.embers.length).toBeGreaterThan(0);
    expect(fx.scorches).toHaveLength(1);
    expect(fx.scorches[0].radius).toBeGreaterThan(0);
    // The dust ring is born lit — it glows while the fire is young.
    const litDust = fx.dusts.filter((d) => d.lit > 0);
    expect(litDust.length).toBeGreaterThan(0);
  });

  test("performance spawnExplosion creates no chunks, embers, scorch, or dust ring", () => {
    const fx = new Fx();
    spawnExplosion(fx, 100, 200, 1, "performance");
    expect(fx.chunks).toHaveLength(0);
    expect(fx.embers).toHaveLength(0);
    expect(fx.scorches).toHaveLength(0);
    expect(fx.dusts.filter((d) => d.lit > 0)).toHaveLength(0);
  });

  test("debris chunks tumble and fall under gravity in Fx.update", () => {
    const fx = new Fx();
    spawnExplosion(fx, 0, 0, 1, "cinematic");
    const ch = fx.chunks[0];
    const vy0 = ch.vy;
    const rot0 = ch.rot;
    // Run long enough for gravity to dominate the initial upward kick.
    fx.update(0.5);
    expect(ch.vy).toBeGreaterThan(vy0); // gravity accelerates downward (+y)
    expect(ch.rot === rot0).toBe(false); // tumbling
  });

  test("embers rise (buoyant) in Fx.update", () => {
    const fx = new Fx();
    spawnExplosion(fx, 0, 0, 1, "cinematic");
    const e = fx.embers[0];
    const y0 = e.y;
    fx.update(0.1);
    expect(e.y).toBeLessThan(y0); // rises (-y)
  });

  test("dust lit decays in Fx.update", () => {
    const fx = new Fx();
    spawnExplosion(fx, 0, 0, 1, "cinematic");
    const d = fx.dusts.find((x) => x.lit > 0);
    expect(d).toBeDefined();
    const lit0 = d!.lit;
    fx.update(0.5);
    expect(d!.lit).toBeLessThan(lit0);
  });
});

describe("spawnImpact", () => {
  test("spawns a flash and sparks at the impact point", () => {
    const fx = new Fx();
    spawnImpact(fx, 50, 60, "#ffd27a", "cinematic");
    expect(fx.flashes.length).toBeGreaterThan(0);
    expect(fx.sparks.length).toBeGreaterThan(0);
    const f = fx.flashes[fx.flashes.length - 1];
    expect(f.x).toBe(50);
    expect(f.y).toBe(60);
  });

  test("Fx.fire triggers an impact at the target end", () => {
    const fx = new Fx();
    fx.fire(0, 0, 100, 100, "#ffd27a");
    expect(fx.tracers).toHaveLength(1);
    // Impact flash at (100,100) plus the muzzle flash at (0,0).
    expect(fx.flashes.length).toBe(2);
  });
});

describe("spawnExplosionDust", () => {
  test("kicks up a ring of lit dust around the blast", () => {
    const fx = new Fx();
    spawnExplosionDust(fx, 0, 0, 1, 8, 1);
    expect(fx.dusts.length).toBeGreaterThan(0);
    for (const d of fx.dusts) {
      expect(d.lit).toBe(1);
      expect(d.maxLife).toBeGreaterThan(1);
    }
  });
});
