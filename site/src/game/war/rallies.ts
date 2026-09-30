// RALLIES — the coordinated fist (design/alliances.md §2).
//
// A rally turns many garrisons into one army: members pledge troops/heroes
// (locked out of their garrisons ON PLEDGE — the cost of showing up is
// immediate), the caller sets a battle plan (entry vectors + timing), and at
// launch the pool marches as ONE combined force in the real battle engine.
//
// Casualty attribution: one "rally" RosterCommitSegment per pledger
// (colonyId stamped), so resolveRosterCasualties bills each colony's real
// roster its share of the one casualty fraction. Maneuver entries carry
// their weight on the entry state (no maneuver segments — no double bill).
// Loot splits strictly by contribution (committed supply-weight); no
// caller's cut, no favoritism — locked (alliances.md §11 Q4).

import type { GameState } from "../types";
import {
  type Battle,
  type BattleHeroSnapshot,
  type CommittedForce,
} from "./war-types";
import { type BattlePlan, validateBattlePlan } from "./maneuvers";
import { attachBattlePlan, createBattle, openBattle } from "./battle-engine";
import { commitRosterWeight, rosterForCommit, stampRosterSegment } from "./roster-commit";
import { availableWeight, releaseWeight } from "./troops";
import {
  allianceOf,
  memberRole,
  unlockRallyHeroes,
  type AllianceResult,
} from "./alliances";

export const RALLY_CONFIG = {
  /** Coordination window: 15 min – 24h. */
  minLeadMs: 15 * 60_000,
  maxLeadMs: 24 * 3600_000,
  /** Chorus site garrison scales to this fraction of the pledged force. */
  chorusScale: 0.8,
  /** Victor's cargo, scaled from the pledged weight (supplies). */
  lootPerWeight: 0.5,
} as const;

export type RallyState = "open" | "launched" | "resolved" | "cancelled";

export interface RallyTarget {
  kind: "chorus-site" | "forward-base" | "defense-point";
  label: string;
  zoneId: string;
}

export interface RallyPledge {
  colonyId: string;
  colonyName: string;
  troops: number;
  heroes: BattleHeroSnapshot[];
  pledgedAt: number;
}

export interface RallyOutcome {
  victory: boolean;
  lootSupplies: number;
  /** Supplies per colony, by contribution share. */
  shares: Record<string, number>;
  /** Troop weight lost per colony. */
  losses: Record<string, number>;
}

export interface Rally {
  id: string;
  allianceId: string;
  allianceName: string;
  name: string;
  target: RallyTarget;
  callerId: string;
  callerName: string;
  launchAt: number;
  state: RallyState;
  pledges: RallyPledge[];
  plan?: BattlePlan;
  battleId?: string;
  createdAt: number;
  launchedAt?: number;
  resolvedAt?: number;
  outcome?: RallyOutcome;
}

export function ensureRallies(state: GameState): void {
  const s = state as unknown as Record<string, unknown>;
  if (!s.rallies || typeof s.rallies !== "object") s.rallies = {};
}

function rallyStore(state: GameState): Record<string, Rally> {
  ensureRallies(state);
  return (state as unknown as { rallies: Record<string, Rally> }).rallies;
}

export function rallyOf(state: GameState, rallyId: string): Rally | null {
  return rallyStore(state)[rallyId] ?? null;
}

export function openRallies(state: GameState, allianceId: string): Rally[] {
  return Object.values(rallyStore(state)).filter(
    (r) => r.allianceId === allianceId && r.state === "open",
  );
}

let rallySeq = 0;
function newRallyId(now: number): string {
  rallySeq += 1;
  return `rally-${now.toString(36)}-${rallySeq.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Calling + pledging
// ---------------------------------------------------------------------------

export function createRally(
  state: GameState,
  caller: { id: string; name: string },
  allianceId: string,
  input: { name: string; target: RallyTarget; launchAt: number },
  now: number,
): AllianceResult<Rally> {
  const a = allianceOf(state, caller.id);
  if (!a || a.id !== allianceId) return { ok: false, error: "Rallies are called for your own alliance." };
  const role = memberRole(a, caller.id);
  if (role !== "leader" && role !== "officer") {
    return { ok: false, error: "Only officers can call a rally." };
  }
  const name = (input.name ?? "").trim().slice(0, 60);
  if (name.length < 3) return { ok: false, error: "Name the rally — at least 3 characters." };
  const lead = input.launchAt - now;
  if (!(lead >= RALLY_CONFIG.minLeadMs)) {
    return { ok: false, error: "Rallies need at least 15 minutes to muster." };
  }
  if (lead > RALLY_CONFIG.maxLeadMs) {
    return { ok: false, error: "Rallies muster within 24 hours — longer than that and the moment's gone." };
  }
  if (!input.target?.zoneId || !(input.target.label ?? "").trim()) {
    return { ok: false, error: "Name a real target." };
  }
  const r: Rally = {
    id: newRallyId(now),
    allianceId: a.id,
    allianceName: a.name,
    name,
    target: { kind: input.target.kind, label: input.target.label.trim(), zoneId: input.target.zoneId },
    callerId: caller.id,
    callerName: caller.name,
    launchAt: Math.trunc(input.launchAt),
    state: "open",
    pledges: [],
    createdAt: now,
  };
  rallyStore(state)[r.id] = r;
  return { ok: true, value: r };
}

/** Pledge troops and/or heroes. The troops leave the garrison INTO the rally
 *  pool at pledge time — locked, gone from home defense until the rally
 *  resolves. Heroes lock the same way. One pledge per colony (unpledge to
 *  revise). */
export function pledgeToRally(
  state: GameState,
  rallyId: string,
  pledger: { id: string; name: string },
  troops: number,
  heroes: BattleHeroSnapshot[],
  now: number,
): AllianceResult<RallyPledge> {
  const r = rallyOf(state, rallyId);
  if (!r) return { ok: false, error: "That rally doesn't exist." };
  if (r.state !== "open") return { ok: false, error: "That rally is already underway." };
  const a = allianceOf(state, pledger.id);
  if (!a || a.id !== r.allianceId) return { ok: false, error: "Only alliance-mates march in this rally." };
  if (r.pledges.some((p) => p.colonyId === pledger.id)) {
    return { ok: false, error: "You've already pledged — unpledge first to revise." };
  }
  const w = Math.max(0, Math.trunc(troops) || 0);
  const heroList = heroes ?? [];
  if (w <= 0 && heroList.length === 0) return { ok: false, error: "Pledge troops, heroes, or both." };
  const roster = rosterForCommit(state, { kind: "home" });
  if (!roster) return { ok: false, error: "No garrison to pledge from." };
  if (w > availableWeight(roster)) return { ok: false, error: "Your garrison can't spare that many." };
  const locks = (state.warReserve?.lockedHeroes ?? {}) as Record<string, { battleId: string }>;
  for (const h of heroList) {
    if (locks[h.id]) return { ok: false, error: `${h.name ?? "A hero"} is already committed elsewhere.` };
  }
  const committed = commitRosterWeight(state, { kind: "home" }, w);
  if (committed <= 0 && w > 0) return { ok: false, error: "Your garrison can't spare that many." };
  if (state.warReserve) {
    for (const h of heroList) {
      state.warReserve.lockedHeroes[h.id] = { battleId: r.id, until: r.launchAt };
    }
  }
  const pledge: RallyPledge = {
    colonyId: pledger.id,
    colonyName: pledger.name,
    troops: committed,
    heroes: heroList,
    pledgedAt: now,
  };
  r.pledges.push(pledge);
  return { ok: true, value: pledge };
}

/** Withdraw a pledge while the rally is still open — the lock releases. */
export function unpledgeFromRally(state: GameState, rallyId: string, colonyId: string): AllianceResult {
  const r = rallyOf(state, rallyId);
  if (!r) return { ok: false, error: "That rally doesn't exist." };
  if (r.state !== "open") return { ok: false, error: "The rally has launched — no mid-march desertion." };
  const p = r.pledges.find((x) => x.colonyId === colonyId);
  if (!p) return { ok: false, error: "You haven't pledged to this rally." };
  const roster = rosterForCommit(state, { kind: "home" });
  if (roster && p.troops > 0) releaseWeight(roster, p.troops);
  unlockRallyHeroes(state, r.id, p.heroes);
  r.pledges = r.pledges.filter((x) => x.colonyId !== colonyId);
  return { ok: true, value: undefined };
}

/** Set (or replace) the battle plan before launch. Structural validation
 *  here; weight-vs-pledges and duration legality re-check at launch. */
export function setRallyPlan(
  state: GameState,
  rallyId: string,
  actorId: string,
  plan: BattlePlan,
): AllianceResult {
  const r = rallyOf(state, rallyId);
  if (!r) return { ok: false, error: "That rally doesn't exist." };
  if (r.state !== "open") return { ok: false, error: "The rally has launched — the plan is marching." };
  const a = allianceOf(state, actorId);
  if (!a || a.id !== r.allianceId) return { ok: false, error: "Not your rally to plan." };
  const role = memberRole(a, actorId);
  if (actorId !== r.callerId && role !== "leader" && role !== "officer") {
    return { ok: false, error: "Only the caller or officers set the battle plan." };
  }
  // Structural validation (duration-agnostic at plan time).
  const vErrs = validateBattlePlan(plan, Number.POSITIVE_INFINITY);
  if (vErrs.length > 0) return { ok: false, error: vErrs[0] };
  r.plan = plan;
  return { ok: true, value: undefined };
}

export function cancelRally(state: GameState, rallyId: string, actorId: string): AllianceResult {
  const r = rallyOf(state, rallyId);
  if (!r) return { ok: false, error: "That rally doesn't exist." };
  if (r.state !== "open") return { ok: false, error: "That rally is already underway." };
  const a = allianceOf(state, actorId);
  const role = a && a.id === r.allianceId ? memberRole(a, actorId) : null;
  if (actorId !== r.callerId && role !== "leader" && role !== "officer") {
    return { ok: false, error: "Only the caller or officers can cancel." };
  }
  releaseRallyPledges(state, r);
  r.state = "cancelled";
  return { ok: true, value: undefined };
}

function releaseRallyPledges(state: GameState, r: Rally): void {
  const roster = rosterForCommit(state, { kind: "home" });
  for (const p of r.pledges) {
    if (roster && p.troops > 0) releaseWeight(roster, p.troops);
    unlockRallyHeroes(state, r.id, p.heroes);
  }
  r.pledges = [];
}

// ---------------------------------------------------------------------------
// Launch — the pool marches as one force
// ---------------------------------------------------------------------------

/** Combined force: one side in the battle engine. */
export function rallyForce(r: Rally): { troops: number; heroes: BattleHeroSnapshot[] } {
  return {
    troops: r.pledges.reduce((s, p) => s + p.troops, 0),
    heroes: r.pledges.flatMap((p) => p.heroes),
  };
}

/** Contribution ledger: committed supply-weight per colony + share. The loot
 *  split and the plaque both read this. */
export function rallyContributions(r: Rally): Record<string, { colonyName: string; weight: number; share: number }> {
  const total = r.pledges.reduce((s, p) => s + p.troops, 0);
  const out: Record<string, { colonyName: string; weight: number; share: number }> = {};
  for (const p of r.pledges) {
    out[p.colonyId] = {
      colonyName: p.colonyName,
      weight: p.troops,
      share: total > 0 ? p.troops / total : 0,
    };
  }
  return out;
}

/** Strict contribution split: supplies by share, rounded; the remainder goes
 *  to the caller (never lost to rounding). No favoritism, no caller's cut. */
export function splitRallyLoot(r: Rally, totalSupplies: number): Record<string, number> {
  const contrib = rallyContributions(r);
  const ids = Object.keys(contrib);
  const shares: Record<string, number> = {};
  let assigned = 0;
  for (const id of ids) {
    const s = Math.floor(totalSupplies * contrib[id].share);
    shares[id] = s;
    assigned += s;
  }
  const remainder = Math.max(0, Math.round(totalSupplies) - assigned);
  if (remainder > 0 && shares[r.callerId] !== undefined) shares[r.callerId] += remainder;
  else if (remainder > 0 && ids[0]) shares[ids[0]] += remainder;
  return shares;
}

/** Build the rally's battle: the pledged pool as one attacker side, a
 *  Chorus-site garrison scaled to the pool as defender, one "rally" roster
 *  segment per pledger (casualty attribution), and the battle plan attached
 *  as timed entries (weights ride the entries — the pledges are already
 *  committed, so nothing commits twice). */
export function launchRallyBattle(
  state: GameState,
  r: Rally,
  now: number,
): { ok: true; battle: Battle } | { ok: false; error: string } {
  const force = rallyForce(r);
  const attacker: CommittedForce = {
    side: "attacker",
    colonyId: `rally:${r.id}`,
    colonyName: `${r.allianceName} — ${r.name}`,
    heroSquad: force.heroes,
    weapons: [],
    troops: force.troops,
    fobStage: 0,
  };
  const defender: CommittedForce = {
    side: "defender",
    colonyId: "chorus-site",
    colonyName: `Chorus — ${r.target.label}`,
    heroSquad: [],
    weapons: [],
    troops: Math.max(50, Math.round(force.troops * RALLY_CONFIG.chorusScale)),
    fobStage: 0,
  };
  const battle = createBattle(
    { zoneId: r.target.zoneId, zoneName: r.target.label, attacker, defender },
    now,
  );
  // One rally segment per pledger: casualties bill the right bodies.
  for (const p of r.pledges) {
    if (p.troops <= 0) continue;
    stampRosterSegment(battle, "attacker", {
      id: `rally-${r.id}-${p.colonyId}`,
      kind: "rally",
      home: { kind: "home" },
      weight: p.troops,
      tollsPaid: 0,
      colonyId: p.colonyId,
      committedAt: now,
    });
  }
  // The battle plan: the pledged pool ENTERS per the plan — it is a partition
  // of the pledged force, not extra troops. Attached through the canonical
  // maneuver seam in precommitted mode: the pledges already left the garrison
  // when they were made, so the entries march in on schedule as sim moves —
  // nothing commits twice.
  if (r.plan) {
    const res = attachBattlePlan(state, battle, "attacker", r.plan, { kind: "home" }, now, undefined, {
      precommitted: true,
      pledgedWeight: force.troops,
      composition: compositionOf(force.heroes, force.troops),
    });
    // Illegal plans reject before launch, never mid-battle (alliances.md §9).
    if (!res.ok) return { ok: false, error: res.error };
  }
  battle.allianceId = r.allianceId;
  openBattle(state, battle);
  return { ok: true, battle };
}

/** Troop-type composition for the public intel (scouts report the muster,
 *  not the plan). Heroes don't change the type mix — the weight does. */
function compositionOf(
  _heroes: BattleHeroSnapshot[],
  totalWeight: number,
): Record<string, number> {
  void _heroes;
  return { mixed: totalWeight };
}

export function launchRally(
  state: GameState,
  rallyId: string,
  actorId: string,
  now: number,
): AllianceResult<Battle> {
  const r = rallyOf(state, rallyId);
  if (!r) return { ok: false, error: "That rally doesn't exist." };
  if (r.state !== "open") return { ok: false, error: "That rally is already underway." };
  const a = allianceOf(state, actorId);
  const role = a && a.id === r.allianceId ? memberRole(a, actorId) : null;
  const isCaller = actorId === r.callerId;
  if (!isCaller && role !== "leader" && role !== "officer") {
    return { ok: false, error: "Only the caller or officers launch." };
  }
  const force = rallyForce(r);
  if (force.troops <= 0 && force.heroes.length === 0) {
    return { ok: false, error: "An empty rally marches nowhere — wait for pledges." };
  }
  const built = launchRallyBattle(state, r, now);
  if (!built.ok) return { ok: false, error: built.error };
  const battle = built.battle;
  r.state = "launched";
  r.launchedAt = now;
  r.battleId = battle.id;
  return { ok: true, value: battle };
}

/** Resolve a launched rally whose battle finished. Casualties are already
 *  real (resolveRosterCasualties billed the segments); here we lock the
 *  contribution outcome: victory, loot split, per-colony losses. Survivors'
 *  locks released with the segments. */
export function resolveRally(state: GameState, r: Rally, now: number): boolean {
  if (r.state !== "launched" || !r.battleId) return false;
  const battle = (state.battles ?? []).find((b) => b.id === r.battleId);
  if (!battle || battle.status !== "resolved") return false;
  const victory = battle.result?.outcome === "attacker_victory";
  const force = rallyForce(r);
  const lootSupplies = victory ? Math.round(force.troops * RALLY_CONFIG.lootPerWeight) : 0;
  const shares = splitRallyLoot(r, lootSupplies);
  // Per-colony losses: each segment took the side's casualty fraction — the
  // same math resolveRosterCasualties uses (toBill / simulated).
  const losses: Record<string, number> = {};
  const segs = battle.internal.rosterCommits?.attacker ?? [];
  const simulated = Math.max(1, Math.trunc(battle.attacker.troops) || 1);
  const tollsPaid = segs.reduce((s, x) => s + (x.tollsPaid || 0), 0);
  const toBill = Math.max(0, battle.casualties.attacker - tollsPaid);
  const frac = Math.min(1, Math.max(0, toBill / simulated));
  for (const s of segs) {
    if (s.kind !== "rally" || !s.colonyId) continue;
    const billed = Math.max(0, s.weight - s.tollsPaid);
    losses[s.colonyId] = Math.round(billed * frac);
  }
  r.outcome = { victory, lootSupplies, shares, losses };
  r.state = "resolved";
  r.resolvedAt = now;
  // The victor's cargo lands in the participating colonies' stockpiles — the
  // server routes each share; locally the player's own share applies.
  const myShare = shares[state.gameId ?? ""];
  if (myShare && myShare > 0) {
    const res = (state as unknown as { resources: { supplies: number } }).resources;
    if (res) res.supplies += myShare;
  }
  return true;
}

/** Engine tick: fire timers whose moment came, and close finished fights. */
export function advanceRallies(state: GameState, now: number): void {
  ensureRallies(state);
  const store = rallyStore(state);
  for (const id of Object.keys(store)) {
    const r = store[id];
    if (r.state === "open" && r.launchAt <= now) {
      // The timer fired — the pool marches even if the caller's away.
      const force = rallyForce(r);
      if (force.troops > 0 || force.heroes.length > 0) {
        const built = launchRallyBattle(state, r, now);
        if (built.ok) {
          r.state = "launched";
          r.launchedAt = now;
          r.battleId = built.battle.id;
        }
        // An illegal plan at auto-launch: the rally holds for the caller
        // rather than marching broken or plan-less.
      } else {
        r.state = "cancelled";
      }
    } else if (r.state === "launched") {
      resolveRally(state, r, now);
    }
  }
}

/** Prune ancient rally history (resolved/cancelled older than 30 days). The
 *  plaques keep the memory; the board doesn't need the clutter. */
export function pruneRallies(state: GameState, now: number): void {
  const store = rallyStore(state);
  const cutoff = now - 30 * 24 * 3600_000;
  for (const id of Object.keys(store)) {
    const r = store[id];
    if ((r.state === "resolved" || r.state === "cancelled") && (r.resolvedAt ?? r.createdAt) < cutoff) {
      delete store[id];
    }
  }
}
