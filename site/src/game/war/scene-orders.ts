// SCENE ORDERS — the click-to-command legality judge (owner 2026-10-05).
//
// Hans's hands on the battle: click one of your squads (the five buses —
// leader + four, one per vector), then click the map. Every order runs
// through the doctrine BEFORE it executes:
//
//   • Siege (Thunder) can NEVER sweep or flank.
//   • REAR ENTRY IS JUMP-SHIP ONLY (owner 2026-10-11): no ground move ends
//     behind the enemy line — not around the edges, not through gaps. A tap
//     behind the lines with Warden escort (≥20% Warden weight, the
//     maneuverRearWardenFrac rule) becomes a combat drop; without escort
//     it's refused.
//   • MOVEMENT BLOCKING (owner 2026-10-11): enemy units obstruct the path —
//     ground units steer around or stop at contact, never ghost through.
//     BREACH EXCEPTION: Reaver assault squads can push through a BROKEN
//     line — one whose Wardens have been ground down. Intact line (Wardens
//     holding) blocks everyone, Reavers included.
//   • ENGAGED units are locked — the one-way door: once casualties start,
//     there is no backing out, no vector change.
//
// Illegal orders are REJECTED WITH THE REASON — never silent. Pure module:
// no DOM, no store, fully unit-testable. The canvas (BattleScene) calls
// judgeMoveOrder on tap and either moves the squad or shows the refusal.

import { supplyWeight } from "./troops";
import { BATTLES_CONFIG, type ManeuverVector } from "./war-types";
import {
  VECTOR_LANES,
  VECTOR_PLAYER,
  type SceneUnit,
} from "./battle-scene-model";

/** One drivable bus. Attacker: A0..A4 (leader + four, one per vector).
 *  Defender: "D" — the Chorus AI, never selectable. */
export interface Squad {
  id: string;
  side: "attacker" | "defender";
  /** 0..4 for attacker players, -1 for the defender AI. */
  playerIdx: number;
  vector: ManeuverVector | "AI";
  name: string;
  /** Live unit ids (excludes the dead) — recomputed per call. */
  unitIds: string[];
}

const VEC_SHORT: Record<ManeuverVector, string> = {
  MAIN: "Main",
  FLANK_LEFT: "Flank L",
  FLANK_RIGHT: "Flank R",
  REAR: "Rear",
  RESERVE: "Reserve",
};

/** Short sector label for movement reports. */
export function vecShort(v: ManeuverVector): string {
  return VEC_SHORT[v];
}

// ---------------------------------------------------------------------------
// ORDER RESPONSE TIME (owner 2026-10-06): a move order doesn't execute
// instantly. The squad acknowledges, plots for ORDER_DELAY_S sim-seconds,
// then steps off. Symmetric — the AI's squads wait the same delay. The
// delay is sim-time, so it scales with the SLOW/NORMAL/FAST pace setting.
// ---------------------------------------------------------------------------

/** Command delay in sim-seconds between order and step-off. */
export const ORDER_DELAY_S = 3;

/** Stamp a move order on a unit: destination now, step-off after the delay. */
export function stampOrder(u: SceneUnit, tx: number, ty: number, tS: number): void {
  u.tx = tx;
  u.ty = ty;
  u.moveAtS = tS + ORDER_DELAY_S;
}

/** Units whose command delay has elapsed — they step off now. Pure. */
export function stepOffUnits(units: SceneUnit[], tS: number): SceneUnit[] {
  return units.filter((u) => u.moveAtS !== undefined && tS >= u.moveAtS);
}

/**
 * CALL IN A MUSTERING SQUAD (owner 2026-10-13 — the reinforcement break).
 * A squad still in staging has exactly ONE door onto the field: the sim's
 * staging block, which releases it when the scene clock reaches its
 * enterAtS (and the phase allows entry). An accepted order on such a squad
 * used to only stamp a destination (the tracer drew, the log said
 * "accepted") while the units waited out a preset clock the commander
 * never set — 300 sim-s for the rear, 480 for the reserve, i.e. 10–16
 * wall-minutes at SLOW pace. The order IS the call-in: pull the squad's
 * entry up to now. The staging block still performs the actual entry
 * (state flip, dropship roar, the "wave is on the field" announcement) —
 * this helper only moves the appointment; it never teleports a unit.
 * On-call reserves do NOT pass through here: issueOrder commits them via
 * the hot-drop branch before the ground-move path runs. Returns how many
 * units were released. Pure.
 */
export function releaseStagingSquad(units: SceneUnit[], tS: number): number {
  let released = 0;
  for (const u of units) {
    if (u.state !== "staging") continue;
    if (u.enterAtS > tS) {
      u.enterAtS = tS;
      released += 1;
    }
  }
  return released;
}

// ---------------------------------------------------------------------------
// LONGEYE COVERAGE (owner 2026-10-06): positional. A Longeye only watches
// its own sector — coverage follows vector assignment (Flank L eyes cover
// Flank L, rear eyes cover the rear, …). Same-vector rule, no adjacency.
// Enemy moves on vectors with no living Longeyes go unreported, even if
// eyes exist elsewhere. (Logistics ships will add jammable aerial coverage
// later — eyeballs can't be jammed, so Longeyes are the failsafe.)
// ---------------------------------------------------------------------------

/** Living Longeyes in an attacker squad — the eyes watching that sector. */
export function squadEyeCount(units: SceneUnit[], squadId: string): number {
  return units.filter(
    (u) => u.squadId === squadId && u.side === "attacker" && u.kind === "longeye" && u.state !== "dead",
  ).length;
}

/** Does the player's vector have living Longeye coverage? */
export function hasLongeyeCover(units: SceneUnit[], vector: ManeuverVector): boolean {
  return squadEyeCount(units, `A${VECTOR_PLAYER[vector]}`) > 0;
}

/** Group living units into their command squads. */
export function buildSquads(units: SceneUnit[]): Squad[] {
  const byId = new Map<string, SceneUnit[]>();
  for (const u of units) {
    if (u.state === "dead") continue;
    const list = byId.get(u.squadId) ?? [];
    list.push(u);
    byId.set(u.squadId, list);
  }
  const squads: Squad[] = [];
  for (const [squadId, members] of byId) {
    const side = members[0].side;
    const vector = squadId === "D" ? ("AI" as const) : members[0].vector;
    const playerIdx = squadId === "D" ? -1 : VECTOR_PLAYER[members[0].vector];
    const name =
      squadId === "D"
        ? "Chorus AI"
        : `Squad ${playerIdx + 1} — ${VEC_SHORT[members[0].vector]}`;
    squads.push({
      id: squadId,
      side,
      playerIdx,
      vector,
      name,
      unitIds: members.map((u) => u.id),
    });
  }
  squads.sort((a, b) => a.playerIdx - b.playerIdx);
  return squads;
}

/** Only attacker squads are drivable — the defender is the Chorus AI. */
export function isDrivable(squad: Squad): boolean {
  return squad.side === "attacker";
}

/** Destination lane from a tap's x: flank bands (east/west) or the middle. */
export type DestLane = "FLANK_LEFT" | "FLANK_RIGHT" | "MIDDLE";

export function destLaneOf(x: number): DestLane {
  const fl = VECTOR_LANES.FLANK_LEFT;
  const fr = VECTOR_LANES.FLANK_RIGHT;
  if (x >= fl.x - fl.spread && x <= fl.x + fl.spread) return "FLANK_LEFT";
  if (x >= fr.x - fr.spread && x <= fr.x + fr.spread) return "FLANK_RIGHT";
  return "MIDDLE";
}

/** y north of this is behind enemy lines — a rear entry, not a push.
 *  (The attacker advances north from the south edge.) */
export const DEEP_Y = 0.5;

/** Human label for the ORDERS log: where the order was sending the squad. */
export function destLabel(x: number, y: number): string {
  const lane = destLaneOf(x);
  if (lane === "FLANK_LEFT") return "FLANK LEFT";
  if (lane === "FLANK_RIGHT") return "FLANK RIGHT";
  return y < DEEP_Y ? "REAR" : "MAIN";
}

export type OrderVerdict = { ok: true } | { ok: false; reason: string };

function hasKind(units: SceneUnit[], kind: SceneUnit["kind"]): boolean {
  return units.some((u) => u.kind === kind);
}

/** Warden supply-weight share of the squad — the rear logistics rule. */
function wardenShare(units: SceneUnit[]): number {
  let total = 0;
  let warden = 0;
  for (const u of units) {
    const w = supplyWeight(u.kind === "dropship" || u.kind === "turret" ? "bulwark" : u.kind);
    total += w;
    if (u.kind === "warden") warden += w;
  }
  return total > 0 ? warden / total : 0;
}

/** Vectors that form a side's battle line (the deep reserve/rear are not the line). */
const LINE_VECTORS: ReadonlySet<string> = new Set(["MAIN", "FLANK_LEFT", "FLANK_RIGHT"]);

/**
 * The enemy's forward line (owner 2026-10-11). The attacker pushes north
 * (low y): the defender's southernmost line unit. The defender pushes south:
 * the attacker's northernmost line unit. Null when the enemy has no living
 * line — nothing left to be behind.
 */
export function enemyLineY(
  allUnits: SceneUnit[],
  side: "attacker" | "defender",
): number | null {
  const enemy = side === "attacker" ? "defender" : "attacker";
  let line: number | null = null;
  for (const u of allUnits) {
    if (u.side !== enemy || u.state === "dead" || u.state === "staging") continue;
    if (!LINE_VECTORS.has(u.vector)) continue;
    if (line === null) line = u.y;
    else if (side === "attacker") line = Math.min(line, u.y);
    else line = Math.max(line, u.y);
  }
  return line;
}

/**
 * Behind enemy lines (owner 2026-10-11): past their forward line with a
 * small margin. A ground move can never end here — jump ships only.
 */
export function isBehindLines(
  dest: { x: number; y: number },
  allUnits: SceneUnit[],
  side: "attacker" | "defender",
): boolean {
  const line = enemyLineY(allUnits, side);
  if (line === null) return false;
  return side === "attacker" ? dest.y < line - 0.03 : dest.y > line + 0.03;
}

/**
 * The enemy line's guards (owner 2026-10-11): living enemy Wardens holding
 * the line vectors. The sim tracks this per formation so the breach
 * condition can be evaluated: intact line (guards > 0) blocks ALL ground
 * movement; broken line (guards = 0) can be breached by assault.
 */
export function lineWardenCount(
  allUnits: SceneUnit[],
  side: "attacker" | "defender",
): number {
  const enemy = side === "attacker" ? "defender" : "attacker";
  let n = 0;
  for (const u of allUnits) {
    if (u.side !== enemy || u.kind !== "warden") continue;
    if (u.state === "dead" || u.state === "staging") continue;
    if (LINE_VECTORS.has(u.vector)) n++;
  }
  return n;
}

/**
 * Breach check (owner 2026-10-11): a squad with living Reavers may push
 * through the enemy line ONLY once its Wardens are ground down. Intact
 * line → nobody passes, Reavers included. Broken line → assault infiltrates;
 * every other squad still can't.
 */
export function canBreachLine(
  squadUnits: SceneUnit[],
  allUnits: SceneUnit[],
  side: "attacker" | "defender",
): boolean {
  const live = squadUnits.filter((u) => u.state !== "dead");
  if (!live.some((u) => u.kind === "reaver")) return false;
  if (enemyLineY(allUnits, side) === null) return false;
  return lineWardenCount(allUnits, side) === 0;
}

/**
 * States a jump ship can lift (owner 2026-10-14): on the field and free to
 * move (`holding` / `advancing`), or still in the ships (`staging`) — a
 * mustering wave ordered behind the lines is CALLED IN AS THE DROP, the
 * same way the on-call reserve's tap commits it. A squad mid-`withdrawing`
 * (pulling back under relief) or already `descending` cannot be lifted.
 */
export function isLiftable(u: SceneUnit): boolean {
  return u.state === "holding" || u.state === "advancing" || u.state === "staging";
}

/**
 * COMMITTED (owner ruling 2026-10-14): a unit is committed when it has
 * genuinely exchanged fire — dealt or taken a damaging hit — never by
 * mere presence. The state machine flips a unit to "engaged" whenever an
 * enemy stands within 0.45 world units (30% of the 1.5-unit field) with
 * no shot exchanged and no per-weapon range in the trigger, so presence
 * alone used to lock squads parked far back on the field (the commander's
 * "committed too far back" report). The judges key on THIS, not on the
 * state label.
 */
export function isCommitted(u: SceneUnit): boolean {
  return u.exchangedAtS !== undefined;
}

/**
 * A plain-words sector for a world point — entry announcements and
 * locate trails (owner 2026-10-14: the commander could not find his own
 * rear wave; "Your rear wave is on the field" names no place). Rows key
 * on the defender line (~y 0.58) and the attacker's own half; columns on
 * thirds of the field width. Pure.
 */
export function sectorLabel(x: number, y: number): string {
  const col = x < 0.5 ? "west" : x > 1.0 ? "east" : "center";
  const row =
    y < 0.5 ? "behind the enemy line" :
    y < 0.72 ? "at the enemy line" :
    y < 1.05 ? "mid-field, your half" :
    "your rear";
  return `${row} · ${col}`;
}

/**
 * Jump-drop legality (owner 2026-10-11): rear entry is jump-ship only and
 * needs Warden escort ≥ maneuverRearWardenFrac. The one-way door holds —
 * engaged squads can't lift. A squad with NOTHING liftable is refused
 * with the reason (owner 2026-10-14): before this check, a mustering rear
 * squad passed the judge, the comms promised the drop, and the lift loop
 * — which only knew on-field states — transitioned zero units. The
 * promise WAS the bug: judge and lift now agree on what can fly.
 */
export function judgeJumpDrop(squadUnits: SceneUnit[]): OrderVerdict {
  const live = squadUnits.filter((u) => u.state !== "dead");
  if (live.length === 0) {
    return { ok: false, reason: "No living units in that squad." };
  }
  // Commitment keys on genuine fire contact (owner ruling 2026-10-14),
  // not the proximity "engaged" label — an unblooded squad standing near
  // the enemy can still lift; a committed one cannot (an airlift out is
  // not a fall back; falling back on the ground is always open).
  if (live.some(isCommitted)) {
    return { ok: false, reason: "Unit committed — it's in the fight; an airlift out needs relief first. Falling back toward your own lines is always open." };
  }
  if (!live.some(isLiftable)) {
    if (live.some((u) => u.state === "descending")) {
      return { ok: false, reason: "Already airborne — that drop is underway." };
    }
    return { ok: false, reason: "Pulling back under relief — a squad mid-withdrawal can't lift." };
  }
  if (wardenShare(live) < BATTLES_CONFIG.maneuverRearWardenFrac) {
    return { ok: false, reason: "Combat drop needs Warden escort (≥20%)." };
  }
  return { ok: true };
}

/**
 * COMMIT A JUMP DROP (owner 2026-10-14 — the rear-flank break). Puts every
 * liftable unit of the squad into `descending` on the destination: the
 * sim's descent block flies them OVER the line and lands them on the spot
 * (the same machinery the reserve hot drop rides). Staging units are
 * lifted straight from muster — the order is their call-in AND their
 * drop, so no entry appointment is left dangling behind the promise.
 * `dest` arrives soft-clamped from the caller; the ±0.025 scatter sits
 * far inside the clamp's maneuver margin. Returns how many units were
 * lifted — the caller may only announce the drop when this is > 0.
 * Pure (rand injected for tests).
 */
export function commitJumpDrop(
  units: SceneUnit[],
  dest: { x: number; y: number },
  tS: number,
  rand: () => number = Math.random,
): number {
  let lifted = 0;
  for (const u of units) {
    if (!isLiftable(u)) continue;
    u.state = "descending"; // airborne — jump ships fly OVER the line
    u.tx = dest.x + (rand() - 0.5) * 0.05;
    u.ty = dest.y + (rand() - 0.5) * 0.05;
    u.dropAtS = tS;
    u.moveAtS = undefined;
    lifted += 1;
  }
  return lifted;
}

/**
 * Judge a click-to-move order. Returns { ok: true } or the refusal with the
 * doctrine reason. The commitment check runs first (owner ruling
 * 2026-10-14): committed squads may only fall back; unblooded squads —
 * however close the enemy stands — are free to maneuver.
 *
 * allUnits (the whole field) enables the behind-lines rule: when provided,
 * a ground move ending behind the enemy line is refused — rear entry is
 * jump-ship only. Omitted (legacy tests), the old deep-strike rule applies.
 */
export function judgeMoveOrder(
  units: SceneUnit[],
  dest: { x: number; y: number },
  allUnits?: SceneUnit[],
): OrderVerdict {
  const live = units.filter((u) => u.state !== "dead");
  if (live.length === 0) {
    return { ok: false, reason: "No living units in that squad." };
  }
  // COMMITMENT (owner ruling 2026-10-14 — replaces the old one-way
  // door): the lock keys on genuine fire contact (isCommitted — dealt or
  // taken fire), NEVER on the "engaged" state label, which is mere
  // proximity: the sim flips a unit to "engaged" whenever an enemy stands
  // within 0.45 world units (30% of the 1.5-unit field) with no shot
  // exchanged and no per-weapon range in the trigger — presence at the
  // back of the field used to count as committed. A squad that has never
  // traded fire is maneuverable wherever it stands. And FALL BACK IS
  // ALWAYS OPEN: a committed squad ordered toward its own lines
  // (attacker: destination no deeper than its current position)
  // executes — relief-gating applies only to full withdrawal OFF the
  // field, not to falling back within it. Only a fresh advance by a
  // committed squad is refused, and the refusal names the open door.
  if (live.some(isCommitted)) {
    const cy = live.reduce((s, u) => s + u.y, 0) / live.length;
    const fallingBack = dest.y >= cy - 0.01;
    if (!fallingBack) {
      return { ok: false, reason: "Unit committed — it's in the fight (casualties mean commitment). Falling back toward your own lines is always open; a fresh advance needs relief first." };
    }
  }
  const lane = destLaneOf(dest.x);
  const thunder = hasKind(live, "thunder");
  // SIEGE NEVER SWEEPS — Thunder is too heavy for flank work. Ever.
  if (thunder && lane !== "MIDDLE") {
    return { ok: false, reason: "Thunder can't flank — siege never sweeps." };
  }
  if (allUnits) {
    // REAR ENTRY IS JUMP-SHIP ONLY — no ground move ends behind the line.
    if (isBehindLines(dest, allUnits, "attacker")) {
      return { ok: false, reason: "Behind enemy lines — call a jump drop." };
    }
    return { ok: true };
  }
  // Legacy path (no field context): the old deep-strike rule.
  const deep = dest.y < DEEP_Y;
  if (deep) {
    if (thunder) {
      return { ok: false, reason: "Thunder too slow for a deep strike." };
    }
    if (wardenShare(live) < BATTLES_CONFIG.maneuverRearWardenFrac) {
      return { ok: false, reason: "Rear entry needs Warden escort." };
    }
  }
  return { ok: true };
}
