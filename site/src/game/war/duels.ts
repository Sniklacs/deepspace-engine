// DUELS — consensual wagered bouts with server-escrowed stakes
// (design/arena-market.md Part I §4).
//
// A duel settles a grudge: two players agree a format (hero duel or a capped
// skirmish) and each puts up STAKES — supplies, embers, scrip, warplate,
// plasma. The server escrows both sides' stakes up front; the winner takes
// all. No take-backs.
//
// LOCKED RULES (owner 2026-09-30, do not redesign):
//   • ARTIFACTS ARE NEVER STAKES. Not on the table, not in escrow, not as a
//     wager. "You can't buy legend" dies the moment a whale buys a grinder's
//     artifact off a duel. Attempting to stake one rejects the call.
//   • The duel itself is BLOODLESS — troops walk home. The risk is the
//     escrowed materials, not bodies. (The §§1–3 mutual-stakes bouts are the
//     place for troop risk; duels are about the wager.)
//   • Challenges go out over the WORLD SPEAKER: the public duel board shows
//     every open challenge. The challenged must publicly ACCEPT or REFUSE —
//     refusing carries no mechanical penalty, because in an alliance game the
//     mockery is worse than any fine. "That's the way she rolls."
//
// FLOW (cross-account, consensual, mirrors the arena pattern):
//   1. Challenger proposes: their stakes are ESCROWED NOW (deducted from
//      their stockpile into the challenge record). fx `duel-challenge` → the
//      challenged colony's save. The board shows it server-wide.
//   2. Challenged accepts: their stakes escrowed, their force locked.
//      fx `duel-accept` → challenger's save, which builds the bloodless duel
//      battle on the real engine.
//   3. On resolve: the host distributes the escrow — winner takes all — and
//      fx `duel-result` → the guest.
//   4. Decline/cancel/expiry: every escrow returns to its owner, locks
//      release. A decline is recorded PUBLICLY on the board.
//
// Pure module: deterministic, no Math.random. Cross-save delivery rides
// alliance-transact.ts (applyOneFx cases); the appliers live here.
import { availableWeight } from "./troops";
import { createBattle } from "./battle-engine";
import {
  commitRosterWeight,
  releaseArenaLocksFor,
  rosterForCommit,
  stampRosterSegment,
} from "./roster-commit";
import type {
  Battle,
  BattleHeroSnapshot,
  BattleSide,
  CommittedForce,
  RosterHome,
} from "./war-types";
import type { GameState } from "../types";
import type { AllianceFx } from "./alliances";

// ============================================================================
// §1 CONFIG & TYPES
// ============================================================================

export const DUEL_CONFIG = {
  /** A proposal unanswered this long expires; every escrow returns. */
  challengeExpiryMs: 48 * 60 * 60 * 1000,
  zoneId: "duel-circle",
  zoneName: "The Duel Circle",
} as const;

/** Duel formats (arena-market.md §4, §8 tunables). */
export type DuelFormat = "hero" | "skirmish-50" | "skirmish-100" | "skirmish-200";

/** Supply-weight troop caps per skirmish format. Hero duels allow no troops. */
export const DUEL_TROOP_CAPS: Record<DuelFormat, number> = {
  hero: 0,
  "skirmish-50": 50,
  "skirmish-100": 100,
  "skirmish-200": 200,
};

export function duelFormatLabel(format: DuelFormat): string {
  switch (format) {
    case "hero": return "Hero duel";
    case "skirmish-50": return "Skirmish · 50 supply";
    case "skirmish-100": return "Skirmish · 100 supply";
    case "skirmish-200": return "Skirmish · 200 supply";
  }
}

/** Stakable resources. ARTIFACTS ARE NOT HERE — by construction, not by
 *  comment. Anything not on this list cannot be escrowed. */
export type DuelStakeKind = "supplies" | "embers" | "scrip" | "warplate" | "plasma";

export const DUEL_STAKE_KINDS: readonly DuelStakeKind[] = [
  "supplies",
  "embers",
  "scrip",
  "warplate",
  "plasma",
] as const;

export function duelStakeLabel(kind: DuelStakeKind): string {
  switch (kind) {
    case "supplies": return "Supplies";
    case "embers": return "Embers";
    case "scrip": return "Scrip";
    case "warplate": return "Warplate";
    case "plasma": return "Plasma";
  }
}

export interface DuelStake {
  kind: DuelStakeKind;
  amount: number;
}

export type DuelChallengeState =
  | "proposed"
  | "accepted"
  | "active"
  | "declined"
  | "expired"
  | "cancelled"
  | "resolved";

/** One side's duel force (client-built, server-validated). */
export interface DuelForceInput {
  troops: number;
  heroes: BattleHeroSnapshot[];
}

export interface DuelChallenge {
  id: string;
  state: DuelChallengeState;
  format: DuelFormat;
  challengerId: string;
  challengerName: string;
  challengedId: string;
  challengedName: string;
  /** Escrowed at propose — already deducted from the challenger's stockpile. */
  challengerStakes: DuelStake[];
  /** Escrowed at accept — already deducted from the challenged's stockpile. */
  challengedStakes: DuelStake[];
  challengerForce: CommittedForce;
  challengedForce: CommittedForce | null;
  battleId: string | null;
  winnerId: string | null;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
}

/** One recorded duel — stored on BOTH saves, aggregated server-side with
 *  duelId dedupe for the public board. */
export interface DuelBout {
  duelId: string;
  challengeId: string;
  season: string;
  format: DuelFormat;
  at: number;
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  /** null = draw/standoff — every escrow returns to its owner. */
  winnerId: string | null;
  /** What the winner took home (empty on a draw). */
  pot: DuelStake[];
}

/** Public board entry — what the world speaker shows. */
export interface DuelBoardEntry {
  id: string;
  state: DuelChallengeState;
  format: DuelFormat;
  challengerId: string;
  challengerName: string;
  challengedId: string;
  challengedName: string;
  pot: DuelStake[];
  createdAt: number;
  decidedAt: number | null;
  winnerId: string | null;
}

// ============================================================================
// §2 STATE
// ============================================================================

/** Additive init — old saves get empty duel state, never a wipe. */
export function ensureDuels(state: GameState): void {
  const s = state as unknown as {
    duelChallenges?: DuelChallenge[];
    duelBouts?: DuelBout[];
  };
  if (!Array.isArray(s.duelChallenges)) s.duelChallenges = [];
  if (!Array.isArray(s.duelBouts)) s.duelBouts = [];
}

export function duelChallengesOf(state: GameState): DuelChallenge[] {
  ensureDuels(state);
  return (state as unknown as { duelChallenges: DuelChallenge[] }).duelChallenges;
}

export function duelBoutsOf(state: GameState): DuelBout[] {
  ensureDuels(state);
  return (state as unknown as { duelBouts: DuelBout[] }).duelBouts;
}

export function duelChallengeById(state: GameState, id: string): DuelChallenge | null {
  return duelChallengesOf(state).find((c) => c.id === id) ?? null;
}

// ============================================================================
// §3 ESCROW (the server holds the coats)
// ============================================================================

export type DuelResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

function stakeBalance(state: GameState, kind: DuelStakeKind): number {
  const st = state as GameState;
  switch (kind) {
    case "supplies": return Math.max(0, Math.trunc(st.resources?.supplies ?? 0));
    case "embers": return Math.max(0, Math.trunc(st.resources?.embers ?? 0));
    case "scrip": return Math.max(0, Math.trunc(st.currency?.scrip ?? 0));
    case "warplate": return Math.max(0, Math.trunc(st.resources?.warplate ?? 0));
    case "plasma": return Math.max(0, Math.trunc(st.resources?.plasma ?? 0));
  }
}

function adjustStakeBalance(state: GameState, kind: DuelStakeKind, delta: number): void {
  const st = state as GameState;
  switch (kind) {
    case "supplies": st.resources.supplies = Math.max(0, (st.resources.supplies ?? 0) + delta); break;
    case "embers": st.resources.embers = Math.max(0, (st.resources.embers ?? 0) + delta); break;
    case "scrip": st.currency.scrip = Math.max(0, (st.currency.scrip ?? 0) + delta); break;
    case "warplate": st.resources.warplate = Math.max(0, (st.resources.warplate ?? 0) + delta); break;
    case "plasma": st.resources.plasma = Math.max(0, (st.resources.plasma ?? 0) + delta); break;
  }
}

/** Validate a stake list. THE artifact gate: "artifact" is not a DuelStakeKind,
 *  so a typed client can't send one — but a tampered client can send anything,
 *  so any unknown kind (including "artifact") rejects with the locked rule. */
export function validateDuelStakes(
  state: GameState,
  raw: unknown,
): DuelResult<DuelStake[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "A duel needs stakes — put something on the table." };
  }
  if (raw.length > 5) return { ok: false, error: "At most five stake lines per side." };
  const clean: DuelStake[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
    const kind = (s as { kind?: unknown })?.kind;
    if (kind === "artifact") {
      return {
        ok: false,
        error: "Artifacts are never at risk — not in duels, not on the market. Legend changes hands only in real war.",
      };
    }
    if (typeof kind !== "string" || !(DUEL_STAKE_KINDS as readonly string[]).includes(kind)) {
      return { ok: false, error: `Can't stake that (${String(kind)}).` };
    }
    if (seen.has(kind)) return { ok: false, error: "One line per resource — combine them." };
    seen.add(kind);
    const amount = Math.trunc((s as { amount?: unknown })?.amount as number) || 0;
    if (amount <= 0) return { ok: false, error: "Every stake line needs a positive amount." };
    const k = kind as DuelStakeKind;
    if (amount > stakeBalance(state, k)) {
      return { ok: false, error: `You don't have ${amount} ${duelStakeLabel(k)} to stake.` };
    }
    clean.push({ kind: k, amount });
  }
  return { ok: true, value: clean };
}

/** Deduct stakes into escrow (the challenge record holds them). */
function escrowStakes(state: GameState, stakes: DuelStake[]): void {
  for (const s of stakes) adjustStakeBalance(state, s.kind, -s.amount);
}

/** Return escrowed stakes to a stockpile. */
function returnStakes(state: GameState, stakes: DuelStake[]): void {
  for (const s of stakes) adjustStakeBalance(state, s.kind, s.amount);
}

/** Combine both sides' stakes into the pot (winner takes all). */
export function duelPot(challenge: DuelChallenge): DuelStake[] {
  const totals = new Map<DuelStakeKind, number>();
  for (const s of [...challenge.challengerStakes, ...challenge.challengedStakes]) {
    totals.set(s.kind, (totals.get(s.kind) ?? 0) + s.amount);
  }
  return [...totals.entries()].map(([kind, amount]) => ({ kind, amount }));
}

// ============================================================================
// §4 FORCE VALIDATION (format caps — the duel circle has rules)
// ============================================================================

function validateDuelForce(
  state: GameState,
  format: DuelFormat,
  force: DuelForceInput,
): DuelResult<{ troops: number; heroes: BattleHeroSnapshot[] }> {
  const troops = Math.max(0, Math.trunc(force.troops) || 0);
  const heroes = Array.isArray(force.heroes) ? force.heroes : [];
  const cap = DUEL_TROOP_CAPS[format];
  if (format === "hero") {
    if (troops > 0) return { ok: false, error: "Hero duels are heroes only — no troops in the circle." };
    if (heroes.length === 0) return { ok: false, error: "A hero duel needs at least one hero." };
  } else {
    if (troops === 0 && heroes.length === 0) {
      return { ok: false, error: "Bring troops, heroes, or both — an empty duel proves nothing." };
    }
    if (troops > cap) {
      return { ok: false, error: `This format caps at ${cap} supply-weight of troops.` };
    }
  }
  if (heroes.length > 5) return { ok: false, error: "At most five heroes enter the circle." };
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
      return { ok: false, error: "A hero in your party has no identity." };
    }
    if (seen.has(h.id)) return { ok: false, error: "A hero can only duel once." };
    seen.add(h.id);
    if (locks[h.id]) return { ok: false, error: `${h.name || "A hero"} is already committed elsewhere.` };
  }
  return { ok: true, value: { troops, heroes } };
}

/** Lock one side's force (troops committed, heroes locked until resolve). */
function lockDuelForce(
  state: GameState,
  colonyId: string,
  colonyName: string,
  side: BattleSide,
  validated: { troops: number; heroes: BattleHeroSnapshot[] },
  duelRef: string,
  until: number,
): CommittedForce {
  const committed = validated.troops > 0 ? commitRosterWeight(state, { kind: "home" }, validated.troops) : 0;
  if (state.warReserve) {
    for (const h of validated.heroes) {
      state.warReserve.lockedHeroes[h.id] = { battleId: duelRef, until };
    }
  }
  return {
    side,
    colonyId,
    colonyName,
    heroSquad: validated.heroes.map((h) => ({ ...h })),
    weapons: [],
    troops: committed,
    fobStage: 0,
  };
}

/** Release one side's duel locks (troops home, heroes unlocked). */
export function releaseDuelForceLocks(
  state: GameState,
  force: CommittedForce,
  duelRef: string,
): void {
  releaseArenaLocksFor(state, { kind: "home" }, force.troops);
  if (state.warReserve) {
    for (const h of force.heroSquad) {
      const lock = state.warReserve.lockedHeroes[h.id];
      if (lock && lock.battleId === duelRef) delete state.warReserve.lockedHeroes[h.id];
    }
  }
}

// ============================================================================
// §5 CHALLENGE LIFECYCLE
// ============================================================================

let duelSeq = 0;
function newDuelId(now: number): string {
  duelSeq += 1;
  return `duel-${now.toString(36)}-${duelSeq.toString(36)}`;
}

/** The challenger's proposal. Their stakes are ESCROWED NOW (deducted from
 *  their stockpile into the challenge) and their force locks. The caller
 *  queues the returned fx to the challenged colony — and the board shows it
 *  to the whole server (the world speaker). */
export function proposeDuel(
  state: GameState,
  challenger: { id: string; name: string },
  challenged: { id: string; name: string },
  format: DuelFormat,
  rawStakes: unknown,
  force: DuelForceInput,
  now: number,
): DuelResult<{ challenge: DuelChallenge; fx: AllianceFx }> {
  ensureDuels(state);
  if (!challenged.id || challenged.id === challenger.id) {
    return { ok: false, error: "You can't duel yourself — the mirror never blinks." };
  }
  if (!(Object.keys(DUEL_TROOP_CAPS) as string[]).includes(format)) {
    return { ok: false, error: "Unknown duel format." };
  }
  const sv = validateDuelStakes(state, rawStakes);
  if (!sv.ok) return sv;
  const fv = validateDuelForce(state, format, force);
  if (!fv.ok) return fv;
  escrowStakes(state, sv.value);
  const duelId = newDuelId(now);
  const committed = lockDuelForce(
    state, challenger.id, challenger.name, "attacker", fv.value, duelId,
    now + DUEL_CONFIG.challengeExpiryMs,
  );
  const challenge: DuelChallenge = {
    id: duelId,
    state: "proposed",
    format,
    challengerId: challenger.id,
    challengerName: challenger.name,
    challengedId: challenged.id,
    challengedName: challenged.name,
    challengerStakes: sv.value,
    challengedStakes: [],
    challengerForce: committed,
    challengedForce: null,
    battleId: null,
    winnerId: null,
    createdAt: now,
    expiresAt: now + DUEL_CONFIG.challengeExpiryMs,
    decidedAt: null,
  };
  duelChallengesOf(state).push(challenge);
  const fx: AllianceFx = {
    kind: "duel-challenge",
    colonyId: challenged.id,
    challenge: JSON.parse(JSON.stringify(challenge)) as DuelChallenge,
    key: `duel-challenge:${challenge.id}`,
  };
  return { ok: true, value: { challenge, fx } };
}

/** The challenged side accepts: their stakes escrow, their force locks, and
 *  the fx carries everything to the challenger's save, which builds the
 *  bloodless duel battle. Accepting is PUBLIC — the board shows it. */
export function acceptDuel(
  state: GameState,
  challengeId: string,
  guest: { id: string; name: string },
  rawStakes: unknown,
  force: DuelForceInput,
  now: number,
): DuelResult<{ fx: AllianceFx }> {
  ensureDuels(state);
  const c = duelChallengeById(state, challengeId);
  if (!c) return { ok: false, error: "That duel doesn't exist." };
  if (c.challengedId !== guest.id) return { ok: false, error: "That duel wasn't issued to you." };
  if (c.state !== "proposed") return { ok: false, error: "That duel is no longer open." };
  if (now > c.expiresAt) {
    c.state = "expired";
    c.decidedAt = now;
    return { ok: false, error: "That duel expired — the stakes were returned." };
  }
  const sv = validateDuelStakes(state, rawStakes);
  if (!sv.ok) return sv;
  const fv = validateDuelForce(state, c.format, force);
  if (!fv.ok) return fv;
  escrowStakes(state, sv.value);
  const committed = lockDuelForce(
    state, guest.id, guest.name, "defender", fv.value, c.id,
    now + DUEL_CONFIG.challengeExpiryMs,
  );
  c.state = "accepted";
  c.challengedStakes = sv.value;
  c.challengedForce = committed;
  c.decidedAt = now;
  const fx: AllianceFx = {
    kind: "duel-accept",
    colonyId: c.challengerId,
    challengeId: c.id,
    challengedStakes: JSON.parse(JSON.stringify(sv.value)) as DuelStake[],
    challengedForce: JSON.parse(JSON.stringify(committed)) as CommittedForce,
    key: `duel-accept:${c.id}`,
  };
  return { ok: true, value: { fx } };
}

/** Decline: the challenged's save marks it PUBLICLY (the board shows the
 *  refusal — the whole server watched). The challenger's escrow returns via
 *  fx; their force stands down. No mechanical penalty — the mockery is the
 *  penalty. */
export function declineDuel(
  state: GameState,
  challengeId: string,
  guestId: string,
  now: number,
): DuelResult<{ fx: AllianceFx }> {
  ensureDuels(state);
  const c = duelChallengeById(state, challengeId);
  if (!c) return { ok: false, error: "That duel doesn't exist." };
  if (c.challengedId !== guestId) return { ok: false, error: "That duel wasn't issued to you." };
  if (c.state !== "proposed") return { ok: false, error: "That duel is no longer open." };
  c.state = "declined";
  c.decidedAt = now;
  return {
    ok: true,
    value: {
      fx: {
        kind: "duel-decline",
        colonyId: c.challengerId,
        challengeId: c.id,
        key: `duel-decline:${c.id}`,
      },
    },
  };
}

/** Cancel (challenger, while proposed): escrow returns, force stands down. */
export function cancelDuel(
  state: GameState,
  challengeId: string,
  challengerId: string,
  now: number,
): DuelResult<{ fx: AllianceFx }> {
  ensureDuels(state);
  const c = duelChallengeById(state, challengeId);
  if (!c) return { ok: false, error: "That duel doesn't exist." };
  if (c.challengerId !== challengerId) return { ok: false, error: "Only the challenger cancels." };
  if (c.state !== "proposed") return { ok: false, error: "That duel is already underway." };
  c.state = "cancelled";
  c.decidedAt = now;
  returnStakes(state, c.challengerStakes);
  releaseDuelForceLocks(state, c.challengerForce, c.id);
  return {
    ok: true,
    value: {
      fx: {
        kind: "duel-cancel",
        colonyId: c.challengedId,
        challengeId: c.id,
        key: `duel-cancel:${c.id}`,
      },
    },
  };
}

/** Sweep stale proposals: every escrow returns to its owner, every lock
 *  releases. Runs in advance(). */
export function expireDuels(state: GameState, now: number): number {
  ensureDuels(state);
  let swept = 0;
  for (const c of duelChallengesOf(state)) {
    if ((c.state === "proposed" || c.state === "accepted") && now > c.expiresAt) {
      const isChallenger = (state.gameId ?? "") === c.challengerId;
      const isChallenged = (state.gameId ?? "") === c.challengedId;
      if (isChallenger) {
        returnStakes(state, c.challengerStakes);
        if (c.state === "proposed") releaseDuelForceLocks(state, c.challengerForce, c.id);
      }
      if (isChallenged && c.state === "accepted") {
        returnStakes(state, c.challengedStakes);
        if (c.challengedForce) releaseDuelForceLocks(state, c.challengedForce, c.id);
      }
      c.state = "expired";
      c.decidedAt = now;
      swept += 1;
    }
  }
  return swept;
}

// ============================================================================
// §6 BATTLE CONSTRUCTION (challenger's save, on duel-accept)
// ============================================================================

/** Build the duel battle from an accepted challenge. ALWAYS bloodless — the
 *  wager is the escrowed materials, never bodies. Runs on the real engine. */
export function startDuelBattle(
  state: GameState,
  challengeId: string,
  challengedStakes: DuelStake[],
  challengedForce: CommittedForce,
  season: string,
  now: number,
): DuelResult<{ battle: Battle }> {
  ensureDuels(state);
  const c = duelChallengeById(state, challengeId);
  if (!c) return { ok: false, error: "That duel doesn't exist." };
  if (c.state !== "proposed" && c.state !== "accepted") {
    return { ok: false, error: "That duel can't start a bout." };
  }
  if (now > c.expiresAt) {
    c.state = "expired";
    c.decidedAt = now;
    returnStakes(state, c.challengerStakes);
    releaseDuelForceLocks(state, c.challengerForce, c.id);
    return { ok: false, error: "That duel expired — the stakes were returned." };
  }
  // Idempotent: a redelivered accept never builds a second bout.
  if (c.battleId) {
    const existing = (state.battles ?? []).find((b) => b.id === c.battleId);
    if (existing) return { ok: true, value: { battle: existing } };
  }
  const defender: CommittedForce = {
    ...challengedForce,
    side: "defender",
    colonyId: c.challengedId,
    colonyName: c.challengedName,
  };
  const battle = createBattle(
    {
      zoneId: DUEL_CONFIG.zoneId,
      zoneName: DUEL_CONFIG.zoneName,
      attacker: { ...c.challengerForce, side: "attacker" },
      defender,
      // No mutual stakes — duels are bloodless by lock. The arena field
      // marks it as a duel bout (challengeId doubles as the duel ref).
      arena: { challengeId: c.id, season, stakes: false },
    },
    now,
  );
  // Roster segments: host local, guest foreign (same seam as arena bouts).
  stampRosterSegment(battle, "attacker", {
    id: `duel-${c.id}-attacker-initial`,
    kind: "initial",
    home: { kind: "home" } as RosterHome,
    weight: c.challengerForce.troops,
    tollsPaid: 0,
    colonyId: c.challengerId,
    committedAt: now,
  });
  if (defender.troops > 0) {
    stampRosterSegment(battle, "defender", {
      id: `duel-${c.id}-defender-initial`,
      kind: "initial",
      home: { kind: "home" } as RosterHome,
      weight: defender.troops,
      tollsPaid: 0,
      colonyId: c.challengedId,
      committedAt: now,
    });
  }
  if (!Array.isArray(state.battles)) state.battles = [];
  state.battles.push(battle);
  c.state = "active";
  c.challengedStakes = challengedStakes;
  c.challengedForce = defender;
  c.battleId = battle.id;
  c.decidedAt = now;
  return { ok: true, value: { battle } };
}

// ============================================================================
// §7 RESOLUTION → PAYOUT (host in advance(), after the battle resolves)
// ============================================================================

/** For every resolved duel battle not yet recorded: the winner takes the
 *  whole pot (both sides' escrowed stakes). A draw returns every escrow to
 *  its owner. Queues `duel-result` fx so the guest records the same bout. */
export function resolveDuelBattles(
  state: GameState,
  now: number,
  queueFx: (fx: AllianceFx) => void,
): number {
  ensureDuels(state);
  let recorded = 0;
  for (const b of state.battles ?? []) {
    if (!b.arena || b.zoneId !== DUEL_CONFIG.zoneId) continue;
    if (b.status !== "resolved" || !b.result) continue;
    const c = duelChallengeById(state, b.arena.challengeId);
    if (!c || c.state === "resolved") continue;
    if (duelBoutsOf(state).some((x) => x.duelId === b.id)) continue;
    const winnerId =
      b.result.outcome === "attacker_victory"
        ? b.attacker.colonyId
        : b.result.outcome === "defender_victory"
          ? b.defender.colonyId
          : null;
    const pot = duelPot(c);
    // Escrow settlement (value is conserved — stakes move, never mint):
    //  • Challenger wins: the whole pot comes home to the host.
    //  • Guest wins: the host's own stakes return to the host; the whole pot
    //    travels to the guest via fx (their own escrow was deducted on accept).
    //  • Draw: every escrow returns to its owner.
    let stakesToGuest: DuelStake[];
    if (winnerId === c.challengerId) {
      for (const s of pot) adjustStakeBalance(state, s.kind, s.amount);
      stakesToGuest = [];
    } else if (winnerId === c.challengedId) {
      returnStakes(state, c.challengerStakes);
      stakesToGuest = pot;
    } else {
      returnStakes(state, c.challengerStakes);
      stakesToGuest = [...c.challengedStakes];
    }
    const bout: DuelBout = {
      duelId: b.id,
      challengeId: c.id,
      season: b.arena.season,
      format: c.format,
      at: now,
      aId: b.attacker.colonyId,
      aName: b.attacker.colonyName,
      bId: b.defender.colonyId,
      bName: b.defender.colonyName,
      winnerId,
      pot: winnerId ? pot : [],
    };
    duelBoutsOf(state).push(bout);
    // Host heroes come home (bloodless — nobody's heroes are ever at risk).
    if (state.warReserve) {
      for (const h of b.attacker.heroSquad) {
        const lock = state.warReserve.lockedHeroes[h.id];
        if (lock && lock.battleId === c.id) delete state.warReserve.lockedHeroes[h.id];
      }
    }
    c.state = "resolved";
    c.winnerId = winnerId;
    c.decidedAt = now;
    queueFx({
      kind: "duel-result",
      colonyId: c.challengedId,
      bout: JSON.parse(JSON.stringify(bout)) as DuelBout,
      stakesToGuest,
      heroIds: b.defender.heroSquad.map((h) => h.id),
      challengeId: c.id,
      key: `duel-result:${b.id}`,
    });
    recorded += 1;
  }
  return recorded;
}

/** Guest-side applier: record the bout, unlock heroes, settle the escrow. */
export function applyDuelResult(
  state: GameState,
  bout: DuelBout,
  stakesToGuest: DuelStake[],
  heroIds: string[],
  challengeId: string,
  key: string,
  now: number,
): void {
  ensureDuels(state);
  const done = (state as unknown as { duelFxDone?: Record<string, number> }).duelFxDone ?? {};
  if (done[key]) return;
  done[key] = now;
  (state as unknown as { duelFxDone?: Record<string, number> }).duelFxDone = done;
  if (!duelBoutsOf(state).some((x) => x.duelId === bout.duelId)) {
    duelBoutsOf(state).push({ ...bout });
  }
  for (const s of stakesToGuest) adjustStakeBalance(state, s.kind, s.amount);
  if (state.warReserve) {
    for (const id of heroIds) {
      const lock = state.warReserve.lockedHeroes[id];
      if (lock && lock.battleId === challengeId) delete state.warReserve.lockedHeroes[id];
    }
  }
  const c = duelChallengeById(state, challengeId);
  if (c && c.state !== "resolved") {
    c.state = "resolved";
    c.winnerId = bout.winnerId;
    c.decidedAt = now;
  }
}

// ============================================================================
// §8 CROSS-SAVE APPLIERS (called from alliance-transact.ts applyOneFx)
// ============================================================================

/** Challenged-side: record an incoming proposal (idempotent on duel id). */
export function applyDuelChallengeFx(target: GameState, challenge: DuelChallenge): void {
  ensureDuels(target);
  if (!duelChallengeById(target, challenge.id)) {
    duelChallengesOf(target).push(JSON.parse(JSON.stringify(challenge)) as DuelChallenge);
  }
}

/** Challenger-side: a redelivered/accepted duel builds the bout. */
export function applyDuelAcceptFx(
  target: GameState,
  challengeId: string,
  challengedStakes: DuelStake[],
  challengedForce: CommittedForce,
  key: string,
  now: number,
): DuelResult {
  ensureDuels(target);
  const done = (target as unknown as { duelFxDone?: Record<string, number> }).duelFxDone ?? {};
  if (done[key]) return { ok: true, value: undefined };
  const season = (target as unknown as { battlePass?: { seasonId?: string } }).battlePass?.seasonId ?? "s1";
  const res = startDuelBattle(target, challengeId, challengedStakes, challengedForce, season, now);
  if (!res.ok) {
    const c = duelChallengeById(target, challengeId);
    if (c && c.state === "expired") {
      const q = (target as unknown as { allianceFx?: AllianceFx[] }).allianceFx ?? [];
      q.push({
        kind: "duel-cancel",
        colonyId: c.challengedId,
        challengeId: c.id,
        key: `duel-cancel:${c.id}:late`,
      });
      (target as unknown as { allianceFx?: AllianceFx[] }).allianceFx = q;
    }
    return res;
  }
  done[key] = now;
  (target as unknown as { duelFxDone?: Record<string, number> }).duelFxDone = done;
  return { ok: true, value: undefined };
}

/** Challenger-side: the challenged declined — PUBLIC refusal. The escrow
 *  returns, the force stands down, and the board remembers. */
export function applyDuelDeclineFx(target: GameState, challengeId: string, now: number): void {
  ensureDuels(target);
  const c = duelChallengeById(target, challengeId);
  if (!c || c.state !== "proposed") return;
  c.state = "declined";
  c.decidedAt = now;
  returnStakes(target, c.challengerStakes);
  releaseDuelForceLocks(target, c.challengerForce, c.id);
}

/** Challenged-side: the challenger cancelled — drop the proposal. */
export function applyDuelCancelFx(target: GameState, challengeId: string, now: number): void {
  ensureDuels(target);
  const c = duelChallengeById(target, challengeId);
  if (!c) return;
  if (c.state === "proposed" || c.state === "accepted") {
    if (c.state === "accepted" && c.challengedForce) {
      returnStakes(target, c.challengedStakes);
      releaseDuelForceLocks(target, c.challengedForce, c.id);
    }
    c.state = "cancelled";
    c.decidedAt = now;
  }
}

// ============================================================================
// §9 WORLD SPEAKER — the public board (aggregated server-side)
// ============================================================================

/** Fold a save's duel records into public board entries. The server calls
 *  this for every save and dedupes by challenge id — the whole server watches
 *  every open challenge, every refusal, every payout. */
export function duelBoardEntriesOf(state: GameState): DuelBoardEntry[] {
  ensureDuels(state);
  const out: DuelBoardEntry[] = [];
  for (const c of duelChallengesOf(state)) {
    // Only the two parties' saves hold a challenge — dedupe server-side.
    out.push({
      id: c.id,
      state: c.state,
      format: c.format,
      challengerId: c.challengerId,
      challengerName: c.challengerName,
      challengedId: c.challengedId,
      challengedName: c.challengedName,
      pot: duelPot(c),
      createdAt: c.createdAt,
      decidedAt: c.decidedAt,
      winnerId: c.winnerId,
    });
  }
  return out;
}

/** Dedupe + sort board entries (newest first). Refusals and resolutions stay
 *  visible — the server never forgets who blinked. */
export function buildDuelBoard(all: DuelBoardEntry[]): DuelBoardEntry[] {
  const seen = new Map<string, DuelBoardEntry>();
  for (const e of all) {
    if (!e || !e.id) continue;
    const prev = seen.get(e.id);
    if (!prev || (e.decidedAt ?? 0) > (prev.decidedAt ?? 0)) seen.set(e.id, e);
  }
  return [...seen.values()].sort((a, b) => b.createdAt - a.createdAt);
}
