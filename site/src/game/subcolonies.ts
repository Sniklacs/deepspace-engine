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
import { sendMail } from "./mailbox";
import {
  addCohort,
  emptyRoster,
  enqueueMuster,
  isTroopType,
  musterCost,
  musterDurationMs,
  removeTroopsNewestFirst,
  rosterByType,
  rosterCount,
  type MusterOrder,
  type TroopRoster,
  type TroopType,
} from "./war/troops";

/** 24 hours: get the supplies there, get everything running. */
export const SUBCOLONY_SETUP_MS = 24 * 3600_000;

/** Kickstart investment to claim a husk (supplies). */
export const SUBCOLONY_CLAIM_COST = 5000;

/** Supply upkeep per active sub colony, due every 24 hours. Hans: "they have
 *  to shoot it supplies ... if they get too heavy on those [they] will have
 *  to end up buying supplies ... or give them up." */
export const SUBCOLONY_UPKEEP_PER_DAY = 1000;

/** How long past the upkeep deadline a hungry sub colony survives before it
 *  collapses back to a husk (troops scatter, claim cleared — it's claimable
 *  again). 48h past due = 72h total without a shipment. */
export const SUBCOLONY_STARVE_MS = 48 * 3600_000;

/** Sub colony garrison cap — a knife, not a home. Fixed, not tier-scaled. */
export const SUBCOLONY_GARRISON_CAP = 1000;

/** Sub colonies build troops twice as fast as the home Cradle (Hans 2026-10-03). */
export const SUBCOLONY_MUSTER_SPEED_MULT = 2;

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
  /** The nextUpkeepDue value we already mailed an upkeep warning about.
   *  Prevents spamming the inbox every advance() while overdue. */
  upkeepMailedFor?: number;
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
  // Mailbox: confirm the claim started (owner 2026-10-03).
  sendMail(state, {
    from: "system",
    subject: `Claiming husk: ${colony.ownerName || "unnamed husk"}`,
    body: `You invested 5,000 supplies to claim this husk as a sub colony. Setup takes 24 hours — supplies are flowing, getting everything running. You'll get another message when it's ready.`,
    category: "alert",
    sentAt: now,
    goTo: { tab: "colony", label: "View Cradle" },
  });
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
      // Mailbox: your sub colony is ready (owner 2026-10-03).
      sendMail(state, {
        from: "system",
        subject: `Sub colony ready: ${colony.ownerName || "unnamed husk"}`,
        body: `Your sub colony is operational. It inherits your research level, builds troops twice as fast, and adds to your reverb. Remember: it needs 1,000 supplies every 24 hours — ship them from the Cradle page or it goes hungry.`,
        category: "alert",
        sentAt: now,
        goTo: { tab: "colony", label: "View sub colonies" },
      });
    }
  }
  return resolved;
}

/**
 * Mailbox nudge: warn once per upkeep cycle when a sub colony's 1,000-supply
 * shipment is overdue. Called from advance() after resolveSubColonies.
 * Idempotent per cycle via subClaim.upkeepMailedFor.
 */
export function mailOverdueUpkeep(state: GameState, now: number = Date.now()): number {
  const wm = ensureWorldMap(state, now);
  let mailed = 0;
  for (const colony of Object.values(wm.known)) {
    const claim = colony.subClaim;
    if (colony.status !== "sub_colony" || !claim?.nextUpkeepDue) continue;
    if (now < claim.nextUpkeepDue) continue;
    if (claim.upkeepMailedFor === claim.nextUpkeepDue) continue;
    claim.upkeepMailedFor = claim.nextUpkeepDue;
    sendMail(state, {
      from: "system",
      subject: `Supplies needed: ${colony.ownerName || "sub colony"}`,
      body: `Your sub colony "${colony.ownerName || "unnamed"}" needs its 1,000-supply shipment. Supplies are needed every 24 hours — ship them from the Cradle page to keep it running.`,
      category: "supply",
      sentAt: now,
      goTo: { tab: "colony", label: "Ship supplies" },
    });
    mailed++;
  }
  return mailed;
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

// ============================================================================
// SUB COLONY MUSTER — build troops at active sub colonies (owner 2026-10-03).
//
// Hans: "a sub colony ... where you can build in and build your troops."
// Rules:
// - Troops ONLY (no other buildings at a sub colony).
// - Inherits the owner's main-colony research level (no re-research) — in v1
//   troop power differs only by supply weight, so this is structural: the
//   sub colony reads the owner's techsResearched via subColonyTechIds().
// - Builds TWICE as fast as the home Cradle (SUBCOLONY_MUSTER_SPEED_MULT).
// - Garrison cap is fixed (SUBCOLONY_GARRISON_CAP) — a knife, not a home.
// - The flat 1,000-supply/day upkeep covers the garrison's mouths — no
//   per-troop hunger clock at subs (the upkeep IS the supply sink).
// ============================================================================

/** Total troops stationed at a sub colony (roster + still-queued). */
export function subColonyTroopCount(colony: KnownColony): number {
  const roster = colony.subTroops ? rosterCount(colony.subTroops) : 0;
  const queued = (colony.subMusterQueue ?? []).reduce((s, o) => s + o.count, 0);
  return roster + queued;
}

/** Troops by type stationed at a sub colony (for the raid defender math). */
export function subColonyTroopsByType(colony: KnownColony): Record<TroopType, number> {
  if (!colony.subTroops) {
    return { bulwark: 0, reaver: 0, longeye: 0, thunder: 0, warden: 0 };
  }
  return rosterByType(colony.subTroops);
}

/**
 * Enqueue a troop muster at an active sub colony.
 *
 * Validates:
 * - the colony is an active sub colony owned by the player
 * - the troop type is known and the count is positive
 * - one active order per type (parallel queues, like home)
 * - fits the sub colony garrison cap
 * - the player can afford the muster cost (same cost as home)
 *
 * The order builds at 2x speed (completesAt is halved vs home muster).
 */
export function enqueueSubColonyMuster(
  state: GameState,
  key: string,
  type: string,
  count: number,
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
  if (!isTroopType(type)) return { ok: false, error: "Unknown troop type." };

  if (!colony.subTroops) colony.subTroops = emptyRoster();
  if (!colony.subMusterQueue) colony.subMusterQueue = [];
  const queue = colony.subMusterQueue;

  const enq = enqueueMuster(
    colony.subTroops,
    queue,
    type,
    count,
    now,
    queue.length + 1,
    SUBCOLONY_GARRISON_CAP,
  );
  if (!enq.ok || !enq.order) return { ok: false, error: enq.error ?? "Muster refused." };

  const cost = musterCost(type, Math.trunc(count));
  if ((state.resources.supplies ?? 0) < cost) {
    return {
      ok: false,
      error: `Need ${cost.toLocaleString()} supplies to muster ${Math.trunc(count)} ${type}.`,
    };
  }
  state.resources.supplies = (state.resources.supplies ?? 0) - cost;

  // 2x build speed: halve the duration.
  const order: MusterOrder = {
    ...enq.order,
    completesAt: now + Math.ceil(musterDurationMs(Math.trunc(count)) / SUBCOLONY_MUSTER_SPEED_MULT),
  };
  queue.push(order);
  return { ok: true };
}

/**
 * Resolve finished sub colony muster orders (call from the game loop).
 * Completed orders add cohorts to the sub colony's garrison roster.
 */
export function resolveSubColonyMusters(state: GameState, now: number = Date.now()): number {
  const wm = ensureWorldMap(state, now);
  let resolved = 0;
  for (const colony of Object.values(wm.known)) {
    if (colony.status !== "sub_colony" || !colony.subMusterQueue?.length) continue;
    const done = colony.subMusterQueue.filter((o) => o.completesAt <= now);
    if (done.length === 0) continue;
    colony.subMusterQueue = colony.subMusterQueue.filter((o) => o.completesAt > now);
    if (!colony.subTroops) colony.subTroops = emptyRoster();
    for (const o of done) {
      addCohort(colony.subTroops, o.type, o.count, o.completesAt);
      resolved++;
    }
  }
  return resolved;
}

/**
 * Starvation: a sub colony whose upkeep is SUBCOLONY_STARVE_MS past due
 * collapses back to a husk. The garrison scatters (troops lost), the claim
 * is cleared, and the husk is claimable again — first come, first serve.
 * The owner's main colony loses nothing (Hans 2026-10-03).
 * Call from the game loop after resolveSubColonies().
 */
export function resolveStarvedSubColonies(state: GameState, now: number = Date.now()): number {
  const wm = ensureWorldMap(state, now);
  let collapsed = 0;
  for (const colony of Object.values(wm.known)) {
    const claim = colony.subClaim;
    if (colony.status !== "sub_colony" || !claim?.nextUpkeepDue) continue;
    if (now < claim.nextUpkeepDue + SUBCOLONY_STARVE_MS) continue;
    const name = colony.ownerName || "sub colony";
    colony.status = "husk";
    colony.subClaim = null;
    colony.subTroops = null;
    colony.subMusterQueue = null;
    colony.ownerName = "Unknown";
    collapsed++;
    sendMail(state, {
      from: "system",
      subject: `Sub colony lost: ${name}`,
      body: `Your sub colony "${name}" went too long without supplies and collapsed — the garrison scattered and the husk is back on the map for anyone to claim. Your main colony is untouched.`,
      category: "alert",
      sentAt: now,
      goTo: { tab: "world", label: "View world map" },
    });
  }
  return collapsed;
}

/**
 * RIVAL TAKEOVER (owner 2026-10-03): "Lose one to a rival (same world): main
 * colony loses nothing, you lose what's there; taker gets it at THEIR
 * research/build level."
 *
 * Called when a raid decisively wins against a sub colony. The garrison is
 * wiped, the old claim is cleared, and a fresh claim is written for the
 * raid leader — the sub colony stays live (no 24h setup; it's already built)
 * but starts with an empty garrison at the TAKER's research level.
 */
export function seizeSubColony(
  state: GameState,
  key: string,
  takerId: string,
  takerName: string,
  now: number = Date.now(),
): { ok: boolean; error?: string } {
  const wm = ensureWorldMap(state, now);
  const colony = wm.known[key];
  if (!colony) return { ok: false, error: "Colony not found." };
  if (colony.status !== "sub_colony" || !colony.subClaim) {
    return { ok: false, error: "Not an active sub colony." };
  }
  const oldOwner = colony.subClaim.claimedByName || "Someone";
  // The taker gets it at THEIR research/build level — fresh claim, empty
  // garrison, upkeep clock restarts.
  colony.subClaim = {
    claimedBy: takerId,
    claimedByName: takerName,
    claimedAt: now,
    setupCompleteAt: now, // already built — live immediately
    suppliesInvested: 0,
    nextUpkeepDue: now + SUBCOLONY_SETUP_MS,
  };
  colony.subTroops = emptyRoster();
  colony.subMusterQueue = [];
  colony.ownerName = takerName;
  sendMail(state, {
    from: "system",
    subject: `Sub colony seized by ${takerName}`,
    body: `${takerName} overran your sub colony and seized it. You lost everything stationed there — your main colony is untouched.`,
    category: "alert",
    sentAt: now,
    goTo: { tab: "world", label: "View world map" },
  });
  return { ok: true, error: undefined };
}

/** Remove troops from a sub colony garrison (raid defender casualties). */
export function bleedSubColonyTroops(
  colony: KnownColony,
  losses: number,
): Record<TroopType, number> {
  if (!colony.subTroops || losses <= 0) {
    return { bulwark: 0, reaver: 0, longeye: 0, thunder: 0, warden: 0 };
  }
  return removeTroopsNewestFirst(colony.subTroops, Math.min(losses, rosterCount(colony.subTroops)));
}
