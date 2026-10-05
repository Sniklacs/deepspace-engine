// SCENE ORDERS — the click-to-command legality judge (owner 2026-10-05).
//
// Hans's hands on the battle: click one of your squads (the five buses —
// leader + four, one per vector), then click the map. Every order runs
// through the doctrine BEFORE it executes:
//
//   • Siege (Thunder) can NEVER sweep or flank.
//   • A deep strike behind enemy lines (x > DEEP_X) is a rear entry: it
//     needs a Warden/logistics escort (≥20% Warden weight, the
//     maneuverRearWardenFrac rule) and legal troop speed (Thunder is too
//     slow — siege never sweeps).
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

/** Destination lane from a tap's y: flank bands or the middle. */
export type DestLane = "FLANK_LEFT" | "FLANK_RIGHT" | "MIDDLE";

export function destLaneOf(y: number): DestLane {
  const fl = VECTOR_LANES.FLANK_LEFT;
  const fr = VECTOR_LANES.FLANK_RIGHT;
  if (y >= fl.y - fl.spread && y <= fl.y + fl.spread) return "FLANK_LEFT";
  if (y >= fr.y - fr.spread && y <= fr.y + fr.spread) return "FLANK_RIGHT";
  return "MIDDLE";
}

/** x past this is behind enemy lines — a rear entry, not a push. */
export const DEEP_X = 0.7;

/** Human label for the ORDERS log: where the order was sending the squad. */
export function destLabel(x: number, y: number): string {
  const lane = destLaneOf(y);
  if (lane === "FLANK_LEFT") return "FLANK LEFT";
  if (lane === "FLANK_RIGHT") return "FLANK RIGHT";
  return x > DEEP_X ? "REAR" : "MAIN";
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

/**
 * Judge a click-to-move order. Returns { ok: true } or the refusal with the
 * doctrine reason. Check order matters — the one-way door is checked first
 * because it overrides everything: an engaged squad answers to nothing.
 */
export function judgeMoveOrder(
  units: SceneUnit[],
  dest: { x: number; y: number },
): OrderVerdict {
  const live = units.filter((u) => u.state !== "dead");
  if (live.length === 0) {
    return { ok: false, reason: "No living units in that squad." };
  }
  // THE ONE-WAY DOOR — casualties mean commitment. An engaged squad does
  // not move, does not withdraw, does not change vectors. Period.
  if (live.some((u) => u.state === "engaged")) {
    return { ok: false, reason: "Unit engaged — casualties mean commitment." };
  }
  const lane = destLaneOf(dest.y);
  const deep = dest.x > DEEP_X;
  const thunder = hasKind(live, "thunder");
  // SIEGE NEVER SWEEPS — Thunder is too heavy for flank work. Ever.
  if (thunder && lane !== "MIDDLE") {
    return { ok: false, reason: "Thunder can't flank — siege never sweeps." };
  }
  if (deep) {
    // A deep strike is a rear entry: it needs legs AND a logistics tail.
    if (thunder) {
      return { ok: false, reason: "Thunder too slow for a deep strike." };
    }
    if (wardenShare(live) < BATTLES_CONFIG.maneuverRearWardenFrac) {
      return { ok: false, reason: "Rear entry needs Warden escort." };
    }
  }
  return { ok: true };
}
