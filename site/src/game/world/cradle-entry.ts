// cradle-entry.ts — CRADLE ENTRY STATE MACHINE (Phase 2, slice 10).
//
// The tap → focus → hover → descend → inside → ascend flow for entering the
// Cradle from the globe (spec §4, normative contract §10):
//
//   FREE → FOCUSING → HOVERING → DESCENDING → INSIDE ⇄ ASCENDING → FREE
//
// Pure kernel: no I/O, no DOM, no Date.now() inside. WorldGlobe.tsx wires
// gestures and the camera to it; the machine only decides. The module
// overlay (slice 11) rides as orthogonal state — ENTER_MODULE/CLOSE_MODULE
// only ever fire in INSIDE, and the world canvas never unmounts for them.
//
// The one hard rule of the whole spec holds here by construction: this
// module cannot unmount anything — it returns state, never touches the DOM.

import { BAND_Z2, BAND_Z4 } from "./zoom-bands";

// ---------------------------------------------------------------------------
// States & events
// ---------------------------------------------------------------------------

/** The Cradle entry states (spec §10). */
export type CradleEntryState =
  | "FREE" // normal globe/map camera; the Cradle marker is tappable
  | "FOCUSING" // tap → the existing GlobeFocusTarget ease centers the Cradle
  | "HOVERING" // centered at the Z1/Z2 boundary; spread to enter, pan away to cancel
  | "DESCENDING" // pinch-in drives z continuously through Z2→Z3→Z4
  | "INSIDE" // the Cradle interior (the Z4 ground band at the Cradle)
  | "ASCENDING"; // pinch-out reverses; FREE again past the Z1/Z2 boundary

/** Module ids openable as overlays from INSIDE (slice 11). The id doubles
 *  as the ?module= URL param, so it must stay URL-safe. */
export const CRADLE_MODULES = [
  "troops",
  "forge",
  "laboratory",
  "loadout",
  "alliance",
  "warroom",
] as const;
export type CradleModuleId = (typeof CRADLE_MODULES)[number];

/** Guard for ENTER_MODULE payloads — unknown ids are ignored, never crash. */
export function isCradleModuleId(v: string): v is CradleModuleId {
  return (CRADLE_MODULES as readonly string[]).includes(v);
}

export type CradleEntryEvent =
  | { type: "TAP_CRADLE" } // tap the Cradle's home-layer marker / the "Enter Cradle" button
  | { type: "EASE_DONE" } // the centering ease completed
  | { type: "SPREAD" } // pinch-out→in… spread/pinch-in: zoom toward the ground
  | { type: "PINCH_OUT" } // pinch-out: zoom away from the ground
  | { type: "PAN_AWAY" } // drag past the hover anchor threshold
  | { type: "TAP_ELSEWHERE" } // tap a non-Cradle target / explicit cancel
  | { type: "ENTER_MODULE"; module: string } // tap a building inside INSIDE
  | { type: "CLOSE_MODULE" }; // close the module overlay

export interface CradleEntryContext {
  entry: CradleEntryState;
  /** Open module overlay (slice 11) — only meaningful in INSIDE. */
  module: CradleModuleId | null;
}

export const CRADLE_ENTRY_INITIAL: CradleEntryContext = { entry: "FREE", module: null };

// ---------------------------------------------------------------------------
// Transition function — the normative contract. Returns the SAME context
// object when the event is a no-op, so callers can compare by reference.
// ---------------------------------------------------------------------------

export function transition(ctx: CradleEntryContext, event: CradleEntryEvent): CradleEntryContext {
  const { entry, module } = ctx;
  switch (entry) {
    case "FREE":
      // The gesture fast path starts here. The Z1 detail sheet still opens
      // alongside (it is the fallback for players who never spread).
      if (event.type === "TAP_CRADLE") return { entry: "FOCUSING", module: null };
      return ctx;

    case "FOCUSING":
      switch (event.type) {
        case "TAP_CRADLE": // tap the centered Cradle again — same as ease done
        case "EASE_DONE":
          return { entry: "HOVERING", module: null };
        case "SPREAD": // eager: skip the rest of the ease, dive straight in
          return { entry: "DESCENDING", module: null };
        case "PAN_AWAY":
        case "TAP_ELSEWHERE":
        case "PINCH_OUT": // any of these cancel the pending focus
          return { entry: "FREE", module: null };
        default:
          return ctx;
      }

    case "HOVERING":
      switch (event.type) {
        case "SPREAD":
        case "TAP_CRADLE": // tap = the enter gesture's button-equivalent at the marker
          return { entry: "DESCENDING", module: null };
        case "PINCH_OUT":
        case "PAN_AWAY":
        case "TAP_ELSEWHERE":
          return { entry: "FREE", module: null };
        default:
          return ctx; // EASE_DONE here is a harmless no-op
      }

    case "DESCENDING":
      switch (event.type) {
        case "PINCH_OUT": // reverse mid-descent — symmetric with the way in
          return { entry: "ASCENDING", module: null };
        default:
          // A pan re-targets the region view; a spread keeps driving z.
          // Neither cancels a committed descent — pinch-out is the reverse.
          return ctx;
      }

    case "INSIDE":
      switch (event.type) {
        case "PINCH_OUT":
          return { entry: "ASCENDING", module: null };
        case "ENTER_MODULE":
          if (!isCradleModuleId(event.module) || module === event.module) return ctx;
          return { entry, module: event.module };
        case "CLOSE_MODULE":
          return module === null ? ctx : { entry, module: null };
        default:
          return ctx;
      }

    case "ASCENDING":
      switch (event.type) {
        case "SPREAD":
        case "TAP_CRADLE": // change of mind — dive back in
          return { entry: "DESCENDING", module: null };
        default:
          return ctx; // PINCH_OUT keeps ascending; the z-guard lands FREE
      }
  }
}

// ---------------------------------------------------------------------------
// z-coherence — the camera is the truth. Programmatic zooms (zoom buttons,
// recenter, deep links) move the camera without gestures; these guards keep
// the machine agreeing with the camera so nobody strands between bands.
// Gesture events remain the primary driver; the guards are the backstop.
// ---------------------------------------------------------------------------

export function syncWithZoom(ctx: CradleEntryContext, z: number): CradleEntryContext {
  if (!Number.isFinite(z)) return ctx;
  const { entry } = ctx;
  if (entry === "DESCENDING") {
    if (z >= BAND_Z4) return { entry: "INSIDE", module: null };
    if (z < BAND_Z2) return { entry: "HOVERING", module: null };
    return ctx;
  }
  if (entry === "ASCENDING") {
    if (z < BAND_Z2) return { entry: "FREE", module: null };
    if (z >= BAND_Z4) return { entry: "INSIDE", module: null };
    return ctx;
  }
  // INSIDE means "at the ground" — if the camera left the ground without a
  // pinch gesture (recenter button, programmatic zoom), follow it out. A
  // module overlay cannot outlive the ground it is pinned to.
  if (entry === "INSIDE" && z < BAND_Z4) return { entry: "ASCENDING", module: null };
  return ctx;
}

// ---------------------------------------------------------------------------
// Background/foreground recovery — mid-transition restores to the nearest
// stable band (spec §10: "State is recoverable"). Stable = FREE, HOVERING,
// INSIDE. A module overlay survives only when we settle back at the ground.
// ---------------------------------------------------------------------------

export function recoverFromBackground(ctx: CradleEntryContext, z: number): CradleEntryContext {
  // z-coherence first: the camera may have moved while we were away, and
  // the guards already know how each state follows it.
  const coherent = syncWithZoom(ctx, z);
  const { entry, module } = coherent;
  if (entry === "FREE" || entry === "HOVERING" || entry === "INSIDE") return coherent;
  if (!Number.isFinite(z)) return { entry: "FREE", module: null };
  if (z >= BAND_Z4) return { entry: "INSIDE", module };
  if (z >= BAND_Z2) return { entry: "HOVERING", module: null };
  return { entry: "FREE", module: null };
}

// ---------------------------------------------------------------------------
// Pan-away detection — HOVERING breaks when the camera drifts off its anchor
// past a threshold (spec §10: "pan away beyond threshold").
// ---------------------------------------------------------------------------

/** Angular drift that breaks the HOVERING hold. */
export const HOVER_PAN_AWAY_DEG = 6;

function wrapDelta180(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x < -180) x += 360;
  return x;
}

/** True once the camera has drifted off the hover anchor — the HOVERING
 *  hold breaks and the machine falls back to FREE. Pure. */
export function panBreaksHover(
  anchorSpin: number,
  anchorTilt: number,
  spin: number,
  tilt: number,
): boolean {
  return (
    Math.abs(wrapDelta180(spin - anchorSpin)) > HOVER_PAN_AWAY_DEG ||
    Math.abs(tilt - anchorTilt) > HOVER_PAN_AWAY_DEG
  );
}

// ---------------------------------------------------------------------------
// The one-time "spread to enter" hint (spec §4/§10: max 3 lifetime shows,
// then never — Hans: no tutorial needed, the feel is the teacher).
// Persistence is localStorage; the store is injected so this stays pure
// and testable (the component passes localStorage, tests pass a fake).
// ---------------------------------------------------------------------------

export const SPREAD_HINT_KEY = "cradle.spreadHint.v1";
/** The hint shows at most this many times, ever, then never again. */
export const SPREAD_HINT_MAX = 3;

export interface HintStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Lifetime hint shows so far. Corrupt/missing → 0, never throws. */
export function spreadHintCount(store: HintStore): number {
  try {
    const raw = store.getItem(SPREAD_HINT_KEY);
    if (raw === null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Whether the hint may show for the given lifetime count. */
export function shouldShowSpreadHint(count: number): boolean {
  return count < SPREAD_HINT_MAX;
}

/** Record one hint show. Returns the new lifetime count. Never throws. */
export function recordSpreadHint(store: HintStore): number {
  const next = spreadHintCount(store) + 1;
  try {
    store.setItem(SPREAD_HINT_KEY, String(next));
  } catch {
    /* private mode — the count is lost, the game is not */
  }
  return next;
}
