// Sub colonies — husk claiming (owner 2026-10-03).
//
// Hans: "husks are claimable by players — you just have to add supplies to
// it to kickstart it and it becomes another colony ... a sub colony ...
// where you can build in and build your troops."
//
// Rules:
// - Tap a husk → "supply it and make it a sub colony?" Costs supplies.
// - Setup takes 24 hours (get supplies there, get everything running).
// - First come, first serve — whoever claims first gets it. Another player
//   tapping a claimed husk sees "this colony is already being supplied by X".
// - Active sub colony: build troops there. Inherits the owner's main-colony
//   research level (no re-research). Adds to the owner's reverb.
// - Ongoing supply upkeep — you have to feed sub colonies to use them.
// - Lose it to someone else: you keep your main colony; you lose what's at
//   the sub colony. The taker gets it at THEIR research/build level.
import type { GameState } from "./types";
import { colonyKey, ensureWorldMap, type KnownColony } from "./worldmap";
import { WORLD_CONFIG_PUBLIC } from "./world-config";

/** 24 hours: get the supplies there, get everything running. */
export const SUBCOLONY_SETUP_MS = 24 * 3600_000;

/** Kickstart investment to claim a husk (supplies). */
export const SUBCOLONY_CLAIM_COST = 5000;

/** Supply upkeep per active sub colony, due every 24 hours. Hans: "they have
 *  to shoot it supplies ... if they get too heavy on those [they] will have
 *  to end up buying supplies ... or give them up." */
export const SUBCOLONY_UPKEEP_PER_DAY = 1000;

/** A husk claim in progress (or completed). Lives on the KnownColony record. */
export interface SubColonyClaim {
  /** colonyId of the claimer. */
  claimedBy: string;
  /** Display name of the claimer (for "supplied by X"). */
  claimedByName: string;
  /** When the claim was placed (epoch ms). */
  claimedAt: number;
  /** claimedAt + SUBCOLONY_SETUP_MS. */
  setupCompleteAt: number;
  /** Supplies invested at claim time. */
  suppliesInvested: number;
  /** When the next 1,000-supply upkeep shipment is due (epoch ms). Set when
   *  setup completes; pushed forward 24h each time upkeep is paid. */
  nextUpkeepDue?: number;
}

/** True when the colony is a husk that nobody has claimed. */
export function isClaimableHusk(colony: KnownColony): boolean {
  return colony.status === "husk" && !colony.subClaim;
}

/** True when the colony is being set up as a sub colony (claimed, <24h). */
export function isSettingUp(colony: KnownColony, now: number): boolean {
  return (
    colony.status === "setting_up" &&
    !!colony.subClaim &&
    now < colony.subClaim.setupCompleteAt
  );
}

/** True when the colony is an active sub colony (setup complete). */
export function isActiveSubColony(colony: KnownColony, now: number): boolean {
  if (colony.status !== "sub_colony" || !colony.subClaim) return false;
  return now >= colony.subClaim.setupCompleteAt;
}

/** Milliseconds until setup completes (0 when done). */
export function setupRemaining(colony: KnownColony, now: number): number {
  if (!colony.subClaim) return 0;
  return Math.max(0, colony.subClaim.setupCompleteAt - now);
}

/** The player's colony id (gameId). */
function myColonyId(state: GameState): string {
  return state.gameId ?? "";
}

/** The player's display name. */
function myName(state: GameState): string {
  return state.playerName ?? state.gameId ?? "Someone";
}

/**
 * Claim a husk as a sub colony.
 *
 * Validates:
 * - the colony exists and is a husk
 * - it is on the player's HOME world (planet-locked — no off-world subs)
 * - it isn't already claimed (first come, first serve)
 * - the player can afford the kickstart supplies
 *
 * On success: deducts supplies, records the claim, flips status to
 * "setting_up". After SUBCOLONY_SETUP_MS, resolveSubColonies() flips it
 * to "sub_colony".
 */
export function claimHusk(
  state: GameState,
  key: string,
  now: number = Date.now(),
): { ok: boolean; error?: string } {
  const wm = ensureWorldMap(state, now);
  const colony = wm.known[key];
  if (!colony) return { ok: false, error: "Colony not found." };
  // First-come-first-serve check comes BEFORE the husk check: a claimed husk
  // is "setting_up", and the tapper should see who claimed it, not a generic
  // "only husks" error.
  if (colony.subClaim) {
    const by = colony.subClaim.claimedByName || "someone else";
    return {
      ok: false,
      error: `This colony is already being supplied by ${by}.`,
    };
  }
  if (colony.status !== "husk") {
    return { ok: false, error: "Only husks can be claimed as sub colonies." };
  }
  // PLANET-LOCKED (owner 2026-10-03): sub colonies live on your own world
  // only. No off-world sub colonies — this is the incentive to clean up your
  // own map, and it keeps other worlds from raiding your subs.
  const homeWorld = WORLD_CONFIG_PUBLIC.worldId;
  if (colony.serverId !== homeWorld) {
    return {
      ok: false,
      error: "Sub colonies are planet-locked — you can only claim husks on your own world.",
    };
  }
  if ((state.resources.supplies ?? 0) < SUBCOLONY_CLAIM_COST) {
    return {
      ok: false,
      error: `Need ${SUBCOLONY_CLAIM_COST.toLocaleString()} supplies to kickstart a sub colony.`,
    };
  }

  const me = myColonyId(state);
  state.resources.supplies = (state.resources.supplies ?? 0) - SUBCOLONY_CLAIM_COST;
  const claim: SubColonyClaim = {
    claimedBy: me,
    claimedByName: myName(state),
    claimedAt: now,
    setupCompleteAt: now + SUBCOLONY_SETUP_MS,
    suppliesInvested: SUBCOLONY_CLAIM_COST,
  };
  colony.subClaim = claim;
  colony.status = "setting_up";
  return { ok: true };
}

/**
 * Advance sub colony claims past their setup timer.
 * Call from the game loop (advance()) and after loading state.
 *
 * setting_up + now >= setupCompleteAt → sub_colony (active).
 * The sub colony inherits the owner's research level implicitly — troop
 * building there reads the owner's techsResearched (see subColonyTechLevel).
 */
export function resolveSubColonies(state: GameState, now: number = Date.now()): number {
  const wm = ensureWorldMap(state, now);
  let resolved = 0;
  for (const colony of Object.values(wm.known)) {
    if (
      colony.status === "setting_up" &&
      colony.subClaim &&
      now >= colony.subClaim.setupCompleteAt
    ) {
      colony.status = "sub_colony";
      // The husk's old husk-ness is gone: it becomes a working colony.
      // Ownership transfers to the claimer.
      colony.ownerName = colony.subClaim.claimedByName;
      // First upkeep shipment due 24h after going live.
      colony.subClaim.nextUpkeepDue = now + SUBCOLONY_SETUP_MS;
      resolved++;
    }
  }
  return resolved;
}

/**
 * Ship a 1,000-supply upkeep shipment to an active sub colony.
 * Deducts supplies from the main colony, pushes nextUpkeepDue forward 24h.
 */
export function shipSubColonySupplies(
  state: GameState,
  key: string,
  now: number = Date.now(),
): { ok: boolean; error?: string } {
  const wm = ensureWorldMap(state, now);
  const colony = wm.known[key];
  if (!colony) return { ok: false, error: "Colony not found." };
  if (colony.status !== "sub_colony" || !colony.subClaim) {
    return { ok: false, error: "Not an active sub colony." };
  }
  const me = state.gameId ?? "";
  if (colony.subClaim.claimedBy !== me) {
    return { ok: false, error: "Not your sub colony." };
  }
  if ((state.resources.supplies ?? 0) < SUBCOLONY_UPKEEP_PER_DAY) {
    return {
      ok: false,
      error: `Need ${SUBCOLONY_UPKEEP_PER_DAY.toLocaleString()} supplies to ship.`,
    };
  }
  state.resources.supplies = (state.resources.supplies ?? 0) - SUBCOLONY_UPKEEP_PER_DAY;
  // Next shipment due 24h from now (or 24h after the missed deadline,
  // whichever is later — no banking free days by being late).
  const base = Math.max(now, colony.subClaim.nextUpkeepDue ?? now);
  colony.subClaim.nextUpkeepDue = base + SUBCOLONY_SETUP_MS;
  return { ok: true };
}

/** Milliseconds until the next upkeep shipment is due (negative when overdue). */
export function upkeepRemaining(colony: KnownColony, now: number): number {
  if (!colony.subClaim?.nextUpkeepDue) return 0;
  return colony.subClaim.nextUpkeepDue - now;
}

/** True when the sub colony's upkeep shipment is overdue (hungry). */
export function isUpkeepOverdue(colony: KnownColony, now: number): boolean {
  return (
    colony.status === "sub_colony" &&
    !!colony.subClaim?.nextUpkeepDue &&
    now >= colony.subClaim.nextUpkeepDue
  );
}

/**
 * The research level a sub colony builds at: the OWNER's main-colony level.
 * Sub colonies never re-research — they read the owner's techsResearched.
 * When a sub colony changes hands, the new owner brings THEIR level.
 */
export function subColonyTechIds(state: GameState): string[] {
  return [...(state.techsResearched ?? [])];
}

/**
 * Reverb contribution of one active sub colony: base + troop weight.
 * Adds to the owner's reverb (Hans: "add to your reverb of course").
 */
export function subColonyReverb(troopCount: number): number {
  return 500 + Math.floor(troopCount / 10);
}

/**
 * All of this player's active sub colonies (for upkeep + reverb totals).
 */
export function mySubColonies(state: GameState, now: number = Date.now()): KnownColony[] {
  const wm = ensureWorldMap(state, now);
  const me = myColonyId(state);
  return Object.values(wm.known).filter(
    (c) =>
      c.status === "sub_colony" &&
      c.subClaim?.claimedBy === me &&
      now >= (c.subClaim?.setupCompleteAt ?? Infinity),
  );
}

/**
 * Daily supply upkeep for all of the player's active sub colonies.
 * Hans: "they have to shoot it supplies ... if they get too heavy on those
 * [they] will have to end up buying supplies ... or give them up."
 */
export function subColonyUpkeepPerDay(state: GameState, now: number = Date.now()): number {
  return mySubColonies(state, now).length * SUBCOLONY_UPKEEP_PER_DAY;
}

/** Exported for tests: the world-map key for a colony. */
export { colonyKey };
