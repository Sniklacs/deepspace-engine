// FRAME-TIME TELEMETRY — Seamless World spec §9, Phase 2 slice 14 (polish).
//
// A tiny rolling-window frame-time sampler. The BattleScene / WorldGlobe
// frame loops feed it via recordFrameTime(ms) — one cheap ring-buffer write
// per frame. The AUTO quality decision (maybeDropRung) is driven from it via
// autoLadderTick(), so the "sustained over-budget windows" AUTO counts are
// real measured windows, not caller estimates.
//
// No I/O, no DOM, no Date.now(). The sampler is a module singleton so any
// frame loop can feed it without prop plumbing; resetFrameTelemetry() is
// the test/session door. The toast on a rung drop stays caller-owned —
// autoLadderTick() just reports the decision (true = a rung dropped).

import { maybeDropRung } from "./graphics-quality";

/** Rolling window: 90 frames ≈ 1.5s at 60fps — one AUTO "window" of evidence. */
export const FRAME_WINDOW = 90;
/** Clamp: a backgrounded tab can deliver one giant rAF gap. A single stall
 *  must not masquerade as sustained slowness, so samples cap here. */
export const FRAME_SAMPLE_MAX_MS = 250;

const samples = new Float64Array(FRAME_WINDOW);
let count = 0; // live samples in the window (≤ FRAME_WINDOW)
let head = 0; // next write index
let sum = 0; // sum of the live window — the average is O(1)

/** Feed one frame's wall-clock time (ms). Pure-ish: mutates only the
 *  module's ring buffer. Outliers clamp at FRAME_SAMPLE_MAX_MS. */
export function recordFrameTime(ms: number): void {
  if (!Number.isFinite(ms)) return;
  const v = Math.min(FRAME_SAMPLE_MAX_MS, Math.max(0, ms));
  if (count === FRAME_WINDOW) {
    sum -= samples[head]; // evict the oldest before overwriting
  } else {
    count += 1;
  }
  samples[head] = v;
  sum += v;
  head = (head + 1) % FRAME_WINDOW;
}

/** Rolling-window average frame time (ms). 0 when nothing is recorded. */
export function frameTimeAvg(): number {
  return count === 0 ? 0 : sum / count;
}

/** How many samples the live window currently holds. */
export function frameSampleCount(): number {
  return count;
}

/** Test / session door: empty the window. */
export function resetFrameTelemetry(): void {
  count = 0;
  head = 0;
  sum = 0;
  samples.fill(0);
}

/**
 * One AUTO decision driven from the live rolling average — feeds
 * frameTimeAvg() into maybeDropRung (3 consecutive over-budget windows to
 * drop, PERFORMANCE floor, manual modes never move). The caller owns the
 * toast: true means a rung just dropped and the player must be told.
 */
export function autoLadderTick(): boolean {
  return maybeDropRung(frameTimeAvg());
}
