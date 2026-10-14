// Run-time bands (owner ruling 2026-10-14): expedition duration scales
// with DISTANCE — backyard sites run ~10–15 minutes ("dump ships, not
// horse and buggy"), the hardest tier tops out inside a 3–5 h ceiling,
// and the demand ladder (RUNG_TIMER_MS) is untouched. Plus the one-shot
// migration that re-bases expeditions still out onto the bands.
// Run: bun test site/src/game/run-time.test.ts
import { describe, expect, test } from "bun:test";
import { ZONES, RUN_TIMER_BANDS, runTimerMs, runTimerMsForRange, rungOfZone, rungTimerMs } from "./zones";
import { migrateTimersToRunTime } from "./engine";
import type { GameState } from "./types";

const MIN = 60_000;

describe("run-time bands — duration scales with distance", () => {
  test("the backyard tier (Outer Ruins) runs 10–15 minutes", () => {
    const outer = ZONES.find((z) => z.id === "outer-ruins")!;
    const ms = runTimerMs(outer);
    expect(ms >= 10 * MIN).toBe(true);
    expect(ms <= 15 * MIN).toBe(true);
  });

  test("nothing in the game exceeds the ceiling; the hardest tier is 3–5 h", () => {
    const all = ZONES.map((z) => runTimerMs(z));
    const max = Math.max(...all);
    expect(max <= 5 * 60 * MIN).toBe(true);
    expect(max >= 3 * 60 * MIN).toBe(true);
    for (const ms of all) expect(ms <= max).toBe(true);
  });

  test("farther (higher range) never runs shorter", () => {
    const byRange = [...ZONES].sort((a, b) => a.range - b.range);
    for (let i = 1; i < byRange.length; i++) {
      expect(runTimerMs(byRange[i]) >= runTimerMs(byRange[i - 1])).toBe(true);
    }
  });

  test("bands climb and clamp at the ceiling", () => {
    for (let i = 1; i < RUN_TIMER_BANDS.length; i++) {
      expect(RUN_TIMER_BANDS[i].ms).toBeGreaterThan(RUN_TIMER_BANDS[i - 1].ms);
      expect(RUN_TIMER_BANDS[i].maxRange).toBeGreaterThan(RUN_TIMER_BANDS[i - 1].maxRange);
    }
    expect(runTimerMsForRange(10_000)).toBe(RUN_TIMER_BANDS[RUN_TIMER_BANDS.length - 1].ms);
    expect(runTimerMsForRange(0)).toBe(RUN_TIMER_BANDS[0].ms);
  });

  test("the demand ladder is untouched by the rescale", () => {
    // Rungs still price demand (rungEntryDemand); only the run clock moved.
    for (const z of ZONES) expect(z.baseDurationMs).toBe(rungTimerMs(rungOfZone(z.id)));
  });
});

describe("migrateTimersToRunTime — in-flight runs re-base onto the bands", () => {
  const fakeState = (durationMs: number, zoneId = "outer-ruins", startedAt = 1_000) =>
    ({
      expeditions: [
        { id: "exp-1", zoneId, label: "t", assignedScientists: 1, status: "out", startedAt, durationMs },
      ],
    }) as unknown as GameState;

  test("a ladder-priced run is re-based proportionally, progress kept", () => {
    const st = fakeState(rungTimerMs(0)); // a full 4 h ladder timer
    migrateTimersToRunTime(st, 5_000);
    const e = st.expeditions[0];
    expect(e.durationMs).toBe(runTimerMs(ZONES[0])); // → the 12-minute band
    expect(e.startedAt).toBe(1_000); // elapsed counts in full (downscale)
    expect(st.timerRebaseRunTime).toBe(1);
  });

  test("once-only: a second pass changes nothing", () => {
    const st = fakeState(rungTimerMs(0));
    migrateTimersToRunTime(st, 5_000);
    const after = st.expeditions[0].durationMs;
    migrateTimersToRunTime(st, 9_000);
    expect(st.expeditions[0].durationMs).toBe(after);
  });

  test("landed runs and unknown zones are left alone", () => {
    const st = fakeState(123_456, "no-such-zone");
    (st.expeditions[0] as { status: string }).status = "out";
    migrateTimersToRunTime(st, 5_000);
    expect(st.expeditions[0].durationMs).toBe(123_456);
  });
});
