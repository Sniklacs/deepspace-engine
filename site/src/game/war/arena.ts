// ARENA — bloodless mock battles, consensual stakes bouts, and the public
// ladder (design/arena-market.md Part I §§1–3; §4 DUELS ARE V2 — not here).
//
// The arena runs the REAL battle engine (maneuvers, plans, decisions — all of
// it) with one override: casualties are virtual unless BOTH sides toggled
// stakes on. Artifacts and heroes are NEVER at risk in the arena, in either
// mode (owner-locked 2026-09-30: legend changes hands only in real PvP).
// No loot, no XP, no supplies, no decision-energy ever moves in the arena —
// the payout is skill and ladder points. Practice that pays becomes farming.
//
// FLOW (cross-account, consensual):
//   1. Challenger commits troops (+ locks heroes) and sends `arena-challenge`
//      fx → the challenged colony's save (incoming challenge).
//   2. Challenged accepts: commits their own troops, sets THEIR stakes
//      toggle, fx `arena-accept` → challenger's save.
//   3. Challenger's save builds the battle (bloodless unless BOTH toggles
//      are on), stamps roster segments (guest's are foreign → billed through
//      the seam), battle resolves lazily like every other battle.
//   4. On resolve: the host records the bout and fx `arena-result` → guest.
//      Decline/cancel/expiry release every lock through the same fx.
//
// Pure module: deterministic, no Math.random. The engine (engine.ts
// advance()) owns the clocks; this module owns the challenge/bout math.
// Cross-save delivery rides alliance-transact.ts (applyOneFx cases live
// there; the appliers live here to keep the war layer cohesive).
import { availableWeight } from "./troops";
import { validateBattlePlan, type BattlePlan } from "./maneuvers";
import { attachBattlePlan, createBattle } from "./battle-engine";
import {
  commitRosterWeight,
  releaseArenaLocksFor,
  rosterForCommit,
  stampRosterSegment,
} from "./roster-commit";
import { WEAPON_TYPES } from "../armory";
import type {
  Battle,
  BattleHeroSnapshot,
  BattleSide,
  CommittedForce,
  CommittedWeapon,
  RosterHome,
} from "./war-types";
import type { GameState } from "../types";
import type { AllianceFx } from "./alliances";

// ============================================================================
// §1 CONFIG
// ============================================================================

export const ARENA_CONFIG = {
  /** A proposal unanswered this long expires and every lock releases. */
  challengeExpiryMs: 48 * 60 * 60 * 1000,
  /** Minimum skin in the game: a bout needs troops or heroes on each side. */
  minForce: 1,
  /** The arena's battleground label (v1: one pit, opaque zone). */
  zoneId: "arena-pit",
  zoneName: "The Arena",
} as const;

/** Bout mode — derived, never trusted from one side alone. */
export type ArenaMode = "bloodless" | "stakes";

export type ArenaChallengeState =
  | "proposed"
  | "accepted"
  | "active"
  | "declined"
  | "expired"
  | "cancelled"
  | "resolved";

/** One side's committed arena force (client-built, server-validated). */
export interface ArenaForceInput {
  /** Supply-weight of troops. */
  troops: number;
  heroes: BattleHeroSnapshot[];
  /** Proving ground: armory kits fielded in the bout (artifacts ride on
   *  the heroes' resolved equipment, not here). */
  weapons: CommittedWeapon[];
}

export interface ArenaChallenge {
  id: string;
  state: ArenaChallengeState;
  challengerId: string;
  challengerName: string;
  challengedId: string;
  challengedName: string;
  /** The challenger's stakes proposal. The EFFECTIVE mode is derived on
   *  accept: stakes only when challengerStakes && guestStakes. */
  challengerStakes: boolean;
  /** The challenged side's toggle — null until they accept. */
  guestStakes: boolean | null;
  /** Effective mode — null until accepted. */
  mode: ArenaMode | null;
  challengerForce: CommittedForce;
  guestForce: CommittedForce | null;
  /** The challenger's battle plan (v1: one plan per bout, the challenger's).
   *  Attached at battle creation in precommitted mode. */
  plan: BattlePlan | null;
  battleId: string | null;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
}

/** One recorded bout — stored on BOTH saves (host creates, guest receives
 *  via fx), aggregated server-side with boutId dedupe for the public ladder. */
export interface ArenaBout {
  boutId: string;
  challengeId: string;
  season: string;
  /** Resolved at (epoch ms). */
  at: number;
  mode: ArenaMode;
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  /** null = draw/standoff. */
  winnerId: string | null;
}

export interface ArenaLadderEntry {
  colonyId: string;
  colonyName: string;
  wins: number;
  losses: number;
  draws: number;
  stakesWins: number;
  stakesLosses: number;
  bouts: number;
}

// ============================================================================
// §2 STATE
// ============================================================================

/** Additive init — old saves get empty arena state, never a wipe. */
export function ensureArena(state: GameState): void {
  const s = state as unknown as {
    arenaChallenges?: ArenaChallenge[];
    arenaBouts?: ArenaBout[];
  };
  if (!Array.isArray(s.arenaChallenges)) s.arenaChallenges = [];
  if (!Array.isArray(s.arenaBouts)) s.arenaBouts = [];
}

export function arenaChallengesOf(state: GameState): ArenaChallenge[] {
  ensureArena(state);
  return (state as unknown as { arenaChallenges: ArenaChallenge[] }).arenaChallenges;
}

export function arenaBoutsOf(state: GameState): ArenaBout[] {
  ensureArena(state);
  return (state as unknown as { arenaBouts: ArenaBout[] }).arenaBouts;
}

export function arenaChallengeById(state: GameState, id: string): ArenaChallenge | null {
  return arenaChallengesOf(state).find((c) => c.id === id) ?? null;
}

// ============================================================================
// §3 FORCE VALIDATION (server-side — the client proposes, the server owns)
// ============================================================================

export type ArenaResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

function validateForceInput(
  state: GameState,
  force: ArenaForceInput,
): ArenaResult<{ troops: number; heroes: BattleHeroSnapshot[]; weapons: CommittedWeapon[] }> {
  const troops = Math.max(0, Math.trunc(force.troops) || 0);
  const heroes = Array.isArray(force.heroes) ? force.heroes : [];
  const weapons = Array.isArray(force.weapons) ? force.weapons : [];
  if (troops < 0) return { ok: false, error: "Troop weight can't be negative." };
  if (troops === 0 && heroes.length === 0) {
    return { ok: false, error: "Bring troops, heroes, or both — an empty bout proves nothing." };
  }
  if (heroes.length > 5) return { ok: false, error: "At most five heroes march in an arena bout." };
  const roster = rosterForCommit(state, { kind: "home" });
  if (troops > 0) {
    if (!roster) return { ok: false, error: "No garrison to march from." };
    if (troops > availableWeight(roster)) {
      return { ok: false, error: "Your garrison can't spare that many." };
    }
  }
  const locks = (state.warReserve?.lockedHeroes ?? {}) as Record<string, { battleId: string }>;
  const seen = new Set<string>();
  for (const h of heroes) {
    if (!h || typeof h.id !== "string" || h.id.length === 0) {
      return { ok: false, error: "A hero in your squad has no identity." };
    }
    if (seen.has(h.id)) return { ok: false, error: "A hero can only march once." };
    seen.add(h.id);
    if (locks[h.id]) return { ok: false, error: `${h.name || "A hero"} is already committed elsewhere.` };
  }
  const cleanWeapons: CommittedWeapon[] = [];
  for (const w of weapons) {
    if (!w || !(WEAPON_TYPES as readonly string[]).includes(w.family)) {
      return { ok: false, error: "Unknown weapon family in your kit list." };
    }
    const tier = Math.trunc(w.tier) || 0;
    if (tier < 1 || tier > 4) return { ok: false, error: "Weapon tiers run 1–4." };
    const count = Math.max(0, Math.trunc(w.count) || 0);
    if (count <= 0) continue;
    cleanWeapons.push({ family: w.family, tier: tier as CommittedWeapon["tier"], count });
  }
  return { ok: true, value: { troops, heroes, weapons: cleanWeapons } };
}

/** Lock one side's force into their own garrison (troops committed, heroes
 *  locked until the bout resolves). Returns the snapshot CommittedForce. */
function lockArenaForce(
  state: GameState,
  home: RosterHome,
  colonyId: string,
  colonyName: string,
  side: BattleSide,
  validated: { troops: number; heroes: BattleHeroSnapshot[]; weapons: CommittedWeapon[] },
  battleRef: string,
  until: number,
): CommittedForce {
  const committed = validated.troops > 0 ? commitRosterWeight(state, home, validated.troops) : 0;
  if (state.warReserve) {
    for (const h of validated.heroes) {
      state.warReserve.lockedHeroes[h.id] = { battleId: battleRef, until };
    }
  }
  return {
    side,
    colonyId,
    colonyName,
    heroSquad: validated.heroes.map((h) => ({ ...h })),
    weapons: validated.weapons.map((w) => ({ ...w })),
    troops: committed,
    fobStage: 0,
  };
}

/** Release one side's arena locks (troops back to the garrison, heroes
 *  unlocked). Used on decline/cancel/expiry. */
export function releaseArenaForceLocks(
  state: GameState,
  home: RosterHome,
  force: CommittedForce,
  battleRef: string,
): void {
  releaseArenaLocksFor(state, home, force.troops);
  if (state.warReserve) {
    for (const h of force.heroSquad) {
      const lock = state.warReserve.lockedHeroes[h.id];
      if (lock && lock.battleId === battleRef) delete state.warReserve.lockedHeroes[h.id];
    }
  }
}

// ============================================================================
// §4 CHALLENGE LIFECYCLE
// ============================================================================

let arenaSeq = 0;
function newChallengeId(now: number): string {
  arenaSeq += 1;
  return `arc-${now.toString(36)}-${arenaSeq.toString(36)}`;
}

/** The challenger's proposal. Commits their troops + locks heroes NOW (the
 *  lock is the honesty: you can't spend the troops mid-proposal). The caller
 *  queues the returned fx to the challenged colony. */
export function challengeArena(
  state: GameState,
  challenger: { id: string; name: string },
  challenged: { id: string; name: string },
  force: ArenaForceInput,
  challengerStakes: boolean,
  plan: BattlePlan | null,
  now: number,
): ArenaResult<{ challenge: ArenaChallenge; fx: AllianceFx }> {
  ensureArena(state);
  if (!challenged.id || challenged.id === challenger.id) {
    return { ok: false, error: "You can't challenge yourself — the mirror never blinks." };
  }
  const v = validateForceInput(state, force);
  if (!v.ok) return v;
  let cleanPlan: BattlePlan | null = null;
  if (plan) {
    // Plans validate against a generous duration bound here; the real
    // battle's duration re-validates at attach (same validator).
    const errs = validateBattlePlan(plan, 8 * 60 * 60 * 1000);
    if (errs.length > 0) return { ok: false, error: errs[0] };
    if (!plan.id || !Array.isArray(plan.maneuvers) || plan.maneuvers.length === 0) {
      return { ok: false, error: "That battle plan is empty." };
    }
    cleanPlan = {
      id: String(plan.id),
      maneuvers: plan.maneuvers.map((m) => ({
        id: String(m.id),
        vector: m.vector,
        enterAtMin: Math.max(0, m.enterAtMin || 0),
        composition: { ...(m.composition ?? {}) },
      })),
    };
  }
  const challengeId = newChallengeId(now);
  const committed = lockArenaForce(
    state,
    { kind: "home" },
    challenger.id,
    challenger.name,
    "attacker",
    v.value,
    challengeId,
    now + ARENA_CONFIG.challengeExpiryMs,
  );
  const challenge: ArenaChallenge = {
    id: challengeId,
    state: "proposed",
    challengerId: challenger.id,
    challengerName: challenger.name,
    challengedId: challenged.id,
    challengedName: challenged.name,
    challengerStakes: !!challengerStakes,
    guestStakes: null,
    mode: null,
    challengerForce: committed,
    guestForce: null,
    plan: cleanPlan,
    battleId: null,
    createdAt: now,
    expiresAt: now + ARENA_CONFIG.challengeExpiryMs,
    decidedAt: null,
  };
  arenaChallengesOf(state).push(challenge);
  const fx: AllianceFx = {
    kind: "arena-challenge",
    colonyId: challenged.id,
    challenge: JSON.parse(JSON.stringify(challenge)) as ArenaChallenge,
    key: `arena-challenge:${challenge.id}`,
  };
  return { ok: true, value: { challenge, fx } };
}

/** The challenged side accepts: commits their troops, sets THEIR stakes
 *  toggle. Returns the fx that carries the acceptance (+ their force) to the
 *  challenger's save, where the battle is built. */
export function acceptArenaChallenge(
  state: GameState,
  challengeId: string,
  guest: { id: string; name: string },
  force: ArenaForceInput,
  guestStakes: boolean,
  now: number,
): ArenaResult<{ fx: AllianceFx }> {
  ensureArena(state);
  const c = arenaChallengeById(state, challengeId);
  if (!c) return { ok: false, error: "That challenge doesn't exist." };
  if (c.challengedId !== guest.id) return { ok: false, error: "That challenge wasn't issued to you." };
  if (c.state !== "proposed") return { ok: false, error: "That challenge is no longer open." };
  if (now > c.expiresAt) {
    c.state = "expired";
    c.decidedAt = now;
    return { ok: false, error: "That challenge expired." };
  }
  const v = validateForceInput(state, force);
  if (!v.ok) return v;
  const committed = lockArenaForce(
    state,
    { kind: "home" },
    guest.id,
    guest.name,
    "defender",
    v.value,
    c.id,
    now + ARENA_CONFIG.challengeExpiryMs,
  );
  c.state = "accepted";
  c.guestStakes = !!guestStakes;
  c.mode = c.challengerStakes && !!guestStakes ? "stakes" : "bloodless";
  c.guestForce = committed;
  c.decidedAt = now;
  const fx: AllianceFx = {
    kind: "arena-accept",
    colonyId: c.challengerId,
    challengeId: c.id,
    guestForce: JSON.parse(JSON.stringify(committed)) as CommittedForce,
    guestStakes: !!guestStakes,
    key: `arena-accept:${c.id}`,
  };
  return { ok: true, value: { fx } };
}

/** Decline: the guest's save marks it; the fx tells the challenger to stand
 *  their troops down. */
export function declineArenaChallenge(
  state: GameState,
  challengeId: string,
  guestId: string,
  now: number,
): ArenaResult<{ fx: AllianceFx }> {
  ensureArena(state);
  const c = arenaChallengeById(state, challengeId);
  if (!c) return { ok: false, error: "That challenge doesn't exist." };
  if (c.challengedId !== guestId) return { ok: false, error: "That challenge wasn't issued to you." };
  if (c.state !== "proposed") return { ok: false, error: "That challenge is no longer open." };
  c.state = "declined";
  c.decidedAt = now;
  return {
    ok: true,
    value: {
      fx: {
        kind: "arena-decline",
        colonyId: c.challengerId,
        challengeId: c.id,
        key: `arena-decline:${c.id}`,
      },
    },
  };
}

/** Cancel (challenger, while proposed): stand down locally + notify guest. */
export function cancelArenaChallenge(
  state: GameState,
  challengeId: string,
  challengerId: string,
  now: number,
): ArenaResult<{ fx: AllianceFx }> {
  ensureArena(state);
  const c = arenaChallengeById(state, challengeId);
  if (!c) return { ok: false, error: "That challenge doesn't exist." };
  if (c.challengerId !== challengerId) return { ok: false, error: "Only the challenger cancels." };
  if (c.state !== "proposed") return { ok: false, error: "That challenge is already underway." };
  c.state = "cancelled";
  c.decidedAt = now;
  releaseArenaForceLocks(state, { kind: "home" }, c.challengerForce, c.id);
  return {
    ok: true,
    value: {
      fx: {
        kind: "arena-cancel",
        colonyId: c.challengedId,
        challengeId: c.id,
        key: `arena-cancel:${c.id}`,
      },
    },
  };
}

/** Sweep stale proposals (and accepted-but-never-built bouts): every lock
 *  releases, nobody is left committed to a ghost. Runs in advance(). */
export function expireArenaChallenges(state: GameState, now: number): number {
  ensureArena(state);
  let swept = 0;
  for (const c of arenaChallengesOf(state)) {
    if ((c.state === "proposed" || c.state === "accepted") && now > c.expiresAt) {
      const isChallenger = (state.gameId ?? "") === c.challengerId;
      const isGuest = (state.gameId ?? "") === c.challengedId;
      if (isChallenger && c.state === "proposed") {
        releaseArenaForceLocks(state, { kind: "home" }, c.challengerForce, c.id);
      }
      if (isGuest && c.state === "accepted" && c.guestForce) {
        releaseArenaForceLocks(state, { kind: "home" }, c.guestForce, c.id);
      }
      c.state = "expired";
      c.decidedAt = now;
      swept += 1;
    }
  }
  return swept;
}

// ============================================================================
// §5 BATTLE CONSTRUCTION (runs on the challenger's save, on arena-accept)
// ============================================================================

/** Build the arena battle from an accepted challenge. The EFFECTIVE mode is
 *  derived here and only here: stakes iff both toggles are on. */
export function startArenaBattle(
  state: GameState,
  challengeId: string,
  guestForce: CommittedForce,
  guestStakes: boolean,
  season: string,
  now: number,
): ArenaResult<{ battle: Battle }> {
  ensureArena(state);
  const c = arenaChallengeById(state, challengeId);
  if (!c) return { ok: false, error: "That challenge doesn't exist." };
  if (c.state !== "proposed" && c.state !== "accepted") {
    return { ok: false, error: "That challenge can't start a bout." };
  }
  if (now > c.expiresAt) {
    c.state = "expired";
    c.decidedAt = now;
    releaseArenaForceLocks(state, { kind: "home" }, c.challengerForce, c.id);
    return { ok: false, error: "That challenge expired." };
  }
  // Idempotent: a redelivered accept never builds a second bout.
  if (c.battleId) {
    const existing = (state.battles ?? []).find((b) => b.id === c.battleId);
    if (existing) return { ok: true, value: { battle: existing } };
  }
  const defender: CommittedForce = {
    ...guestForce,
    side: "defender",
    colonyId: c.challengedId,
    colonyName: c.challengedName,
  };
  const battle = createBattle(
    {
      zoneId: ARENA_CONFIG.zoneId,
      zoneName: ARENA_CONFIG.zoneName,
      attacker: { ...c.challengerForce, side: "attacker" },
      defender,
      stakes: { attacker: c.challengerStakes, defender: !!guestStakes },
      arena: {
        challengeId: c.id,
        season,
        hostColonyId: c.challengerId,
        guestColonyId: c.challengedId,
      },
    },
    now,
  );
  // Roster segments: the host's own bodies are local; the guest's ride the
  // foreign seam so stakes-mode casualties bill the right roster.
  stampRosterSegment(battle, "attacker", {
    id: `arena-${c.id}-attacker-initial`,
    kind: "initial",
    home: { kind: "home" },
    weight: c.challengerForce.troops,
    tollsPaid: 0,
    colonyId: c.challengerId,
    committedAt: now,
  });
  if (defender.troops > 0) {
    stampRosterSegment(battle, "defender", {
      id: `arena-${c.id}-defender-initial`,
      kind: "initial",
      home: { kind: "home" },
      weight: defender.troops,
      tollsPaid: 0,
      colonyId: c.challengedId,
      committedAt: now,
    });
  }
  // The challenger's battle plan (v1: one plan per bout — the challenger's).
  // Precommitted: the troops already left the garrison at challenge time.
  if (c.plan) {
    const res = attachBattlePlan(state, battle, "attacker", c.plan, { kind: "home" }, now, undefined, {
      precommitted: true,
      pledgedWeight: Math.max(0, c.challengerForce.troops),
    });
    if (!res.ok) return { ok: false, error: res.error };
  }
  if (!Array.isArray(state.battles)) state.battles = [];
  state.battles.push(battle);
  c.state = "active";
  c.guestStakes = !!guestStakes;
  c.mode = battle.arena?.stakes ? "stakes" : "bloodless";
  c.guestForce = defender;
  c.battleId = battle.id;
  c.decidedAt = now;
  return { ok: true, value: { battle } };
}

// ============================================================================
// §6 RESOLUTION → BOUTS (runs on the host in advance(), after casualties)
// ============================================================================

/** For every resolved arena battle not yet recorded: write the bout to this
 *  save, unlock the host's heroes, and queue the `arena-result` fx so the
 *  guest records the same bout. The ladder itself is aggregated server-side
 *  (arenaLadder in api.ts) with boutId dedupe — no cross-save table to sync. */
export function resolveArenaBattles(
  state: GameState,
  now: number,
  queueFx: (fx: AllianceFx) => void,
): number {
  ensureArena(state);
  let recorded = 0;
  for (const b of state.battles ?? []) {
    if (!b.arena || b.status !== "resolved" || !b.result) continue;
    const boutId = b.id;
    if (arenaBoutsOf(state).some((x) => x.boutId === boutId)) continue;
    const c = arenaChallengeById(state, b.arena.challengeId);
    const winnerId =
      b.result.outcome === "attacker_victory"
        ? b.attacker.colonyId
        : b.result.outcome === "defender_victory"
          ? b.defender.colonyId
          : null;
    const bout: ArenaBout = {
      boutId,
      challengeId: b.arena.challengeId,
      season: b.arena.season,
      at: now,
      mode: b.arena.stakes ? "stakes" : "bloodless",
      aId: b.attacker.colonyId,
      aName: b.attacker.colonyName,
      bId: b.defender.colonyId,
      bName: b.defender.colonyName,
      winnerId,
    };
    arenaBoutsOf(state).push(bout);
    // Host heroes come home.
    if (state.warReserve) {
      for (const h of b.attacker.heroSquad) {
        const lock = state.warReserve.lockedHeroes[h.id];
        if (lock && lock.battleId === b.arena.challengeId) delete state.warReserve.lockedHeroes[h.id];
      }
    }
    if (c) {
      c.state = "resolved";
      c.decidedAt = now;
    }
    queueFx({
      kind: "arena-result",
      colonyId: b.defender.colonyId,
      bout: JSON.parse(JSON.stringify(bout)) as ArenaBout,
      heroIds: b.defender.heroSquad.map((h) => h.id),
      challengeId: b.arena.challengeId,
      key: `arena-result:${boutId}`,
    });
    recorded += 1;
  }
  return recorded;
}

/** Guest-side applier: record the bout + unlock the guest's heroes. */
export function applyArenaResult(
  state: GameState,
  bout: ArenaBout,
  heroIds: string[],
  challengeId: string,
  key: string,
  now: number,
): void {
  ensureArena(state);
  const done = (state as unknown as { arenaFxDone?: Record<string, number> }).arenaFxDone ?? {};
  if (done[key]) return;
  done[key] = now;
  (state as unknown as { arenaFxDone?: Record<string, number> }).arenaFxDone = done;
  if (!arenaBoutsOf(state).some((x) => x.boutId === bout.boutId)) {
    arenaBoutsOf(state).push({ ...bout });
  }
  if (state.warReserve) {
    for (const id of heroIds) {
      const lock = state.warReserve.lockedHeroes[id];
      if (lock && lock.battleId === challengeId) delete state.warReserve.lockedHeroes[id];
    }
  }
  const c = arenaChallengeById(state, bout.challengeId);
  if (c && (c.state === "accepted" || c.state === "active")) {
    c.state = "resolved";
    c.decidedAt = now;
  }
}

/** The season key bouts count toward (same source as the memorial feed). */
export function arenaSeason(state: GameState): string {
  const s = state as unknown as { battlePass?: { seasonId?: string } };
  return s.battlePass?.seasonId ?? "s1";
}

// ============================================================================
// §8 CROSS-SAVE APPLIERS (called from alliance-transact.ts applyOneFx)
// ============================================================================

/** Challenged-side: record an incoming proposal (idempotent on challenge id). */
export function applyArenaChallengeFx(target: GameState, challenge: ArenaChallenge): void {
  ensureArena(target);
  if (!arenaChallengeById(target, challenge.id)) {
    arenaChallengesOf(target).push(JSON.parse(JSON.stringify(challenge)) as ArenaChallenge);
  }
}

/** Challenger-side: a redelivered/accepted challenge builds the bout. */
export function applyArenaAcceptFx(
  target: GameState,
  challengeId: string,
  guestForce: CommittedForce,
  guestStakes: boolean,
  key: string,
  now: number,
): ArenaResult {
  ensureArena(target);
  const done = (target as unknown as { arenaFxDone?: Record<string, number> }).arenaFxDone ?? {};
  if (done[key]) return { ok: true, value: undefined };
  const res = startArenaBattle(target, challengeId, guestForce, guestStakes, arenaSeason(target), now);
  if (!res.ok) {
    // The bout can't start (expired/cancelled after accept): tell the guest
    // to stand down. Queued through the local outbox like every other fx.
    const c = arenaChallengeById(target, challengeId);
    if (c && c.state === "expired") {
      const q = (target as unknown as { allianceFx?: AllianceFx[] }).allianceFx ?? [];
      q.push({
        kind: "arena-cancel",
        colonyId: c.challengedId,
        challengeId: c.id,
        key: `arena-cancel:${c.id}:late`,
      });
      (target as unknown as { allianceFx?: AllianceFx[] }).allianceFx = q;
    }
    return res;
  }
  done[key] = now;
  (target as unknown as { arenaFxDone?: Record<string, number> }).arenaFxDone = done;
  return { ok: true, value: undefined };
}

/** Challenger-side: the challenged declined — stand the troops down. */
export function applyArenaDeclineFx(target: GameState, challengeId: string, now: number): void {
  ensureArena(target);
  const c = arenaChallengeById(target, challengeId);
  if (!c || c.state !== "proposed") return;
  c.state = "declined";
  c.decidedAt = now;
  releaseArenaForceLocks(target, { kind: "home" }, c.challengerForce, c.id);
}

/** Guest-side: the challenger cancelled — drop the proposal. */
export function applyArenaCancelFx(target: GameState, challengeId: string, now: number): void {
  ensureArena(target);
  const c = arenaChallengeById(target, challengeId);
  if (!c) return;
  if (c.state === "proposed" || c.state === "accepted") {
    // Accepted-but-cancelled is a can't-happen (cancel only runs while
    // proposed), but release guest locks defensively if they exist.
    if (c.state === "accepted" && c.guestForce) {
      releaseArenaForceLocks(target, { kind: "home" }, c.guestForce, c.id);
    }
    c.state = "cancelled";
    c.decidedAt = now;
  }
}

// ============================================================================
// §7 LADDER (aggregated server-side; entries derive from bouts)
// ============================================================================

/** Fold bouts into ladder entries (dedupe by boutId — host and guest each
 *  hold a copy of every bout they fought). */
export function buildLadderEntries(bouts: ArenaBout[]): ArenaLadderEntry[] {
  const seen = new Set<string>();
  const map = new Map<string, ArenaLadderEntry>();
  const get = (id: string, name: string): ArenaLadderEntry => {
    let e = map.get(id);
    if (!e) {
      e = { colonyId: id, colonyName: name, wins: 0, losses: 0, draws: 0, stakesWins: 0, stakesLosses: 0, bouts: 0 };
      map.set(id, e);
    }
    return e;
  };
  for (const b of bouts) {
    if (!b || seen.has(b.boutId)) continue;
    seen.add(b.boutId);
    const a = get(b.aId, b.aName);
    const bEnt = get(b.bId, b.bName);
    const stakes = b.mode === "stakes";
    if (b.winnerId === null) {
      a.draws += 1; bEnt.draws += 1;
    } else if (b.winnerId === b.aId) {
      a.wins += 1; bEnt.losses += 1;
      if (stakes) { a.stakesWins += 1; bEnt.stakesLosses += 1; }
    } else {
      bEnt.wins += 1; a.losses += 1;
      if (stakes) { bEnt.stakesWins += 1; a.stakesLosses += 1; }
    }
    a.bouts += 1; bEnt.bouts += 1;
  }
  return [...map.values()].sort((x, y) => {
    // Stakes wins first (a hardcore win reads differently), then wins, then
    // fewest losses. The pecking order rewards daring, not farming.
    if (y.stakesWins !== x.stakesWins) return y.stakesWins - x.stakesWins;
    if (y.wins !== x.wins) return y.wins - x.wins;
    return x.losses - y.losses;
  });
}

/** Seasonal titles — cosmetic only (arena-market.md §2). */
export function arenaTitle(rank: number, serverName: string): string | null {
  if (rank === 1) return `Champion of ${serverName}`;
  if (rank === 2) return `Blade of ${serverName}`;
  if (rank === 3) return `Warden of ${serverName}`;
  return null;
}

/** Human mode label for the unmistakable UI. */
export function arenaModeLabel(mode: ArenaMode): string {
  return mode === "stakes" ? "STAKES — troops at risk" : "PRACTICE — no troop loss";
}
