// RENDERED FX — "rendered" explosion composites + volumetric dust/fireballs
// (Seamless World spec §9, Phase 2 slice 9; REBUILT Oct 13 2026).
//
// Spec §9's bar: the old single-sprite "pixel blotch" dies here. A rendered
// explosion has STRUCTURE — a bright core, a turbulent mid fireball, an
// outer shockwave ring, smoke that rises and lingers, and LIGHT: a
// point-light bloom cast onto nearby terrain/units for its lifetime.
//
// Oct 13 2026 rebuild (owner: explosions read "thin and snare-like"): the
// structure above is now PRE-BAKED into a sprite atlas (fireball frame
// sequence, glow, smoke, dust, scorch) and blitted — see the "explosion
// beats" section below for the full root-cause note. The ladder
// (game/graphics-quality.ts) still gates companion-particle counts and the
// shockwave ring — never the fireball's structure, at any rung.
// Presentation only — no sim/engine/balance changes.
//
// The spawn/draw functions push into and read from the BattleScene Fx
// instance (components/BattleScene/effects.ts); the Fx class owns update +
// lifetime bookkeeping, this module owns the rendered LOOK.

import type {
  Fx,
  Boom,
  Ring,
  Bloom,
  Spark,
  Dust,
  Tracer,
  Chunk,
  Ember,
  Scorch,
  Shell,
} from "../../components/BattleScene/effects";
import {
  GRAPHICS_LADDER,
  particleBudgetMultiplier,
  type GraphicsLevel,
} from "../graphics-quality";

/** px/s^2 — impact sparks fall under gravity. */
export const SPARK_GRAVITY = 640;
/** Layers of soft sprite per kicked-up dust event. */
export const VOL_DUST_LAYERS = 3;

// ---- layer plans (pure, ladder-parameterized) ------------------------------

/** The rendered-explosion recipe for one quality rung. */
export interface ExplosionPlan {
  /** Bright near-white core gradient. */
  core: boolean;
  /** Offset volumetric fireball gradients (0 → single composite sprite). */
  fireballLayers: number;
  /** Fast-expanding shockwave ring. */
  shockwave: boolean;
  /** Base smoke-column puff count (scaled by the particle budget at spawn). */
  smokeColumn: number;
  /** Bloom light radius in px at scale 1 (0 = bloom off). */
  bloomRadius: number;
  /** True = bloom casts onto terrain + units; false = units only. */
  bloomOnTerrain: boolean;
  /** PERFORMANCE path: one shaded composite sprite, never a blob. */
  composite: boolean;
  /** Impact sparks with gravity. */
  sparks: boolean;
  /** Tumbling solid debris fragments. */
  debrisChunks: number;
  /** Tiny rising heat embers. */
  embers: number;
  /** Dark scorch decal left on the ground. */
  scorch: boolean;
  /** Explosion-kicked dust ring puffs. */
  dustRing: number;
}

/** Layer counts per rung (spec §9's ladder table). */
export function planExplosion(level: GraphicsLevel): ExplosionPlan {
  switch (level) {
    case "cinematic":
      return {
        core: true,
        fireballLayers: 3,
        shockwave: true,
        smokeColumn: 6,
        bloomRadius: 150,
        bloomOnTerrain: true,
        composite: false,
        sparks: true,
        debrisChunks: 8,
        embers: 18,
        scorch: true,
        dustRing: 10,
      };
    case "balanced":
      return {
        core: true,
        fireballLayers: 2,
        shockwave: false,
        smokeColumn: 4,
        bloomRadius: 110,
        bloomOnTerrain: false,
        composite: false,
        sparks: true,
        debrisChunks: 5,
        embers: 10,
        scorch: true,
        dustRing: 6,
      };
    case "performance":
      return {
        core: false,
        fireballLayers: 0,
        shockwave: false,
        smokeColumn: 2,
        bloomRadius: 0,
        bloomOnTerrain: false,
        composite: true,
        sparks: true,
        debrisChunks: 0,
        embers: 0,
        scorch: false,
        dustRing: 0,
      };
  }
}

// ---- fireball churn geometry (pure, seeded, testable) -----------------------

/** One offset fireball gradient layer: offset as a fraction of radius. */
export interface FireballLayerGeom {
  dx: number;
  dy: number;
  scale: number;
}

/**
 * The 3 offset layers of a volumetric fireball. Offsets churn with time so
 * the interior roils; golden-angle phase spread keeps the layers from
 * lining up. Bounded (|dx|,|dy| ≤ 0.36) and deterministic per seed + t.
 */
export function fireballOffsets(
  churnSeed: number,
  t01: number,
): FireballLayerGeom[] {
  const t = Math.max(0, Math.min(1, t01));
  const out: FireballLayerGeom[] = [];
  for (let i = 0; i < 3; i++) {
    const ph = churnSeed * 0.0001 + i * 2.39996; // golden-angle spread
    const churn = 0.16 + 0.1 * i; // outer layers roil wider
    out.push({
      dx: Math.cos(ph + t * (2.2 + i * 0.9)) * churn,
      dy: Math.sin(ph * 1.7 + t * (1.6 + i * 1.1)) * churn,
      scale: 1 - i * 0.22 - t * 0.1,
    });
  }
  return out;
}

// ---- spawners (push into the Fx instance's arrays) -------------------------

/** The 3-layer rendered explosion: core + fireball + shockwave + smoke + bloom. */
export function spawnExplosion(
  fx: Fx,
  x: number,
  y: number,
  scale: number,
  level: GraphicsLevel,
  cookoff = false,
): void {
  const plan = planExplosion(level);
  const budget = particleBudgetMultiplier(level);

  const nParts = Math.max(1, Math.round(26 * budget));
  const nSmoke = Math.max(1, Math.round(plan.smokeColumn * budget));
  const parts: Boom["particles"] = [];
  const smoke: Boom["smoke"] = [];
  for (let i = 0; i < nParts; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (60 + Math.random() * 220) * scale;
    parts.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.5 + Math.random() * 0.6,
      maxLife: 1.1,
      size: 2 + Math.random() * 4,
      color: ["#ffdf8a", "#ff9c3f", "#ff5f2b", "#fff3d6"][i % 4],
    });
  }
  for (let i = 0; i < nSmoke; i++) {
    const a = Math.random() * Math.PI * 2;
    // Lingering column: longer life, stronger rise, growth in update().
    const life = 2.2 + Math.random() * 1.6;
    smoke.push({
      // Spread across the blast, not clumped dead-center: a tight cluster
      // of dark puffs over the young fireball reads as a black hole in its
      // heart (Oct 13 rebuild capture pass).
      x: x + (Math.random() - 0.5) * Math.max(20, 46 * scale * 0.9),
      y: y + (Math.random() - 0.5) * Math.max(20, 46 * scale * 0.55),
      vx: Math.cos(a) * 24,
      vy: -26 - Math.random() * 26,
      life,
      maxLife: 3.8,
      size: 10 + Math.random() * 14,
      seed: Math.random() * Math.PI * 2,
    });
  }
  fx.booms.push({
    x,
    y,
    life: 2.4,
    maxLife: 2.4,
    radius: 46 * scale,
    particles: parts,
    smoke,
    churnSeed: (Math.random() * 1e9) | 0,
    composite: plan.composite,
    cookoff,
    scale,
  });
  if (fx.booms.length > 40) fx.booms.splice(0, fx.booms.length - 40);

  if (plan.shockwave) {
    fx.rings.push({
      x,
      y,
      life: 0.55,
      maxLife: 0.55,
      maxR: 100 * scale,
      color: "#ffd9a0",
      width: 4,
      kind: "shock",
    });
  }

  if (plan.bloomRadius > 0) {
    fx.blooms.push({
      x,
      y,
      life: 1.1,
      maxLife: 1.1,
      radius: plan.bloomRadius * scale,
      color: "#ffb35c",
      terrain: plan.bloomOnTerrain,
    });
    if (fx.blooms.length > 40) fx.blooms.splice(0, fx.blooms.length - 40);
  }

  if (plan.sparks) {
    const nSparks = Math.max(1, Math.round(12 * budget));
    for (let i = 0; i < nSparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (140 + Math.random() * 320) * scale;
      fx.sparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 120 * scale,
        life: 0.4 + Math.random() * 0.5,
        maxLife: 0.9,
        size: 1.5 + Math.random() * 2,
        color: ["#fff6e0", "#ffd27a", "#ff9c3f"][i % 3],
      });
    }
    if (fx.sparks.length > 120) fx.sparks.splice(0, fx.sparks.length - 120);
  }

  // Tumbling solid debris — dark hull fragments with hot edges.
  const nChunks = Math.round(plan.debrisChunks * budget);
  for (let i = 0; i < nChunks; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (90 + Math.random() * 260) * scale;
    const life = 0.9 + Math.random() * 0.9;
    fx.chunks.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 160 * scale,
      life,
      maxLife: life,
      size: (3 + Math.random() * 5) * scale,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 14,
      color: ["#3a2a20", "#4a3226", "#2e2018"][i % 3],
    });
  }
  if (fx.chunks.length > 80) fx.chunks.splice(0, fx.chunks.length - 80);

  // Heat embers — tiny, bright, buoyant; they rise and flicker out.
  const nEmbers = Math.round(plan.embers * budget);
  for (let i = 0; i < nEmbers; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 30 + Math.random() * 90;
    const life = 1.2 + Math.random() * 1.4;
    fx.embers.push({
      x: x + (Math.random() - 0.5) * 30 * scale,
      y: y + (Math.random() - 0.5) * 30 * scale,
      vx: Math.cos(a) * sp,
      vy: -40 - Math.random() * 80,
      life,
      maxLife: life,
      size: 1 + Math.random() * 1.6,
      seed: Math.random() * Math.PI * 2,
    });
  }
  if (fx.embers.length > 160) fx.embers.splice(0, fx.embers.length - 160);

  // The blast kicks up a ring of dust — lit orange while the fire is young.
  if (plan.dustRing > 0) {
    spawnExplosionDust(fx, x, y, scale, plan.dustRing, budget);
  }

  // Ground scorch — the dark mark the explosion leaves behind.
  if (plan.scorch) {
    const life = 9 + Math.random() * 3;
    fx.scorches.push({ x, y, radius: (26 + Math.random() * 14) * scale, life, maxLife: life });
    if (fx.scorches.length > 24) fx.scorches.splice(0, fx.scorches.length - 24);
  }
}

/** Volumetric dust: 3 layered soft sprites that hang, spread, and settle. */
export function spawnVolumetricDust(
  fx: Fx,
  x: number,
  y: number,
  _level: GraphicsLevel,
): void {
  const base = Math.random() * Math.PI * 2;
  for (let i = 0; i < VOL_DUST_LAYERS; i++) {
    // Outer layers live longer and start wider — one kick, three depths.
    const life = (1.8 + Math.random() * 1.4) * (1 + i * 0.25);
    fx.dusts.push({
      x: x + (Math.random() - 0.5) * (10 + i * 8),
      y: y + (Math.random() - 0.5) * 6,
      vx: Math.cos(base + i) * (14 + Math.random() * 18),
      vy: -10 - Math.random() * 16,
      life,
      maxLife: life,
      size: 7 + Math.random() * 8 + i * 5,
      age: 0,
      churn: Math.random() * Math.PI * 2,
      lit: 0,
    });
  }
  if (fx.dusts.length > 220) fx.dusts.splice(0, fx.dusts.length - 220);
}

/**
 * Explosion-kicked dust ring: puffs thrown outward along the ground by the
 * blast. Born lit (lit=1) — they glow orange while the fire is young, then
 * cool back to dust tan as lit decays in Fx.update.
 */
export function spawnExplosionDust(
  fx: Fx,
  x: number,
  y: number,
  scale: number,
  count: number,
  budget: number,
): void {
  const n = Math.max(1, Math.round(count * budget));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const sp = (50 + Math.random() * 90) * scale;
    const life = 1.6 + Math.random() * 1.2;
    fx.dusts.push({
      x: x + Math.cos(a) * 12 * scale,
      y: y + Math.sin(a) * 8 * scale,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp * 0.4 - 14,
      life,
      maxLife: life,
      size: 9 + Math.random() * 10,
      age: 0,
      churn: Math.random() * Math.PI * 2,
      lit: 1,
    });
  }
  if (fx.dusts.length > 260) fx.dusts.splice(0, fx.dusts.length - 260);
}

/**
 * Tracer impact: a hot flash + a few sparks where the shot lands. Small and
 * cheap — this fires for every tracer hit, so it stays ladder-light.
 */
export function spawnImpact(
  fx: Fx,
  x: number,
  y: number,
  color: string,
  level: GraphicsLevel,
): void {
  const budget = particleBudgetMultiplier(level);
  fx.flashes.push({ x, y, life: 0.14, maxLife: 0.14, radius: 10, color: "#fff3d6" });
  if (fx.flashes.length > 120) fx.flashes.splice(0, fx.flashes.length - 120);
  const n = Math.max(1, Math.round(4 * budget));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 80 + Math.random() * 160;
    const life = 0.25 + Math.random() * 0.3;
    fx.sparks.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 60,
      life,
      maxLife: life,
      size: 1 + Math.random() * 1.5,
      color,
    });
  }
  if (fx.sparks.length > 140) fx.sparks.splice(0, fx.sparks.length - 140);
}

/** Muzzle-flash bloom at the tracer origin (spec: "give them light"). */
export function spawnMuzzleBloom(
  fx: Fx,
  x: number,
  y: number,
  level: GraphicsLevel,
): void {
  if (GRAPHICS_LADDER[level].bloom === "off") return;
  fx.blooms.push({
    x,
    y,
    life: 0.16,
    maxLife: 0.16,
    radius: 26,
    color: "#ffe9b0",
    terrain: false,
  });
  if (fx.blooms.length > 60) fx.blooms.splice(0, fx.blooms.length - 60);
}

// ---- explosion beats (pure timing — the three-beat read) --------------------
//
// Owner verdict (Oct 13 2026): the old explosions read THIN and snare-like.
// Root causes found in the draw path: (1) every boom/bloom/dust/flash built
// fresh radial gradients EVERY FRAME — on Android that blew the AUTO ladder's
// 20ms frame budget, so AUTO demoted the graphics rung mid-fight and the
// explosion collapsed to the single-gradient PERFORMANCE composite (one soft
// circle + ~4 dots); (2) the POV renderer never got the rendered explosion
// at all — one gradient blob; (3) smoke was hard-edged flat discs.
//
// The rebuild: the fireball is a PRE-BAKED frame sequence (baked once,
// offscreen — gradients are legal at bake time, banned per-frame), played
// back in three beats inside EXPLOSION_BRIGHT_S:
//   beat 1 — white-hot core flash that SWELLS (radius envelope peaks ~1.3×),
//   beat 2 — turbulent fireball, cooling white → orange → deep red,
//   beat 3 — the body dies into the lingering smoke + embers (spawned data).
// Every rung blits the same baked frames; the ladder still gates how many
// companion particles (sparks/chunks/embers/smoke) ride along — never the
// fireball's structure. Draw calls per frame: drawImage only.

/** Baked fireball frames across the bright phase. */
export const EXPLOSION_FRAMES = 10;
/** Seconds the fireball body lives (the boom's smoke/embers outlive it). */
export const EXPLOSION_BRIGHT_S = 0.95;

/** Frame index for bright-phase progress t01 ∈ [0,1] — monotonic, bounded. */
export function explosionFrameAt(t01: number): number {
  const t = Math.max(0, Math.min(1, t01));
  return Math.min(EXPLOSION_FRAMES - 1, Math.floor(t * EXPLOSION_FRAMES));
}

/**
 * Fireball radius envelope over the bright phase, as a multiple of the
 * boom's base radius: a fast swell to ≈1.3× by t≈0.3 (the flash beat),
 * then a slow settle as it cools. The old body grew while fading — biggest
 * when nearly invisible — which is half of why it read thin.
 */
export function explosionRadiusAt(t01: number): number {
  const t = Math.max(0, Math.min(1, t01));
  const swellIn = Math.min(1, t / 0.3);
  const swell = 1 - Math.pow(1 - swellIn, 3); // easeOutCubic
  return (0.5 + 0.85 * swell) * (1 - 0.12 * t);
}

/** Bright-phase progress 0..1 for a boom (≥1 = body has died into smoke). */
export function explosionBrightT(b: Boom): number {
  const age = b.maxLife - b.life;
  // Per-boom rate variance from the churn seed so simultaneous booms don't
  // march in lockstep.
  const rate = 0.92 + (((b.churnSeed >> 3) % 17) / 100);
  return Math.max(0, Math.min(1.2, (age / EXPLOSION_BRIGHT_S) * rate));
}

// ---- pre-baked sprite atlas (bake once, blit forever) -----------------------

type FxCanvas = HTMLCanvasElement;

interface FxAtlas {
  /** Fireball frame sequence (256px), index = explosionFrameAt(brightT). */
  fire: FxCanvas[];
  /** Soft warm light (blooms, flash bodies). */
  glowWarm: FxCanvas;
  /** Near-white hot light (impact/muzzle flash cores). */
  glowHot: FxCanvas;
  /** Soft irregular smoke puffs (128px), variant per smoke seed. */
  smoke: FxCanvas[];
  /** Soft dust puff, cool tan. */
  dust: FxCanvas;
  /** Soft dust puff, blast-lit orange. */
  dustLit: FxCanvas;
  /** Dark irregular ground scorch. */
  scorch: FxCanvas;
}

let atlasCache: FxAtlas | null | undefined;

/** Deterministic RNG (mulberry32) — bakes are stable frame to frame. */
function bakeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function bakeCanvas(size: number): FxCanvas | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  return cv;
}

/** Fire sprite geometry: solid fire reaches BAKE_FIRE_R of the half-size. */
const FIRE_HALF = 128;
const FIRE_R = 92;
export const FIRE_SPRITE_OVERHANG = FIRE_HALF / FIRE_R;

/** Cooling color ramp shared by the bake (same stops the old body used). */
function coolRamp(t: number): {
  inner: [number, number, number];
  mid: [number, number, number];
  hot: [number, number, number];
} {
  const cool = Math.min(1, t * 1.4);
  return {
    inner: [
      Math.round(255 - 75 * cool),
      Math.round(252 - 175 * cool),
      Math.round(240 - 210 * cool),
    ],
    mid: [
      Math.round(255 - 95 * cool),
      Math.round(220 - 160 * cool),
      Math.round(150 - 130 * cool),
    ],
    hot: [
      Math.round(255 - 115 * cool),
      Math.round(150 - 100 * cool),
      Math.round(50 - 35 * cool),
    ],
  };
}

function rgb(c: [number, number, number], a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

function bakeFireFrame(t: number, frameIdx: number): FxCanvas | null {
  const cv = bakeCanvas(FIRE_HALF * 2);
  if (!cv) return null;
  const g = cv.getContext("2d");
  if (!g) return null;
  const rnd = bakeRng(0xf17e + frameIdx * 7919);
  const C = FIRE_HALF;
  const ramp = coolRamp(t);

  // Dark turbulent rim — overlapping smoky lobes, stronger as it cools.
  const rimN = 7;
  for (let i = 0; i < rimN; i++) {
    const ang = (i / rimN) * Math.PI * 2 + rnd() * 0.7;
    const dist = FIRE_R * (0.55 + rnd() * 0.35);
    const r = FIRE_R * (0.34 + rnd() * 0.22);
    const x = C + Math.cos(ang) * dist;
    const y = C + Math.sin(ang) * dist;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(96,38,16,${0.34 + 0.3 * t})`);
    gr.addColorStop(1, "rgba(60,22,10,0)");
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Turbulent fireball lobes (baked churn — per-frame positions, no runtime cost).
  const lobeN = 5;
  for (let i = 0; i < lobeN; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = FIRE_R * (0.12 + rnd() * 0.4);
    const r = FIRE_R * (0.5 + rnd() * 0.3);
    const x = C + Math.cos(ang) * dist;
    const y = C + Math.sin(ang) * dist;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgb(ramp.hot, 0.5));
    gr.addColorStop(0.6, "rgba(220,80,25,0.28)");
    gr.addColorStop(1, "rgba(120,30,10,0)");
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Mid body.
  {
    const gr = g.createRadialGradient(C, C, 0, C, C, FIRE_R * 0.78);
    gr.addColorStop(0, rgb(ramp.mid, 0.72));
    gr.addColorStop(1, "rgba(255,140,50,0)");
    g.fillStyle = gr;
    g.beginPath(); g.arc(C, C, FIRE_R * 0.78, 0, Math.PI * 2); g.fill();
  }
  // White-hot core — biggest and brightest in the flash beat, cools/shrinks.
  {
    const coreR = FIRE_R * (0.62 - 0.38 * t);
    const gr = g.createRadialGradient(C, C, 0, C, C, coreR);
    gr.addColorStop(0, rgb(ramp.inner, 0.98));
    gr.addColorStop(0.6, rgb(ramp.mid, 0.8));
    gr.addColorStop(1, "rgba(255,160,60,0)");
    g.fillStyle = gr;
    g.beginPath(); g.arc(C, C, coreR, 0, Math.PI * 2); g.fill();
  }
  // Beat 1 flash: an extra near-white wash over the whole ball.
  if (t < 0.3) {
    const gr = g.createRadialGradient(C, C, 0, C, C, FIRE_R * 1.05);
    gr.addColorStop(0, `rgba(255,252,240,${0.55 * (1 - t / 0.3)})`);
    gr.addColorStop(1, "rgba(255,240,200,0)");
    g.fillStyle = gr;
    g.beginPath(); g.arc(C, C, FIRE_R * 1.05, 0, Math.PI * 2); g.fill();
  }
  // Beat 3: smoke creeps in over the cooling fire.
  if (t > 0.5) {
    const sa = (t - 0.5) * 0.8;
    for (let i = 0; i < 4; i++) {
      const ang = rnd() * Math.PI * 2;
      const dist = FIRE_R * (0.3 + rnd() * 0.5);
      const r = FIRE_R * (0.4 + rnd() * 0.3);
      const x = C + Math.cos(ang) * dist;
      const y = C + Math.sin(ang) * dist - FIRE_R * 0.1;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(28,24,22,${sa})`);
      gr.addColorStop(1, "rgba(28,24,22,0)");
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  return cv;
}

function bakeGlow(inner: string, mid: string): FxCanvas | null {
  const cv = bakeCanvas(128);
  if (!cv) return null;
  const g = cv.getContext("2d");
  if (!g) return null;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.4, mid);
  gr.addColorStop(1, "rgba(255,150,50,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return cv;
}

function bakePuff(
  seed: number,
  stops: [number, string][],
  baseR: number,
): FxCanvas | null {
  const cv = bakeCanvas(128);
  if (!cv) return null;
  const g = cv.getContext("2d");
  if (!g) return null;
  const rnd = bakeRng(seed);
  // One soft body + a few offset lobes so the silhouette is irregular.
  const blobs: [number, number, number][] = [[64, 64, baseR]];
  for (let i = 0; i < 4; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 12 + rnd() * 18;
    blobs.push([64 + Math.cos(ang) * dist, 64 + Math.sin(ang) * dist, baseR * (0.55 + rnd() * 0.3)]);
  }
  for (const [x, y, r] of blobs) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    for (const [off, col] of stops) gr.addColorStop(off, col);
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return cv;
}

function bakeAtlas(): FxAtlas | null {
  const fire: FxCanvas[] = [];
  for (let i = 0; i < EXPLOSION_FRAMES; i++) {
    const f = bakeFireFrame(i / (EXPLOSION_FRAMES - 1), i);
    if (!f) return null;
    fire.push(f);
  }
  const glowWarm = bakeGlow("rgba(255,205,130,0.55)", "rgba(255,160,70,0.26)");
  const glowHot = bakeGlow("rgba(255,246,220,0.9)", "rgba(255,205,120,0.4)");
  const smokeStops: [number, string][] = [
    [0, "rgba(38,33,30,0.82)"],
    [0.6, "rgba(34,30,28,0.45)"],
    [1, "rgba(30,26,24,0)"],
  ];
  const smoke: FxCanvas[] = [];
  for (let i = 0; i < 3; i++) {
    const s = bakePuff(0x5100 + i * 331, smokeStops, 46);
    if (!s) return null;
    smoke.push(s);
  }
  const dust = bakePuff(0xd057, [
    [0, "rgba(203,185,143,0.5)"],
    [0.7, "rgba(203,185,143,0.25)"],
    [1, "rgba(203,185,143,0)"],
  ], 52);
  const dustLit = bakePuff(0xd118, [
    [0, "rgba(255,150,60,0.55)"],
    [0.7, "rgba(240,130,55,0.27)"],
    [1, "rgba(230,120,50,0)"],
  ], 52);
  const scorch = bakePuff(0x5c09, [
    [0, "rgba(10,7,5,0.88)"],
    [0.7, "rgba(14,9,7,0.5)"],
    [1, "rgba(16,10,8,0)"],
  ], 54);
  if (!glowWarm || !glowHot || !dust || !dustLit || !scorch) return null;
  return { fire, glowWarm, glowHot, smoke, dust, dustLit, scorch };
}

/** The baked FX atlas — baked lazily on first use, null where canvas is unavailable (tests/SSR). */
export function fxAtlas(): FxAtlas | null {
  if (atlasCache === undefined) {
    try {
      atlasCache = bakeAtlas();
    } catch {
      atlasCache = null;
    }
  }
  return atlasCache;
}

/**
 * Blit the baked warm/hot light sprite — replaces every per-frame radial
 * gradient the flash/bloom paths used to build. Caller owns composite mode
 * (blooms/flashes draw inside the "lighter" pass).
 */
export function drawGlowAt(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  alpha: number,
  hot = false,
): void {
  const at = fxAtlas();
  if (!at || r <= 0 || alpha <= 0) return;
  c.globalAlpha = Math.max(0, Math.min(1, alpha));
  c.drawImage(hot ? at.glowHot : at.glowWarm, x - r, y - r, r * 2, r * 2);
  c.globalAlpha = 1;
}

/**
 * Blit one baked smoke puff (soft, irregular — never the old hard disc).
 * `seed` picks the variant; the puff's own alpha profile does the soft edge.
 */
export function drawSmokePuff(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  alpha: number,
  seed: number,
): void {
  const at = fxAtlas();
  if (!at || r <= 0 || alpha <= 0) return;
  const idx = Math.abs(Math.floor(seed * 7)) % at.smoke.length;
  c.globalAlpha = Math.max(0, Math.min(1, alpha));
  c.drawImage(at.smoke[idx], x - r, y - r, r * 2, r * 2);
  c.globalAlpha = 1;
}

/** Blit the baked scorch decal, stretched to an ellipse (ground-plane views). */
export function drawScorchAt(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  alpha: number,
): void {
  const at = fxAtlas();
  if (!at || rx <= 0 || ry <= 0 || alpha <= 0) return;
  c.globalAlpha = Math.max(0, Math.min(1, alpha));
  c.drawImage(at.scorch, x - rx, y - ry, rx * 2, ry * 2);
  c.globalAlpha = 1;
}

// ---- draw helpers (called from the scene's fx draw passes) -----------------

function alphaOf(life: number, maxLife: number): number {
  return Math.max(0, Math.min(1, life / maxLife));
}

/**
 * Point-light bloom: drawn in the "lighter" pass over ground AND units so
 * the flash genuinely casts light on the scene for its lifetime.
 * Blits the baked glow sprite — no per-frame gradient (Oct 13 rebuild).
 */
export function drawBloom(c: CanvasRenderingContext2D, b: Bloom): void {
  const a = alphaOf(b.life, b.maxLife);
  if (a <= 0 || b.radius <= 0) return;
  drawGlowAt(c, b.x, b.y, b.radius, a);
}

/**
 * The explosion body, projected or not: blit the baked fireball frame for
 * the boom's bright-phase beat at an explicit center + solid-fire radius.
 * Shared by the top-down pass (drawExplosionBody) and the POV renderer, so
 * BOTH modes finally show the same rendered explosion (the POV path used to
 * draw a lone gradient blob). After the bright phase the body is gone —
 * smoke, embers, and scorch carry the tail.
 */
export function drawExplosionBodyAt(
  c: CanvasRenderingContext2D,
  b: Boom,
  cx: number,
  cy: number,
  fireR: number,
): void {
  const at = fxAtlas();
  if (!at || fireR <= 0) return;
  const bt = explosionBrightT(b);
  if (bt >= 1) return;
  const frame = at.fire[explosionFrameAt(bt)];
  const half = fireR * FIRE_SPRITE_OVERHANG;
  // Fade the body out across the last fifth of the bright phase.
  const fade = bt > 0.8 ? 1 - (bt - 0.8) * 5 * 0.7 : 1;
  c.globalAlpha = Math.max(0, Math.min(1, fade));
  c.drawImage(frame, cx - half, cy - half, half * 2, half * 2);
  c.globalAlpha = 1;
}

/**
 * The explosion body (top-down pass): the baked three-beat fireball —
 * swelling white-hot flash → turbulent cooling fireball → gone, leaving
 * smoke and embers — plus the boom's hot debris particles. The composite
 * (PERFORMANCE) boom blits the same frames: one sprite, but a structured,
 * animated one — never the old single static gradient blob.
 */
export function drawExplosionBody(c: CanvasRenderingContext2D, b: Boom): void {
  const a = alphaOf(b.life, b.maxLife);
  if (a <= 0) return;
  const bt = explosionBrightT(b);
  const R = b.radius * explosionRadiusAt(Math.min(1, bt));
  // Hot air rises — the fireball climbs as it cools.
  const riseY = -Math.min(1, bt) * R * 0.3;
  drawExplosionBodyAt(c, b, b.x, b.y + riseY, R);

  // Hot debris particles.
  for (const p of b.particles) {
    if (p.life <= 0) continue;
    c.globalAlpha = alphaOf(p.life, p.maxLife);
    c.fillStyle = p.color;
    c.beginPath();
    c.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

/** The shockwave: fast-expanding double-stroked ring, fading as it runs out. */
export function drawShockwave(c: CanvasRenderingContext2D, rg: Ring): void {
  const a = alphaOf(rg.life, rg.maxLife);
  if (a <= 0) return;
  const r = rg.maxR * (1 - a);
  c.strokeStyle = rg.color;
  c.globalAlpha = a * 0.9;
  c.lineWidth = rg.width;
  c.beginPath();
  c.arc(rg.x, rg.y, r, 0, Math.PI * 2);
  c.stroke();
  c.globalAlpha = a * 0.35;
  c.lineWidth = rg.width * 2.2;
  c.beginPath();
  c.arc(rg.x, rg.y, r * 0.92, 0, Math.PI * 2);
  c.stroke();
  c.globalAlpha = 1;
}

/** Impact spark: short additive streak along its velocity. */
export function drawSpark(c: CanvasRenderingContext2D, s: Spark): void {
  const a = alphaOf(s.life, s.maxLife);
  if (a <= 0) return;
  c.strokeStyle = s.color;
  c.globalAlpha = a;
  c.lineWidth = s.size;
  c.beginPath();
  c.moveTo(s.x, s.y);
  c.lineTo(s.x - s.vx * 0.025, s.y - s.vy * 0.025);
  c.stroke();
  c.globalAlpha = 1;
}

/**
 * The laser/tracer: a 3-pass beam — wide soft halo (the bloom), the colored
 * body, and a white-hot core — plus a bright head where it lands. Drawn in
 * the "lighter" pass, no shadowBlur (the layered strokes ARE the glow, and
 * they're cheaper than the shadow pipeline).
 */
export function drawTracerBeam(c: CanvasRenderingContext2D, tr: Tracer): void {
  const a = alphaOf(tr.life, tr.maxLife);
  if (a <= 0) return;
  const w = tr.width;
  // Pass 1 — halo: the bloom-like falloff around the beam.
  c.strokeStyle = tr.color;
  c.globalAlpha = a * 0.22;
  c.lineWidth = w * 4.5;
  c.lineCap = "round";
  c.beginPath(); c.moveTo(tr.x1, tr.y1); c.lineTo(tr.x2, tr.y2); c.stroke();
  // Pass 2 — body: the saturated color.
  c.globalAlpha = a * 0.85;
  c.lineWidth = w * 1.9;
  c.beginPath(); c.moveTo(tr.x1, tr.y1); c.lineTo(tr.x2, tr.y2); c.stroke();
  // Pass 3 — core: white-hot.
  c.strokeStyle = "#fffdf4";
  c.globalAlpha = a;
  c.lineWidth = Math.max(1, w * 0.7);
  c.beginPath(); c.moveTo(tr.x1, tr.y1); c.lineTo(tr.x2, tr.y2); c.stroke();
  // Head: the bright point where the shot is landing (baked glow blit —
  // tracers are the most numerous fx; per-frame gradients here were a
  // real hot-loop cost).
  drawGlowAt(c, tr.x2, tr.y2, w * 3, 0.9 * a, true);
  c.globalAlpha = 1;
}

/**
 * Kinetic slug (owner 2026-10-11): NOT a beam. A short bright streak —
 * white-hot core over a thin warm glow, gone in a blink. The eye reads
 * "bullet", never "lightsaber".
 */
export function drawTracerSlug(c: CanvasRenderingContext2D, tr: Tracer): void {
  const a = alphaOf(tr.life, tr.maxLife);
  if (a <= 0) return;
  c.lineCap = "round";
  // faint warm wake
  c.strokeStyle = tr.color;
  c.globalAlpha = a * 0.35;
  c.lineWidth = tr.width * 2.2;
  c.beginPath(); c.moveTo(tr.x1, tr.y1); c.lineTo(tr.x2, tr.y2); c.stroke();
  // white-hot slug body
  c.strokeStyle = "#fffdf4";
  c.globalAlpha = a;
  c.lineWidth = Math.max(1, tr.width * 0.9);
  c.beginPath(); c.moveTo(tr.x1, tr.y1); c.lineTo(tr.x2, tr.y2); c.stroke();
  c.globalAlpha = 1;
}

/**
 * Lobbed siege shell in flight (owner 2026-10-11): a big glowing projectile
 * riding a visible parabolic arc. The arc is the dodge read — you SEE it
 * coming before it lands.
 */
export function drawShell(c: CanvasRenderingContext2D, s: Shell): void {
  const t = Math.max(0, Math.min(1, s.t));
  const x = s.x1 + (s.x2 - s.x1) * t;
  const y = s.y1 + (s.y2 - s.y1) * t - Math.sin(t * Math.PI) * s.arc;
  const r = 5 * s.size;
  // hot glow around the shell (baked glow blit — no per-frame gradients)
  drawGlowAt(c, x, y, r * 4, 0.9);
  // the shell body — dark with a burning rim
  c.fillStyle = "#2a1a10";
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#ffb347";
  c.lineWidth = 1.6;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
  // fire trail along the arc behind it — a tapered solid stroke (round cap)
  // reads the same at shell scale and builds no gradient.
  const tb = Math.max(0, t - 0.08);
  const tx = s.x1 + (s.x2 - s.x1) * tb;
  const ty = s.y1 + (s.y2 - s.y1) * tb - Math.sin(tb * Math.PI) * s.arc;
  c.strokeStyle = "rgba(255,165,80,0.5)";
  c.lineWidth = r * 1.2;
  c.lineCap = "round";
  c.beginPath(); c.moveTo(tx, ty); c.lineTo(x, y); c.stroke();
}

/** Tumbling debris chunk: dark solid fragment with a hot glowing edge. */
export function drawDebrisChunks(c: CanvasRenderingContext2D, chunks: Chunk[]): void {
  for (const ch of chunks) {
    const a = alphaOf(ch.life, ch.maxLife);
    if (a <= 0) continue;
    c.save();
    c.translate(ch.x, ch.y);
    c.rotate(ch.rot);
    const s = ch.size;
    // Hot edge — the fragment is still burning on one side.
    c.globalAlpha = a * 0.8;
    c.fillStyle = "#ff7a2a";
    c.fillRect(-s / 2 - 1, -s / 2 - 1, s + 2, s + 2);
    // Dark hull body.
    c.globalAlpha = a;
    c.fillStyle = ch.color;
    c.fillRect(-s / 2, -s / 2, s, s);
    c.restore();
  }
  c.globalAlpha = 1;
}

/** Heat embers: tiny bright motes with a flicker — additive, they shimmer. */
export function drawEmbers(c: CanvasRenderingContext2D, embers: Ember[]): void {
  for (const e of embers) {
    const a = alphaOf(e.life, e.maxLife);
    if (a <= 0) continue;
    // Flicker: the ember breathes as it rises.
    const fl = 0.6 + 0.4 * Math.sin(e.seed + e.life * 14);
    c.globalAlpha = a * fl;
    c.fillStyle = "#ffd98a";
    const s = e.size;
    c.fillRect(e.x - s / 2, e.y - s / 2, s, s);
    // Hot core dot.
    c.globalAlpha = a * fl * 0.9;
    c.fillStyle = "#fff6e0";
    c.fillRect(e.x - s / 4, e.y - s / 4, Math.max(1, s / 2), Math.max(1, s / 2));
  }
  c.globalAlpha = 1;
}

/** Ground scorch: the dark mark left behind — normal blend, fades slowly. */
export function drawScorch(c: CanvasRenderingContext2D, s: Scorch): void {
  const a = alphaOf(s.life, s.maxLife);
  if (a <= 0) return;
  // Scorches linger: full strength for the first half of life, then fade.
  const hold = a > 0.5 ? 1 : a * 2;
  drawScorchAt(c, s.x, s.y, s.radius, s.radius, hold * 0.75);
}

/**
 * Volumetric dust: fades IN (never pops), churns while it hangs, settles
 * out smoothly. The three layers per kick read as one roiling cloud.
 * Dust near a blast is LIT — it glows orange (lit=1) and cools back to tan
 * as lit decays.
 */
export function drawVolDust(c: CanvasRenderingContext2D, d: Dust): void {
  const ageA = Math.min(1, d.age / 0.35); // fade-in — no pop
  const outA = alphaOf(d.life, d.maxLife);
  const a = ageA * outA * 0.62;
  if (a <= 0) return;
  const at = fxAtlas();
  if (!at) return;
  const cx = d.x + Math.cos(d.churn + d.age * 1.3) * d.size * 0.22;
  const cy = d.y + Math.sin(d.churn * 1.3 + d.age * 1.7) * d.size * 0.22;
  // Cool tan → hot orange, driven by blast lighting: pick the baked variant
  // (the puff count is the highest of any fx — per-puff gradients were a
  // top hot-loop cost; the blit keeps the churn/alpha motion identical).
  const spr = d.lit >= 0.4 ? at.dustLit : at.dust;
  c.globalAlpha = Math.max(0, Math.min(1, a));
  c.drawImage(spr, cx - d.size, cy - d.size, d.size * 2, d.size * 2);
  c.globalAlpha = 1;
}
