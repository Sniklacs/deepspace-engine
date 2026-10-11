// Tests for game/world/corruption.ts — the Chorus corruption gradient.
//
// Pure, seeded, presentation-only: determinism per battle seed, band
// boundaries, range 0..1, and a ragged (not constant-radius) edge.
//
// Run: bun test src/game/world/corruption.test.ts
import { describe, test, expect } from "bun:test";
import {
  corruptionAt,
  bandAt,
  bandWeights,
  CORRUPTION_BANDS,
  CORRUPTION_PALETTE,
  type CorruptionField,
} from "./corruption";

const FIELD: CorruptionField = {
  seed: 12345,
  strongholdX: 0,
  strongholdY: 0,
  radius: 10,
};

describe("corruptionAt", () => {
  test("is deterministic per seed — same inputs, same answer, every call", () => {
    const a = corruptionAt(3.2, -4.7, FIELD);
    const b = corruptionAt(3.2, -4.7, FIELD);
    const c = corruptionAt(-8.1, 1.9, { ...FIELD, seed: 777 });
    expect(a).toBe(b);
    expect(c).toBe(corruptionAt(-8.1, 1.9, { ...FIELD, seed: 777 }));
  });

  test("is 1 exactly at the stronghold heart", () => {
    expect(corruptionAt(0, 0, FIELD)).toBe(1);
    expect(corruptionAt(FIELD.strongholdX, FIELD.strongholdY, FIELD)).toBe(1);
  });

  test("is 0 far at the outskirts", () => {
    expect(corruptionAt(30, 0, FIELD)).toBe(0);
    expect(corruptionAt(0, -50, FIELD)).toBe(0);
    expect(corruptionAt(21, 21, FIELD)).toBe(0);
  });

  test("stays in 0..1 across a wide sample grid", () => {
    for (let x = -25; x <= 25; x += 1.25) {
      for (let y = -25; y <= 25; y += 1.25) {
        const c = corruptionAt(x, y, FIELD);
        expect(c >= 0 && c <= 1).toBe(true);
      }
    }
  });

  test("decreases outward on average — stronghold hot, outskirts clean", () => {
    const near = corruptionAt(1, 1, FIELD);
    const mid = corruptionAt(5, 0, FIELD);
    const far = corruptionAt(9, 0, FIELD);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(bandAt(near)).toBe("burnt");
    expect(bandAt(far)).toBe("verdant");
  });

  test("is sensitive to the seed — different seeds, different corruption", () => {
    // A mid-range point where the ragged edge lives.
    const a = corruptionAt(6, 2.5, FIELD);
    const b = corruptionAt(6, 2.5, { ...FIELD, seed: 99999 });
    expect(Math.abs(a - b)).toBeGreaterThan(1e-6);
  });

  test("the edge is ragged — corruption varies around a fixed-radius ring", () => {
    // Eight points all exactly 5 units (0.5r) from the stronghold.
    // A perfect circle would give eight identical values; noise must move them.
    const ring: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ring.push(corruptionAt(5 * Math.cos(a), 5 * Math.sin(a), FIELD));
    }
    const mean = ring.reduce((s, v) => s + v, 0) / ring.length;
    const variance = ring.reduce((s, v) => s + (v - mean) * (v - mean), 0) / ring.length;
    expect(variance).toBeGreaterThan(1e-6);
    // …but they still read as one band — the raggedness doesn't scramble the gradient.
    for (const v of ring) expect(v).toBeGreaterThan(0.25);
  });

  test("custom raggedness / noiseScale still behave (0..1, stronghold 1)", () => {
    const f: CorruptionField = { ...FIELD, raggedness: 0.5, noiseScale: 5, seed: 42 };
    expect(corruptionAt(0, 0, f)).toBe(1);
    for (let i = 0; i < 50; i++) {
      const c = corruptionAt(i - 25, 25 - i, f);
      expect(c >= 0 && c <= 1).toBe(true);
    }
  });

  test("a zero raggedness gives the pure radial falloff", () => {
    const f: CorruptionField = { ...FIELD, raggedness: 0, seed: 1 };
    expect(corruptionAt(5, 0, f)).toBeCloseTo(0.5, 10);
    expect(corruptionAt(0, 5, f)).toBeCloseTo(0.5, 10);
    expect(corruptionAt(2.5, 0, f)).toBeCloseTo(0.75, 10);
  });
});

describe("bandAt", () => {
  test("maps the spec's five bands to their corruption ranges", () => {
    expect(bandAt(0)).toBe("verdant");
    expect(bandAt(0.249)).toBe("verdant");
    expect(bandAt(0.25)).toBe("fading");
    expect(bandAt(0.449)).toBe("fading");
    expect(bandAt(0.45)).toBe("blighted");
    expect(bandAt(0.649)).toBe("blighted");
    expect(bandAt(0.65)).toBe("cracked");
    expect(bandAt(0.849)).toBe("cracked");
    expect(bandAt(0.85)).toBe("burnt");
    expect(bandAt(1)).toBe("burnt");
  });
});

describe("bandWeights", () => {
  test("mid-band is a single full-weight entry", () => {
    const w = bandWeights(0.5);
    expect(w).toHaveLength(1);
    expect(w[0].band).toBe("blighted");
    expect(w[0].weight).toBeCloseTo(1, 10);
  });

  test("a stop crossfades between its two bands", () => {
    const w = bandWeights(0.45);
    expect(w).toHaveLength(2);
    const total = w.reduce((s, e) => s + e.weight, 0);
    expect(total).toBeCloseTo(1, 10);
    const byBand = Object.fromEntries(w.map((e) => [e.band, e.weight]));
    expect(byBand.fading).toBeCloseTo(0.5, 2);
    expect(byBand.blighted).toBeCloseTo(0.5, 2);
  });

  test("weights always sum to 1 across the range", () => {
    for (let c = 0; c <= 1.0001; c += 0.02) {
      const w = bandWeights(c);
      const total = w.reduce((s, e) => s + e.weight, 0);
      expect(total).toBeCloseTo(1, 8);
      for (const e of w) {
        expect(CORRUPTION_BANDS.includes(e.band)).toBe(true);
        expect(e.weight).toBeGreaterThan(0);
      }
    }
  });
});

describe("CORRUPTION_PALETTE", () => {
  test("covers all five bands with valid hex swatches", () => {
    expect(CORRUPTION_BANDS).toHaveLength(5);
    const hex = /^#[0-9a-fA-F]{6}$/;
    for (const band of CORRUPTION_BANDS) {
      const sw = CORRUPTION_PALETTE[band];
      expect(sw).toBeDefined();
      for (const key of ["ground", "flora", "accent", "light"] as const) {
        expect(sw[key]).toMatch(hex);
      }
    }
  });
});
