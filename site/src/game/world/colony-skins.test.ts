// Tests for colony-skins.ts — LOD settlement art for the world map.
// The bake functions need canvas; bun has no DOM, so a Proxy-based mock
// lets the code paths run (catches crashes/logic errors, not pixels).

import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearColonySkinCache,
  COLONY_SKIN_DEGREES,
  colonySkinLODForScale,
  colonySkinSize,
  colonySkinSprite,
  type ColonySkinSpec,
} from "./colony-skins";

// --- minimal canvas mock ---------------------------------------------------

function mockGradient(): unknown {
  return { addColorStop: () => {} };
}

function mockCtx(): unknown {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "createRadialGradient" || prop === "createLinearGradient") {
          return () => mockGradient();
        }
        if (prop === "measureText") return () => ({ width: 0 });
        return () => {};
      },
      set: () => true,
    },
  );
}

function installCanvasMock(): void {
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => mockCtx(),
    }),
  };
}

// ---------------------------------------------------------------------------

describe("colonySkinLODForScale", () => {
  test("null at orbit and below (icons suffice)", () => {
    expect(colonySkinLODForScale(0.5)).toBeNull();
    expect(colonySkinLODForScale(1)).toBeNull();
    expect(colonySkinLODForScale(1.99)).toBeNull();
  });
  test("far at high altitude (Z2)", () => {
    expect(colonySkinLODForScale(2)).toBe("far");
    expect(colonySkinLODForScale(5.9)).toBe("far");
  });
  test("near at low altitude (Z3)", () => {
    expect(colonySkinLODForScale(6)).toBe("near");
    expect(colonySkinLODForScale(13.9)).toBe("near");
  });
  test("ground at ground level (Z4)", () => {
    expect(colonySkinLODForScale(14)).toBe("ground");
    expect(colonySkinLODForScale(24)).toBe("ground");
  });
  test("non-finite scale → null", () => {
    expect(colonySkinLODForScale(NaN)).toBeNull();
    expect(colonySkinLODForScale(Infinity)).toBeNull();
  });
});

describe("colonySkinSize", () => {
  test("grows with LOD", () => {
    const far = colonySkinSize("far");
    const near = colonySkinSize("near");
    const ground = colonySkinSize("ground");
    expect(far).toBeLessThan(near);
    expect(near).toBeLessThan(ground);
    expect(far).toBeGreaterThan(0);
  });
});

describe("COLONY_SKIN_DEGREES", () => {
  test("positive world size", () => {
    expect(COLONY_SKIN_DEGREES).toBeGreaterThan(0);
  });
});

describe("colonySkinSprite (bake smoke tests)", () => {
  beforeEach(() => {
    installCanvasMock();
    clearColonySkinCache();
  });

  const races = ["draconians", "anunnaki", "ashtar", "watchers", "grays", "nephilim", "unknown"] as const;
  const statuses = ["active", "abandoned", "husk"] as const;
  const lods = ["far", "near", "ground"] as const;

  test("bakes every race × status × LOD without throwing", () => {
    for (const race of races) {
      for (const status of statuses) {
        for (const lod of lods) {
          const spec: ColonySkinSpec = { race, status, isHome: false, lod };
          const spr = colonySkinSprite(spec);
          expect(spr).toBeDefined();
          expect(spr.width).toBe(colonySkinSize(lod));
        }
      }
    }
  });

  test("home variant bakes", () => {
    const spec: ColonySkinSpec = { race: "draconians", status: "active", isHome: true, lod: "ground" };
    expect(colonySkinSprite(spec)).toBeDefined();
  });

  test("cache returns the same sprite for the same spec", () => {
    const spec: ColonySkinSpec = { race: "ashtar", status: "active", isHome: false, lod: "near" };
    const a = colonySkinSprite(spec);
    const b = colonySkinSprite(spec);
    expect(a).toBe(b);
  });

  test("different specs get different sprites", () => {
    const a = colonySkinSprite({ race: "draconians", status: "active", isHome: false, lod: "far" });
    clearColonySkinCache();
    const b = colonySkinSprite({ race: "watchers", status: "active", isHome: false, lod: "far" });
    expect(a).not.toBe(b);
  });
});
