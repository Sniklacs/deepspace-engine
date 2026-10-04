/**
 * LEADER BATTLE ROLES — "everybody drives their bus" (owner 2026-10-04).
 *
 * Hans: every leader needs a real breakdown of the ROLE they play in battle
 * scenes — different modifiers per leader for how they fight, mapped onto
 * the 5-vector tactical system (MAIN, FLANK_LEFT, FLANK_RIGHT, REAR,
 * RESERVE). The leader defines what the bus does.
 *
 * Keyed by Specialty so it works for every present and future leader with
 * that specialty — the four playable leaders today are Oric Vey (tactician),
 * Vaera Sun (economist), Senna Kade (engineer), and Aran Holt (logistician).
 *
 * Pure data + deterministic helpers. No imports of engine/api/UI modules.
 */

import type { Specialty } from "./types";
import type { ManeuverVector } from "./war/war-types";

export type BattleRoleId =
  | "flanker"
  | "line-holder"
  | "siegebreaker"
  | "quartermaster"
  | "provider";

export interface LeaderBattleRole {
  /** The leader specialty this role belongs to. */
  specialty: Specialty;
  /** Stable role id. */
  role: BattleRoleId;
  /** Display name, e.g. "Flanker". */
  roleName: string;
  /** One-line tagline for pickers and cards. */
  tagline: string;
  /** Vectors this leader favors — where their bus belongs. */
  favoredVectors: ManeuverVector[];
  /** Power multiplier per vector while this leader commands the battle.
   *  Unlisted vectors fight at 1.0. */
  vectorMult: Partial<Record<ManeuverVector, number>>;
  /** Casualty reduction (0–1) on the attacker's losses — the leader's
   *  care for their people made manifest. */
  holdReduction: number;
  /** Game-manual prose: what this leader DOES in a battle scene. */
  brief: string;
}

export const LEADER_BATTLE_ROLES: LeaderBattleRole[] = [
  {
    specialty: "tactician",
    role: "flanker",
    roleName: "Flanker",
    tagline: "Doesn't meet the enemy — arrives where they aren't.",
    favoredVectors: ["FLANK_LEFT", "FLANK_RIGHT", "REAR"],
    vectorMult: { FLANK_LEFT: 1.2, FLANK_RIGHT: 1.2, REAR: 1.15 },
    holdReduction: 0,
    brief:
      "The tactician's bus is the flank. Oric Vey never meets the enemy head-on if he can help it — " +
      "he puts his strength on the flanks and the rear, where the enemy's eyes aren't, and the surprise " +
      "does half the killing for him. Troops under a tactician hit 20% harder on flank vectors and 15% " +
      "harder from the rear. What he doesn't do is hold: a tactician ordered to sit on the main line " +
      "fights at even strength and bleeds like anyone else. If your plan is a hammer blow from an " +
      "unexpected direction, put the tactician in the driver's seat.",
  },
  {
    specialty: "economist",
    role: "quartermaster",
    roleName: "Quartermaster",
    tagline: "Wins the battle in the ledger before the first shot.",
    favoredVectors: ["RESERVE", "MAIN"],
    vectorMult: { RESERVE: 1.2, MAIN: 1.05 },
    holdReduction: 0.05,
    brief:
      "The economist fights with supply lines. Vaera Sun wins battles in the ledger before the first " +
      "shot — her reserves arrive fed, equipped, and exactly on time, which is why troops held in " +
      "reserve under a quartermaster fight 20% harder and the main line gets a 5% edge from never " +
      "wanting for anything. Her care shows in the casualty lists too: 5% fewer of her people come " +
      "home hurt. She is not a duelist — don't ask her to lead a rear penetration. But if your plan " +
      "needs a deep bench and a long fight, her bus is the one that never runs dry.",
  },
  {
    specialty: "engineer",
    role: "siegebreaker",
    roleName: "Siegebreaker",
    tagline: "Treats a fortified line as an engineering problem.",
    favoredVectors: ["MAIN"],
    vectorMult: { MAIN: 1.2 },
    holdReduction: 0.05,
    brief:
      "The engineer breaks things that were built to not break. Senna Kade looks at a fortified main " +
      "line the way she looks at a faulty reactor — as a problem with a solution — and her troops " +
      "hit 20% harder on the MAIN vector, where the enemy is strongest and most confident. She keeps " +
      "her people 5% safer through fieldworks thrown up as they advance. Flanks and rear actions are " +
      "wasted on her: the siegebreaker's bus drives straight at the wall, because she knows exactly " +
      "where the wall is weakest.",
  },
  {
    specialty: "logistician",
    role: "line-holder",
    roleName: "Line-Holder",
    tagline: "The wall that the enemy breaks against.",
    favoredVectors: ["MAIN", "RESERVE"],
    vectorMult: { MAIN: 1.1, RESERVE: 1.1 },
    holdReduction: 0.1,
    brief:
      "The logistician is the line. Aran Holt's bus doesn't maneuver — it arrives, it digs in, and " +
      "the enemy breaks against it. Troops on MAIN and RESERVE vectors fight 10% harder under a " +
      "line-holder, and 10% fewer of them fall — nobody in the colony organizes a fighting retreat " +
      "like Aran, because nobody plans to need one. He will never give you a brilliant flank; he " +
      "will give you a line that is still there in the morning. When the klaxon sounds and you need " +
      "someone to hold the ground you already own, this is your driver.",
  },
  {
    specialty: "horticulturist",
    role: "provider",
    roleName: "Provider",
    tagline: "The field sustains the fight.",
    favoredVectors: ["RESERVE", "REAR"],
    vectorMult: { RESERVE: 1.15, REAR: 1.05 },
    holdReduction: 0.05,
    brief:
      "The horticulturist feeds the war. No colony has fielded one as a battle leader yet, but the " +
      "doctrine is written: a provider keeps the reserves strong (15% harder from RESERVE) and the " +
      "rear echelons moving (5% on REAR), and 5% fewer troops fall when the field itself is an ally. " +
      "The provider's bus is the one that makes a long campaign possible — the unglamorous engine " +
      "room of every army that ever came home.",
  },
];

export const LEADER_ROLE_BY_SPECIALTY: Record<Specialty, LeaderBattleRole> =
  Object.fromEntries(LEADER_BATTLE_ROLES.map((r) => [r.specialty, r])) as Record<
    Specialty,
    LeaderBattleRole
  >;

/** The battle role for a leader specialty. */
export function leaderBattleRole(specialty: Specialty): LeaderBattleRole {
  return LEADER_ROLE_BY_SPECIALTY[specialty];
}

/** Power multiplier for a vector under the given leader specialty.
 *  Undefined specialty (no leader / unknown) = 1.0 everywhere. */
export function leaderVectorMult(
  specialty: Specialty | undefined,
  vector: ManeuverVector,
): number {
  if (!specialty) return 1;
  return LEADER_ROLE_BY_SPECIALTY[specialty]?.vectorMult[vector] ?? 1;
}

/** Casualty reduction for the attacker's losses under the given leader. */
export function leaderHoldReduction(specialty: Specialty | undefined): number {
  if (!specialty) return 0;
  return LEADER_ROLE_BY_SPECIALTY[specialty]?.holdReduction ?? 0;
}

/** Every specialty has a role — the table stays complete. */
export function leaderRoleCoverageOk(specialties: readonly Specialty[]): boolean {
  return specialties.every((s) => LEADER_ROLE_BY_SPECIALTY[s] != null);
}
