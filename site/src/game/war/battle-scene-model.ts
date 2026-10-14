// BATTLE SCENE MODEL — the 2D battle scene's view model (Battle Scene P1).
//
// Pure data + builders. The canvas component (components/BattleScene) renders
// this model; the animation loop mutates a working copy, never this.
// Two sources:
//   • buildDemoScene(nowMs) — synthetic battle for the demo/practice view.
//   • sceneFromBattle(battle) — adapts a live Battle entity.
// Doctrine timeline (presentation): T+0 approach (30s) → T+30 touchdown →
// T+75 first contact → T+90 weapons free. The T+30→T+75 window is unload
// and set positions (owner 2026-10-06: "45 seconds to get your shit
// straight"). The scene clock starts when the scene mounts (demo) or maps
// from battle elapsed (live).

import type { Battle, BattleSide, ManeuverVector } from "./war-types";
import type { TroopType } from "./troops";

/** Renderable unit kinds on the tactical map. */
export type SceneUnitKind = TroopType | "dropship" | "turret";

/**
 * Display names for every icon on the field (owner 2026-10-05: "name the
 * damn icons"). Shared by the canvas tags, the legend, and the FIELD FORCE
 * roster so the visual language is identical everywhere.
 */
export const UNIT_KIND_LABEL: Record<SceneUnitKind, string> = {
  bulwark: "Bulwark",
  reaver: "Reaver",
  longeye: "Longeye",
  thunder: "Thunder",
  warden: "Warden",
  dropship: "Dropship",
  turret: "Turret",
};

/** Troop types only, in doctrine order — the roster/legend row order. */
export const TROOP_KINDS: SceneUnitKind[] = ["bulwark", "reaver", "longeye", "thunder", "warden"];

export type SceneUnitState =
  | "staging" // in dropship / at muster, not yet on the field
  | "descending" // hot drop in progress — committed reserve falling on a picked spot
  | "advancing" // moving to assigned position
  | "holding" // in position, not yet engaged
  | "engaged" // in contact — exchanging fire
  | "withdrawing" // pulling back under relief
  | "dead";

export interface SceneUnit {
  id: string;
  side: BattleSide;
  kind: SceneUnitKind;
  /** Tech tier 1–4 — force quality at a glance (owner 2026-10-05). */
  tier: 1 | 2 | 3 | 4;
  vector: ManeuverVector;
  /**
   * Command squad — the "bus" this unit rides. Attacker squads are one per
   * player (A0..A4, leader + four, mapped by vector); the defender is the
   * Chorus AI ("D"). The click-to-command layer selects and orders squads.
   */
  squadId: string;
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
  /** On-call reserve (owner 2026-10-06): waits for the raid leader's commit
   *  when driving manually (hot drop); on auto it enters at enterAtS. */
  onCall?: boolean;
  /**
   * The force's leader/hero unit (owner 2026-10-13): when a force fields
   * one (a player-led loadout's hero), the itemized target list pins it
   * at the top, named and badged, targetable like any troop. The Chorus
   * defense templates field NO leader — nothing sets this in the demo —
   * so no fake entry ever appears against them.
   */
  leader?: boolean;
  /** The leader's display name (only meaningful with `leader`). */
  name?: string;
  /** Sim-time the hot drop started (descent began). */
  dropAtS?: number;
  /** Sim-time when a stamped move order steps off (command delay) — the
   *  squad holds its position ("plotting") until then. */
  moveAtS?: number;
  /** Sim-time this unit last GENUINELY exchanged fire — it fired a shot or
   *  took a damaging hit (owner ruling 2026-10-14). THIS is commitment:
   *  "casualties mean commitment." Mere proximity (the 0.45-unit presence
   *  radius that flips a unit to the `engaged` STATE for the firing loop)
   *  never sets it — a squad parked deep at its own rear that has never
   *  traded a shot is present, not committed, and stays maneuverable. */
  exchangedAtS?: number;
  /** True while logistics autopilot paints this enemy (target-paint beam). */
  painted?: boolean;
  /**
   * Warden-projected shield (owner 2026-10-11): 0..1 energy pool that
   * absorbs damage BEFORE armor/hull. Only nonzero while living Wardens
   * cover this unit; regenerates while covered, collapses when they die.
   */
  shield01?: number;
  /** Max shield01 — derives from covering Warden count. */
  shieldMax?: number;
  /** Living friendly Wardens projecting over this unit (4Hz refresh). */
  wardenCover?: number;
  /** Sim-time when this thunder may lob its next shell (siege cooldown). */
  nextSiegeAt?: number;
  /**
   * Siege hold-fire (owner 2026-10-11): when true this thunder holds its
   * shells — the commander silences the battery before friendlies enter
   * the blast zone, then resumes. Per-unit; the HUD flips the whole battery.
   */
  siegeHold?: boolean;
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
  /** Graded Chorus defense (deploy-my-loadout): 1 Screen … 5 Bastion.
   *  Drives the counterattack threshold and G5's hunting behavior. */
  chorusGrade?: 1 | 2 | 3 | 4 | 5;
  /** Seeded battlefield terrain — cover vs open ground. */
  terrain: TerrainFeature[];
  units: SceneUnit[];
  turrets: SceneTurret[];
  /** Battle longitude (deg) — anchors the local day/night phase. */
  lonDeg: number;
  /** Epoch ms the scene clock's T+0 maps to (demo: mount time). */
  t0: number;
  seed: number;
  /** Total troops per side — drives casualty-matched deaths for live. */
  troops: { attacker: number; defender: number };
  /**
   * Real player-vs-player duel (owner 2026-10-11): the replay ALWAYS
   * auto-saves and the result feeds the arena ladder rankings.
   */
  pvp?: { opponentId: string; opponentName: string; duelId: string };
}

export type ScenePhase = "approach" | "touchdown" | "contact" | "weapons-free" | "resolved";

/** Doctrine phase boundaries on the scene clock (seconds).
 *  (owner 2026-10-06): touchdown stays T+30; first contact moved T+45 → T+75;
 *  weapons-free T+60 → T+90 (the 15s contact→weapons gap is kept). The
 *  T+30→T+75 window is UNLOAD AND SET POSITIONS — "45 seconds to get your
 *  shit straight": landing craft hit the south staging zone and the player
 *  spreads his lines via click-to-command before contact. */
export const SCENE_PHASES: { phase: ScenePhase; atS: number; label: string }[] = [
  { phase: "approach", atS: 0, label: "APPROACH" },
  { phase: "touchdown", atS: 30, label: "TOUCHDOWN" },
  { phase: "contact", atS: 75, label: "FIRST CONTACT" },
  { phase: "weapons-free", atS: 90, label: "WEAPONS FREE" },
];

export function scenePhaseAt(tS: number): ScenePhase {
  if (tS < 30) return "approach";
  if (tS < 75) return "touchdown";
  if (tS < 90) return "contact";
  return "weapons-free";
}

/**
 * Casualty fraction at which a side's force breaks (demo threshold victory).
 * Doctrine: battles break on casualty thresholds, not mutual annihilation.
 */
export const DEMO_BREAK_FRAC = 0.65;

/** Hot-drop scatter (owner 2026-10-06): 5% of committed drops scatter onto
 *  occupied ground — friend or foe underneath takes casualties both ways. */
export const HOTDROP_SCATTER_CHANCE = 0.05;
/** Splash damage when a drop lands on troops (fraction of hp01). */
export const HOTDROP_SPLASH_DMG = 0.35;
/** How close (tactical units) the drop must be to troops to scatter onto them. */
export const HOTDROP_SCATTER_RADIUS = 0.25;
/** Splash radius around the bad landing. */
export const HOTDROP_SPLASH_RADIUS = 0.07;
/** Enemy proximity that makes a landing zone "hot" (descent fire). */
export const HOTDROP_HOT_RADIUS = 0.35;

export interface ScatterResult {
  x: number;
  y: number;
  scattered: boolean;
  /** unit ids caught in the bad landing (the lander is listed too) */
  splash: string[];
}

/**
 * Pure: resolve a hot-drop landing. 5% of drops scatter onto the nearest
 * occupied ground within HOTDROP_SCATTER_RADIUS — whoever is underneath
 * (friend or foe) and the landing unit both eat splash damage.
 */
export function scatterLanding(
  units: { id: string; side: string; state: string; x: number; y: number }[],
  selfId: string,
  x: number,
  y: number,
  roll: number,
): ScatterResult {
  if (roll >= HOTDROP_SCATTER_CHANCE) return { x, y, scattered: false, splash: [] };
  let best: { id: string; x: number; y: number; d: number } | null = null;
  for (const u of units) {
    if (u.id === selfId || u.state === "dead" || u.state === "staging" || u.state === "descending") continue;
    const d = Math.hypot(u.x - x, u.y - y);
    if (d <= HOTDROP_SCATTER_RADIUS && (!best || d < best.d)) best = { id: u.id, x: u.x, y: u.y, d };
  }
  if (!best) return { x, y, scattered: false, splash: [] };
  const splash = units
    .filter(
      (u) =>
        (u.id === selfId || (u.state !== "dead" && u.state !== "staging" && u.state !== "descending")) &&
        Math.hypot(u.x - best!.x, u.y - best!.y) <= HOTDROP_SPLASH_RADIUS,
    )
    .map((u) => u.id);
  return { x: best.x, y: best.y, scattered: true, splash };
}

/**
 * Pure: which side (if any) has broken at the casualty threshold.
 * Returns the VICTOR side ("attacker" holds the field when the defender
 * breaks, and vice versa), or null while both sides still fight.
 */
export function demoBreakVictor(
  units: { side: string; state: string }[],
): "attacker" | "defender" | null {
  for (const side of ["attacker", "defender"] as const) {
    const total = units.filter((u) => u.side === side).length;
    const dead = units.filter((u) => u.side === side && u.state === "dead").length;
    if (total > 0 && dead / total >= DEMO_BREAK_FRAC) {
      return side === "attacker" ? "defender" : "attacker";
    }
  }
  return null;
}

/** Vector → lane layout on the tactical map (world coords).
 *  North-south battles: flanks spread EAST-WEST along x; main/rear/reserve
 *  stack along the south-north advance axis (see VECTOR_LEAN). */
export const VECTOR_LANES: Record<ManeuverVector, { x: number; spread: number }> = {
  MAIN: { x: 0.75, spread: 0.3 },
  FLANK_LEFT: { x: 0.33, spread: 0.18 },
  FLANK_RIGHT: { x: 1.17, spread: 0.18 },
  REAR: { x: 0.75, spread: 0.22 },
  RESERVE: { x: 0.75, spread: 0.18 },
};

/**
 * Tactical world bounds. The battlefield is 1.5 × 1.5 world units — 2.25x
 * the old 1×1 field — so battles with hundreds of troops have room to
 * breathe. The player deploys on the SOUTH edge and advances north; the
 * Chorus holds the NORTH half.
 */
export const WORLD_W = 1.5;
export const WORLD_H = 1.5;
export const WORLD_CX = WORLD_W / 2;
export const WORLD_CY = WORLD_H / 2;
/** Whole-field framing zoom: at this zoom the full battlefield fits the view. */
export const WORLD_FIT_ZOOM = 1 / WORLD_W;

/**
 * Meters per world unit (owner 2026-10-11): the 1.5-unit field is 150m
 * across — rifle engagement at 0.45 reads as ~45m. Siege AoE, shield radii
 * and other distance-tuned mechanics speak meters; convert at the edges.
 */
export const METERS_PER_WORLD_UNIT = 100;

/** Siege blast damage radius in meters (owner 2026-10-11). */
export const SIEGE_BLAST_R_M = 20;

/**
 * Siege AoE falloff (owner 2026-10-11): damage fraction by distance from
 * impact — 2m:100%, 5m:70%, 10m:50%, 15m:30%, 20m:10%, beyond:0.
 * Smoothly interpolated between rings; shells don't discriminate, so this
 * applies to every unit in the blast, friend or foe. Pure.
 */
const SIEGE_FALLOFF_RINGS: Array<readonly [meters: number, frac: number]> = [
  [0, 1],
  [2, 1],
  [5, 0.7],
  [10, 0.5],
  [15, 0.3],
  [20, 0.1],
];
export function siegeFalloff(meters: number): number {
  if (meters <= 2) return 1;
  for (let i = 1; i < SIEGE_FALLOFF_RINGS.length; i++) {
    const [m1, f1] = SIEGE_FALLOFF_RINGS[i - 1];
    const [m2, f2] = SIEGE_FALLOFF_RINGS[i];
    if (meters <= m2) {
      const k = (meters - m1) / (m2 - m1);
      return f1 + (f2 - f1) * k;
    }
  }
  return 0;
}

/** Depth lean per vector from midfield (world units, south-north axis).
 *  dir = +1 for the attacker (south), −1 for the defender (north).
 *  The defender's layers read north→south as: deep reserve, rear siege,
 *  second line, front line — the front faces the southern attacker. */
export const VECTOR_LEAN: Record<ManeuverVector, number> = {
  MAIN: 0.12,
  FLANK_LEFT: 0.12,
  FLANK_RIGHT: 0.12,
  REAR: 0.24,
  RESERVE: 0.48,
};
/** Siege sits deeper than the second line — pre-sighted in the rear. */
export const THUNDER_LEAN = 0.36;
/** Refused-flank pullback (world units, toward the defender's own back). */
export const REFUSED_FLANK_DEEP = 0.21;

/** Clamp a world x into the field. */
export function clampWorldX(x: number): number {
  return Math.max(0.06, Math.min(WORLD_W - 0.06, x));
}

/** Clamp a world y into the field. */
export function clampWorldY(y: number): number {
  return Math.max(0.06, Math.min(WORLD_H - 0.06, y));
}

// ---------------------------------------------------------------------------
// TERRAIN — seeded cover. Ridges, rock formations, and ruins/debris fields
// vs open ground. Visible during the approach alongside the scout intel so
// the player picks positions with cover in mind. Units in/near cover take
// less damage — same modest scale as the hold bonus.
// ---------------------------------------------------------------------------

/** Cover feature kinds. */
export type TerrainKind = "ridge" | "rocks" | "ruins";

export interface TerrainFeature {
  id: string;
  kind: TerrainKind;
  x: number;
  y: number;
  /** Cover radius (world units). */
  r: number;
}

/** Defensive bonus for fighting in/near cover. */
export const COVER_REDUCTION = 0.12;

/** Seeded terrain for a battle — deterministic per seed, so replays match. */
export function terrainFor(seed: number): TerrainFeature[] {
  const rnd = mulberry32(seed ^ 0x7e44a);
  const kinds: TerrainKind[] = ["ridge", "rocks", "ruins"];
  const n = 6 + Math.floor(rnd() * 3); // 6–8 features
  const out: TerrainFeature[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `tf${i}`,
      kind: kinds[Math.floor(rnd() * kinds.length)],
      x: 0.15 + rnd() * (WORLD_W - 0.3),
      y: 0.15 + rnd() * (WORLD_H - 0.3),
      r: 0.1 + rnd() * 0.08,
    });
  }
  return out;
}

/** True while a world position has cover. */
export function coverAt(x: number, y: number, terrain: TerrainFeature[]): boolean {
  for (const f of terrain) {
    const dx = f.x - x;
    const dy = f.y - y;
    if (dx * dx + dy * dy <= f.r * f.r) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// SCOUT FLYBY — the approach-phase intel gamble (owner 2026-10-06).
// A scout craft sweeps the enemy (north) half; if it completes the run the
// Chorus disposition (lines, grade, positions) is revealed and the player
// plans the unload around it. 20% of flybys get shot down — no second
// scout, no retry: the player deploys blind and meets them at first
// contact. Terrain is mapped on the way in regardless.
// ---------------------------------------------------------------------------

/** Flyby timeline (scene seconds). */
export const FLYBY_START_S = 5;
export const SHOOTDOWN_S = 14;
export const REVEAL_S = 25;

export type ScoutStatus = "pending" | "flying" | "revealed" | "lost";

/** Seeded per battle: 80% the scout completes the sweep, 20% it's lost. */
export function scoutSurvives(seed: number): boolean {
  return mulberry32(seed ^ 0x5c07)() >= 0.2;
}

/** Pure: the scout's status at a scene time — deterministic for replays. */
export function scoutStatusAt(seed: number, tS: number): ScoutStatus {
  if (tS < FLYBY_START_S) return "pending";
  if (!scoutSurvives(seed)) return tS < SHOOTDOWN_S ? "flying" : "lost";
  return tS < REVEAL_S ? "flying" : "revealed";
}

// ---------------------------------------------------------------------------
// BATTLE CLOCK — the shared timeline (owner 2026-10-06).
// The Chorus grants the positioning window, but the battle can't stall:
// from weapons-free the attacker has a sim-time budget (constant across
// SLOW/NORMAL/FAST — the sim clock already scales with pace). Every ~3
// sim-minutes the defense holds, a reinforcement wave feeds the weakest
// defensive vector (capped). Clock expiry = the raid fails: the defense
// held. Framed as the timeline running out, not a punishment.
// ---------------------------------------------------------------------------

/** Sim-seconds of battle from weapons-free before the timeline runs out. */
export const BATTLE_CLOCK_BUDGET_S = 660; // ~11 min at NORMAL
/** Scene time of clock end. */
export const CLOCK_END_S = 90 + BATTLE_CLOCK_BUDGET_S; // T+750
/** Reinforcement wave cadence (sim-seconds past weapons-free). */
export const ESCALATION_INTERVAL_S = 180;
/** Reinforcement waves are capped — the defense thickens, not infinitely. */
export const MAX_REINFORCE_WAVES = 3;

/**
 * Escalation schedule (owner 2026-10-06): every ESCALATION_INTERVAL_S past
 * weapons-free that the defense holds, the next wave is due — capped at
 * MAX_REINFORCE_WAVES. Pure: returns the wave number now due, or 0.
 */
export function waveDueAt(wfT: number, landed: number): number {
  const idx = Math.floor(wfT / ESCALATION_INTERVAL_S);
  return idx >= 1 && idx <= MAX_REINFORCE_WAVES && idx > landed ? idx : 0;
}

/**
 * Weakest defensive vector (fewest living units) — reinforcement waves feed
 * it. Pure.
 */
export function weakestVector(
  units: Pick<SceneUnit, "side" | "vector" | "state">[],
  vectors: ManeuverVector[],
): ManeuverVector {
  let weak = vectors[0];
  let weakN = Infinity;
  for (const v of vectors) {
    const n = units.filter((u) => u.side === "defender" && u.vector === v && u.state !== "dead").length;
    if (n < weakN) {
      weakN = n;
      weak = v;
    }
  }
  return weak;
}

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
  /** On-call posture (owner 2026-10-06 doctrine, restored 2026-10-13):
   *  the RESERVE waits embarked for the commander's commit — the squads
   *  panel shows it as deployable (🪂), a tap + map tap hot-drops it, and
   *  on AUTO it enters at enterAtS like any timed wave. buildUnits shipped
   *  without ever setting this flag, so no reserve was ever on call: the
   *  hot-drop commit in issueOrder filtered on it and always found nobody,
   *  and the panel never marked the squad deployable. */
  onCall?: boolean;
}

/**
 * Command squads, by player: the leader's bus plus four. Each attacker
 * vector is one player's squad (MAIN→0, FLANK_LEFT→1, FLANK_RIGHT→2,
 * REAR→3, RESERVE→4); the defender is the Chorus AI, one mind ("D").
 * Hans drives the attacker squads — click a squad, click the map.
 */
export const VECTOR_PLAYER: Record<ManeuverVector, number> = {
  MAIN: 0,
  FLANK_LEFT: 1,
  FLANK_RIGHT: 2,
  REAR: 3,
  RESERVE: 4,
};

function buildUnits(seed: number): SceneUnit[] {
  const rnd = mulberry32(seed);
  const units: SceneUnit[] = [];
  let n = 0;
  const specs: DemoSpec[] = [];
  for (const side of ["attacker", "defender"] as BattleSide[]) {
    // MAIN body — bulwarks + reavers, enters at touchdown.
    specs.push({ side, vector: "MAIN", kinds: ["bulwark", "bulwark", "reaver", "longeye"], count: 14, enterAtS: 30 });
    // Flanks — reavers + longeyes, spread east-west now.
    specs.push({ side, vector: "FLANK_LEFT", kinds: ["reaver", "reaver", "longeye"], count: 7, enterAtS: 34 });
    specs.push({ side, vector: "FLANK_RIGHT", kinds: ["reaver", "longeye", "longeye"], count: 7, enterAtS: 38 });
    // REAR — thunder siege + warden escort (the doctrine: never without wardens).
    specs.push({ side, vector: "REAR", kinds: ["thunder", "warden", "warden", "bulwark"], count: 6, enterAtS: side === "attacker" ? 300 : 240 });
    // RESERVE — the ace in the hole, embarked and ON CALL.
    specs.push({ side, vector: "RESERVE", kinds: ["bulwark", "reaver", "warden"], count: 6, enterAtS: 480, onCall: true });
  }
  for (const s of specs) {
    const lane = VECTOR_LANES[s.vector];
    // dir: +1 = attacker pushing north from the south edge; −1 = defender
    // holding the north half. Fighting positions stack along the
    // south-north axis by vector lean — no unit ever reads as spawning
    // inside the enemy's defensive positions.
    const dir = s.side === "attacker" ? 1 : -1;
    const backY = s.side === "attacker" ? WORLD_H - 0.08 : 0.08;
    for (let i = 0; i < s.count; i++) {
      const kind = s.kinds[Math.floor(rnd() * s.kinds.length)];
      // Tier mix (owner 2026-10-05): weight T2/T3, some T1 chaff, a few T4
      // elites. Siege is never chaff — thunder floors at T2. Deterministic
      // per seed so the demo muster is stable.
      const roll = rnd();
      let tier: 1 | 2 | 3 | 4 = roll < 0.25 ? 1 : roll < 0.6 ? 2 : roll < 0.9 ? 3 : 4;
      if (kind === "thunder" && tier === 1) tier = 2;
      const lean = kind === "thunder" ? THUNDER_LEAN : VECTOR_LEAN[s.vector];
      const fightY = WORLD_CY + dir * lean + (rnd() - 0.5) * 0.1;
      // Stage on your OWN edge, inside your OWN vector lane — muster reads
      // as an ordered formation, not a blob around mid-height.
      const stageX = clampWorldX(lane.x + (rnd() - 0.5) * 2 * lane.spread);
      const tx = clampWorldX(lane.x + (rnd() - 0.5) * 2 * lane.spread);
      units.push({
        id: `u${n++}`,
        side: s.side,
        kind,
        tier,
        vector: s.vector,
        squadId: s.side === "attacker" ? `A${VECTOR_PLAYER[s.vector]}` : "D",
        x: stageX,
        y: Math.max(0.04, Math.min(WORLD_H - 0.04, backY + (rnd() - 0.5) * 0.06)),
        tx,
        ty: clampWorldY(fightY),
        hp01: 1,
        state: "staging",
        enterAtS: s.enterAtS,
        ...(s.onCall ? { onCall: true } : {}),
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
  // Defender guns hold the north half; the attacker's gun supports from the south.
  for (let i = 0; i < 4; i++) {
    const defender = i < 3;
    turrets.push({
      id: `t${i}`,
      side: defender ? "defender" : "attacker",
      x: defender ? 0.45 + (i % 3) * 0.3 + (rnd() - 0.5) * 0.08 : 0.75 + (rnd() - 0.5) * 0.1,
      y: defender ? 0.5 + (rnd() - 0.5) * 0.08 : 1.0 + (rnd() - 0.5) * 0.08,
      aim: defender ? Math.PI / 2 : -Math.PI / 2, // south at the attacker / north at the defense
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
    terrain: terrainFor(seed),
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
  const turrets: SceneTurret[] = [
    { id: "t0", side: "defender", x: 0.55, y: 0.45, aim: Math.PI / 2, hp01: 1 },
    { id: "t1", side: "defender", x: 0.95, y: 0.55, aim: Math.PI / 2, hp01: 1 },
    { id: "t2", side: "attacker", x: 0.75, y: 1.05, aim: -Math.PI / 2, hp01: 1 },
  ];
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
    terrain: terrainFor(seed),
    // Real PvP duel (owner 2026-10-11): arena bouts auto-save their replay.
    // The ladder itself is fed by the arena's bout ledger (buildLadderEntries).
    pvp: battle.arena ? {
      opponentId: battle.defender.colonyId,
      opponentName: battle.defender.colonyName,
      duelId: battle.arena.challengeId,
    } : undefined,
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
