// CORRUPTION GRADIENT — the Chorus's corruption, visible in the ground
// (Seamless World spec §8, Phase 2 slice 6).
//
// Pure + seeded: corruptionAt(x, y) is deterministic per battle seed, so the
// tile baker and the live renderer always agree on what the ground looks like.
//
// PRESENTATION ONLY. The gradient never feeds the sim — cover still comes
// from coverAt (a burnt rock still gives cover), and G1–G5 grades are
// untouched. The art must never imply a mechanical effect the engine
// doesn't have.

/** Clamp to 0..1. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The five visual bands, outskirts → stronghold (spec §8). */
export type CorruptionBand = "verdant" | "fading" | "blighted" | "cracked" | "burnt";

export const CORRUPTION_BANDS: readonly CorruptionBand[] = [
  "verdant",
  "fading",
  "blighted",
  "cracked",
  "burnt",
];

/**
 * Upper corruption stops of the bands (tunable). Band i covers
 * (stops[i-1], stops[i]] — verdant is 0–0.25, …, burnt is 0.85–1.0.
 * Stops are crossfade centers for the renderer (bandWeights), not hard lines.
 */
export const CORRUPTION_STOPS: Record<"verdant" | "fading" | "blighted" | "cracked", number> = {
  verdant: 0.25,
  fading: 0.45,
  blighted: 0.65,
  cracked: 0.85,
};

export interface CorruptionField {
  /** Battle seed — the corruption's fingerprint for this fight. */
  seed: number;
  /** The Chorus stronghold position (world units). Corruption = 1 here. */
  strongholdX: number;
  strongholdY: number;
  /** World-unit distance from the stronghold to pure outskirts (corruption 0). */
  radius: number;
  /**
   * How far the band edges wander, as a fraction of `radius`.
   * Default 0.22 — ragged, organic, never a perfect circle.
   */
  raggedness?: number;
  /** Noise features per radius — higher = more lobes on the ragged edge. */
  noiseScale?: number;
}

/** Per-band palette (tunable export). Swatches are hex strings. */
export interface CorruptionSwatch {
  /** Ground base color. */
  ground: string;
  /** Vegetation / canopy tint — living in verdant, a memory in blighted. */
  flora: string;
  /** Accent: dead snags, crack networks, ember glow. */
  accent: string;
  /** Ambient light tint cast onto units standing in this band. */
  light: string;
}

export const CORRUPTION_PALETTE: Record<CorruptionBand, CorruptionSwatch> = {
  verdant: { ground: "#2f6b2e", flora: "#3f8f3a", accent: "#6fae4f", light: "#bfe6a8" },
  fading: { ground: "#5c6234", flora: "#7a7a3f", accent: "#a3915b", light: "#d8cf9a" },
  blighted: { ground: "#5a5347", flora: "#6b6250", accent: "#8a7f68", light: "#c4b89e" },
  cracked: { ground: "#4a3a2c", flora: "#54432f", accent: "#ff6a2a", light: "#e8a06a" },
  burnt: { ground: "#1e1410", flora: "#2b1d16", accent: "#ff3d1f", light: "#ff7a4d" },
};

// ---- deterministic 2D value noise (no Math.random — pure per seed) --------

function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 974711) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in 0..1, deterministic for (x, y, seed). */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// ---- the gradient ----------------------------------------------------------

/**
 * Corruption at a world point: 1 at the stronghold → 0 at the outskirts,
 * radial with seeded noise perturbation so the band edges are ragged.
 *
 * The perturbation is scaled by distance from the stronghold — the heart is
 * pure burnt, the wobble grows outward. Deterministic per seed: same field,
 * same answer, every call, every bake.
 */
export function corruptionAt(x: number, y: number, field: CorruptionField): number {
  const radius = Math.max(field.radius, 1e-6);
  const raggedness = field.raggedness ?? 0.22;
  const scale = (field.noiseScale ?? 2.5) / radius;

  const dx = x - field.strongholdX;
  const dy = y - field.strongholdY;
  const dist = Math.hypot(dx, dy) / radius;

  // Two noise octaves in -1..1; wobble vanishes at the stronghold so the
  // heart reads exactly 1 and the edge stays ragged.
  const n1 = valueNoise(x * scale, y * scale, field.seed) * 2 - 1;
  const n2 = valueNoise(x * scale * 2.7 + 13.7, y * scale * 2.7 + 7.3, (field.seed ^ 0x9e3779b9) >>> 0) * 2 - 1;
  const wobble = (n1 * 0.7 + n2 * 0.3) * Math.min(1, dist);

  return clamp01(1 - (dist + wobble * raggedness));
}

/** Hard band classification at corruption c (bakes, tests, "which band"). */
export function bandAt(c: number): CorruptionBand {
  if (c < CORRUPTION_STOPS.verdant) return "verdant";
  if (c < CORRUPTION_STOPS.fading) return "fading";
  if (c < CORRUPTION_STOPS.blighted) return "blighted";
  if (c < CORRUPTION_STOPS.cracked) return "cracked";
  return "burnt";
}

function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * Band blend weights at corruption c — the renderer crossfades palettes
 * across the tunable stops instead of drawing hard lines. `feather` is the
 * crossfade half-width in corruption units. Returns 1–2 entries summing to 1.
 */
export function bandWeights(
  c: number,
  feather = 0.05,
): { band: CorruptionBand; weight: number }[] {
  const v = clamp01(c);
  const stops = [0, CORRUPTION_STOPS.verdant, CORRUPTION_STOPS.fading, CORRUPTION_STOPS.blighted, CORRUPTION_STOPS.cracked, 1];
  const out: { band: CorruptionBand; weight: number }[] = [];
  for (let i = 0; i < CORRUPTION_BANDS.length; i++) {
    const lo = stops[i];
    const hi = stops[i + 1];
    const rise = smoothstep(lo - feather, lo + feather, v);
    const fall = 1 - smoothstep(hi - feather, hi + feather, v);
    const w = rise * fall;
    if (w > 1e-4) out.push({ band: CORRUPTION_BANDS[i], weight: w });
  }
  const sum = out.reduce((s, e) => s + e.weight, 0) || 1;
  return out.map((e) => ({ band: e.band, weight: e.weight / sum }));
}
