// DEPLOY MY LOADOUT — Hans's real barracks force on the battle scene.
//
// The Arena's practice battle was a canned demo; this builds a SceneBattle
// from the player's ACTUAL tiered roster (TroopCohort { type, tier, count }).
// Pure module: reads picks, never touches the roster — the Arena is
// bloodless, so no troops are lost, mustered, or moved. The scene just
// renders.
//
// Doctrine staging (mirrors buildUnits in battle-scene-model):
//   bulwark -> MAIN (holders)          reaver -> FLANK_L / FLANK_R (shock)
//   longeye -> REAR (ranged support)   thunder -> REAR, delayed 300s (siege)
//   warden  -> REAR escort first, overflow to flanks
//   ~20% of bulwark+reaver held in RESERVE (enterAtS 240) — the ace in hole.
// The enemy is a Chorus garrison lined up by a seeded defensive commander
// (chorusCommanderFor) — a layered defense scaled to comparable power via
// the tier power curve: a real fight, not a guaranteed win, not a slaughter.
// (owner 2026-10-06): the Chorus fights like a survivor — it defends first,
// holds a modest bonus while in posture, and commits its reserve when the
// player bleeds. See chorus-doctrine.ts.

import {
  TROOP_TYPES,
  supplyWeight,
  tierPowerMult,
  type TroopRoster,
  type TroopTier,
  type TroopType,
} from "./troops";
import type { BattleSide, ManeuverVector } from "./war-types";
import { troopReverb } from "../formations";
import {
  clampWorldX,
  clampWorldY,
  REFUSED_FLANK_DEEP,
  terrainFor,
  THUNDER_LEAN,
  VECTOR_LANES,
  VECTOR_LEAN,
  VECTOR_PLAYER,
  WORLD_CY,
  WORLD_H,
  mulberry32,
  type SceneBattle,
  type SceneTurret,
  type SceneUnit,
  type SceneUnitKind,
} from "./battle-scene-model";

/** Max SceneUnits on the field per deployment — canvas perf + readability. */
export const DEPLOY_CAP = 100;

/** One line of the muster picker: how many of type×tier Hans fields. */
export interface DeploymentPick {
  type: TroopType;
  tier: TroopTier;
  count: number;
}

/** Tier-weighted battle power of a pick list: the number the war layer
 *  prices forces at (same curve as rosterPower). */
export function picksPower(picks: DeploymentPick[]): number {
  return picks.reduce(
    (p, k) => p + Math.max(0, Math.trunc(k.count)) * supplyWeight(k.type) * tierPowerMult(k.tier),
    0,
  );
}

export function picksCount(picks: DeploymentPick[]): number {
  return picks.reduce((n, k) => n + Math.max(0, Math.trunc(k.count)), 0);
}

/** Clamp picks to what the roster actually holds (and drop empties). Pure. */
export function clampPicksToRoster(picks: DeploymentPick[], roster: TroopRoster): DeploymentPick[] {
  const owned = new Map<string, number>();
  for (const c of roster.cohorts) {
    const k = `${c.type}:${c.tier}`;
    owned.set(k, (owned.get(k) ?? 0) + c.count);
  }
  return picks
    .map((p) => ({ ...p, count: Math.max(0, Math.min(Math.trunc(p.count), owned.get(`${p.type}:${p.tier}`) ?? 0)) }))
    .filter((p) => p.count > 0);
}

interface PlacedUnit {
  type: TroopType;
  tier: TroopTier;
  vector: ManeuverVector;
  enterAtS: number;
  /** Refused-flank layout: this unit stages deep, pulled back off the line. */
  deep?: boolean;
}

/** Doctrine vector assignment for Hans's force. */
function assignVectors(picks: DeploymentPick[]): PlacedUnit[] {
  const placed: PlacedUnit[] = [];
  const byType = new Map<TroopType, DeploymentPick[]>();
  for (const p of picks) {
    const list = byType.get(p.type) ?? [];
    list.push(p);
    byType.set(p.type, list);
  }
  const expand = (type: TroopType): { tier: TroopTier }[] => {
    const out: { tier: TroopTier }[] = [];
    for (const p of byType.get(type) ?? []) {
      for (let i = 0; i < p.count; i++) out.push({ tier: p.tier });
    }
    return out;
  };

  // Walk each type's units in order.
  const units: { type: TroopType; tier: TroopTier }[] = [];
  for (const t of TROOP_TYPES) units.push(...expand(t).map((u) => ({ type: t, tier: u.tier })));

  // Partition: reserve = every 5th bulwark/reaver (20%), rest by doctrine.
  const field: typeof units = [];
  const reserve: typeof units = [];
  const counters = new Map<TroopType, number>();
  for (const u of units) {
    if (u.type === "bulwark" || u.type === "reaver") {
      const c = (counters.get(u.type) ?? 0) + 1;
      counters.set(u.type, c);
      if (c % 5 === 0) {
        reserve.push(u);
        continue;
      }
    }
    field.push(u);
  }

  let flankFlip = false;
  for (const u of field) {
    if (u.type === "bulwark") placed.push({ ...u, vector: "MAIN", enterAtS: 30 });
    else if (u.type === "reaver") {
      flankFlip = !flankFlip;
      placed.push({ ...u, vector: flankFlip ? "FLANK_LEFT" : "FLANK_RIGHT", enterAtS: flankFlip ? 34 : 38 });
    } else if (u.type === "longeye") placed.push({ ...u, vector: "REAR", enterAtS: 40 });
    else if (u.type === "thunder") placed.push({ ...u, vector: "REAR", enterAtS: 300 }); // delayed siege entry — doctrine
    else placed.push({ ...u, vector: "REAR", enterAtS: 40 }); // warden escort
  }
  // Wardens ride with the rear first (escort), so the siege never walks alone.
  // (Placement order above already puts all wardens in REAR.)
  for (const u of reserve) placed.push({ ...u, vector: "RESERVE", enterAtS: 240 });

  return placed;
}

/** Stage placed units onto the tactical map — north-south conventions:
 *  the attacker musters on the SOUTH edge and pushes north; the defender
 *  holds the NORTH half in layered depth. Flanks spread east-west. */
function stageUnits(
  placed: PlacedUnit[],
  side: BattleSide,
  seed: number,
  squadFor: (v: ManeuverVector) => string,
): SceneUnit[] {
  const rnd = mulberry32(seed);
  const dir = side === "attacker" ? 1 : -1; // +1 south (attacker), −1 north (defender)
  const backY = side === "attacker" ? WORLD_H - 0.08 : 0.08;
  return placed.map((p, n) => {
    const lane = VECTOR_LANES[p.vector];
    const lean = p.type === "thunder" ? THUNDER_LEAN : VECTOR_LEAN[p.vector];
    // Refused flank: this wing stages deep, pulled off the line toward its
    // own back — the defense reads as refused before the first shot.
    const deepShift = p.deep ? REFUSED_FLANK_DEEP : 0;
    const fightY = WORLD_CY + dir * (lean + deepShift) + (rnd() - 0.5) * 0.1;
    const laneJitter = () => lane.x + (rnd() - 0.5) * 2 * lane.spread;
    return {
      id: `${side === "attacker" ? "p" : "e"}${n}`,
      side,
      kind: p.type as SceneUnitKind,
      tier: p.tier,
      vector: p.vector,
      squadId: squadFor(p.vector),
      x: clampWorldX(laneJitter()),
      y: Math.max(0.04, Math.min(WORLD_H - 0.04, backY + (rnd() - 0.5) * 0.06)),
      tx: clampWorldX(laneJitter()),
      ty: clampWorldY(fightY),
      hp01: 1,
      state: "staging" as const,
      enterAtS: p.enterAtS,
    };
  });
}

/** Five graded Chorus defenses (owner 2026-10-06): G1 the smallest and
 *  easiest to crack, G5 the hardest — rated by power and reverb, scaled
 *  relative to the player's deployed power so every grade stays meaningful
 *  no matter the force size. G5 is special: the survivor that learned to
 *  hunt — it holds an offensive strike package and hits back. */
export type ChorusGrade = 1 | 2 | 3 | 4 | 5;

export interface ChorusGradeSpec {
  grade: ChorusGrade;
  /** "Screen" … "Bastion" */
  name: string;
  /** Picker blurb — what Hans is signing up for. */
  blurb: string;
  /** Enemy power as a fraction of the player's deployed power. */
  powerRatio: number;
  mix: Record<TroopType, number>;
  /** Pre-sighted siege in the rear (G1: none). */
  siege: boolean;
  /** Every Nth bulwark/reaver held in reserve (0 = no reserve). */
  reserveEvery: number;
  reserveAtS: number;
  /** One flank stages deep, pulled off the line. */
  refusedFlank: boolean;
  /** Wardens screen with the front line instead of the rear. */
  wardenScreen: boolean;
  /** Player-strength fraction that triggers the reserve commitment. */
  counterThreshold: number;
  /** G5: commits a strike package proactively and tries to win. */
  hunts: boolean;
  /** Extra picker warning for the grade that hits back. */
  hint?: string;
}

export const CHORUS_GRADES: Record<ChorusGrade, ChorusGradeSpec> = {
  1: {
    grade: 1, name: "Screen", powerRatio: 0.6,
    blurb: "Thin picket line — a few tanks forward, almost nothing behind. Easiest to crack.",
    mix: { bulwark: 0.5, reaver: 0.3, longeye: 0.15, thunder: 0, warden: 0.05 },
    siege: false, reserveEvery: 0, reserveAtS: 240,
    refusedFlank: false, wardenScreen: false, counterThreshold: 0.6, hunts: false,
  },
  2: {
    grade: 2, name: "Picket", powerRatio: 0.8,
    blurb: "A real front line with a thin second line and a token reserve.",
    mix: { bulwark: 0.4, reaver: 0.25, longeye: 0.2, thunder: 0.05, warden: 0.1 },
    siege: true, reserveEvery: 8, reserveAtS: 240,
    refusedFlank: false, wardenScreen: false, counterThreshold: 0.6, hunts: false,
  },
  3: {
    grade: 3, name: "Bulwark", powerRatio: 1.0,
    blurb: "The standard layered defense — front, second line, siege, deep reserve. The fair fight.",
    mix: { bulwark: 0.36, reaver: 0.24, longeye: 0.2, thunder: 0.08, warden: 0.12 },
    siege: true, reserveEvery: 5, reserveAtS: 240,
    refusedFlank: false, wardenScreen: false, counterThreshold: 0.6, hunts: false,
  },
  4: {
    grade: 4, name: "Fortress", powerRatio: 1.25,
    blurb: "Deep layers, a refused flank, a strong reserve, pre-sighted siege, warden screens.",
    mix: { bulwark: 0.34, reaver: 0.22, longeye: 0.18, thunder: 0.12, warden: 0.14 },
    siege: true, reserveEvery: 4, reserveAtS: 240,
    refusedFlank: true, wardenScreen: true, counterThreshold: 0.65, hunts: false,
  },
  5: {
    grade: 5, name: "Bastion", powerRatio: 1.5,
    blurb: "Thickest everything — deepest lines, biggest reserve, overlapping coverage.",
    mix: { bulwark: 0.34, reaver: 0.24, longeye: 0.16, thunder: 0.12, warden: 0.14 },
    siege: true, reserveEvery: 3, reserveAtS: 240,
    refusedFlank: true, wardenScreen: true, counterThreshold: 0.75, hunts: true,
    hint: "⚠️ Bastion counterattacks — it hits back.",
  },
};

/** The fair fight — the picker's default and the builder's. */
export const DEFAULT_CHORUS_GRADE: ChorusGrade = 3;

export function isChorusGrade(n: number): n is ChorusGrade {
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5;
}

export interface ChorusLineup {
  grade: ChorusGrade;
  placed: PlacedUnit[];
}

/** Doctrinal Chorus defense at the given grade: a formed, layered army.
 *
 *  G1 Screen: thin picket — tanks forward, almost nothing behind, no siege,
 *  no reserve. G2 Picket: a real front line, thin second line, token
 *  reserve. G3 Bulwark: the standard layered defense — front / second /
 *  rear siege / deep reserve. G4 Fortress: deep layers, a refused flank,
 *  strong reserve, warden screens. G5 Bastion: thickest everything, biggest
 *  reserve — and an offensive strike package (fast movers + siege) held in
 *  the deep reserve, because the Bastion hunts.
 *
 *  Power target = player power × grade ratio (±5% window, one-unit overshoot
 *  at most) — the difficulty curve is the grade dial, nothing else moves.
 *  Seeded layout variation (which flank refuses, exact rolls) keeps battles
 *  from feeling identical; same seed → same defense, so replays stay stable. */
export function buildChorusLineup(
  targetPower: number,
  seed: number,
  grade: ChorusGrade = DEFAULT_CHORUS_GRADE,
): ChorusLineup {
  const spec = CHORUS_GRADES[grade];
  const rnd = mulberry32(seed ^ 0x51f7);
  const mix = spec.mix;
  // Refused flank: one flank stages deep, pulled off the line (seeded which).
  const refusedFlank: ManeuverVector | null =
    spec.refusedFlank ? (rnd() < 0.5 ? "FLANK_LEFT" : "FLANK_RIGHT") : null;

  const typeRoll = (): TroopType => {
    const r = rnd();
    let acc = 0;
    for (const t of TROOP_TYPES) {
      acc += mix[t];
      if (r < acc) return t;
    }
    return "bulwark";
  };

  const tierRoll = (type: TroopType): TroopTier => {
    const r = rnd();
    // Veterans hold the front line — the heavies skew a tier up.
    const lo = type === "bulwark" ? 0.15 : 0.25;
    const mid = type === "bulwark" ? 0.55 : 0.6;
    let t: TroopTier = r < lo ? 1 : r < mid ? 2 : r < 0.9 ? 3 : 4;
    if (type === "thunder" && t === 1) t = 2; // siege is never chaff
    return t;
  };

  const placed: PlacedUnit[] = [];
  const powerTarget = targetPower * spec.powerRatio;
  let power = 0;
  let guard = 0;
  let flankFlip = false;
  let bulwarkN = 0;
  let reaverN = 0;
  let thunderN = 0;
  while (power < powerTarget * 0.95 && placed.length < 120 && guard++ < 500) {
    const type = typeRoll();
    const tier = tierRoll(type);
    power += supplyWeight(type) * tierPowerMult(tier);
    let vector: ManeuverVector;
    let enterAtS: number;
    let deep = false;
    if (type === "bulwark") {
      bulwarkN++;
      if (spec.reserveEvery > 0 && bulwarkN % spec.reserveEvery === 0) {
        vector = "RESERVE";
        enterAtS = spec.reserveAtS; // heavies held back, committed with the reserve
      } else {
        vector = "MAIN";
        enterAtS = 30;
      }
    } else if (type === "reaver") {
      reaverN++;
      if (spec.reserveEvery > 0 && reaverN % spec.reserveEvery === 0) {
        vector = "RESERVE";
        enterAtS = spec.reserveAtS; // the ace in the hole — G5's strike package rides here
      } else {
        flankFlip = !flankFlip;
        vector = flankFlip ? "FLANK_LEFT" : "FLANK_RIGHT";
        enterAtS = flankFlip ? 34 : 38;
        // Refused flank: this wing stages deep, off the line.
        if (refusedFlank && vector === refusedFlank) {
          deep = true;
          enterAtS += 60;
        }
      }
    } else if (type === "thunder") {
      thunderN++;
      if (spec.hunts && thunderN % 2 === 0) {
        // Bastion's strike package: siege held in the deep reserve, committed
        // proactively — the survivor that learned to hunt.
        vector = "RESERVE";
        enterAtS = spec.reserveAtS;
      } else {
        vector = "REAR";
        enterAtS = 300; // siege pre-sighted in the rear — same clock as the player's thunder
      }
    } else if (type === "warden" && spec.wardenScreen) {
      vector = "REAR";
      enterAtS = 30; // warden screen rides up with the front line
    } else {
      vector = "REAR"; // longeyes on the second line, wardens riding escort
      enterAtS = 40;
    }
    placed.push({ type, tier, vector, enterAtS, deep });
  }
  return { grade, placed };
}

function buildTurrets(seed: number): SceneTurret[] {
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
  return turrets;
}

export interface DeployOptions {
  /** Display name for Hans's force (e.g. his gameId). */
  attackerName: string;
  /** Epoch ms the scene clock's T+0 maps to. */
  nowMs: number;
  /** Deterministic layout seed (default: derived from picks). */
  seed?: number;
  /** How hard a fight Hans wants — default G3, the fair fight. */
  grade?: ChorusGrade;
}

/** The deterministic layout seed for a pick list (shared by builder + preview). */
export function deploySeedFor(picks: DeploymentPick[]): number {
  return picks.reduce((s, p) => s + p.count * (p.tier + 1) * (TROOP_TYPES.indexOf(p.type) + 1), 7);
}

/**
 * Honest reverb of a built force on the game's reverb scale (same scale as
 * troopReverb — the number the war layer prices forces at, tier-weighted).
 */
export function forceReverb(items: { type: TroopType; tier: TroopTier; count: number }[]): number {
  return Math.round(
    items.reduce(
      (s, i) => s + Math.max(0, Math.trunc(i.count)) * troopReverb(i.type, 1) * tierPowerMult(i.tier),
      0,
    ),
  );
}

/** Reverb of Hans's picked force — the number he compares the grade against. */
export function picksReverb(picks: DeploymentPick[]): number {
  return forceReverb(picks);
}

/** Reverb of a built Chorus garrison — computed from its actual composition. */
export function garrisonReverb(placed: PlacedUnit[]): number {
  return forceReverb(placed.map((p) => ({ type: p.type, tier: p.tier, count: 1 })));
}

/** Preview the enemy's reverb for the picker — same seed the deploy will use,
 *  so the number Hans sees is the number he fights. */
export function previewGarrisonReverb(picks: DeploymentPick[], grade: ChorusGrade): number {
  const power = picksPower(picks);
  if (power <= 0) return 0;
  return garrisonReverb(buildChorusLineup(power, deploySeedFor(picks), grade).placed);
}

/**
 * Build a bloodless practice battle from Hans's real picks. Pure — the
 * roster is never touched. Throws on an empty force.
 */
export function buildPlayerScene(rawPicks: DeploymentPick[], opts: DeployOptions): SceneBattle {
  const picks = rawPicks
    .map((p) => ({ ...p, count: Math.max(0, Math.trunc(p.count)) }))
    .filter((p) => p.count > 0);
  const total = picksCount(picks);
  if (total === 0) throw new Error("buildPlayerScene: empty force — pick at least one troop");
  if (total > DEPLOY_CAP) throw new Error(`buildPlayerScene: ${total} exceeds the ${DEPLOY_CAP}-unit field cap`);

  const seed = opts.seed ?? deploySeedFor(picks);
  const grade = opts.grade ?? DEFAULT_CHORUS_GRADE;
  const playerPlaced = assignVectors(picks);
  const playerPower = picksPower(picks);
  const { placed: enemyPlaced } = buildChorusLineup(playerPower, seed, grade);

  const units = [
    ...stageUnits(playerPlaced, "attacker", seed, (v) => `A${VECTOR_PLAYER[v]}`),
    ...stageUnits(enemyPlaced, "defender", seed ^ 0x2b, () => "D"),
  ];

  return {
    id: `player-deploy-${opts.nowMs}`,
    name: "Practice deployment — Muster Flats",
    attackerName: opts.attackerName,
    defenderName: `Chorus Garrison — ${CHORUS_GRADES[grade].name}`,
    tier: "Practice",
    chorusGrade: grade,
    units,
    turrets: buildTurrets(seed),
    lonDeg: -84.4,
    t0: opts.nowMs,
    seed,
    troops: { attacker: total, defender: enemyPlaced.length },
    terrain: terrainFor(seed),
  };
}

/** Doctrine hint for the picker: siege without escort walks alone. */
export function escortWarning(picks: DeploymentPick[]): string | null {
  const thunder = picks.filter((p) => p.type === "thunder").reduce((n, p) => n + p.count, 0);
  const wardenW = picks.filter((p) => p.type === "warden").reduce((n, p) => n + p.count * supplyWeight("warden"), 0);
  const rearW =
    picks
      .filter((p) => p.type === "thunder" || p.type === "longeye" || p.type === "warden")
      .reduce((n, p) => n + p.count * supplyWeight(p.type), 0) || 1;
  if (thunder > 0 && wardenW / rearW < 0.2) {
    return "No Warden escort for your siege — doctrine wants 20% Warden weight on a rear entry. Your Thunder deploys without cover.";
  }
  return null;
}
