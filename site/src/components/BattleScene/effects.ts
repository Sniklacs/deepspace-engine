// BATTLE SCENE EFFECTS — the procedural animation layer (Battle Scene P1).
//
// Tracers, muzzle flashes, explosions, smoke, jammer rings, target-paint
// beams, radar sweep. All procedural — no sprite sheets needed, animates at
// any frame rate. The component owns one Fx instance per scene and calls
// update(dt) + draw(ctx, view) each frame.
import { particleBudgetMultiplier } from "../../game/graphics-quality";

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
}
export interface Ring {
  x: number; y: number; life: number; maxLife: number; maxR: number; color: string; width: number;
}
export interface Beam {
  x1: number; y1: number; x2: number; y2: number; life: number; maxLife: number; color: string;
}
export interface Dust {
  x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number;
}

export class Fx {
  tracers: Tracer[] = [];
  flashes: Flash[] = [];
  booms: Boom[] = [];
  rings: Ring[] = [];
  beams: Beam[] = [];
  /** Kicked-up dust around moving troops — the ground-cam's texture. */
  dusts: Dust[] = [];
  /** Screen shake trauma 0..1 — decays; offset = trauma² × max. */
  trauma = 0;
  /** Radar sweep angle (radians), active during contact phase. */
  sweep = 0;
  sweepOn = false;

  fire(x1: number, y1: number, x2: number, y2: number, color = "#ffd27a"): void {
    this.tracers.push({ x1, y1, x2, y2, life: 0.22, maxLife: 0.22, color, width: 2 });
    this.flashes.push({ x: x1, y: y1, life: 0.12, maxLife: 0.12, radius: 14, color: "#ffe9b0" });
    if (this.tracers.length > 220) this.tracers.splice(0, this.tracers.length - 220);
  }

  explode(x: number, y: number, scale = 1): void {
    // SEAMLESS-WORLD §9 (slice 8): the graphics ladder thins spawned
    // particles per rung — counts only. Sim behavior (damage, timing,
    // trauma) is untouched; CINEMATIC (budget 1) is byte-identical.
    const budget = particleBudgetMultiplier();
    const nParts = Math.max(1, Math.round(26 * budget));
    const nSmoke = Math.max(1, Math.round(8 * budget));
    const parts: Boom["particles"] = [];
    const smoke: Boom["smoke"] = [];
    for (let i = 0; i < nParts; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 220) * scale;
      parts.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.6, maxLife: 1.1,
        size: 2 + Math.random() * 4,
        color: ["#ffdf8a", "#ff9c3f", "#ff5f2b", "#fff3d6"][i % 4],
      });
    }
    for (let i = 0; i < nSmoke; i++) {
      const a = Math.random() * Math.PI * 2;
      smoke.push({
        x: x + (Math.random() - 0.5) * 20, y: y + (Math.random() - 0.5) * 20,
        vx: Math.cos(a) * 24, vy: -18 - Math.random() * 20,
        life: 1.2 + Math.random() * 1.2, maxLife: 2.4, size: 10 + Math.random() * 14,
      });
    }
    this.booms.push({ x, y, life: 2.4, maxLife: 2.4, radius: 46 * scale, particles: parts, smoke });
    this.rings.push({ x, y, life: 0.5, maxLife: 0.5, maxR: 60 * scale, color: "#ffb35c", width: 3 });
    this.trauma = Math.min(1, this.trauma + 0.35 * scale);
    if (this.booms.length > 40) this.booms.splice(0, this.booms.length - 40);
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

  /** Dust kicked up by a moving troop — soft tan puff, drifts and settles. */
  dust(x: number, y: number): void {
    if (this.dusts.length > 160) return;
    // SEAMLESS-WORLD §9 (slice 8): ambient dust thins probabilistically per
    // rung — CINEMATIC (budget 1) always spawns, PERFORMANCE keeps ~15%.
    if (Math.random() > particleBudgetMultiplier()) return;
    this.dusts.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 26,
      vy: -8 - Math.random() * 22,
      life: 0.7 + Math.random() * 0.8,
      maxLife: 1.5,
      size: 5 + Math.random() * 9,
    });
  }

  update(dt: number): void {
    const step = <T extends { life: number }>(arr: T[]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        arr[i].life -= dt;
        if (arr[i].life <= 0) arr.splice(i, 1);
      }
    };
    step(this.tracers); step(this.flashes); step(this.rings); step(this.beams);
    step(this.dusts);
    for (const d of this.dusts) {
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.vx *= 1 - 1.8 * dt; d.vy *= 1 - 1.2 * dt;
      d.size += 10 * dt;
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

  /** Current shake offset in px. */
  shake(maxPx: number): { x: number; y: number } {
    const s = this.trauma * this.trauma * maxPx;
    return { x: (Math.random() - 0.5) * 2 * s, y: (Math.random() - 0.5) * 2 * s };
  }
}
