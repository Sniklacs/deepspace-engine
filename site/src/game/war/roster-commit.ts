// ROSTER COMMIT — binding real mustered troops to battle entities
// (muster-troops.md §5, forward-base.md §6).
//
// The battle engine simulates with CommittedForce.troops (a plain number).
// This module is the war layer's handshake between that number and a REAL
// roster: at commit time it locks supply-weight via commitWeight(); at
// resolve time it converts the battle's stamped casualty number back into
// dead cohorts via resolveBattleCasualties() and appends the losses to the
// colony's memorial feed (the plaques' source).
//
// A side carries a LIST of commit segments (initial force + every mid-battle
// addition: reinforcements, aid arrivals, maneuver entries), each stamped
// with its home, weight, and origin — so casualties bill the right bodies.
// The Chorus never commits — it has no roster, and its casualties stay ghost
// numbers by design.
//
// Two homes can back a side: "home" (the Cradle garrison) or a forward base
// (kind "base", keyed by foreign serverId) — the beachhead's last stand
// spends its own garrison, never the colony's.
//
// Design notes the war layer respects:
//   • Commit BEFORE createBattle: the creator sets CommittedForce.troops to
//     the committed weight, so the battle simulates what was actually sent.
//     (The Act I prologue is the exception: its troop numbers are pinned by
//     prologue-tests/act1-entry-verify.ts, so it simulates the scripted
//     number while committing min(scripted, available) — real troops die
//     proportionally, the story calibration never moves.)
//   • Casualties are stamped at creation (finalCasualties) and never
//     re-priced at resolve — the fraction applied here is
//     (stamped − settled tolls) / simulated troops.
//   • Mid-battle tolls (withdrawal rearguard) settle IMMEDIATELY via
//     settleToll(): the covering force dies now, pro-rata across the side's
//     live segments, and the final resolve bills only the remainder — tolls
//     are never double-paid (each segment tracks tollsPaid).
//   • Reinforcements commit AFTER the decision lands (never before
//     validation): the API handler commits the stamped troopsAdded out of the
//     real roster and stamps a segment. Duplicate submissions never commit
//     twice — the engine's idempotent duplicate path adds no troops, so the
//     handler commits nothing.
//   • There is no ghost troop pool. warReserve.troops was removed: the
//     "reserve" behind a reinforcement is availableWeight() of the side's
//     troop home — real bodies, or no order.
//
// Pure module: deterministic, no Math.random. The engine (engine.ts
// advance()) owns the clocks; this module owns the math.

import {
  applyCommittedCasualties,
  availableWeight,
  commitWeight,
  recordCasualties,
  releaseWeight,
  resolveBattleCasualties,
  type TroopRoster,
  type TroopType,
} from "./troops";
import {
  maneuverWeight,
  planComposition,
  planWeight,
  validateBattlePlan,
  type BattlePlan,
} from "./maneuvers";
import type {
  Battle,
  BattleSide,
  ManeuverVector,
  RosterCommitKind,
  RosterCommitSegment,
  RosterHome,
} from "./war-types";
import type { GameState } from "../types";
// Type-only: the fx shapes live in alliances.ts, which imports THIS module —
// a value import would be a module cycle. The queue itself is just an array
// push (mirrors queueAllianceFx's shape).
import type { AllianceFx } from "./alliances";

/** Queue a cross-account effect without importing alliances.ts (cycle-safe).
 *  alliance-transact.ts drains and applies these. */
function queueFx(state: GameState, fx: AllianceFx): void {
  if (!Array.isArray(state.allianceFx)) state.allianceFx = [];
  state.allianceFx.push(fx);
}

/** This colony's id — segments whose colonyId differs are foreign bodies:
 *  their roster lives on another account and is billed through the seam. */
function localColonyId(state: GameState): string {
  return state.gameId ?? "";
}

/** A segment is foreign when it names another colony's bodies. */
function isForeignSegment(state: GameState, s: RosterCommitSegment): boolean {
  return !!s.colonyId && s.colonyId !== localColonyId(state);
}

/** The war band's name for memorial attribution (rallies stamp allianceId). */
function allianceNameFor(state: GameState, battle: Battle): string | undefined {
  const aid = (battle as unknown as { allianceId?: string }).allianceId;
  if (!aid) return undefined;
  const store = (state as unknown as { alliances?: Record<string, { name?: string }> }).alliances;
  const name = store?.[aid]?.name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

/** Shared memorial context for one battle side's foreign billing. */
function foreignBillCtx(
  state: GameState,
  battle: Battle,
  season: string | undefined,
): { site: string; season: string; factions: [string, string]; allianceName?: string } {
  return {
    site: battle.zoneName,
    season: seasonFor(state, season),
    factions: [battle.attacker.colonyName, battle.defender.colonyName],
    allianceName: allianceNameFor(state, battle),
  };
}

/** The real roster behind a commit — null when the home doesn't exist
 *  (pre-muster saves, unplanted beachheads: commit degrades to 0). */
export function rosterForCommit(state: GameState, home: RosterHome): TroopRoster | null {
  if (home.kind === "home") return state.troops?.home.roster ?? null;
  return state.forwardBases?.[home.serverId]?.home.roster ?? null;
}

/**
 * Commit a detachment: lock up to `weight` supply-weight out of the roster.
 * Returns the weight actually committed — never more than availableWeight().
 * The creator sets CommittedForce.troops to the return BEFORE createBattle:
 * the battle simulates what you actually send. Never ghost numbers.
 */
export function commitRosterWeight(
  state: GameState,
  home: RosterHome,
  weight: number,
): number {
  const r = rosterForCommit(state, home);
  if (!r) return 0;
  const w = Math.min(Math.max(0, Math.trunc(weight)), availableWeight(r));
  if (w <= 0) return 0;
  commitWeight(r, w); // w <= availableWeight, so this always succeeds
  return w;
}

/** All live segments for a side — normalizes the pre-segment single-object
 *  save shape ({ home, weight }) into one "initial" segment, migrating in
 *  place so toll/weight mutations persist. */
export function segmentsFor(battle: Battle, side: BattleSide): RosterCommitSegment[] {
  const rc = battle.internal.rosterCommits?.[side];
  if (!rc) return [];
  if (Array.isArray(rc)) return rc;
  const old = rc as unknown as { home: RosterHome; weight: number };
  const seg: RosterCommitSegment = {
    id: `rc-legacy-${battle.id}-${side}`,
    kind: "initial",
    home: old.home,
    weight: Math.max(0, Math.trunc(old.weight) || 0),
    tollsPaid: 0,
    committedAt: battle.internal.committedAt ?? battle.startedAt,
  };
  battle.internal.rosterCommits![side] = [seg];
  return [seg];
}

/** Which troop home backs a side's committed force — the first segment's
 *  home, or null when the side never committed (ghost/scripted side). The
 *  API builds real-troop BattleReserves from this. */
export function sideHomeFor(battle: Battle, side: BattleSide): RosterHome | null {
  return segmentsFor(battle, side)[0]?.home ?? null;
}

/** Stamp one segment onto a side (server-only — battlePublicView strips
 *  `internal`). */
export function stampRosterSegment(
  battle: Battle,
  side: BattleSide,
  segment: RosterCommitSegment,
): void {
  if (!battle.internal.rosterCommits) battle.internal.rosterCommits = {};
  const list = battle.internal.rosterCommits[side] ?? [];
  list.push(segment);
  battle.internal.rosterCommits[side] = list;
}

/** Stamp a side's initial commit onto a battle under construction — the
 *  prologue path (kept so act1-battle.ts doesn't change shape). */
export function stampRosterCommit(
  battle: Battle,
  side: BattleSide,
  commit: { home: RosterHome; weight: number },
): void {
  stampRosterSegment(battle, side, {
    id: `rc-${battle.id}-${side}-initial`,
    kind: "initial",
    home: commit.home,
    weight: Math.max(0, Math.trunc(commit.weight) || 0),
    tollsPaid: 0,
    committedAt: battle.internal.committedAt ?? Date.now(),
  });
}

function emptyLosses(): Record<TroopType, number> {
  return { bulwark: 0, reaver: 0, longeye: 0, thunder: 0, warden: 0 };
}

function mergeLosses(into: Record<TroopType, number>, add: Record<TroopType, number>): void {
  for (const t of Object.keys(into) as TroopType[]) into[t] += add[t] ?? 0;
}

function recordSegmentLosses(
  state: GameState,
  battle: Battle,
  seasonId: string,
  lossesByType: Record<TroopType, number>,
): void {
  if (!state.troops) return;
  const total = (Object.values(lossesByType) as number[]).reduce((s, n) => s + n, 0);
  if (total <= 0) return;
  recordCasualties(state.troops.history, {
    battleId: battle.id,
    site: battle.zoneName,
    season: seasonId,
    factions: [battle.attacker.colonyName, battle.defender.colonyName],
    lossesByType,
    fallenHeroes: [],
    allianceName: allianceNameFor(state, battle),
    colonyName: state.playerName || "An unnamed colony",
  });
}

function seasonFor(state: GameState, season?: string): string {
  return season ?? state.battlePass?.seasonId ?? "s1";
}

/**
 * Settle a mid-battle toll (withdrawal rearguard) IMMEDIATELY: the covering
 * force dies now, pro-rata across the side's live segments. Each segment's
 * weight shrinks by what it paid and records tollsPaid, so the final resolve
 * bills only the remainder. Losses hit the memorial feed at once — the
 * rearguard's stand is its own plaque entry. Returns the weight actually
 * killed (0 when the side has no live segments — ghost sides pay nothing).
 */
export function settleToll(
  state: GameState,
  battle: Battle,
  side: BattleSide,
  tollWeight: number,
  season?: string,
): number {
  // ARENA bloodless: the rearguard walks home too — a withdrawal in a
  // bloodless bout costs no bodies (the toll IS virtual, like the rest).
  if (battle.bloodless && battle.arena) return 0;
  const segs = segmentsFor(battle, side).filter((s) => s.weight > 0);
  const total = segs.reduce((s, x) => s + x.weight, 0);
  const toll = Math.max(0, Math.trunc(tollWeight) || 0);
  if (total <= 0 || toll <= 0) return 0;
  const losses = emptyLosses();
  let killed = 0;
  const ctx = foreignBillCtx(state, battle, season);
  for (const s of segs) {
    const share = Math.min(s.weight, Math.round((toll * s.weight) / total));
    if (share <= 0) continue;
    if (isForeignSegment(state, s)) {
      // Foreign bodies pay through the seam — the sender's roster, the
      // sender's memorial. The segment shrinks here so the final resolve
      // never rebills the toll.
      queueFx(state, {
        kind: "bill-foreign-casualties",
        colonyId: s.colonyId!,
        segmentId: s.id,
        reinforcementId: s.reinforcementId,
        weight: share,
        segmentWeight: s.weight,
        key: `casualty:${battle.id}:${s.id}:toll:${s.tollsPaid + share}`,
        battleId: battle.id,
        site: ctx.site,
        season: ctx.season,
        factions: ctx.factions,
        allianceName: ctx.allianceName,
      });
      s.weight = Math.max(0, s.weight - share);
      s.tollsPaid += share;
      killed += share;
      continue;
    }
    const r = rosterForCommit(state, s.home);
    if (!r) continue; // home vanished mid-battle — nothing to bill
    const res = applyCommittedCasualties(r, share);
    s.weight = Math.max(0, s.weight - res.weightKilled);
    s.tollsPaid += res.weightKilled;
    killed += res.weightKilled;
    mergeLosses(losses, res.losses);
  }
  recordSegmentLosses(state, battle, seasonFor(state, season), losses);
  return killed;
}

/**
 * Commit a whole battle plan out of one roster, all-or-nothing: every
 * maneuver's weight is locked (pledged troops leave the garrison on pledge,
 * not on launch). Returns the segments — the caller sets the side's
 * CommittedForce.troops to the MAIN segment's weight BEFORE createBattle,
 * then stamps via stampBattlePlan(). On any failure nothing is committed.
 */
export function commitBattlePlan(
  state: GameState,
  side: BattleSide,
  plan: BattlePlan,
  home: RosterHome,
  now: number,
): { ok: true; segments: RosterCommitSegment[] } | { ok: false; error: string } {
  // Structural validation here; the entry-time bound needs the battle's
  // duration, so stampBattlePlan re-validates fully once the battle exists.
  const structural = validateBattlePlan(plan, Number.POSITIVE_INFINITY);
  if (structural.length > 0) return { ok: false, error: structural[0] };
  const total = planWeight(plan);
  if (total <= 0) return { ok: false, error: "A battle plan with no troops holds nothing." };
  const r = rosterForCommit(state, home);
  if (!r || availableWeight(r) < total) {
    return { ok: false, error: "Not enough troops in the garrison to pledge this plan." };
  }
  const segments: RosterCommitSegment[] = [];
  for (const m of plan.maneuvers) {
    const w = commitRosterWeight(state, home, maneuverWeight(m)); // cannot fail — total was checked
    segments.push({
      id: `rc-plan-${side}-${m.vector}-${now}`,
      kind: "maneuver",
      home,
      weight: w,
      tollsPaid: 0,
      vector: m.vector as ManeuverVector,
      committedAt: now,
    });
  }
  return { ok: true, segments };
}

/**
 * Stamp a committed plan onto a battle under construction: segments, the
 * server-only plan state (vectors/timing hidden until entry), and the public
 * intel (composition visible at launch). The MAIN maneuver is already in the
 * fight at T+0, so its entry is marked entered at attach. Illegal-once-timed
 * plans roll everything back and stamp nothing.
 */
export function stampBattlePlan(
  state: GameState,
  battle: Battle,
  side: BattleSide,
  plan: BattlePlan,
  segments: RosterCommitSegment[],
  now: number,
): { ok: true } | { ok: false; error: string } {
  const errors = validateBattlePlan(plan, battle.durationMs);
  if (errors.length > 0) {
    // Illegal once the battle's clock is known — release everything committed
    // and stamp nothing. The plan never launches.
    for (const s of segments) {
      const r = rosterForCommit(state, s.home);
      if (r && s.weight > 0) releaseWeight(r, s.weight);
    }
    return { ok: false, error: errors[0] };
  }
  for (const s of segments) stampRosterSegment(battle, side, s);
  battle.internal.planState = {
    side,
    planId: plan.id,
    attachedAt: now,
    entries: plan.maneuvers.map((m) => ({
      maneuverId: m.id,
      vector: m.vector,
      enterAtMin: m.enterAtMin,
      entered: m.vector === "MAIN",
      enteredAt: m.vector === "MAIN" ? now : undefined,
    })),
    screens: {},
  };
  const main = plan.maneuvers.find((m) => m.vector === "MAIN");
  battle.maneuverIntel = {
    side,
    composition: planComposition(plan),
    entered: main
      ? [{ id: main.id, vector: main.vector, troops: maneuverWeight(main), enteredAt: now }]
      : [],
    unentered: plan.maneuvers.length - (main ? 1 : 0),
  };
  return { ok: true };
}

/**
 * Apply stamped casualties for battles that resolved since the last tick.
 * Idempotent per battle (rosterResolved stamp): repeated advances, repeated
 * saves, and crash-replays can never double-kill. Per side, every live
 * segment pays its pro-rata share of (stamped − already-settled tolls);
 * losses append to the colony's memorial feed — the plaques read them.
 *
 * THE ZERO-CASUALTY FIX: when a side's billable fraction is zero, the old
 * code `continue`d and left the commitment locked FOREVER while marking the
 * battle resolved. Now the locks release — nobody died, everybody comes home.
 *
 * Returns the number of battles whose losses were applied.
 */
/**
 * ARENA lock release (decline/cancel/expiry): free `weight` of committed
 * troops back to the home garrison WITHOUT killing anyone. The arena's
 * honesty lock, undone.
 */
export function releaseArenaLocksFor(state: GameState, home: RosterHome, weight: number): void {
  const r = rosterForCommit(state, home);
  if (!r) return;
  const w = Math.max(0, Math.trunc(weight) || 0);
  if (w > 0) releaseWeight(r, w);
}
/**
 * ARENA bloodless release (arena-market.md §0.1): every segment's lock
 * releases and every troop walks home — nobody died, nothing is billed.
 * Foreign segments release through the seam (same fx the rally-survivor
 * path uses). Idempotent via the caller's rosterResolved stamp.
 */
function releaseArenaLocks(state: GameState, battle: Battle): void {
  for (const side of ["attacker", "defender"] as BattleSide[]) {
    for (const s of segmentsFor(battle, side)) {
      if (s.weight <= 0) continue;
      if (isForeignSegment(state, s)) {
        queueFx(state, {
          kind: "release-troop-lock",
          colonyId: s.colonyId!,
          weight: s.weight,
          key: `casualty:${battle.id}:${s.id}:arena-release`,
        });
      } else {
        const r = rosterForCommit(state, s.home);
        if (r) releaseWeight(r, s.weight);
      }
      s.weight = 0;
    }
  }
}
export function resolveRosterCasualties(state: GameState, season?: string): number {
  // No season engine exists yet (seasons.md) — the caller may pass one
  // explicitly; otherwise read the battle-pass window, else the pre-season
  // label. The memorial feed needs a season string; it must never be blank.
  const seasonId = seasonFor(state, season);
  if (!Array.isArray(state.battles)) return 0;
  let applied = 0;
  for (const b of state.battles) {
    if (b.status === "active") continue;
    if (b.internal.rosterResolved) continue;
    // ARENA bloodless (arena-market.md §0.1 + owner 2026-10-01): casualties
    // were computed for the report, but nobody dies — every segment's lock
    // releases and every troop walks home. Foreign segments release through
    // the same seam as rally survivors.
    if (b.bloodless && b.arena) {
      releaseArenaLocks(state, b);
      b.internal.rosterResolved = true;
      continue;
    }
    let touched = false;
    for (const side of ["attacker", "defender"] as BattleSide[]) {
      const segs = segmentsFor(b, side).filter((s) => s.weight > 0 || s.tollsPaid > 0);
      if (segs.length === 0) continue;
      touched = true;
      const force = side === "attacker" ? b.attacker : b.defender;
      const simulated = Math.max(0, Math.trunc(force.troops) || 0);
      const stamped = side === "attacker" ? b.casualties.attacker : b.casualties.defender;
      // Mid-battle tolls (withdrawal rearguard) already died via settleToll —
      // the final bill is the stamped remainder. Never double-pay.
      const tollsPaid = segs.reduce((s, x) => s + (x.tollsPaid || 0), 0);
      const toBill = Math.max(0, stamped - tollsPaid);
      const totalLive = segs.reduce((s, x) => s + Math.max(0, x.weight), 0);
      const fraction = simulated > 0 && totalLive > 0 ? Math.min(1, toBill / simulated) : 0;
      if (fraction <= 0) {
        // Nobody died on this side — release every live lock. (This is the
        // zero-casualty fix: the old `continue` stranded the weight forever.)
        for (const s of segs) {
          if (s.weight <= 0) continue;
          if (isForeignSegment(state, s)) {
            // Reinforcement guests: survivors stay stationed — the sender's
            // lock holds, nothing to bill, nothing to release.
            // Rally pledgers: their lock was only this battle — march home.
            if (!s.reinforcementId) {
              queueFx(state, {
                kind: "release-troop-lock",
                colonyId: s.colonyId!,
                weight: s.weight,
                key: `casualty:${b.id}:${s.id}:release`,
              });
            }
            s.weight = 0;
            continue;
          }
          const r = rosterForCommit(state, s.home);
          if (r) releaseWeight(r, s.weight);
          s.weight = 0;
        }
        continue;
      }
      const losses = emptyLosses();
      const ctx = foreignBillCtx(state, b, season);
      for (const s of segs) {
        if (s.weight <= 0) continue;
        if (isForeignSegment(state, s)) {
          // Foreign bodies: the sender's roster pays through the seam (their
          // memorial, their alliance attribution) — never the local roster.
          queueFx(state, {
            kind: "bill-foreign-casualties",
            colonyId: s.colonyId!,
            segmentId: s.id,
            reinforcementId: s.reinforcementId,
            fraction,
            segmentWeight: s.weight,
            battleId: b.id,
            site: ctx.site,
            season: ctx.season,
            factions: ctx.factions,
            allianceName: ctx.allianceName,
          });
          s.weight = 0;
          continue;
        }
        const r = rosterForCommit(state, s.home);
        if (!r) continue; // home vanished mid-battle (razed beachhead) — nothing to bill
        mergeLosses(losses, resolveBattleCasualties(r, s.weight, fraction));
        s.weight = 0; // resolveBattleCasualties releases the commitment
      }
      recordSegmentLosses(state, b, seasonId, losses);
    }
    if (touched) {
      b.internal.rosterResolved = true;
      applied += 1;
    }
  }
  return applied;
}

// Re-export the kind for callers that stamp segments directly.
export type { RosterCommitKind };
