// TERRAIN DETAIL OVERLAYS — quality-gated live detail at Z3+
// (Seamless World spec §8, Phase 2 slice 13).
//
// The corruption GRADIENT is baked into tiles (slice 6); this module is the
// live detail the bake can't hold: drifting ash motes in blighted bands,
// heat shimmer + ember pulse in burnt bands, vegetation sway in verdant
// bands. The "sound is animation" equivalent for the eyes — the ground
// breathes.
//
// Pure + seeded: createOverlaySpec is deterministic per (seed, field, area);
// mote motion is a pure function of time, so the scene holds no per-frame
// state. The scene calls drawTerrainOverlays once per frame. Presentation
// only — never the sim.

import {
  corruptionAt,
  bandAt,
  type CorruptionBand,
  type CorruptionField,
} from "./corruption";
import {
  GRAPHICS_LADDER,
  resolveGraphicsLevel,
  type GraphicsLevel,
} from "../graphics-quality";

/** Live detail kind, driven by the corruption band at the mote's position. */
export type OverlayMoteKind = "ash" | "ember" | "sway" | "heat";

export interface OverlayMote {
  /** Base position in world coords (motion is a pure function of t). */
  x: number;
  y: number;
  kind: OverlayMoteKind;
  /** Radius (ash/ember/sway) or column base width (heat), world units. */
  size: number;
  /** 0..2π animation phase. */
  phase: number;
  /** Drift velocity, world units per second. */
  driftX: number;
  driftY: number;
  /** The corruption band this mote belongs to (for tests + tuning). */
  band: CorruptionBand;
}

export interface OverlaySpec {
  motes: OverlayMote[];
  field: CorruptionField;
  worldW: number;
  worldH: number;
  seed: number;
}

/** Which detail lives in which band (spec §8). */
export function kindForBand(band: CorruptionBand): OverlayMoteKind {
  switch (band) {
    case "verdant":
    case "fading":
      return "sway"; // living ground — vegetation sway, thinning in fading
    case "blighted":
    case "cracked":
      return "ash"; // vegetation is memory — ash drifts
    case "burnt":
      return "ember"; // the charred heart — embers (some become heat columns)
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OverlaySpecOptions {
  seed: number;
  worldW: number;
  worldH: number;
  /** The Chorus stronghold (world units) — corruption = 1 here. */
  strongholdX: number;
  strongholdY: number;
  /** World-unit distance from the stronghold to pure outskirts. */
  radius: number;
  /** Motes to place (default: the CINEMATIC budget; draw gates per rung). */
  count?: number;
}

/**
 * Build the overlay spec: seed motes across the world area, each classified
 * by the corruption band under it. Built once per battle; the draw call
 * gates how many actually render (quality ladder) and where the camera is.
 */
export function createOverlaySpec(opts: OverlaySpecOptions): OverlaySpec {
  const count = opts.count ?? 140;
  const rnd = mulberry32(opts.seed);
  const field: CorruptionField = {
    seed: opts.seed,
    strongholdX: opts.strongholdX,
    strongholdY: opts.strongholdY,
    radius: opts.radius,
  };
  const motes: OverlayMote[] = [];
  for (let i = 0; i < count; i++) {
    const x = rnd() * opts.worldW;
    const y = rnd() * opts.worldH;
    const band = bandAt(corruptionAt(x, y, field));
    let kind = kindForBand(band);
    if (band === "burnt" && rnd() < 0.3) kind = "heat";
    motes.push({
      x,
      y,
      kind,
      band,
      size:
        kind === "heat"
          ? 0.008 + rnd() * 0.008
          : kind === "ember"
            ? 0.006 + rnd() * 0.006
            : kind === "ash"
              ? 0.008 + rnd() * 0.008
              : 0.006 + rnd() * 0.005,
      phase: rnd() * Math.PI * 2,
      driftX: (rnd() - 0.5) * 0.05,
      // Embers rise; everything else hangs near the ground.
      driftY: (rnd() - 0.5) * 0.03 - (kind === "ember" ? 0.04 : 0),
    });
  }
  return { motes, field, worldW: opts.worldW, worldH: opts.worldH, seed: opts.seed };
}

// ---- pure motion math (seeded, testable) -----------------------------------

/** Vegetation sway — world units of lateral wobble at time t. */
export function swayOffset(phase: number, t: number): number {
  return Math.sin(phase + t * 1.4) * 0.03;
}

/** Ember pulse — 0..1 brightness cycle. */
export function emberPulse(phase: number, t: number): number {
  return 0.5 + 0.5 * Math.sin(phase + t * 3.2);
}

function wrap(v: number, max: number): number {
  return ((v % max) + max) % max;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Mote screen position + alpha at time t — pure, no stored state. */
export function motePosition(
  m: OverlayMote,
  t: number,
  worldW: number,
  worldH: number,
): { x: number; y: number; alpha: number } {
  const x = wrap(m.x + m.driftX * t, worldW);
  let y = wrap(m.y + m.driftY * t, worldH);
  let alpha: number;
  switch (m.kind) {
    case "ash":
      alpha = 0.5;
      break;
    case "ember":
      y += Math.sin(m.phase + t * 2.1) * 0.03;
      alpha = 0.35 + 0.65 * emberPulse(m.phase, t);
      break;
    case "sway":
      y += swayOffset(m.phase, t);
      alpha = 0.45;
      break;
    case "heat":
      alpha = 0.16 + 0.1 * Math.sin(m.phase + t * 5.1);
      break;
  }
  return { x, y, alpha: clamp01(alpha) };
}

// ---- quality + zoom gating -------------------------------------------------

/** Motes drawn per frame per rung (spec §9: all / reduced / off). */
export function overlayMoteBudget(level: GraphicsLevel): number {
  const g = GRAPHICS_LADDER[level].terrainOverlays;
  return g === "all" ? 140 : g === "reduced" ? 60 : 0;
}

/** Overlays render at close zoom only (Z3+ detail band). */
export function overlayVisibleAtZoom(zoom: number, fitZoom: number): boolean {
  return zoom >= fitZoom * 1.4;
}

// ---- scene draw (called once per frame, inside world space) -----------------

function drawMote(
  c: CanvasRenderingContext2D,
  m: OverlayMote,
  p: { x: number; y: number; alpha: number },
  night: number,
): void {
  switch (m.kind) {
    case "ash": {
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, m.size);
      g.addColorStop(0, `rgba(154,147,138,${(p.alpha * 0.5).toFixed(3)})`);
      g.addColorStop(1, "rgba(154,147,138,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(p.x, p.y, m.size, 0, Math.PI * 2);
      c.fill();
      break;
    }
    case "ember": {
      // Embers burn brighter at night — the burnt heart glows after dark.
      const a = p.alpha * (0.6 + 0.7 * Math.max(0, Math.min(1, night)));
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, m.size * 1.6);
      g.addColorStop(0, `rgba(255,190,110,${a.toFixed(3)})`);
      g.addColorStop(0.5, `rgba(255,110,40,${(a * 0.6).toFixed(3)})`);
      g.addColorStop(1, "rgba(255,80,30,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(p.x, p.y, m.size * 1.6, 0, Math.PI * 2);
      c.fill();
      break;
    }
    case "sway": {
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, m.size);
      g.addColorStop(0, `rgba(170,198,108,${(p.alpha * 0.6).toFixed(3)})`);
      g.addColorStop(1, "rgba(170,198,108,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(p.x, p.y, m.size, 0, Math.PI * 2);
      c.fill();
      break;
    }
    case "heat": {
      // Heat shimmer: a tall, thin, shimmering column — the cheap canvas
      // stand-in for distortion. Alpha breathes with the phase.
      const wdt = m.size * 0.35;
      const hgt = m.size * 6;
      const g = c.createLinearGradient(0, p.y, 0, p.y - hgt);
      g.addColorStop(0, `rgba(255,220,170,${p.alpha.toFixed(3)})`);
      g.addColorStop(1, "rgba(255,220,170,0)");
      c.fillStyle = g;
      c.fillRect(p.x - wdt / 2, p.y - hgt, wdt, hgt);
      break;
    }
  }
}

/**
 * Draw the live detail over the baked ground. The spec holds CINEMATIC
 * density; the rung decides how many motes render (PERFORMANCE → 0, baked
 * gradient only). The caller gates the Z3+ zoom band via
 * overlayVisibleAtZoom.
 */
export function drawTerrainOverlays(
  c: CanvasRenderingContext2D,
  spec: OverlaySpec,
  t: number,
  night: number,
): void {
  const n = overlayMoteBudget(resolveGraphicsLevel());
  if (n <= 0) return;
  c.save();
  const count = Math.min(n, spec.motes.length);
  for (let i = 0; i < count; i++) {
    const m = spec.motes[i];
    const p = motePosition(m, t, spec.worldW, spec.worldH);
    drawMote(c, m, p, night);
  }
  c.restore();
}
