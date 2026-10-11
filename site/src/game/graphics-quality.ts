// GRAPHICS QUALITY LADDER — Seamless World spec §9, Phase 2 slice 8.
//
// GRAPHICS = SURVIVAL: the game ships full fidelity by default and the ladder
// scales DOWN for weaker phones — it never caps everyone at the weakest
// device. The ladder changes pixels, never outcomes: sim fidelity, the
// battle clock, pace control, comms bubbles, scout outcomes, and G1–G5
// balance are untouched by every rung (spec §9).
//
// Persistence follows the existing globe pattern (`worldglobe.layers.v1`):
// localStorage, per device — a player's phone and tablet differ.

export type GraphicsLevel = "cinematic" | "balanced" | "performance";
export type GraphicsMode = GraphicsLevel | "auto";

export const GRAPHICS_LEVELS: readonly GraphicsLevel[] = [
  "cinematic",
  "balanced",
  "performance",
];
export const GRAPHICS_MODES: readonly GraphicsMode[] = [
  "auto",
  "cinematic",
  "balanced",
  "performance",
];

export interface GraphicsLadderEntry {
  /** Multiplier on spawned fx particles (explosions/dust/sparks). */
  particleBudget: number;
  /** Explosion rendering richness. */
  explosionLayers: "full" | "standard" | "composite";
  /** Dynamic light bloom. */
  bloom: "terrain-units" | "units" | "off";
  /** Terrain detail overlays (ash motes / ember pulse / vegetation sway). */
  terrainOverlays: "all" | "reduced" | "off";
  shadows: "soft" | "simple" | "off";
  /** DPR ceiling — the renderer takes min(dprCap, device DPR). */
  dprCap: number;
  /** Screen shake amplitude. */
  shake: "full" | "reduced" | "minimal";
  /** Orbit dust-cloud churn. */
  orbitDust: "animated" | "fewer" | "static";
}

/** The ladder table (spec §9). CINEMATIC is the default full-fidelity rung. */
export const GRAPHICS_LADDER: Record<GraphicsLevel, GraphicsLadderEntry> = {
  cinematic: {
    particleBudget: 1,
    explosionLayers: "full",
    bloom: "terrain-units",
    terrainOverlays: "all",
    shadows: "soft",
    dprCap: 2,
    shake: "full",
    orbitDust: "animated",
  },
  balanced: {
    particleBudget: 0.45,
    explosionLayers: "standard",
    bloom: "units",
    terrainOverlays: "reduced",
    shadows: "simple",
    dprCap: 1.5,
    shake: "reduced",
    orbitDust: "fewer",
  },
  performance: {
    particleBudget: 0.15,
    explosionLayers: "composite",
    bloom: "off",
    terrainOverlays: "off",
    shadows: "off",
    dprCap: 1,
    shake: "minimal",
    orbitDust: "static",
  },
};

/** localStorage key — same naming shape as `worldglobe.layers.v1`. */
const STORE_KEY = "graphics.quality.v1";

function isMode(v: unknown): v is GraphicsMode {
  return typeof v === "string" && (GRAPHICS_MODES as readonly string[]).includes(v);
}

function readStore(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null; // private mode → default
  }
}

/** The player's chosen mode, defaulting to "auto". Corrupt values → "auto". */
export function getGraphicsMode(): GraphicsMode {
  const raw = readStore();
  return isMode(raw) ? raw : "auto";
}

const listeners = new Set<() => void>();
function emit(): void {
  for (const fn of listeners) fn();
}

/** Re-render hook for settings UI. */
export function subscribeGraphicsMode(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Keeps the honest CSS weight rule alive under the new ladder:
 * `html[data-quality="reduced"]` kills backdrop blur / CSS animations (see
 * styles/app.css), which is exactly what PERFORMANCE wants for the DOM.
 */
function syncDocumentAttrs(level: GraphicsLevel): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(
    "data-quality",
    level === "performance" ? "reduced" : "full",
  );
}

/** Persist the mode (per device) and notify subscribers. */
export function setGraphicsMode(mode: GraphicsMode): void {
  if (!isMode(mode)) return;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORE_KEY, mode);
  } catch {
    /* private mode — the choice just doesn't persist */
  }
  syncDocumentAttrs(mode === "auto" ? autoRung : mode);
  emit();
}

// ---- AUTO rung state -------------------------------------------------------

/** Sustained-frame-time budget before AUTO calls a frame "over budget". */
export const FRAME_BUDGET_MS = 20;
/** Consecutive over-budget rolling windows before AUTO drops one rung. */
export const OVER_BUDGET_WINDOWS = 3;

let autoRung: GraphicsLevel = "cinematic";
let overBudgetStreak = 0;

/** AUTO's current rung (starts at CINEMATIC every session — spec §9). */
export function autoRungLevel(): GraphicsLevel {
  return autoRung;
}

/** Test / session door: drop AUTO back to CINEMATIC with a clean streak. */
export function resetAutoLadder(): void {
  autoRung = "cinematic";
  overBudgetStreak = 0;
}

/**
 * The effective rung: the manual choice, or AUTO's current rung.
 * This is what every consumer reads — never branch on the raw mode.
 */
export function resolveGraphicsLevel(): GraphicsLevel {
  const mode = getGraphicsMode();
  return mode === "auto" ? autoRung : mode;
}

/** Particle-budget multiplier for the fx spawn path (spec §9's first slice). */
export function particleBudgetMultiplier(level: GraphicsLevel = resolveGraphicsLevel()): number {
  return GRAPHICS_LADDER[level].particleBudget;
}

/** DPR ceiling for a rung given the device's DPR. */
export function effectiveDpr(
  deviceDpr: number,
  level: GraphicsLevel = resolveGraphicsLevel(),
): number {
  return Math.min(GRAPHICS_LADDER[level].dprCap, Math.max(1, deviceDpr));
}

/**
 * AUTO logic: feed it the rolling-window average frame time. On sustained
 * over-budget frames it drops exactly one rung and returns true — the toast
 * UI (later slice) fires on that true. Manual modes never move; PERFORMANCE
 * is the floor. Never silently degrades twice without a tell: the caller
 * owns the toast, this function just reports the decision.
 */
export function maybeDropRung(avgFrameMs: number): boolean {
  if (getGraphicsMode() !== "auto") return false;
  if (autoRung === "performance") {
    overBudgetStreak = 0;
    return false;
  }
  if (avgFrameMs > FRAME_BUDGET_MS) {
    overBudgetStreak += 1;
    if (overBudgetStreak >= OVER_BUDGET_WINDOWS) {
      autoRung = GRAPHICS_LEVELS[GRAPHICS_LEVELS.indexOf(autoRung) + 1];
      overBudgetStreak = 0;
      return true;
    }
    return false;
  }
  overBudgetStreak = 0;
  return false;
}
