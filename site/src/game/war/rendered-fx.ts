// RENDERED FX — "rendered" explosion composites + volumetric dust/fireballs
// (Seamless World spec §9, Phase 2 slice 9).
//
// Spec §9's bar: the old single-sprite "pixel blotch" dies here. A rendered
// explosion has STRUCTURE — a bright core, a turbulent mid fireball, an
// outer shockwave ring, smoke that rises and lingers, and LIGHT: a
// point-light bloom cast onto nearby terrain/units for its lifetime.
// Fireballs are volumetric (2–3 offset radial gradients with animated noise
// churn) and illuminate as they travel. Dust is volumetric too — layered
// soft sprites that hang, spread, and settle, never pop in/out puffs.
//
// Everything here is parameterized by the graphics ladder
// (game/graphics-quality.ts): CINEMATIC gets everything, BALANCED drops the
// shockwave ring, PERFORMANCE gets a single shaded composite sprite (never
// a blob). Presentation only — no sim/engine/balance changes.
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
      x: x + (Math.random() - 0.5) * 20,
      y: y + (Math.random() - 0.5) * 20,
      vx: Math.cos(a) * 24,
      vy: -26 - Math.random() * 26,
      life,
      maxLife: 3.8,
      size: 10 + Math.random() * 14,
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
    });
  }
  if (fx.dusts.length > 220) fx.dusts.splice(0, fx.dusts.length - 220);
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

// ---- draw helpers (called from the scene's fx draw passes) -----------------

function alphaOf(life: number, maxLife: number): number {
  return Math.max(0, Math.min(1, life / maxLife));
}

/** "#rrggbb" + alpha → rgba() string. */
function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/**
 * Point-light bloom: drawn in the "lighter" pass over ground AND units so
 * the flash genuinely casts light on the scene for its lifetime.
 */
export function drawBloom(c: CanvasRenderingContext2D, b: Bloom): void {
  const a = alphaOf(b.life, b.maxLife);
  if (a <= 0 || b.radius <= 0) return;
  const g = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.radius);
  g.addColorStop(0, hexA(b.color, 0.3 * a));
  g.addColorStop(1, hexA(b.color, 0));
  c.globalAlpha = 1;
  c.fillStyle = g;
  c.beginPath();
  c.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
  c.fill();
}

/**
 * The explosion body: either the PERFORMANCE single shaded composite sprite
 * (structured multi-stop gradient — bright heart, hot mid, dark turbulent
 * rim — never a blob) or the CINEMATIC/BALANCED core + churning fireball
 * layers + hot debris particles.
 */
export function drawExplosionBody(c: CanvasRenderingContext2D, b: Boom): void {
  const a = alphaOf(b.life, b.maxLife);
  if (a <= 0) return;
  const t = 1 - a; // 0 = fresh, 1 = dying
  const R = b.radius * (1.6 - a * 0.6);

  if (b.composite) {
    // One sprite, but SHAPED: the rim wobble keeps it from reading as a blob.
    const rimStop = 0.5 + 0.12 * Math.sin(b.churnSeed * 0.001 + t * 9);
    const g = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, R);
    g.addColorStop(0, `rgba(255,246,224,${0.95 * a})`);
    g.addColorStop(0.35, `rgba(255,170,70,${0.75 * a})`);
    g.addColorStop(rimStop, `rgba(150,60,20,${0.5 * a})`);
    g.addColorStop(1, "rgba(40,20,12,0)");
    c.globalAlpha = 1;
    c.fillStyle = g;
    c.beginPath();
    c.arc(b.x, b.y, R, 0, Math.PI * 2);
    c.fill();
    return;
  }

  // Bright core (near-white).
  const core = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, R * 0.55);
  core.addColorStop(0, `rgba(255,252,240,${0.95 * a})`);
  core.addColorStop(0.6, `rgba(255,220,150,${0.7 * a})`);
  core.addColorStop(1, "rgba(255,160,60,0)");
  c.globalAlpha = 1;
  c.fillStyle = core;
  c.beginPath();
  c.arc(b.x, b.y, R * 0.55, 0, Math.PI * 2);
  c.fill();

  // Turbulent mid fireball: the offset layers roil as the boom ages.
  for (const L of fireballOffsets(b.churnSeed, t)) {
    const lx = b.x + L.dx * R;
    const ly = b.y + L.dy * R;
    const lr = R * L.scale;
    const g = c.createRadialGradient(lx, ly, 0, lx, ly, lr);
    g.addColorStop(0, `rgba(255,150,50,${0.55 * a})`);
    g.addColorStop(0.6, `rgba(220,80,25,${0.3 * a})`);
    g.addColorStop(1, "rgba(120,30,10,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(lx, ly, lr, 0, Math.PI * 2);
    c.fill();
  }

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
 * Volumetric dust: fades IN (never pops), churns while it hangs, settles
 * out smoothly. The three layers per kick read as one roiling cloud.
 */
export function drawVolDust(c: CanvasRenderingContext2D, d: Dust): void {
  const ageA = Math.min(1, d.age / 0.35); // fade-in — no pop
  const outA = alphaOf(d.life, d.maxLife);
  const a = ageA * outA * 0.3;
  if (a <= 0) return;
  const cx = d.x + Math.cos(d.churn + d.age * 1.3) * d.size * 0.22;
  const cy = d.y + Math.sin(d.churn * 1.3 + d.age * 1.7) * d.size * 0.22;
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, d.size);
  g.addColorStop(0, `rgba(203,185,143,${a})`);
  g.addColorStop(0.7, `rgba(203,185,143,${a * 0.5})`);
  g.addColorStop(1, "rgba(203,185,143,0)");
  c.globalAlpha = 1;
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cy, d.size, 0, Math.PI * 2);
  c.fill();
}
