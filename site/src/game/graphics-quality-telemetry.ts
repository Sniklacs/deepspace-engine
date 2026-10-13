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
// autoLadderTick() just reports the decision (true = the rung changed).

import { FRAME_BUDGET_MS, maybeDropRung, maybeRaiseRung } from "./graphics-quality";

/** Rolling window: 90 frames ≈ 1.5s at 60fps — one AUTO "window" of evidence. */
export const FRAME_WINDOW = 90;
/** Clamp: a backgrounded tab can deliver one giant rAF gap. A single stall
 *  must not masquerade as sustained slowness, so samples cap here. */
export const FRAME_SAMPLE_MAX_MS = 250;

const samples = new Float64Array(FRAME_WINDOW);
let count = 0; // live samples in the window (≤ FRAME_WINDOW)
let head = 0; // next write index
let sum = 0; // sum of the live window — the average is O(1)
let over = 0; // live samples over the frame budget — the share is O(1)

/** Feed one frame's wall-clock time (ms). Pure-ish: mutates only the
 *  module's ring buffer. Outliers clamp at FRAME_SAMPLE_MAX_MS. */
export function recordFrameTime(ms: number): void {
  if (!Number.isFinite(ms)) return;
  const v = Math.min(FRAME_SAMPLE_MAX_MS, Math.max(0, ms));
  if (count === FRAME_WINDOW) {
    sum -= samples[head]; // evict the oldest before overwriting
    if (samples[head] > FRAME_BUDGET_MS) over -= 1;
  } else {
    count += 1;
  }
  samples[head] = v;
  sum += v;
  if (v > FRAME_BUDGET_MS) over += 1;
  head = (head + 1) % FRAME_WINDOW;
}

/** Rolling-window average frame time (ms). 0 when nothing is recorded. */
export function frameTimeAvg(): number {
  return count === 0 ? 0 : sum / count;
}

/** Share (0..1) of live window frames that exceeded the frame budget.
 *  The climb-back's REST path reads this: a coping device shows a
 *  vsync median with a hitch-dragged mean, which only the share sees. */
export function frameOverBudgetShare(): number {
  return count === 0 ? 0 : over / count;
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
  over = 0;
  samples.fill(0);
}

/**
 * One AUTO decision driven from the live rolling average — feeds
 * frameTimeAvg() into maybeDropRung (3 consecutive over-budget windows to
 * drop, PERFORMANCE floor, manual modes never move) and, when no drop
 * fires, into maybeRaiseRung (the Oct 13 2026 climb-back: sustained cheap
 * frames — or a sustained idle rest on a coping device — raise one rung
 * toward CINEMATIC, so a storm-earned demotion is not a session-long
 * blur sentence). `idleMs` is the caller's time since last interaction.
 * True means the rung CHANGED — the caller resizes (and owns any toast).
 */
export function autoLadderTick(idleMs = 0): boolean {
  const avg = frameTimeAvg();
  if (maybeDropRung(avg)) return true;
  return maybeRaiseRung(avg, frameOverBudgetShare(), idleMs);
}
