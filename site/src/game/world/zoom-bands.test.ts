// Tests for the seamless-world zoom continuum kernel (game/world/zoom-bands.ts).
// Run: bun test site/src/game/world/zoom-bands.test.ts
import { describe, expect, test } from "bun:test";
import {
  BAND_Z2,
  BAND_Z3,
  BAND_Z4,
  bandCenter,
  bandForScale,
  clampZoomScale,
  isGroundLevel,
  isRegionDominant,
  MORPH_END,
  MORPH_START,
  morphTFromScale,
  octavesBetween,
  octavesOf,
  scaleOfOctaves,
  smoothstepBand,
  ZOOM_BAND_LABEL,
  ZOOM_SCALE_MAX,
} from "./zoom-bands";

describe("bandForScale — the five bands of the continuum", () => {
  test("solar-system side stays Z0 below the system blend threshold", () => {
    expect(bandForScale(0.08)).toBe("Z0");
    expect(bandForScale(0.3)).toBe("Z0");
    expect(bandForScale(0.619)).toBe("Z0");
  });

  test("the globe's orbit band spans the system threshold up to Z2", () => {
    expect(bandForScale(0.62)).toBe("Z1");
    expect(bandForScale(1)).toBe("Z1"); // today's default globe scale
    expect(bandForScale(1.999)).toBe("Z1");
  });

  test("band boundaries are exact at the thresholds", () => {
    expect(bandForScale(BAND_Z2)).toBe("Z2");
    expect(bandForScale(BAND_Z3)).toBe("Z3");
    expect(bandForScale(BAND_Z4)).toBe("Z4");
    expect(bandForScale(ZOOM_SCALE_MAX)).toBe("Z4");
  });

  test("non-finite scales fall back to the orbit band, never crash", () => {
    expect(bandForScale(NaN)).toBe("Z1");
    expect(bandForScale(Infinity)).toBe("Z1");
  });

  test("every band has a label", () => {
    for (const b of ["Z0", "Z1", "Z2", "Z3", "Z4"] as const) {
      expect(ZOOM_BAND_LABEL[b].length).toBeGreaterThan(0);
    }
  });
});

describe("bandCenter — tap-to-focus zoom targets", () => {
  test("each band's center lands inside that band", () => {
    for (const b of ["Z0", "Z1", "Z2", "Z3", "Z4"] as const) {
      expect(bandForScale(bandCenter(b))).toBe(b);
    }
  });

  test("Z3's center is the dust-cloud tap target scale", () => {
    expect(bandCenter("Z3")).toBeGreaterThan(BAND_Z3);
    expect(bandCenter("Z3")).toBeLessThan(BAND_Z4);
  });
});

describe("octave math — logarithmic pinch sensitivity", () => {
  test("doubling the scale is exactly one octave", () => {
    expect(octavesBetween(1, 2)).toBeCloseTo(1, 10);
    expect(octavesBetween(2, 1)).toBeCloseTo(-1, 10);
    expect(octavesBetween(3, 3)).toBeCloseTo(0, 10);
  });

  test("octavesOf/scaleOfOctaves round-trip", () => {
    expect(scaleOfOctaves(octavesOf(7))).toBeCloseTo(7, 10);
    expect(octavesOf(1)).toBeCloseTo(0, 10);
  });
});

describe("morphTFromScale — the sphere→plane crossfade", () => {
  test("pure globe below the morph range, pure plane at its end", () => {
    expect(morphTFromScale(1)).toBe(0);
    expect(morphTFromScale(MORPH_START)).toBe(0);
    expect(morphTFromScale(MORPH_END)).toBe(1);
    expect(morphTFromScale(ZOOM_SCALE_MAX)).toBe(1);
  });

  test("smoothstepped — no pop at the midpoint", () => {
    const mid = morphTFromScale((MORPH_START + MORPH_END) / 2);
    expect(mid).toBeCloseTo(0.5, 10);
    // monotonic across the range
    let prev = -1;
    for (let z = MORPH_START; z <= MORPH_END + 0.001; z += 0.05) {
      const t = morphTFromScale(z);
      expect(t >= prev).toBe(true);
      prev = t;
    }
  });
});

describe("smoothstepBand", () => {
  test("clamps outside the range", () => {
    expect(smoothstepBand(2, 3, 1)).toBe(0);
    expect(smoothstepBand(2, 3, 4)).toBe(1);
  });
});

describe("clampZoomScale — the axis extends downward past the old max", () => {
  test("keeps the solar-system floor", () => {
    expect(clampZoomScale(0.08)).toBe(0.08);
    expect(clampZoomScale(0.01)).toBe(0.08);
  });

  test("extends past the old SCALE_MAX=3 to the new ground max", () => {
    expect(clampZoomScale(3)).toBe(3);
    expect(clampZoomScale(14)).toBe(14);
    expect(clampZoomScale(24)).toBe(ZOOM_SCALE_MAX);
    expect(clampZoomScale(100)).toBe(ZOOM_SCALE_MAX);
  });

  test("non-finite input falls back to 1", () => {
    expect(clampZoomScale(NaN)).toBe(1);
  });
});

describe("band predicates", () => {
  test("isRegionDominant flips once the morph is mostly done", () => {
    expect(isRegionDominant(1)).toBe(false);
    expect(isRegionDominant(MORPH_END)).toBe(true);
  });

  test("isGroundLevel is true only in Z4", () => {
    expect(isGroundLevel(9)).toBe(false);
    expect(isGroundLevel(14)).toBe(true);
    expect(isGroundLevel(24)).toBe(true);
  });
});
