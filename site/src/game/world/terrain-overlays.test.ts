// Tests for game/world/terrain-overlays.ts — quality-gated live terrain
// detail at Z3+ (Seamless World spec §8, Phase 2 slice 13).
//
// NOTE: this repo's bun `Matchers` type stubs only declare a subset of
// matchers — these tests use only toBe / toBeGreaterThan / toBeLessThan /
// toEqual / toBeDefined / toBeCloseTo / toHaveLength / toMatch.
//
// Run: bun test src/game/world/terrain-overlays.test.ts
import { describe, test, expect } from "bun:test";
import {
  createOverlaySpec,
  drawTerrainOverlays,
  emberPulse,
  kindForBand,
  motePosition,
  overlayMoteBudget,
  overlayVisibleAtZoom,
  swayOffset,
  type OverlaySpecOptions,
} from "./terrain-overlays";
import { corruptionAt, bandAt } from "./corruption";

const OPTS: OverlaySpecOptions = {
  seed: 4242,
  worldW: 1.5,
  worldH: 1.5,
  strongholdX: 0.75,
  strongholdY: 1.5,
  radius: 1.35,
};

describe("createOverlaySpec", () => {
  test("is deterministic per seed — same inputs, same motes", () => {
    const a = createOverlaySpec(OPTS);
    const b = createOverlaySpec(OPTS);
    expect(a.motes).toEqual(b.motes);
    expect(a.motes).toHaveLength(140);
  });

  test("different seeds give different motes", () => {
    const a = createOverlaySpec(OPTS);
    const b = createOverlaySpec({ ...OPTS, seed: 777 });
    const same = a.motes.every(
      (m, i) => m.x === b.motes[i].x && m.y === b.motes[i].y,
    );
    expect(same).toBe(false);
  });

  test("every mote's kind is driven by the corruption band under it", () => {
    const spec = createOverlaySpec(OPTS);
    for (const m of spec.motes) {
      const band = bandAt(corruptionAt(m.x, m.y, spec.field));
      expect(band).toBe(m.band);
      const expected = kindForBand(band);
      // Burnt motes may flip to heat columns by the seeded coin flip.
      const ok = m.kind === expected || (band === "burnt" && m.kind === "heat");
      expect(ok).toBe(true);
    }
  });

  test("motes cover all three detail kinds across the gradient", () => {
    const spec = createOverlaySpec(OPTS);
    const kinds = new Set(spec.motes.map((m) => m.kind));
    expect(kinds.has("sway")).toBe(true); // verdant outskirts
    expect(kinds.has("ash")).toBe(true); // blighted mid
    expect(kinds.has("ember") || kinds.has("heat")).toBe(true); // burnt heart
  });
});

describe("kindForBand", () => {
  test("maps bands to the spec's detail kinds", () => {
    expect(kindForBand("verdant")).toBe("sway");
    expect(kindForBand("fading")).toBe("sway");
    expect(kindForBand("blighted")).toBe("ash");
    expect(kindForBand("cracked")).toBe("ash");
    expect(kindForBand("burnt")).toBe("ember");
  });
});

describe("swayOffset / emberPulse", () => {
  test("sway is periodic and bounded", () => {
    const p = 1.2;
    const period = (Math.PI * 2) / 1.4;
    expect(swayOffset(p, 3.7)).toBeCloseTo(swayOffset(p, 3.7 + period), 10);
    for (let t = 0; t < 10; t += 0.25) {
      expect(Math.abs(swayOffset(p, t))).toBeLessThan(0.031);
    }
  });

  test("ember pulse stays in 0..1 and is deterministic", () => {
    expect(emberPulse(0.5, 2.0)).toBe(emberPulse(0.5, 2.0));
    for (let t = 0; t < 10; t += 0.2) {
      const v = emberPulse(2.9, t);
      expect(v >= 0 && v <= 1).toBe(true);
    }
  });
});

describe("motePosition", () => {
  test("is a pure function of time — same t, same position", () => {
    const spec = createOverlaySpec(OPTS);
    const m = spec.motes[0];
    expect(motePosition(m, 12.5, 1.5, 1.5)).toEqual(
      motePosition(m, 12.5, 1.5, 1.5),
    );
  });

  test("motes drift with time and stay in bounds even for huge t", () => {
    const spec = createOverlaySpec(OPTS);
    for (const m of spec.motes.slice(0, 40)) {
      const p0 = motePosition(m, 0, 1.5, 1.5);
      const p1 = motePosition(m, 10000, 1.5, 1.5);
      expect(p0.x >= 0 && p0.x < 1.5).toBe(true);
      expect(p1.x >= 0 && p1.x < 1.5).toBe(true);
      expect(p1.y >= 0 && p1.y < 1.5).toBe(true);
      expect(p1.alpha >= 0 && p1.alpha <= 1).toBe(true);
      expect(p0.x === p1.x && p0.y === p1.y).toBe(false);
    }
  });
});

describe("overlayMoteBudget", () => {
  test("cinematic > balanced > performance(=0, baked gradient only)", () => {
    expect(overlayMoteBudget("cinematic")).toBe(140);
    expect(overlayMoteBudget("balanced")).toBe(60);
    expect(overlayMoteBudget("performance")).toBe(0);
    expect(overlayMoteBudget("cinematic")).toBeGreaterThan(
      overlayMoteBudget("balanced"),
    );
  });
});

describe("overlayVisibleAtZoom", () => {
  test("gates overlays to the Z3+ close-zoom band", () => {
    expect(overlayVisibleAtZoom(1.0, 1.0)).toBe(false);
    expect(overlayVisibleAtZoom(1.39, 1.0)).toBe(false);
    expect(overlayVisibleAtZoom(1.4, 1.0)).toBe(true);
    expect(overlayVisibleAtZoom(3.2, 1.0)).toBe(true);
  });
});

describe("drawTerrainOverlays", () => {
  // A null-prototype canvas stand-in: drawTerrainOverlays must not throw
  // when the rung renders zero motes, and must call drawing ops otherwise.
  function fakeCtx(): {
    ctx: CanvasRenderingContext2D;
    calls: string[];
  } {
    const calls: string[] = [];
    const grad = {
      addColorStop: () => calls.push("addColorStop"),
    };
    const ctx = {
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      createRadialGradient: () => {
        calls.push("createRadialGradient");
        return grad;
      },
      createLinearGradient: () => {
        calls.push("createLinearGradient");
        return grad;
      },
      beginPath: () => calls.push("beginPath"),
      arc: () => calls.push("arc"),
      fill: () => calls.push("fill"),
      fillRect: () => calls.push("fillRect"),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  test("draws motes on the default (cinematic) rung, balanced save/restore", () => {
    // Default rung is AUTO → cinematic (no localStorage in this runtime),
    // so all 12 spec motes render.
    const spec = createOverlaySpec({ ...OPTS, count: 12 });
    const { ctx, calls } = fakeCtx();
    drawTerrainOverlays(ctx, spec, 5.0, 0.5);
    expect(calls.filter((c) => c === "save")).toHaveLength(1);
    expect(calls.filter((c) => c === "restore")).toHaveLength(1);
    const fills = calls.filter((c) => c === "fill" || c === "fillRect").length;
    expect(fills).toBeGreaterThan(0);
  });
});
