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
  spawnImpact,
  spawnMuzzleBloom,
  spawnVolumetricDust,
} from "../../game/war/rendered-fx";

export interface Tracer {
  x1: number; y1: number; x2: number; y2: number;
  life: number; maxLife: number; color: string; width: number;
  /** beam = sustained energy shot; slug = kinetic round (short bright streak). */
  kind: "beam" | "slug";
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
  kind?: "shock" | "jam" | "shield";
}
/** A lobbed siege shell — travels a visible arc, then detonates. */
export interface Shell {
  x1: number; y1: number; x2: number; y2: number;
  /** 0..1 flight progress */
  t: number;
  /** seconds of flight */
  dur: number;
  /** arc height in px */
  arc: number;
  color: string;
  size: number;
  /** damage payload + firing side — set by the scene, resolved on landing. */
  dmg?: number;
  side?: string;
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
  /** 0..1 — how strongly the dust is lit by a nearby blast (tints orange, decays). */
  lit: number;
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
/** Debris chunk: a tumbling solid fragment from an explosion — dark body, hot edge. */
export interface Chunk {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number;
  rot: number; rotV: number; color: string;
}
/** Ember: a tiny bright mote that rises on the heat and flickers out. */
export interface Ember {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; seed: number;
}
/** Scorch: the dark mark an explosion leaves on the ground — fades slowly. */
export interface Scorch {
  x: number; y: number; radius: number;
  life: number; maxLife: number;
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
  /** Tumbling explosion debris. */
  chunks: Chunk[] = [];
  /** Rising heat embers. */
  embers: Ember[] = [];
  /** Ground scorch decals. */
  scorches: Scorch[] = [];
  /** Lobbed siege shells in flight. */
  shells: Shell[] = [];
  /** Screen shake trauma 0..1 — decays; offset = trauma² × max. */
  trauma = 0;
  /** Radar sweep angle (radians), active during contact phase. */
  sweep = 0;
  sweepOn = false;

  fire(x1: number, y1: number, x2: number, y2: number, color = "#ffd27a"): void {
    this.tracers.push({ x1, y1, x2, y2, life: 0.22, maxLife: 0.22, color, width: 2, kind: "beam" });
    this.flashes.push({ x: x1, y: y1, life: 0.12, maxLife: 0.12, radius: 14, color: "#ffe9b0" });
    // SEAMLESS-WORLD §9 (slice 9): muzzle-flash bloom at the tracer origin —
    // the light travels with the shot (ladder-gated, off on PERFORMANCE).
    spawnMuzzleBloom(this, x1, y1, resolveGraphicsLevel());
    // The shot lands: impact flash + sparks at the target end.
    spawnImpact(this, x2, y2, color, resolveGraphicsLevel());
    if (this.tracers.length > 220) this.tracers.splice(0, this.tracers.length - 220);
  }

  /**
   * Kinetic burst (owner 2026-10-11): chain guns and rifles don't shoot
   * lightsabers. A 3-round burst of short bright slugs — dakka, not a beam.
   * Same damage event as one beam shot; the burst is pure presentation.
   */
  fireKinetic(x1: number, y1: number, x2: number, y2: number, color = "#ffe9b0"): void {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len, ny = dy / len;
    // perpendicular for the spread jitter
    const px = -ny, py = nx;
    for (let i = 0; i < 3; i++) {
      // stagger the burst along the flight path — the rounds chase each other
      const back = i * len * 0.06;
      const jx = (Math.random() - 0.5) * 10, jy = (Math.random() - 0.5) * 10;
      const sx = x1 - nx * back + px * jx * 0.3;
      const sy = y1 - ny * back + py * jy * 0.3;
      // slugs are SHORT — a bright streak, not a full-length line
      const slugLen = Math.min(len * 0.35, 46);
      const ex = sx + nx * slugLen + px * jx * 0.3;
      const ey = sy + ny * slugLen + py * jy * 0.3;
      const life = 0.14 - i * 0.02;
      this.tracers.push({ x1: sx, y1: sy, x2: ex, y2: ey, life, maxLife: 0.14, color, width: 1.6, kind: "slug" });
    }
    // the muzzle blast: bigger, hotter, star-shaped flash for gunfire
    this.flashes.push({ x: x1, y: y1, life: 0.1, maxLife: 0.1, radius: 20, color: "#fff6d8" });
    spawnMuzzleBloom(this, x1, y1, resolveGraphicsLevel());
    spawnImpact(this, x2, y2, color, resolveGraphicsLevel());
    if (this.tracers.length > 220) this.tracers.splice(0, this.tracers.length - 220);
  }

  /**
   * Lob a siege shell (owner 2026-10-11): a big visible projectile arcing
   * through the air. Presentation only — BattleScene advances the flight
   * and detonates on landing.
   */
  lobShell(x1: number, y1: number, x2: number, y2: number, dur = 1.4, size = 1): void {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    this.shells.push({
      x1, y1, x2, y2, t: 0, dur,
      arc: Math.min(140, 40 + dist * 0.25),
      color: "#ffb347", size,
    });
    // the thump of the launch
    this.flashes.push({ x: x1, y: y1, life: 0.18, maxLife: 0.18, radius: 26, color: "#ffd9a0" });
    if (this.shells.length > 40) this.shells.splice(0, this.shells.length - 40);
  }

  /** Shield impact ripple (owner 2026-10-11): the bubble shivers where the hit lands. */
  shieldHit(x: number, y: number): void {
    if (this.rings.length > 60) return;
    this.rings.push({ x, y, life: 0.45, maxLife: 0.45, maxR: 26, color: "rgba(125,211,252,0.8)", width: 2, kind: "shield" });
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
    step(this.chunks); step(this.embers); step(this.scorches);
    for (const d of this.dusts) {
      d.age += dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.vx *= 1 - 1.8 * dt; d.vy *= 1 - 1.2 * dt;
      // Churn wobble while the cloud hangs — it breathes, it doesn't hover.
      d.x += Math.sin(d.churn + d.age * 2.2) * 9 * dt;
      d.y += Math.cos(d.churn * 1.4 + d.age * 1.6) * 6 * dt;
      d.size += 10 * dt;
      // Blast lighting fades as the cloud drifts from the fire.
      d.lit = Math.max(0, d.lit - dt * 0.8);
    }
    for (const s of this.sparks) {
      // step() already moved life; integrate velocity under gravity.
      s.vy += SPARK_GRAVITY * dt;
      s.vx *= 1 - 0.6 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
    }
    for (const ch of this.chunks) {
      // Tumbling debris: gravity pulls, drag slows, it spins as it falls.
      ch.vy += SPARK_GRAVITY * 0.7 * dt;
      ch.vx *= 1 - 0.4 * dt;
      ch.x += ch.vx * dt; ch.y += ch.vy * dt;
      ch.rot += ch.rotV * dt;
    }
    for (const e of this.embers) {
      // Embers are buoyant — they rise on the heat, drift, and flicker out.
      e.vy -= 60 * dt;
      e.vx *= 1 - 0.8 * dt;
      e.vy *= 1 - 0.5 * dt;
      e.x += e.vx * dt + Math.sin(e.seed + e.life * 9) * 14 * dt;
      e.y += e.vy * dt;
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
