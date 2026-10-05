// BATTLE SCENE MODEL — the 2D battle scene's view model (Battle Scene P1).
//
// Pure data + builders. The canvas component (components/BattleScene) renders
// this model; the animation loop mutates a working copy, never this.
// Two sources:
//   • buildDemoScene(nowMs) — synthetic battle for the demo/practice view.
//   • sceneFromBattle(battle) — adapts a live Battle entity.
// Doctrine timeline (presentation): T+0 approach (30s) → T+30 touchdown →
// T+45 first contact → T+60 weapons free. The scene clock starts when the
// scene mounts (demo) or maps from battle elapsed (live).

import type { Battle, BattleSide, ManeuverVector } from "./war-types";
import type { TroopType } from "./troops";

/** Renderable unit kinds on the tactical map. */
export type SceneUnitKind = TroopType | "dropship" | "turret";

export type SceneUnitState =
  | "staging" // in dropship / at muster, not yet on the field
  | "advancing" // moving to assigned position
  | "holding" // in position, not yet engaged
  | "engaged" // in contact — exchanging fire
  | "withdrawing" // pulling back under relief
  | "dead";

export interface SceneUnit {
  id: string;
  side: BattleSide;
  kind: SceneUnitKind;
  vector: ManeuverVector;
  /** Tactical coords 0..1. Attacker stages left, defender holds right. */
  x: number;
  y: number;
  /** Assigned position (approach plan). */
  tx: number;
  ty: number;
  hp01: number;
  state: SceneUnitState;
  /** Seconds on the scene clock when this unit enters (delayed entries). */
  enterAtS: number;
  /** True while logistics autopilot paints this enemy (target-paint beam). */
  painted?: boolean;
}

export interface SceneTurret {
  id: string;
  side: BattleSide;
  x: number;
  y: number;
  /** Current aim angle (radians) — the gunner view / auto-target drives this. */
  aim: number;
  hp01: number;
}

export interface SceneBattle {
  id: string;
  name: string;
  attackerName: string;
  defenderName: string;
  /** Tier badge for the scene header when the battle has one (demo: Practice). */
  tier?: string;
  units: SceneUnit[];
  turrets: SceneTurret[];
  /** Battle longitude (deg) — anchors the local day/night phase. */
  lonDeg: number;
  /** Epoch ms the scene clock's T+0 maps to (demo: mount time). */
  t0: number;
  seed: number;
  /** Total troops per side — drives casualty-matched deaths for live. */
  troops: { attacker: number; defender: number };
}

export type ScenePhase = "approach" | "touchdown" | "contact" | "weapons-free" | "resolved";

/** Doctrine phase boundaries on the scene clock (seconds). */
export const SCENE_PHASES: { phase: ScenePhase; atS: number; label: string }[] = [
  { phase: "approach", atS: 0, label: "APPROACH" },
  { phase: "touchdown", atS: 30, label: "TOUCHDOWN" },
  { phase: "contact", atS: 45, label: "FIRST CONTACT" },
  { phase: "weapons-free", atS: 60, label: "WEAPONS FREE" },
];

export function scenePhaseAt(tS: number): ScenePhase {
  if (tS < 30) return "approach";
  if (tS < 45) return "touchdown";
  if (tS < 60) return "contact";
  return "weapons-free";
}

/** Vector → lane layout on the tactical map (0..1 coords). */
export const VECTOR_LANES: Record<ManeuverVector, { y: number; spread: number }> = {
  MAIN: { y: 0.5, spread: 0.16 },
  FLANK_LEFT: { y: 0.22, spread: 0.1 },
  FLANK_RIGHT: { y: 0.78, spread: 0.1 },
  REAR: { y: 0.5, spread: 0.12 },
  RESERVE: { y: 0.5, spread: 0.1 },
};

/** Deterministic PRNG (mulberry32) — the scene layout is stable per seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Night factor 0 (full day) → 1 (full night) for a battle longitude at
 * `nowMs`. Same idea as solar.ts: the subsolar longitude drifts 15°/hour;
 * local solar midnight ⇒ night. Pure.
 */
export function sceneNightFactor(lonDeg: number, nowMs: number): number {
  const d = new Date(nowMs);
  const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  // Subsolar longitude ≈ 180 − 15 × UTC hours (same convention as solar.ts).
  const subsolarLon = 180 - 15 * utcHours;
  let delta = Math.abs(lonDeg - subsolarLon) % 360;
  if (delta > 180) delta = 360 - delta;
  // delta 0 ⇒ local noon, 180 ⇒ local midnight.
  const t = (delta - 90) / 60; // 0 at day edge → 1 past 150°
  const cl = Math.max(0, Math.min(1, t));
  return cl * cl * (3 - 2 * cl); // smoothstep
}

interface DemoSpec {
  side: BattleSide;
  vector: ManeuverVector;
  kinds: SceneUnitKind[];
  count: number;
  enterAtS: number;
  backX: number; // staging x for this side
}

function buildUnits(seed: number): SceneUnit[] {
  const rnd = mulberry32(seed);
  const units: SceneUnit[] = [];
  let n = 0;
  const specs: DemoSpec[] = [];
  for (const side of ["attacker", "defender"] as BattleSide[]) {
    const backX = side === "attacker" ? 0.06 : 0.94;
    // MAIN body — bulwarks + reavers, enters at touchdown.
    specs.push({ side, vector: "MAIN", kinds: ["bulwark", "bulwark", "reaver", "longeye"], count: 14, enterAtS: 30, backX });
    // Flanks — reavers + longeyes.
    specs.push({ side, vector: "FLANK_LEFT", kinds: ["reaver", "reaver", "longeye"], count: 7, enterAtS: 34, backX });
    specs.push({ side, vector: "FLANK_RIGHT", kinds: ["reaver", "longeye", "longeye"], count: 7, enterAtS: 38, backX });
    // REAR — thunder siege + warden escort (the doctrine: never without wardens).
    specs.push({ side, vector: "REAR", kinds: ["thunder", "warden", "warden", "bulwark"], count: 6, enterAtS: side === "attacker" ? 300 : 240, backX });
    // RESERVE — the ace in the hole, embarked.
    specs.push({ side, vector: "RESERVE", kinds: ["bulwark", "reaver", "warden"], count: 6, enterAtS: 480, backX });
  }
  for (const s of specs) {
    const lane = VECTOR_LANES[s.vector];
    const dir = s.side === "attacker" ? 1 : -1;
    // Assigned fighting position: mid-field biased by vector, with a side
    // lean that tells the story — attackers push past midfield, defenders
    // hold their ground. (Owner 2026-10-05: no unit should ever read as
    // spawning inside the enemy's defensive positions.)
    const sideLean = s.vector === "REAR" ? 0.18 : s.vector === "RESERVE" ? 0.3 : 0.08;
    const fightX = 0.5 - dir * sideLean + (rnd() - 0.5) * 0.08;
    for (let i = 0; i < s.count; i++) {
      const kind = s.kinds[Math.floor(rnd() * s.kinds.length)];
      // Stage on your OWN side, inside your OWN vector lane — muster reads
      // as an ordered formation, not a blob around mid-height.
      const stageY = Math.max(0.06, Math.min(0.94, lane.y + (rnd() - 0.5) * 2 * lane.spread));
      const ty = Math.max(0.06, Math.min(0.94, lane.y + (rnd() - 0.5) * 2 * lane.spread));
      units.push({
        id: `u${n++}`,
        side: s.side,
        kind,
        vector: s.vector,
        x: s.backX + (rnd() - 0.5) * 0.05,
        y: stageY,
        tx: Math.max(0.08, Math.min(0.92, fightX + (rnd() - 0.5) * 0.1)),
        ty,
        hp01: 1,
        state: "staging",
        enterAtS: s.enterAtS,
      });
    }
  }
  return units;
}

/** Synthetic battle for the demo/practice scene. Always renders + animates. */
export function buildDemoScene(nowMs: number): SceneBattle {
  const seed = 1337;
  const troops = { attacker: 5200, defender: 4800 };
  const units = buildUnits(seed);
  const rnd = mulberry32(seed ^ 0x9e37);
  const turrets: SceneTurret[] = [];
  for (let i = 0; i < 4; i++) {
    turrets.push({
      id: `t${i}`,
      side: i < 3 ? "defender" : "attacker",
      x: i < 3 ? 0.78 + rnd() * 0.1 : 0.16 + rnd() * 0.08,
      y: 0.2 + i * 0.2 + (rnd() - 0.5) * 0.06,
      aim: i < 3 ? Math.PI : 0,
      hp01: 1,
    });
  }
  return {
    id: "demo-battle",
    name: "Practice engagement — Muster Flats",
    attackerName: "Ashen Vanguard",
    defenderName: "Chorus Garrison",
    tier: "Practice",
    units,
    turrets,
    lonDeg: -84.4,
    t0: nowMs,
    seed,
    troops,
  };
}

/**
 * Adapt a live Battle entity into a scene. Troop counts come from the real
 * committed forces; vector layout falls back to doctrine formation when the
 * plan's entered maneuvers aren't visible. Pure.
 */
export function sceneFromBattle(battle: Battle): SceneBattle {
  const seed = hashStr(battle.id);
  const troops = {
    attacker: Math.max(1, Math.trunc(battle.attacker.troops)),
    defender: Math.max(1, Math.trunc(battle.defender.troops)),
  };
  const units = buildUnits(seed);
  const rnd = mulberry32(seed ^ 0x51f7);
  const turrets: SceneTurret[] = [
    { id: "t0", side: "defender", x: 0.8, y: 0.3, aim: Math.PI, hp01: 1 },
    { id: "t1", side: "defender", x: 0.84, y: 0.62, aim: Math.PI, hp01: 1 },
    { id: "t2", side: "attacker", x: 0.18, y: 0.5, aim: 0, hp01: 1 },
  ];
  void rnd;
  return {
    id: battle.id,
    name: battle.zoneName || battle.zoneId,
    attackerName: battle.attacker.colonyName,
    defenderName: battle.defender.colonyName,
    units,
    turrets,
    lonDeg: ((seed % 360) - 180),
    t0: battle.startedAt,
    seed,
    troops,
  };
}

/** Scene clock seconds since T+0. */
export function sceneClockS(scene: SceneBattle, nowMs: number): number {
  return Math.max(0, (nowMs - scene.t0) / 1000);
}

/** Format mm:ss for the battle clock. */
export function fmtSceneClock(tS: number): string {
  const m = Math.floor(tS / 60);
  const s = Math.floor(tS % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
