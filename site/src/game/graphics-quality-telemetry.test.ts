// Tests for game/graphics-quality-telemetry.ts — the rolling-window
// frame-time sampler feeding AUTO's rung decisions (spec §9, slice 14).
//
// NOTE: bun:test type stubs here only declare toBe / toBeGreaterThan /
// toBeLessThan / toEqual / toBeDefined / toBeCloseTo / toHaveLength / toMatch.
//
// Run: bun test src/game/graphics-quality-telemetry.test.ts
import { describe, test, expect } from "bun:test";
import {
  FRAME_SAMPLE_MAX_MS,
  FRAME_WINDOW,
  autoLadderTick,
  frameOverBudgetShare,
  frameSampleCount,
  frameTimeAvg,
  recordFrameTime,
  resetFrameTelemetry,
} from "./graphics-quality-telemetry";
import {
  autoRungLevel,
  getGraphicsMode,
  resetAutoLadder,
  setGraphicsMode,
} from "./graphics-quality";

// This bun test runtime has no localStorage — shim it in-memory so the
// mode reads in autoLadderTick exercise the real path.
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

function fresh(): void {
  memStore.clear();
  resetAutoLadder();
  resetFrameTelemetry();
}

describe("recordFrameTime / frameTimeAvg (rolling window)", () => {
  test("empty sampler averages to 0 — never a NaN", () => {
    fresh();
    expect(frameSampleCount()).toBe(0);
    expect(frameTimeAvg()).toBe(0);
  });

  test("averages the samples fed", () => {
    fresh();
    recordFrameTime(10);
    recordFrameTime(20);
    recordFrameTime(30);
    expect(frameSampleCount()).toBe(3);
    expect(frameTimeAvg()).toBeCloseTo(20, 6);
  });

  test("the window rolls: old samples evict, the average tracks the recent", () => {
    fresh();
    for (let i = 0; i < FRAME_WINDOW; i++) recordFrameTime(10);
    expect(frameSampleCount()).toBe(FRAME_WINDOW);
    expect(frameTimeAvg()).toBeCloseTo(10, 6);
    // push a full window of slow frames — the fast history must be gone
    for (let i = 0; i < FRAME_WINDOW; i++) recordFrameTime(50);
    expect(frameSampleCount()).toBe(FRAME_WINDOW);
    expect(frameTimeAvg()).toBeCloseTo(50, 6);
  });

  test("clamps one giant stall (background tab) so it can't fake sustained slowness", () => {
    fresh();
    recordFrameTime(16.6);
    recordFrameTime(16.6);
    recordFrameTime(10_000); // a 10s background gap
    expect(frameTimeAvg()).toBeLessThan(FRAME_SAMPLE_MAX_MS);
    expect(frameTimeAvg()).toBeCloseTo((16.6 + 16.6 + FRAME_SAMPLE_MAX_MS) / 3, 4);
  });

  test("ignores NaN / Infinity; negatives clamp to 0", () => {
    fresh();
    recordFrameTime(Number.NaN);
    recordFrameTime(Number.POSITIVE_INFINITY);
    recordFrameTime(-5);
    expect(frameSampleCount()).toBe(1); // the negative clamped to 0
    expect(frameTimeAvg()).toBe(0);
  });

  test("reset empties the window", () => {
    fresh();
    recordFrameTime(42);
    resetFrameTelemetry();
    expect(frameSampleCount()).toBe(0);
    expect(frameTimeAvg()).toBe(0);
  });

  test("frameOverBudgetShare tracks the over-budget fraction, evictions included", () => {
    fresh();
    expect(frameOverBudgetShare()).toBe(0);
    for (let i = 0; i < FRAME_WINDOW; i++) recordFrameTime(i < 45 ? 30 : 10); // half over 20ms
    expect(frameOverBudgetShare()).toBeCloseTo(0.5, 6);
    // Evict the whole window with cheap frames — the share must follow.
    for (let i = 0; i < FRAME_WINDOW; i++) recordFrameTime(10);
    expect(frameOverBudgetShare()).toBe(0);
    resetFrameTelemetry();
    expect(frameOverBudgetShare()).toBe(0);
  });
});

describe("autoLadderTick — the AUTO decision driven from the sampler", () => {
  test("sustained slow frames drop one rung, reporting true", () => {
    fresh();
    setGraphicsMode("auto");
    // three ticks over a slow rolling average = the 3-window rule firing
    for (let i = 0; i < FRAME_WINDOW; i++) recordFrameTime(50);
    expect(autoLadderTick()).toBe(false);
    expect(autoLadderTick()).toBe(false);
    expect(autoLadderTick()).toBe(true);
    expect(autoRungLevel()).toBe("balanced");
  });

  test("fast frames never drop — the streak never builds", () => {
    fresh();
    setGraphicsMode("auto");
    for (let i = 0; i < FRAME_WINDOW; i++) recordFrameTime(12);
    for (let i = 0; i < 6; i++) expect(autoLadderTick()).toBe(false);
    expect(autoRungLevel()).toBe("cinematic");
  });

  test("manual modes never move, however slow the sampler reads", () => {
    fresh();
    setGraphicsMode("cinematic");
    for (let i = 0; i < FRAME_WINDOW; i++) recordFrameTime(100);
    for (let i = 0; i < 6; i++) expect(autoLadderTick()).toBe(false);
    expect(autoRungLevel()).toBe("cinematic");
    expect(getGraphicsMode()).toBe("cinematic");
  });

  test("climb-back: demoted rung returns after sustained cheap ticks", () => {
    fresh();
    setGraphicsMode("auto");
    for (let i = 0; i < FRAME_WINDOW; i++) recordFrameTime(100);
    for (let i = 0; i < 3; i++) autoLadderTick();
    expect(autoRungLevel()).toBe("balanced");
    // Flush the window with vsync-rate frames, then tick the climb out.
    resetFrameTelemetry();
    for (let i = 0; i < FRAME_WINDOW; i++) recordFrameTime(16);
    let climbed = false;
    for (let i = 0; i < 8 && !climbed; i++) climbed = autoLadderTick();
    expect(climbed).toBe(true);
    expect(autoRungLevel()).toBe("cinematic");
  });

  test("climb-back REST path: the floor escapes at idle; active touching never climbs", () => {
    fresh();
    setGraphicsMode("auto");
    for (let i = 0; i < FRAME_WINDOW; i++) recordFrameTime(100);
    for (let i = 0; i < 6; i++) autoLadderTick();
    expect(autoRungLevel()).toBe("performance");
    // The measured rest profile: mean ~21ms, ~15% over budget.
    resetFrameTelemetry();
    for (let i = 0; i < FRAME_WINDOW; i++) recordFrameTime(i % 20 < 3 ? 33 : 19);
    for (let i = 0; i < 8; i++) expect(autoLadderTick(0)).toBe(false); // still touching
    expect(autoRungLevel()).toBe("performance");
    let climbed = false;
    for (let i = 0; i < 8 && !climbed; i++) climbed = autoLadderTick(30_000); // idle 30s
    expect(climbed).toBe(true);
    expect(autoRungLevel()).toBe("balanced");
    // Settle contract: at BALANCED this mean is over the drop budget, so
    // the shipped drop rule pulls it back within 3 ticks — the ladder
    // settles at the highest rung whose mean holds, it does not yo-yo
    // upward past the evidence.
    let dropped = false;
    for (let i = 0; i < 4 && !dropped; i++) dropped = autoLadderTick(30_000);
    expect(dropped).toBe(true);
    expect(autoRungLevel()).toBe("performance");
  });
});
