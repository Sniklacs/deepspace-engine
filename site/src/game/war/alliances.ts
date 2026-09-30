// ALLIANCES — the war band (design/alliances.md).
//
// Server-shaped records kept on the colony save (keyed by id, members by
// colonyId) so a future multiplayer server migration is mechanical. The
// player's own colony acts through these functions; other colonies appear
// as id/name references, exactly like the battle engine's aid flow.
//
// v1 scope: founding, membership (invite/apply/leave/kick/promote), the
// 50-colony cap, help ticks (daily budget, Cradle-tier tick size), and
// standing reinforcements (sender-side locks + recall). Rallies live in
// rallies.ts. Membership persists across seasons by design — no reset path
// touches the alliance store (alliances.md §9).

import type { GameState } from "../types";
import { commitRosterWeight, rosterForCommit } from "./roster-commit";
import { availableWeight, releaseWeight } from "./troops";

export const ALLIANCE_CONFIG = {
  /** Owner-confirmed: big enough for a war band, small enough to know names. */
  sizeCap: 50,
  /** Officers: up to 5 under the leader. */
  officerCap: 5,
  /** Founding cost — enough to mean it, cheap enough to not gate it. */
  foundSuppliesCost: 500,
  /** Any colony at Cradle Tier 2+ may found. */
  foundCradleTier: 2,
  /** Help ticks: this many per colony per server day. */
  helpPerDay: 5,
  /** Tick size by HELPER's Cradle tier (minutes shaved off a build/research
   *  timer). Index 1-5; tunable. */
  helpTickMinutesByTier: [0, 5, 12, 25, 40, 60],
  /** "Who helped you this week" list retention. */
  helpWeekMs: 7 * 24 * 3600_000,
} as const;

export type AllianceRole = "leader" | "officer" | "member";

export interface AllianceMember {
  colonyId: string;
  colonyName: string;
  role: AllianceRole;
  joinedAt: number;
}

export interface AllianceApplication {
  colonyId: string;
  colonyName: string;
  appliedAt: number;
}

export interface AllianceInvite {
  colonyId: string;
  colonyName: string;
  invitedAt: number;
  byColonyId: string;
}

export interface Alliance {
  id: string;
  name: string;
  banner: string;
  motto: string;
  members: AllianceMember[];
  applications: AllianceApplication[];
  invites: AllianceInvite[];
  foundedAt: number;
  founderId: string;
  /** Which server's war band this is (one race per server). */
  homeServerId: string;
}

/** A standing reinforcement: the sender's bodies stationed with an ally.
 *  The troops are LOCKED out of the sender's garrison (commitRosterWeight at
 *  send); they fight under the host's command and die for real. Upkeep debits
 *  the HOST's stockpile — the sender's only cost is the missing bodies. */
export interface Reinforcement {
  id: string;
  fromColonyId: string;
  fromColonyName: string;
  toColonyId: string;
  toColonyName: string;
  /** Foreign-server station: rides the sender's next jump (forward-base.md). */
  toFobServerId?: string;
  /** Supply-weight locked out of the sender's garrison. */
  troops: number;
  heroes: string[];
  sentAt: number;
  state: "stationed" | "recalled" | "dismissed";
}

/** One help tick given: the ledger entry. The timer-shave itself is applied
 *  by applyHelpTick on the TARGET's state (the server routes it); the giver's
 *  budget and this ledger live here. */
export interface HelpTick {
  id: string;
  fromColonyId: string;
  fromColonyName: string;
  toColonyId: string;
  toColonyName: string;
  minutes: number;
  at: number;
}

export type AllianceResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// State shape + migration
// ---------------------------------------------------------------------------

/** Migration-safe init. Alliances are soul-level (alliances.md §9): this
 *  store is NEVER wiped by season resets — only by the player leaving or
 *  the alliance disbanding. */
export function ensureAlliances(state: GameState): void {
  const s = state as unknown as Record<string, unknown>;
  if (!s.alliances || typeof s.alliances !== "object") s.alliances = {};
  if (!s.reinforcements || !Array.isArray(s.reinforcements)) s.reinforcements = [];
  if (typeof s.helpDay !== "string") s.helpDay = "";
  if (typeof s.helpUsed !== "number") s.helpUsed = 0;
  if (!Array.isArray(s.helpLedger)) s.helpLedger = [];
  if (!Array.isArray(s.helpReceived)) s.helpReceived = [];
}

function allianceStore(state: GameState): Record<string, Alliance> {
  ensureAlliances(state);
  return (state as unknown as { alliances: Record<string, Alliance> }).alliances;
}

function todayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/** The alliance a colony belongs to (one alliance per colony — enforced at
 *  every membership write). */
export function allianceOf(state: GameState, colonyId: string): Alliance | null {
  const store = allianceStore(state);
  for (const id of Object.keys(store)) {
    if (store[id].members.some((m) => m.colonyId === colonyId)) return store[id];
  }
  return null;
}

export function memberRole(a: Alliance, colonyId: string): AllianceRole | null {
  return a.members.find((m) => m.colonyId === colonyId)?.role ?? null;
}

function isOfficerOrAbove(a: Alliance, colonyId: string): boolean {
  const r = memberRole(a, colonyId);
  return r === "leader" || r === "officer";
}

let allianceSeq = 0;
function newAllianceId(now: number): string {
  allianceSeq += 1;
  return `all-${now.toString(36)}-${allianceSeq.toString(36)}`;
}

export function createAlliance(
  state: GameState,
  founder: { id: string; name: string },
  cradleTier: number,
  input: { name: string; banner?: string; motto?: string; homeServerId?: string },
  now: number,
): AllianceResult<Alliance> {
  const store = allianceStore(state);
  if (allianceOf(state, founder.id)) return { ok: false, error: "One flag at a time — leave your current alliance first." };
  if (cradleTier < ALLIANCE_CONFIG.foundCradleTier) {
    return { ok: false, error: `Founding takes a Cradle at Tier ${ALLIANCE_CONFIG.foundCradleTier} — yours is Tier ${cradleTier}.` };
  }
  const s = state as unknown as { resources: { supplies: number } };
  if ((s.resources?.supplies ?? 0) < ALLIANCE_CONFIG.foundSuppliesCost) {
    return { ok: false, error: `Founding costs ${ALLIANCE_CONFIG.foundSuppliesCost} supplies.` };
  }
  const name = (input.name ?? "").trim().slice(0, 40);
  if (name.length < 3) return { ok: false, error: "Give your war band a name — at least 3 characters." };
  s.resources.supplies -= ALLIANCE_CONFIG.foundSuppliesCost;
  const a: Alliance = {
    id: newAllianceId(now),
    name,
    banner: (input.banner ?? "⚔️").slice(0, 8),
    motto: (input.motto ?? "").trim().slice(0, 120),
    members: [{ colonyId: founder.id, colonyName: founder.name, role: "leader", joinedAt: now }],
    applications: [],
    invites: [],
    foundedAt: now,
    founderId: founder.id,
    homeServerId: input.homeServerId ?? "home",
  };
  store[a.id] = a;
  return { ok: true, value: a };
}

export function applyToAlliance(
  state: GameState,
  allianceId: string,
  applicant: { id: string; name: string },
  now: number,
): AllianceResult {
  const a = allianceStore(state)[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  if (allianceOf(state, applicant.id)) return { ok: false, error: "One flag at a time — leave your current alliance first." };
  if (a.members.length >= ALLIANCE_CONFIG.sizeCap) return { ok: false, error: "Their war band is full (50)." };
  if (a.applications.some((x) => x.colonyId === applicant.id)) return { ok: false, error: "Your application is already on their board." };
  a.applications.push({ colonyId: applicant.id, colonyName: applicant.name, appliedAt: now });
  return { ok: true, value: undefined };
}

export function inviteToAlliance(
  state: GameState,
  allianceId: string,
  actorId: string,
  target: { id: string; name: string },
  now: number,
): AllianceResult {
  const a = allianceStore(state)[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  if (!isOfficerOrAbove(a, actorId)) return { ok: false, error: "Only officers can invite." };
  if (allianceOf(state, target.id)) return { ok: false, error: "They already fly a flag." };
  if (a.members.length >= ALLIANCE_CONFIG.sizeCap) return { ok: false, error: "The war band is full (50)." };
  if (a.invites.some((x) => x.colonyId === target.id)) return { ok: false, error: "They're already invited." };
  a.invites.push({ colonyId: target.id, colonyName: target.name, invitedAt: now, byColonyId: actorId });
  return { ok: true, value: undefined };
}

/** Accept an application (officer+) or an invite (the invited colony). */
export function acceptMembership(
  state: GameState,
  allianceId: string,
  actorId: string,
  colonyId: string,
  now: number,
): AllianceResult {
  const a = allianceStore(state)[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  const viaInvite = a.invites.some((x) => x.colonyId === colonyId);
  const viaApplication = a.applications.some((x) => x.colonyId === colonyId);
  if (!viaInvite && !viaApplication) return { ok: false, error: "No invite or application on record." };
  // Officers approve applications; the invited colony accepts its own invite.
  if (viaApplication && !viaInvite && !isOfficerOrAbove(a, actorId)) {
    return { ok: false, error: "Only officers can approve applications." };
  }
  if (viaInvite && !viaApplication && actorId !== colonyId && !isOfficerOrAbove(a, actorId)) {
    return { ok: false, error: "That's not your invite to accept." };
  }
  if (a.members.length >= ALLIANCE_CONFIG.sizeCap) return { ok: false, error: "The war band is full (50)." };
  if (allianceOf(state, colonyId)) return { ok: false, error: "They already fly a flag." };
  const rec = a.invites.find((x) => x.colonyId === colonyId) ?? a.applications.find((x) => x.colonyId === colonyId)!;
  a.invites = a.invites.filter((x) => x.colonyId !== colonyId);
  a.applications = a.applications.filter((x) => x.colonyId !== colonyId);
  a.members.push({ colonyId, colonyName: rec.colonyName, role: "member", joinedAt: now });
  return { ok: true, value: undefined };
}

export function declineMembership(
  state: GameState,
  allianceId: string,
  actorId: string,
  colonyId: string,
): AllianceResult {
  const a = allianceStore(state)[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  const viaApplication = a.applications.some((x) => x.colonyId === colonyId);
  if (viaApplication && !isOfficerOrAbove(a, actorId)) return { ok: false, error: "Only officers can decline applications." };
  if (!viaApplication && actorId !== colonyId && !isOfficerOrAbove(a, actorId)) {
    return { ok: false, error: "That's not yours to decline." };
  }
  a.invites = a.invites.filter((x) => x.colonyId !== colonyId);
  a.applications = a.applications.filter((x) => x.colonyId !== colonyId);
  return { ok: true, value: undefined };
}

/** Leaving is free and instant. Pledged rally troops in OPEN rallies return
 *  at once; troops in a LAUNCHED rally finish the fight (no mid-march
 *  desertion); stationed reinforcements auto-recall. The name stays on the
 *  plaques it earned — history doesn't unhappen. */
export function leaveAlliance(state: GameState, colonyId: string, now: number): AllianceResult {
  const a = allianceOf(state, colonyId);
  if (!a) return { ok: false, error: "You're not in an alliance." };
  releaseOpenRallyPledges(state, a.id, colonyId);
  autoRecallReinforcements(state, colonyId);
  a.members = a.members.filter((m) => m.colonyId !== colonyId);
  if (a.members.length === 0) {
    delete allianceStore(state)[a.id];
    return { ok: true, value: undefined };
  }
  // Leadership passes: oldest officer, else oldest member.
  const wasLeader = !a.members.some((m) => m.role === "leader");
  if (wasLeader) {
    const officers = a.members.filter((m) => m.role === "officer").sort((x, y) => x.joinedAt - y.joinedAt);
    const heir = officers[0] ?? [...a.members].sort((x, y) => x.joinedAt - y.joinedAt)[0];
    if (heir) heir.role = "leader";
  }
  void now;
  return { ok: true, value: undefined };
}

export function kickMember(
  state: GameState,
  allianceId: string,
  actorId: string,
  targetId: string,
  now: number,
): AllianceResult {
  const a = allianceStore(state)[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  const actorRole = memberRole(a, actorId);
  const targetRole = memberRole(a, targetId);
  if (!targetRole) return { ok: false, error: "They're not in this alliance." };
  if (actorRole === "leader") {
    if (targetId === actorId) return { ok: false, error: "Leaders don't kick themselves — disband or pass the flag." };
  } else if (actorRole === "officer") {
    if (targetRole !== "member") return { ok: false, error: "Officers can only kick members." };
  } else {
    return { ok: false, error: "Only officers can kick." };
  }
  // Same troop handling as leaving.
  releaseOpenRallyPledges(state, a.id, targetId);
  autoRecallReinforcements(state, targetId);
  a.members = a.members.filter((m) => m.colonyId !== targetId);
  void now;
  return { ok: true, value: undefined };
}

export function promoteMember(
  state: GameState,
  allianceId: string,
  actorId: string,
  targetId: string,
): AllianceResult {
  const a = allianceStore(state)[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  if (memberRole(a, actorId) !== "leader") return { ok: false, error: "Only the leader promotes." };
  const t = a.members.find((m) => m.colonyId === targetId);
  if (!t || t.role !== "member") return { ok: false, error: "Only members can be promoted." };
  const officers = a.members.filter((m) => m.role === "officer").length;
  if (officers >= ALLIANCE_CONFIG.officerCap) return { ok: false, error: `The officer bench is full (${ALLIANCE_CONFIG.officerCap}).` };
  t.role = "officer";
  return { ok: true, value: undefined };
}

export function demoteMember(
  state: GameState,
  allianceId: string,
  actorId: string,
  targetId: string,
): AllianceResult {
  const a = allianceStore(state)[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  if (memberRole(a, actorId) !== "leader") return { ok: false, error: "Only the leader demotes." };
  const t = a.members.find((m) => m.colonyId === targetId);
  if (!t || t.role !== "officer") return { ok: false, error: "Only officers can be demoted." };
  t.role = "member";
  return { ok: true, value: undefined };
}

/** Pass the flag explicitly (leader → another member). */
export function transferLeadership(
  state: GameState,
  allianceId: string,
  actorId: string,
  targetId: string,
): AllianceResult {
  const a = allianceStore(state)[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  if (memberRole(a, actorId) !== "leader") return { ok: false, error: "Only the leader can pass the flag." };
  const t = a.members.find((m) => m.colonyId === targetId);
  if (!t) return { ok: false, error: "They're not in this alliance." };
  const actor = a.members.find((m) => m.colonyId === actorId)!;
  actor.role = "officer";
  t.role = "leader";
  return { ok: true, value: undefined };
}

export function disbandAlliance(state: GameState, allianceId: string, actorId: string): AllianceResult {
  const store = allianceStore(state);
  const a = store[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  if (memberRole(a, actorId) !== "leader") return { ok: false, error: "Only the leader can disband." };
  for (const m of a.members) {
    releaseOpenRallyPledges(state, a.id, m.colonyId);
    autoRecallReinforcements(state, m.colonyId);
  }
  delete store[allianceId];
  return { ok: true, value: undefined };
}

// ---------------------------------------------------------------------------
// Help ticks — the daily co-op loop (alliances.md §4)
// ---------------------------------------------------------------------------

/** Tick size reads the HELPER's Cradle tier — progression pays dividends
 *  socially. Buildings and research only; never troops, never the forge. */
export function helpTickMinutes(tier: number): number {
  const t = Math.min(5, Math.max(1, Math.trunc(tier) || 1));
  return ALLIANCE_CONFIG.helpTickMinutesByTier[t];
}

function helpBudget(state: GameState, now: number): { used: number; perDay: number } {
  ensureAlliances(state);
  const s = state as unknown as { helpDay: string; helpUsed: number };
  const day = todayKey(now);
  if (s.helpDay !== day) {
    s.helpDay = day;
    s.helpUsed = 0;
  }
  return { used: s.helpUsed, perDay: ALLIANCE_CONFIG.helpPerDay };
}

export function helpRemaining(state: GameState, now: number): number {
  const b = helpBudget(state, now);
  return Math.max(0, b.perDay - b.used);
}

/** Validate + spend one help action. The timer-shave applies to the TARGET's
 *  state via applyHelpTick (the server routes it); the giver's budget and
 *  ledger update here. */
export function giveHelp(
  state: GameState,
  helper: { id: string; name: string; tier: number },
  target: { id: string; name: string },
  now: number,
): AllianceResult<HelpTick> {
  ensureAlliances(state);
  if (helper.id === target.id) return { ok: false, error: "You can't help yourself — that's just work." };
  const ha = allianceOf(state, helper.id);
  const ta = allianceOf(state, target.id);
  if (!ha || !ta || ha.id !== ta.id) return { ok: false, error: "Help is for alliance-mates." };
  if (helpRemaining(state, now) <= 0) return { ok: false, error: "You've spent today's help — it refreshes tomorrow." };
  const minutes = helpTickMinutes(helper.tier);
  const s = state as unknown as { helpUsed: number; helpLedger: HelpTick[] };
  s.helpUsed += 1;
  const tick: HelpTick = {
    id: `help-${now.toString(36)}-${s.helpUsed}`,
    fromColonyId: helper.id,
    fromColonyName: helper.name,
    toColonyId: target.id,
    toColonyName: target.name,
    minutes,
    at: now,
  };
  s.helpLedger.push(tick);
  return { ok: true, value: tick };
}

/** Shave `minutes` off a colony's active build AND research timers. Pure over
 *  the target state — the server calls this on the TARGET's save. Buildings
 *  and research only, never troops/muster/forge (alliances.md §4). */
export function applyHelpTick(
  targetState: GameState,
  minutes: number,
): { ok: true; shavedMs: number } | { ok: false; error: string } {
  const s = targetState as unknown as {
    programDeploy?: { startedAt: number; durationMs: number } | null;
    researchJobs?: { status: string; durationMs: number }[];
  };
  const shaveMs = Math.max(0, Math.round(minutes * 60_000));
  let shaved = 0;
  const p = s.programDeploy;
  if (p && p.durationMs > 0) {
    const cut = Math.min(p.durationMs, shaveMs);
    p.durationMs -= cut;
    shaved += cut;
  }
  for (const j of s.researchJobs ?? []) {
    if (j.status === "researching" && j.durationMs > 0) {
      const cut = Math.min(j.durationMs, shaveMs);
      j.durationMs -= cut;
      shaved += cut;
    }
  }
  if (shaved <= 0) return { ok: false, error: "They have nothing underway to help with." };
  return { ok: true, shavedMs: shaved };
}

/** "Who helped you this week" — the simple list social pressure runs on. */
export function recordHelpReceived(state: GameState, tick: HelpTick, now: number): void {
  ensureAlliances(state);
  const s = state as unknown as { helpReceived: HelpTick[] };
  s.helpReceived.push(tick);
  const cutoff = now - ALLIANCE_CONFIG.helpWeekMs;
  s.helpReceived = s.helpReceived.filter((h) => h.at >= cutoff);
}

// ---------------------------------------------------------------------------
// Standing reinforcements (alliances.md §3)
// ---------------------------------------------------------------------------

function reinforcementStore(state: GameState): Reinforcement[] {
  ensureAlliances(state);
  return (state as unknown as { reinforcements: Reinforcement[] }).reinforcements;
}

/** Send bodies to stand in an ally's walls. The troops leave YOUR garrison
 *  into the commitment at once (real bodies, not a buff); they fight under
 *  the host's command. Upkeep debits the HOST's stockpile. */
export function sendReinforcement(
  state: GameState,
  from: { id: string; name: string },
  to: { id: string; name: string; fobServerId?: string },
  troops: number,
  heroIds: string[],
  now: number,
): AllianceResult<Reinforcement> {
  const fa = allianceOf(state, from.id);
  const ta = allianceOf(state, to.id);
  if (!fa || !ta || fa.id !== ta.id) return { ok: false, error: "Reinforcements march for alliance-mates only." };
  const w = Math.max(0, Math.trunc(troops) || 0);
  if (w <= 0 && heroIds.length === 0) return { ok: false, error: "Send someone — troops, heroes, or both." };
  const roster = rosterForCommit(state, { kind: "home" });
  if (!roster) return { ok: false, error: "No garrison to march from." };
  if (w > availableWeight(roster)) return { ok: false, error: "The garrison can't spare that many." };
  // Heroes: not already locked to a battle or rally.
  const locks = (state.warReserve?.lockedHeroes ?? {}) as Record<string, { battleId: string }>;
  for (const h of heroIds) {
    if (locks[h]) return { ok: false, error: "One of those heroes is already committed elsewhere." };
  }
  const committed = commitRosterWeight(state, { kind: "home" }, w);
  if (committed <= 0 && w > 0) return { ok: false, error: "The garrison can't spare that many." };
  for (const h of heroIds) {
    if (state.warReserve) state.warReserve.lockedHeroes[h] = { battleId: `reinforce-${now}`, until: 0 };
  }
  const r: Reinforcement = {
    id: `reinf-${now.toString(36)}-${from.id.slice(-4)}`,
    fromColonyId: from.id,
    fromColonyName: from.name,
    toColonyId: to.id,
    toColonyName: to.name,
    toFobServerId: to.fobServerId,
    troops: committed,
    heroes: [...heroIds],
    sentAt: now,
    state: "stationed",
  };
  reinforcementStore(state).push(r);
  return { ok: true, value: r };
}

/** Release a reinforcement's lock back to the sender's garrison (the bodies
 *  walk home). Used by recall, dismiss, and auto-recall. */
function releaseReinforcement(state: GameState, r: Reinforcement): void {
  if (r.state !== "stationed") return;
  const roster = rosterForCommit(state, { kind: "home" });
  if (roster && r.troops > 0) releaseWeight(roster, r.troops);
  if (state.warReserve) {
    for (const h of r.heroes) {
      const lock = state.warReserve.lockedHeroes[h];
      if (lock && lock.battleId === `reinforce-${r.sentAt}`) delete state.warReserve.lockedHeroes[h];
    }
  }
  r.state = "recalled";
}

export function recallReinforcement(state: GameState, colonyId: string, reinforcementId: string): AllianceResult {
  const r = reinforcementStore(state).find((x) => x.id === reinforcementId);
  if (!r || r.fromColonyId !== colonyId) return { ok: false, error: "That's not your reinforcement to recall." };
  if (r.state !== "stationed") return { ok: false, error: "It's already on its way home." };
  releaseReinforcement(state, r);
  return { ok: true, value: undefined };
}

/** The host dismisses guests at any time — the bodies march home and the
 *  sender's lock releases (server routes the release to the sender's save;
 *  locally the same save holds both sides). */
export function dismissReinforcement(state: GameState, colonyId: string, reinforcementId: string): AllianceResult {
  const r = reinforcementStore(state).find((x) => x.id === reinforcementId);
  if (!r || r.toColonyId !== colonyId) return { ok: false, error: "Those aren't your guests to dismiss." };
  if (r.state !== "stationed") return { ok: false, error: "They're already gone." };
  releaseReinforcement(state, r);
  r.state = "dismissed";
  return { ok: true, value: undefined };
}

/** Reinforcements stationed AT a colony (its guests). */
export function reinforcementsAt(state: GameState, colonyId: string): Reinforcement[] {
  return reinforcementStore(state).filter((r) => r.toColonyId === colonyId && r.state === "stationed");
}

/** Reinforcements sent BY a colony (its troops abroad). */
export function reinforcementsFrom(state: GameState, colonyId: string): Reinforcement[] {
  return reinforcementStore(state).filter((r) => r.fromColonyId === colonyId && r.state === "stationed");
}

/** Leaving/kicked: every stationed reinforcement auto-recalls. */
export function autoRecallReinforcements(state: GameState, colonyId: string): number {
  let n = 0;
  for (const r of reinforcementStore(state)) {
    if (r.fromColonyId === colonyId && r.state === "stationed") {
      releaseReinforcement(state, r);
      n += 1;
    }
  }
  return n;
}

/** Host-side upkeep: feeding stationed guests costs the HOST this much
 *  supply per hour (1 per 10 troops, same curve as muster upkeep). Pure. */
export function reinforcementUpkeepPerHour(r: Reinforcement): number {
  return Math.ceil(r.troops / 10);
}

/** Desertion order when the host starves: guests leave before family. Pure
 *  helper — sorts stationed troop groups guests-first for the hunger pass. */
export function desertionOrder<T extends { troops: number; guest: boolean }>(groups: T[]): T[] {
  return [...groups].sort((a, b) => Number(b.guest) - Number(a.guest));
}

// ---------------------------------------------------------------------------
// Rally pledge locks (used by rallies.ts + leave/kick paths)
// ---------------------------------------------------------------------------

/** Release a colony's pledges in OPEN rallies (leaving/kick/disband). */
export function releaseOpenRallyPledges(state: GameState, allianceId: string, colonyId: string): number {
  const s = state as unknown as { rallies?: Record<string, RallyLike> };
  const rallies = s.rallies ?? {};
  let released = 0;
  for (const id of Object.keys(rallies)) {
    const r = rallies[id];
    if (r.allianceId !== allianceId || r.state !== "open") continue;
    const p = r.pledges.find((x) => x.colonyId === colonyId);
    if (!p) continue;
    const roster = rosterForCommit(state, { kind: "home" });
    if (roster && p.troops > 0) releaseWeight(roster, p.troops);
    unlockRallyHeroes(state, r.id, p.heroes);
    r.pledges = r.pledges.filter((x) => x.colonyId !== colonyId);
    released += 1;
  }
  return released;
}

/** Minimal rally shape this module needs (rallies.ts owns the full type). */
interface RallyLike {
  id: string;
  allianceId: string;
  state: string;
  pledges: { colonyId: string; troops: number; heroes: { id: string }[] }[];
}

export function unlockRallyHeroes(state: GameState, rallyId: string, heroIds: { id: string }[]): void {
  if (!state.warReserve) return;
  for (const h of heroIds) {
    const lock = state.warReserve.lockedHeroes[h.id];
    if (lock && lock.battleId === rallyId) delete state.warReserve.lockedHeroes[h.id];
  }
}
