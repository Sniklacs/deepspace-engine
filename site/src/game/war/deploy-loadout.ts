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
// The enemy is a Chorus garrison scaled to comparable power via the tier
// power curve — a real fight, not a guaranteed win, not a slaughter.

import {
  TROOP_TYPES,
  supplyWeight,
  tierPowerMult,
  type TroopRoster,
  type TroopTier,
  type TroopType,
} from "./troops";
import type { BattleSide, ManeuverVector } from "./war-types";
import {
  VECTOR_LANES,
  VECTOR_PLAYER,
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

/** Stage placed units onto the tactical map — same conventions as the demo:
 *  own side, own lane, muster formation; attackers push, defenders hold. */
function stageUnits(
  placed: PlacedUnit[],
  side: BattleSide,
  seed: number,
  squadFor: (v: ManeuverVector) => string,
): SceneUnit[] {
  const rnd = mulberry32(seed);
  const backX = side === "attacker" ? 0.06 : 0.94;
  const dir = side === "attacker" ? 1 : -1;
  return placed.map((p, n) => {
    const lane = VECTOR_LANES[p.vector];
    const sideLean = p.vector === "REAR" ? 0.18 : p.vector === "RESERVE" ? 0.3 : 0.08;
    const fightX = 0.5 - dir * sideLean + (rnd() - 0.5) * 0.08;
    const stageY = Math.max(0.06, Math.min(0.94, lane.y + (rnd() - 0.5) * 2 * lane.spread));
    const ty = Math.max(0.06, Math.min(0.94, lane.y + (rnd() - 0.5) * 2 * lane.spread));
    return {
      id: `${side === "attacker" ? "p" : "e"}${n}`,
      side,
      kind: p.type as SceneUnitKind,
      tier: p.tier,
      vector: p.vector,
      squadId: squadFor(p.vector),
      x: backX + (rnd() - 0.5) * 0.05,
      y: stageY,
      tx: Math.max(0.08, Math.min(0.92, fightX + (rnd() - 0.5) * 0.1)),
      ty,
      hp01: 1,
      state: "staging" as const,
      enterAtS: p.enterAtS,
    };
  });
}

/** Chorus garrison scaled to the player's power — a real fight. Deterministic
 *  per seed; target power within ±5% of the player's. */
function buildChorusForce(targetPower: number, seed: number): PlacedUnit[] {
  const rnd = mulberry32(seed ^ 0x51f7);
  const typeRoll = (): TroopType => {
    const r = rnd();
    if (r < 0.3) return "bulwark";
    if (r < 0.6) return "reaver";
    if (r < 0.8) return "longeye";
    if (r < 0.88) return "thunder";
    return "warden";
  };
  const tierRoll = (type: TroopType): TroopTier => {
    const r = rnd();
    let t: TroopTier = r < 0.25 ? 1 : r < 0.6 ? 2 : r < 0.9 ? 3 : 4;
    if (type === "thunder" && t === 1) t = 2; // siege is never chaff
    return t;
  };
  const placed: PlacedUnit[] = [];
  let power = 0;
  let guard = 0;
  let flankFlip = false;
  while (power < targetPower * 0.95 && placed.length < 120 && guard++ < 500) {
    const type = typeRoll();
    const tier = tierRoll(type);
    power += supplyWeight(type) * tierPowerMult(tier);
    let vector: ManeuverVector;
    let enterAtS: number;
    if (type === "bulwark") {
      vector = "MAIN";
      enterAtS = 30;
    } else if (type === "reaver") {
      flankFlip = !flankFlip;
      vector = flankFlip ? "FLANK_LEFT" : "FLANK_RIGHT";
      enterAtS = flankFlip ? 34 : 38;
    } else if (type === "thunder") {
      vector = "REAR";
      enterAtS = 240;
    } else {
      vector = "REAR";
      enterAtS = 40;
    }
    placed.push({ type, tier, vector, enterAtS });
  }
  return placed;
}

function buildTurrets(seed: number): SceneTurret[] {
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
  return turrets;
}

export interface DeployOptions {
  /** Display name for Hans's force (e.g. his gameId). */
  attackerName: string;
  /** Epoch ms the scene clock's T+0 maps to. */
  nowMs: number;
  /** Deterministic layout seed (default: derived from picks). */
  seed?: number;
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

  const seed = opts.seed ?? picks.reduce((s, p) => s + p.count * (p.tier + 1) * (TROOP_TYPES.indexOf(p.type) + 1), 7);
  const playerPlaced = assignVectors(picks);
  const playerPower = picksPower(picks);
  const enemyPlaced = buildChorusForce(playerPower, seed);

  const units = [
    ...stageUnits(playerPlaced, "attacker", seed, (v) => `A${VECTOR_PLAYER[v]}`),
    ...stageUnits(enemyPlaced, "defender", seed ^ 0x2b, () => "D"),
  ];

  return {
    id: `player-deploy-${opts.nowMs}`,
    name: "Practice deployment — Muster Flats",
    attackerName: opts.attackerName,
    defenderName: "Chorus Garrison",
    tier: "Practice",
    units,
    turrets: buildTurrets(seed),
    lonDeg: -84.4,
    t0: opts.nowMs,
    seed,
    troops: { attacker: total, defender: enemyPlaced.length },
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
