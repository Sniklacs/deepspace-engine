// Tests for game/graphics-quality.ts — the Seamless World quality ladder
// (spec §9, Phase 2 slice 8).
//
// NOTE: this repo's bun `Matchers` type stubs only declare a subset of
// matchers — `toContain`, `toBeLessThanOrEqual`, `toBeGreaterThanOrEqual`
// are TYPE ERRORS here even though bun supports them at runtime. These
// tests use only the declared ones (toBe / toBeGreaterThan / toBeLessThan
// / toEqual / toBeDefined / toBeCloseTo / toHaveLength / toMatch).
//
// Run: bun test src/game/graphics-quality.test.ts
import { describe, test, expect } from "bun:test";
import {
  GRAPHICS_LADDER,
  GRAPHICS_LEVELS,
  GRAPHICS_MODES,
  autoRungLevel,
  effectiveDpr,
  getGraphicsMode,
  maybeDropRung,
  maybeRaiseRung,
  RAISE_FRAME_MAX_MS,
  RAISE_IDLE_MS,
  RAISE_OVER_SHARE_MAX,
  RAISE_REST_AVG_MAX_MS,
  RAISE_REST_SHARE_MAX,
  RAISE_WINDOWS,
  particleBudgetMultiplier,
  resetAutoLadder,
  resolveGraphicsLevel,
  setGraphicsMode,
  subscribeGraphicsMode,
} from "./graphics-quality";

// This bun test runtime has no localStorage — shim it in-memory so the
// persistence tests exercise the real read/write path of the module.
const memStore = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k: string, v: string) => {
    memStore.set(k, String(v));
  },
  removeItem: (k: string) => {
    memStore.delete(k);
  },
  clear: () => memStore.clear(),
};

/** Reset device + AUTO state before each test — no leakage between suites. */
function fresh(): void {
  memStore.clear();
  resetAutoLadder();
}

describe("the ladder table (spec §9)", () => {
  test("has exactly the three rungs", () => {
    fresh();
    expect(GRAPHICS_LEVELS).toEqual(["cinematic", "balanced", "performance"]);
  });

  test("particle budgets: 100% / ~45% / ~15%", () => {
    fresh();
    expect(GRAPHICS_LADDER.cinematic.particleBudget).toBe(1);
    expect(GRAPHICS_LADDER.balanced.particleBudget).toBe(0.45);
    expect(GRAPHICS_LADDER.performance.particleBudget).toBe(0.15);
  });

  test("DPR caps: min(2, device) / min(1.5, device) / 1", () => {
    fresh();
    expect(GRAPHICS_LADDER.cinematic.dprCap).toBe(2);
    expect(GRAPHICS_LADDER.balanced.dprCap).toBe(1.5);
    expect(GRAPHICS_LADDER.performance.dprCap).toBe(1);
  });

  test("bloom / shadows / shake / overlays / explosion layers / orbit dust", () => {
    fresh();
    const c = GRAPHICS_LADDER.cinematic;
    expect(c.bloom).toBe("terrain-units");
    expect(c.shadows).toBe("soft");
    expect(c.shake).toBe("full");
    expect(c.terrainOverlays).toBe("all");
    expect(c.explosionLayers).toBe("full");
    expect(c.orbitDust).toBe("animated");

    const b = GRAPHICS_LADDER.balanced;
    expect(b.bloom).toBe("units");
    expect(b.shadows).toBe("simple");
    expect(b.shake).toBe("reduced");
    expect(b.terrainOverlays).toBe("reduced");
    expect(b.explosionLayers).toBe("standard");
    expect(b.orbitDust).toBe("fewer");

    const p = GRAPHICS_LADDER.performance;
    expect(p.bloom).toBe("off");
    expect(p.shadows).toBe("off");
    expect(p.shake).toBe("minimal");
    expect(p.terrainOverlays).toBe("off");
    expect(p.explosionLayers).toBe("composite");
    expect(p.orbitDust).toBe("static");
  });
});

describe("effectiveDpr", () => {
  test("caps at the rung's ceiling, never below 1", () => {
    fresh();
    expect(effectiveDpr(3, "balanced")).toBe(1.5);
    expect(effectiveDpr(2, "performance")).toBe(1);
    expect(effectiveDpr(1, "cinematic")).toBe(1);
    expect(effectiveDpr(1.5, "cinematic")).toBe(1.5);
    expect(effectiveDpr(0.5, "performance")).toBe(1);
  });
});

describe("persistence (per-device localStorage, worldglobe.layers.v1 pattern)", () => {
  test("round-trips the chosen mode", () => {
    fresh();
    setGraphicsMode("performance");
    expect(getGraphicsMode()).toBe("performance");
    setGraphicsMode("balanced");
    expect(getGraphicsMode()).toBe("balanced");
  });

  test("defaults to auto", () => {
    fresh();
    setGraphicsMode("auto");
    expect(getGraphicsMode()).toBe("auto");
  });

  test("ignores invalid modes", () => {
    fresh();
    setGraphicsMode("performance");
    setGraphicsMode("banana" as never);
    expect(getGraphicsMode()).toBe("performance");
  });

  test("a corrupt stored value falls back to auto", () => {
    fresh();
    localStorage.setItem("graphics.quality.v1", "banana");
    expect(getGraphicsMode()).toBe("auto");
  });

  test("subscribers are notified on change", () => {
    fresh();
    let calls = 0;
    const unsub = subscribeGraphicsMode(() => {
      calls += 1;
    });
    setGraphicsMode("balanced");
    expect(calls).toBe(1);
    unsub();
    setGraphicsMode("cinematic");
    expect(calls).toBe(1);
  });

  test("all four modes are valid", () => {
    fresh();
    expect(GRAPHICS_MODES.includes(getGraphicsMode())).toBe(true);
    for (const m of GRAPHICS_MODES) {
      setGraphicsMode(m);
      expect(getGraphicsMode()).toBe(m);
    }
  });
});

describe("AUTO rung (maybeDropRung)", () => {
  test("starts at CINEMATIC", () => {
    fresh();
    resetAutoLadder();
    expect(autoRungLevel()).toBe("cinematic");
    expect(resolveGraphicsLevel()).toBe("cinematic");
  });

  test("drops one rung after sustained over-budget frames, reporting the change", () => {
    fresh();
    resetAutoLadder();
    expect(maybeDropRung(50)).toBe(false); // 1st over-budget window
    expect(maybeDropRung(50)).toBe(false); // 2nd
    expect(maybeDropRung(50)).toBe(true); // 3rd — sustained → drop
    expect(autoRungLevel()).toBe("balanced");
    expect(resolveGraphicsLevel()).toBe("balanced");
    expect(particleBudgetMultiplier()).toBe(0.45);
  });

  test("an under-budget window resets the streak — no hair-trigger drops", () => {
    fresh();
    resetAutoLadder();
    expect(maybeDropRung(50)).toBe(false);
    expect(maybeDropRung(50)).toBe(false);
    expect(maybeDropRung(10)).toBe(false); // streak broken
    expect(maybeDropRung(50)).toBe(false);
    expect(maybeDropRung(50)).toBe(false);
    expect(autoRungLevel()).toBe("cinematic");
  });

  test("walks down to PERFORMANCE and stops there", () => {
    fresh();
    resetAutoLadder();
    for (let i = 0; i < 3; i++) expect(maybeDropRung(100)).toBe(i === 2);
    expect(autoRungLevel()).toBe("balanced");
    for (let i = 0; i < 3; i++) expect(maybeDropRung(100)).toBe(i === 2);
    expect(autoRungLevel()).toBe("performance");
    // The floor: sustained bad frames can never go lower, and report no change.
    expect(maybeDropRung(100)).toBe(false);
    expect(maybeDropRung(100)).toBe(false);
    expect(maybeDropRung(100)).toBe(false);
    expect(autoRungLevel()).toBe("performance");
    expect(particleBudgetMultiplier()).toBe(0.15);
  });

  test("manual modes never move, whatever the frame time", () => {
    fresh();
    resetAutoLadder();
    setGraphicsMode("cinematic");
    for (let i = 0; i < 5; i++) expect(maybeDropRung(500)).toBe(false);
    expect(resolveGraphicsLevel()).toBe("cinematic");
    expect(autoRungLevel()).toBe("cinematic"); // the AUTO rung itself is untouched

    setGraphicsMode("performance");
    expect(resolveGraphicsLevel()).toBe("performance");
    expect(particleBudgetMultiplier()).toBe(0.15);
  });
});

describe("AUTO climb-back (maybeRaiseRung) — Oct 13 2026 blur fix", () => {
  function demoteToPerformance(): void {
    for (let i = 0; i < 6; i++) maybeDropRung(100);
    expect(autoRungLevel()).toBe("performance");
  }

  test("a demoted rung climbs back after sustained cheap frames", () => {
    fresh();
    resetAutoLadder();
    demoteToPerformance();
    for (let i = 0; i < RAISE_WINDOWS - 1; i++) {
      expect(maybeRaiseRung(RAISE_FRAME_MAX_MS)).toBe(false);
    }
    expect(autoRungLevel()).toBe("performance");
    expect(maybeRaiseRung(RAISE_FRAME_MAX_MS)).toBe(true); // the RAISE_WINDOWS-th cheap window
    expect(autoRungLevel()).toBe("balanced");
    expect(effectiveDpr(2)).toBe(1.5); // the DPR the canvas actually gets back
    for (let i = 0; i < RAISE_WINDOWS; i++) maybeRaiseRung(4);
    expect(autoRungLevel()).toBe("cinematic");
    expect(effectiveDpr(2)).toBe(2);
  });

  test("CINEMATIC is the ceiling — cheap frames there change nothing", () => {
    fresh();
    resetAutoLadder();
    for (let i = 0; i < RAISE_WINDOWS + 2; i++) expect(maybeRaiseRung(4)).toBe(false);
    expect(autoRungLevel()).toBe("cinematic");
  });

  test("one non-cheap window resets the climb streak (no oscillation)", () => {
    fresh();
    resetAutoLadder();
    demoteToPerformance();
    for (let i = 0; i < RAISE_WINDOWS - 1; i++) maybeRaiseRung(4);
    expect(maybeRaiseRung(RAISE_FRAME_MAX_MS + 5)).toBe(false); // streak broken
    for (let i = 0; i < RAISE_WINDOWS - 1; i++) {
      expect(maybeRaiseRung(4)).toBe(false);
    }
    expect(autoRungLevel()).toBe("performance");
    expect(maybeRaiseRung(4)).toBe(true);
    expect(autoRungLevel()).toBe("balanced");
  });

  test("a bad window kills the climb streak (drop-check then raise-check, as the tick runs them)", () => {
    fresh();
    resetAutoLadder();
    demoteToPerformance();
    for (let i = 0; i < RAISE_WINDOWS - 1; i++) maybeRaiseRung(4);
    // One drowning window, evaluated in autoLadderTick's order: the drop
    // side no-ops at the floor, the raise side sees a non-qualifying
    // window and resets the streak.
    expect(maybeDropRung(50)).toBe(false);
    expect(maybeRaiseRung(50, 1, RAISE_IDLE_MS * 10)).toBe(false);
    for (let i = 0; i < RAISE_WINDOWS - 1; i++) {
      expect(maybeRaiseRung(4)).toBe(false);
    }
    expect(autoRungLevel()).toBe("performance");
    expect(maybeRaiseRung(4)).toBe(true);
    expect(autoRungLevel()).toBe("balanced");
  });

  test("manual modes never climb", () => {
    fresh();
    resetAutoLadder();
    demoteToPerformance();
    setGraphicsMode("performance");
    for (let i = 0; i < RAISE_WINDOWS + 2; i++) expect(maybeRaiseRung(4)).toBe(false);
    expect(autoRungLevel()).toBe("performance");
  });

  test("the CHEAP path needs the over-budget share low, not just the mean", () => {
    fresh();
    resetAutoLadder();
    demoteToPerformance();
    // Mean looks vsync-fine, but a third of frames blow the budget —
    // a stuttery device, not a cheap one: no climb without idleness.
    for (let i = 0; i < RAISE_WINDOWS + 2; i++) {
      expect(maybeRaiseRung(16, RAISE_OVER_SHARE_MAX + 0.2, 0)).toBe(false);
    }
    expect(autoRungLevel()).toBe("performance");
  });

  test("the REST path: idle + coping (hitchy mean, low share) climbs", () => {
    fresh();
    resetAutoLadder();
    demoteToPerformance();
    // The measured QA-tablet rest profile: mean ~21ms (over the cheap
    // bar), share ~0.15 (under the rest bar), player idle past the gate.
    for (let i = 0; i < RAISE_WINDOWS - 1; i++) {
      expect(maybeRaiseRung(21, 0.15, RAISE_IDLE_MS + 5000)).toBe(false);
    }
    expect(maybeRaiseRung(21, 0.15, RAISE_IDLE_MS + 5000)).toBe(true);
    expect(autoRungLevel()).toBe("balanced");
  });

  test("the REST path refuses while the player is still interacting", () => {
    fresh();
    resetAutoLadder();
    demoteToPerformance();
    for (let i = 0; i < RAISE_WINDOWS + 2; i++) {
      expect(maybeRaiseRung(21, 0.15, RAISE_IDLE_MS - 1)).toBe(false);
    }
    expect(autoRungLevel()).toBe("performance");
  });

  test("the REST path refuses a device that is not coping at this rung", () => {
    fresh();
    resetAutoLadder();
    demoteToPerformance();
    // Idle forever, but most frames over budget — raising would drown it.
    for (let i = 0; i < RAISE_WINDOWS + 2; i++) {
      expect(maybeRaiseRung(RAISE_REST_AVG_MAX_MS, RAISE_REST_SHARE_MAX + 0.2, RAISE_IDLE_MS * 10)).toBe(false);
    }
    // And a mean beyond the rest bar refuses even with a clean share.
    for (let i = 0; i < RAISE_WINDOWS + 2; i++) {
      expect(maybeRaiseRung(RAISE_REST_AVG_MAX_MS + 10, 0.1, RAISE_IDLE_MS * 10)).toBe(false);
    }
    expect(autoRungLevel()).toBe("performance");
  });
});
