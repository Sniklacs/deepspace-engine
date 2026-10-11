// BATTLE SCENE EFFECTS — the procedural animation layer (Battle Scene P1).
//
// Tracers, muzzle flashes, explosions, smoke, jammer rings, target-paint
// beams, radar sweep. All procedural — no sprite sheets needed, animates at
// any frame rate. The component owns one Fx instance per scene and calls
// update(dt) + draw(ctx, view) each frame.
import {
  GRAPHICS_LADDER,
  particleBudgetMultiplier,
  resolveGraphicsLevel,
} from "../../game/graphics-quality";
// SEAMLESS-WORLD §9 (slice 9): rendered explosion composites + volumetric
// dust/fireballs. effects.ts owns the Fx instance + lifetimes; rendered-fx.ts
// owns the ladder-parameterized LOOK. Runtime import only — rendered-fx.ts
// imports these types type-only, so there is no import cycle.
import {
  SPARK_GRAVITY,
  spawnExplosion,
  spawnMuzzleBloom,
  spawnVolumetricDust,
} from "../../game/war/rendered-fx";

export interface Tracer {
  x1: number; y1: number; x2: number; y2: number;
  life: number; maxLife: number; color: string; width: number;
}
export interface Flash {
  x: number; y: number; life: number; maxLife: number; radius: number; color: string;
}
export interface Boom {
  x: number; y: number; life: number; maxLife: number; radius: number;
  particles: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string }[];
  smoke: { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }[];
  /** Seeded churn phase for the volumetric fireball layers (rendered-fx). */
  churnSeed: number;
  /** PERFORMANCE path: draw the single shaded composite sprite. */
  composite: boolean;
}
export interface Ring {
  x: number; y: number; life: number; maxLife: number; maxR: number; color: string; width: number;
  /** "shock" = the rendered explosion's shockwave ring (double-stroked). */
  kind?: "shock" | "jam";
}
export interface Beam {
  x1: number; y1: number; x2: number; y2: number; life: number; maxLife: number; color: string;
}
export interface Dust {
  x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number;
  /** Age since spawn — drives the fade-in (dust never pops). */
  age: number;
  /** Seeded churn phase for drift wobble while the dust hangs. */
  churn: number;
}
/** Point-light bloom: a flash of light cast onto terrain/units (rendered-fx). */
export interface Bloom {
  x: number; y: number; life: number; maxLife: number; radius: number; color: string;
  /** True = casts onto terrain + units; false = units only (BALANCED). */
  terrain: boolean;
}
/** Impact spark: hot debris with gravity. */
export interface Spark {
  x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string;
}

export class Fx {
  tracers: Tracer[] = [];
  flashes: Flash[] = [];
  booms: Boom[] = [];
  rings: Ring[] = [];
  beams: Beam[] = [];
  /** Kicked-up dust around moving troops — the ground-cam's texture. */
  dusts: Dust[] = [];
  /** Point-light blooms: explosions and muzzle flashes casting light. */
  blooms: Bloom[] = [];
  /** Impact sparks with gravity. */
  sparks: Spark[] = [];
  /** Screen shake trauma 0..1 — decays; offset = trauma² × max. */
  trauma = 0;
  /** Radar sweep angle (radians), active during contact phase. */
  sweep = 0;
  sweepOn = false;

  fire(x1: number, y1: number, x2: number, y2: number, color = "#ffd27a"): void {
    this.tracers.push({ x1, y1, x2, y2, life: 0.22, maxLife: 0.22, color, width: 2 });
    this.flashes.push({ x: x1, y: y1, life: 0.12, maxLife: 0.12, radius: 14, color: "#ffe9b0" });
    // SEAMLESS-WORLD §9 (slice 9): muzzle-flash bloom at the tracer origin —
    // the light travels with the shot (ladder-gated, off on PERFORMANCE).
    spawnMuzzleBloom(this, x1, y1, resolveGraphicsLevel());
    if (this.tracers.length > 220) this.tracers.splice(0, this.tracers.length - 220);
  }

  explode(x: number, y: number, scale = 1): void {
    // SEAMLESS-WORLD §9 (slice 9): the rendered 3-layer composite
    // (core + turbulent fireball + shockwave) + bloom + lingering smoke
    // column + impact sparks — ladder-gated inside rendered-fx. The slice-8
    // particle-budget hook stays the spawn path's budget; trauma is sim-adjacent
    // timing (presentation) and is untouched.
    spawnExplosion(this, x, y, scale, resolveGraphicsLevel());
    this.trauma = Math.min(1, this.trauma + 0.35 * scale);
  }

  /** Logistics autopilot: expanding jammer ring from a warden. */
  jam(x: number, y: number): void {
    if (this.rings.length > 60) return;
    this.rings.push({ x, y, life: 1.6, maxLife: 1.6, maxR: 90, color: "rgba(94,234,212,0.55)", width: 2 });
  }

  /** Logistics autopilot: target-paint beam, warden → enemy. */
  paint(x1: number, y1: number, x2: number, y2: number): void {
    if (this.beams.length > 40) return;
    this.beams.push({ x1, y1, x2, y2, life: 0.8, maxLife: 0.8, color: "rgba(248,113,113,0.8)" });
  }

  /** Dust kicked up by a moving troop — volumetric: layers, drift, churn. */
  dust(x: number, y: number): void {
    if (this.dusts.length > 160) return;
    // SEAMLESS-WORLD §9 (slice 8, kept): ambient dust thins probabilistically
    // per rung — CINEMATIC (budget 1) always spawns, PERFORMANCE keeps ~15%.
    if (Math.random() > particleBudgetMultiplier()) return;
    // SEAMLESS-WORLD §9 (slice 9): the kick is now a layered volumetric
    // cloud — it hangs, spreads, and settles instead of popping in/out.
    spawnVolumetricDust(this, x, y, resolveGraphicsLevel());
  }

  update(dt: number): void {
    const step = <T extends { life: number }>(arr: T[]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        arr[i].life -= dt;
        if (arr[i].life <= 0) arr.splice(i, 1);
      }
    };
    step(this.tracers); step(this.flashes); step(this.rings); step(this.beams);
    step(this.dusts); step(this.blooms); step(this.sparks);
    for (const d of this.dusts) {
      d.age += dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.vx *= 1 - 1.8 * dt; d.vy *= 1 - 1.2 * dt;
      // Churn wobble while the cloud hangs — it breathes, it doesn't hover.
      d.x += Math.sin(d.churn + d.age * 2.2) * 9 * dt;
      d.y += Math.cos(d.churn * 1.4 + d.age * 1.6) * 6 * dt;
      d.size += 10 * dt;
    }
    for (const s of this.sparks) {
      // step() already moved life; integrate velocity under gravity.
      s.vy += SPARK_GRAVITY * dt;
      s.vx *= 1 - 0.6 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      b.life -= dt;
      for (const p of b.particles) {
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 1 - 2.4 * dt; p.vy *= 1 - 2.4 * dt;
      }
      for (const s of b.smoke) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.size += 14 * dt; }
      if (b.life <= 0) this.booms.splice(i, 1);
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    if (this.sweepOn) this.sweep += dt * 1.4;
  }

  /** Current shake offset in px — amplitude gated by the quality rung. */
  shake(maxPx: number): { x: number; y: number } {
    // SEAMLESS-WORLD §9 (slice 9): shake is presentation, never sim — the
    // ladder scales its amplitude (full → reduced → minimal).
    const rung = GRAPHICS_LADDER[resolveGraphicsLevel()].shake;
    const gate = rung === "full" ? 1 : rung === "reduced" ? 0.55 : 0.2;
    const s = this.trauma * this.trauma * maxPx * gate;
    return { x: (Math.random() - 0.5) * 2 * s, y: (Math.random() - 0.5) * 2 * s };
  }
}
