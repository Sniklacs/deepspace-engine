// ALLIANCES — the war band (design/alliances.md).
//
// Server-shaped records kept on the colony save (keyed by id, members by
// colonyId) so a future multiplayer server migration is mechanical. The
// player's own colony acts through these functions; other colonies appear
// as id/name references, exactly like the battle engine's aid flow.
//
// v1 scope: founding, membership (invite/apply/leave/kick/promote), the
// 100-colony cap, help ticks (daily budget, Cradle-tier tick size), and
// standing reinforcements (sender-side locks + recall). Rallies live in
// rallies.ts. Membership persists across seasons by design — no reset path
// touches the alliance store (alliances.md §9).

import type { GameState } from "../types";
import type { ShipyardState } from "../shipyard";
import { sendMail } from "../mailbox";
import type { ArenaBout, ArenaChallenge } from "./arena";
import { commitRosterWeight, rosterForCommit, stampRosterSegment } from "./roster-commit";
import type { Battle, BattleSide, CommittedForce } from "./war-types";
import type { Rally, RallyPledge } from "./rallies";
import {
  applyCommittedCasualties,
  availableWeight,
  commitWeight,
  mixWeight,
  previewTakeNewestFirst,
  recordCasualties,
  releaseWeight,
} from "./troops";
import type { SlotLoads, SavedFormation } from "./playbook";
import type { CompactReplay } from "./battle-replays";

/** Local activity-log line (mirrors engine.log's shape). */
function alog(state: GameState, msg: string): void {
  if (!Array.isArray((state as unknown as { log?: unknown }).log)) return;
  const l = (state as unknown as { log: string[] }).log;
  l.unshift(msg);
  (state as unknown as { log: string[] }).log = l.slice(0, 60);
}

export const ALLIANCE_CONFIG = {
  /** Owner-confirmed Oct 2 2026: 100 members (up from 50). Big enough for ship
   *  factory crews and raiding parties; no cap on alliance count per planet. */
  sizeCap: 100,
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

/**
 * Member permissions (owner 2026-10-11): per-member flags assigned by the
 * leader/officers. New members join with the default set (doctrines OFF —
 * the leader grants it when the recruit is ready). Extensible: add new
 * flags to this union; memberPermissions() is the single check.
 */
export type AlliancePermission = "doctrines";

/** Default permissions for a fresh member — doctrines OFF by default. */
export const DEFAULT_MEMBER_PERMISSIONS: readonly AlliancePermission[] = [];

// ---------------------------------------------------------------------------
// Member avatars + service record (owner 2026-10-11).
// ---------------------------------------------------------------------------

/**
 * A member's avatar: a preset sigil we provide, or their own uploaded image.
 * Uploads live on the player's own save (served on demand); the member
 * record carries only the reference, so the alliance record stays lean and
 * avatar changes sync out with the next mirror update.
 */
export type MemberAvatar =
  | { kind: "preset"; key: string }
  | { kind: "upload"; id: string };

/** Preset avatar sigils — the set every member can pick from. */
export const AVATAR_PRESETS: readonly { key: string; glyph: string; label: string }[] = [
  { key: "war-helm", glyph: "🪖", label: "War helm" },
  { key: "blade", glyph: "⚔️", label: "Crossed blades" },
  { key: "shield", glyph: "🛡️", label: "Shield" },
  { key: "dragon", glyph: "🐉", label: "Dragon" },
  { key: "flame", glyph: "🔥", label: "Flame" },
  { key: "bolt", glyph: "⚡", label: "Bolt" },
  { key: "crown", glyph: "👑", label: "Crown" },
  { key: "skull", glyph: "💀", label: "Skull" },
  { key: "wolf", glyph: "🐺", label: "Wolf" },
  { key: "eagle", glyph: "🦅", label: "Eagle" },
  { key: "bow", glyph: "🏹", label: "Bow" },
  { key: "trident", glyph: "🔱", label: "Trident" },
  { key: "star", glyph: "🌟", label: "Star" },
  { key: "comet", glyph: "☄️", label: "Comet" },
  { key: "fist", glyph: "✊", label: "Fist" },
  { key: "eye", glyph: "👁️", label: "Eye" },
];

export const DEFAULT_AVATAR_KEY = "war-helm";

export function avatarGlyph(key: string): string {
  return AVATAR_PRESETS.find((p) => p.key === key)?.glyph ?? "🪖";
}

/** Effective avatar for a member (pure). */
export function avatarFor(m: Pick<AllianceMember, "avatar">): MemberAvatar {
  return m.avatar ?? { kind: "preset", key: DEFAULT_AVATAR_KEY };
}

/**
 * Service record — what a member has given the alliance (owner 2026-10-11).
 * "Sacrifice" means troops committed to the alliance cause and lost in
 * battle: reinforcements/reserves sent to allies that died holding the line.
 * Not wasted — given. Persistent on the member record; incremented when
 * their reinforcements die in an allied battle (record-service fx).
 */
export interface MemberServiceRecord {
  /** troop weight lost in alliance service */
  troopsLost: number;
  /** allied battles they bled in */
  battles: number;
  /** supplies donated to the alliance cause */
  donated: number;
}

export function emptyServiceRecord(): MemberServiceRecord {
  return { troopsLost: 0, battles: 0, donated: 0 };
}

export function serviceOf(m: Pick<AllianceMember, "service">): MemberServiceRecord {
  return m.service ?? emptyServiceRecord();
}

/**
 * Contribution score (owner 2026-10-11): troops lost in service feed it
 * directly — a member who bleeds for the alliance shows it — plus
 * donations. One number, comparable across the roster.
 */
export function memberContribution(m: Pick<AllianceMember, "service">): number {
  const s = serviceOf(m);
  return s.troopsLost + s.donated;
}

/**
 * Record sacrifice on the canonical record (pure): a member's troops died
 * in alliance service. Bumps version so mirrors converge.
 */
export function recordMemberService(a: Alliance, memberId: string, troopsLost: number): boolean {
  const m = a.members.find((x) => x.colonyId === memberId);
  if (!m) return false;
  const s = serviceOf(m);
  s.troopsLost += Math.max(0, Math.trunc(troopsLost));
  s.battles += 1;
  m.service = s;
  logAllianceActivity(
    a,
    "sacrifice",
    `${m.colonyName} bled for the war band — ${troopsLost} fallen.`,
    { byColonyId: memberId, byColonyName: m.colonyName, at: Date.now() },
  );
  touchAlliance(a);
  return true;
}

/**
 * Canonical-side applier: record-service fx. A member's troops bled in
 * alliance service — idempotent per key (crash-replays can't double-count
 * sacrifice).
 */
export function applyRecordService(
  state: GameState,
  fx: Extract<AllianceFx, { kind: "record-service" }>,
  now = Date.now(),
): boolean {
  if (fxDone(state, fx.key)) return false;
  markFxDone(state, fx.key, now);
  const a = allianceStore(state)[fx.allianceId];
  if (!a) return false;
  return recordMemberService(a, fx.memberId, fx.troopsLost);
}

export interface AllianceMember {
  colonyId: string;
  colonyName: string;
  role: AllianceRole;
  joinedAt: number;
  /** Granted permissions. Missing = defaults. Leaders/officers implicitly
   *  hold every permission — they run the alliance. */
  permissions?: AlliancePermission[];
  /** Avatar: preset sigil or uploaded image reference. */
  avatar?: MemberAvatar;
  /** Service record — troops lost in alliance service + contribution. */
  service?: MemberServiceRecord;
}

/** Effective permissions for a member (pure). */
export function memberPermissions(a: Alliance, colonyId: string): AlliancePermission[] {
  const m = a.members.find((x) => x.colonyId === colonyId);
  if (!m) return [];
  if (m.role === "leader" || m.role === "officer") {
    return ["doctrines"];
  }
  return m.permissions ?? [...DEFAULT_MEMBER_PERMISSIONS];
}

/** Single permission check (pure). */
export function memberCan(a: Alliance, colonyId: string, perm: AlliancePermission): boolean {
  return memberPermissions(a, colonyId).includes(perm);
}

/**
 * Leader/officer-only: assign a member's permissions (pure, mutates the
 * record + bumps version). The leader's own permissions can't be changed.
 */
export function setMemberPermissions(
  a: Alliance,
  byColonyId: string,
  targetColonyId: string,
  permissions: AlliancePermission[],
): { ok: boolean; error?: string } {
  const by = memberRole(a, byColonyId);
  if (by !== "leader" && by !== "officer") {
    return { ok: false, error: "Only the leader and officers assign permissions." };
  }
  const m = a.members.find((x) => x.colonyId === targetColonyId);
  if (!m) return { ok: false, error: "Not a member of this alliance." };
  if (m.role === "leader") return { ok: false, error: "The leader's permissions can't be changed." };
  m.permissions = [...new Set(permissions)];
  touchAlliance(a);
  return { ok: true };
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
  /** Join policy (owner 2026-10-03): "open" = free join, tap Join and you're in.
   *  "apply" = submit application, leader/officers review before joining.
   *  Defaults to "apply" for migration. */
  joinPolicy?: "open" | "apply";
  /** Shipyard tithe rate (owner 2026-10-03): 0-100. % of raid loot and gleaning
   *  that auto-flows to the shipyard stockpile. Set by leader/officers.
   *  Defaults to 0 (pure voluntary donations). */
  titheRate?: number;
  /** Monotonic mutation counter. Every write goes through the canonical
   *  record on the founder's account; mirrors converge by taking the
   *  highest-version copy (sync-alliance). */
  version: number;
  /** The alliance ship factory (design/abandoned-colonies-world-map.md).
   *  Warships are built here; build speed scales with active contributors. */
  shipyard?: ShipyardState;
  /** The war band's reverb feed (owner 2026-10-04): chronological activity —
   *  joins, leaves, kicks, promotions, donations, ship builds, rallies,
   *  policy changes. Newest first, capped at ALLIANCE_ACTIVITY_CAP. Fans
   *  out to mirrors with the record (sync-alliance). */
  activity?: AllianceActivityEntry[];
  /**
   * DOCTRINES (owner 2026-10-11): the alliance's institutional memory — how
   * the war band fights. Saved from a won battle, named, with the teaching
   * tape (compact replay) attached. Alliance-scoped: they live here, not on
   * the globe. Viewing requires the "doctrines" member permission.
   */
  doctrines?: AllianceDoctrine[];
}

// ---------------------------------------------------------------------------
// Doctrines — the alliance's way of war (owner 2026-10-11).
// A doctrine is a named, battle-proven formation saved to the ALLIANCE
// (personal setups stay in the war room). New members open the doctrine
// library, see how the alliance fights, watch the attached replay, and
// build their forces to fit. Doctrines ride the alliance record and fan
// out to mirrors with sync-alliance.
// ---------------------------------------------------------------------------

/** Cap on doctrines per alliance — the shelf, not the archive. */
export const MAX_DOCTRINES = 10;

export interface AllianceDoctrine {
  id: string;
  /** Required — every doctrine is findable by name. */
  name: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  playId: string;
  loads: SlotLoads;
  slotMeta?: SavedFormation["slotMeta"];
  /** The teaching tape — compact replay, embedded. */
  replay?: CompactReplay;
  /** Proof it works: the battle it was saved from. */
  battleName: string;
  victor: "attacker" | "defender" | null;
  durationS: number;
  killsAttacker: number;
  killsDefender: number;
}

/** One line of the "build to this doctrine" guide (pure). */
export interface DoctrineGuideLine {
  type: string;
  tier: number;
  count: number;
}

/**
 * "Build to this doctrine": the composition a new player needs, grouped by
 * type+tier (pure). The UI pairs this with their roster deficit.
 */
export function doctrineGuide(d: Pick<AllianceDoctrine, "loads">): {
  total: number;
  lines: DoctrineGuideLine[];
} {
  const byKT = new Map<string, DoctrineGuideLine>();
  for (const picks of Object.values(d.loads ?? {})) {
    for (const p of picks ?? []) {
      const k = `${p.type}:${p.tier}`;
      const line = byKT.get(k);
      if (line) line.count += Math.max(0, Math.trunc(p.count));
      else byKT.set(k, { type: p.type, tier: p.tier, count: Math.max(0, Math.trunc(p.count)) });
    }
  }
  const lines = [...byKT.values()].sort((a, b) => b.count - a.count);
  return { total: lines.reduce((n, l) => n + l.count, 0), lines };
}

export function doctrinesOf(a: Alliance): AllianceDoctrine[] {
  return a.doctrines ?? [];
}

/**
 * Save a doctrine to the alliance (pure, mutates the record + bumps
 * version). Any member may contribute — the library is the war band's
 * memory. Viewing is gated by the "doctrines" permission, not saving.
 */
export function addDoctrine(
  a: Alliance,
  d: Omit<AllianceDoctrine, "id" | "createdAt">,
  now: number,
): AllianceDoctrine {
  const doc: AllianceDoctrine = {
    ...d,
    id: `doc-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
  };
  a.doctrines = [...(a.doctrines ?? []), doc].slice(-MAX_DOCTRINES);
  touchAlliance(a);
  return doc;
}

/**
 * Remove a doctrine (pure). The author may retract their own; the leader
 * and officers may remove any.
 */
export function removeDoctrine(
  a: Alliance,
  byColonyId: string,
  doctrineId: string,
): { ok: boolean; error?: string } {
  const d = (a.doctrines ?? []).find((x) => x.id === doctrineId);
  if (!d) return { ok: false, error: "Doctrine not found." };
  const role = memberRole(a, byColonyId);
  if (d.authorId !== byColonyId && role !== "leader" && role !== "officer") {
    return { ok: false, error: "Only the author, the leader, or an officer can remove a doctrine." };
  }
  a.doctrines = (a.doctrines ?? []).filter((x) => x.id !== doctrineId);
  touchAlliance(a);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Alliance activity — the war band's reverb feed (owner 2026-10-04).
// "Everything going on in there": joins, leaves, kicks, promotions,
// donations, ship builds, rallies, policy changes. Newest first, capped.
// Logged on the canonical record; mirrors converge via sync-alliance.
// ---------------------------------------------------------------------------

export type AllianceActivityKind =
  | "founded"
  | "joined"
  | "left"
  | "kicked"
  | "invited"
  | "promoted"
  | "demoted"
  | "leadership"
  | "donated"
  | "ship-built"
  | "rally-called"
  | "rally-launched"
  | "rally-resolved"
  | "rally-cancelled"
  | "policy"
  | "tithe"
  | "sacrifice";

export interface AllianceActivityEntry {
  id: string;
  at: number;
  kind: AllianceActivityKind;
  text: string;
  byColonyId?: string;
  byColonyName?: string;
}

/** The reverb feed keeps the latest entries; older history scrolls off. */
export const ALLIANCE_ACTIVITY_CAP = 200;

let activitySeq = 0;

/** Append to the war band's reverb feed. Bumps the record version so the
 *  new entry fans out to every mirror with the next sync. */
export function logAllianceActivity(
  a: Alliance,
  kind: AllianceActivityKind,
  text: string,
  opts?: { byColonyId?: string; byColonyName?: string; at?: number },
): void {
  if (!Array.isArray(a.activity)) a.activity = [];
  activitySeq += 1;
  const at = opts?.at ?? Date.now();
  a.activity.unshift({
    id: `aa-${at.toString(36)}-${activitySeq.toString(36)}`,
    at,
    kind,
    text,
    ...(opts?.byColonyId ? { byColonyId: opts.byColonyId } : {}),
    ...(opts?.byColonyName ? { byColonyName: opts.byColonyName } : {}),
  });
  if (a.activity.length > ALLIANCE_ACTIVITY_CAP) a.activity.length = ALLIANCE_ACTIVITY_CAP;
  touchAlliance(a);
}

/** The reverb feed, newest first (empty for pre-feed records). */
export function allianceActivity(a: Alliance): AllianceActivityEntry[] {
  if (!Array.isArray(a.activity)) a.activity = [];
  return a.activity;
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
  /** Per-type snapshot of the locked troops (newest-first at send time) —
   *  feeds mercenary-band spawning if the guests desert at the host. */
  troopsByType?: Record<string, number>;
  heroes: string[];
  sentAt: number;
  state: "stationed" | "recalled" | "dismissed" | "deserted" | "destroyed";
}

/** The host's mirror of a stationed reinforcement. The authoritative
 *  Reinforcement record lives on the SENDER's save (their lock, their
 *  recall); this mirror lives on the HOST's save and drives host-side
 *  upkeep, guest-first desertion, and battle commits. The server keeps the
 *  two in sync (alliances.md §7). */
export interface GuestMirror {
  /** Reinforcement id (shared with the sender's record). */
  id: string;
  fromColonyId: string;
  fromColonyName: string;
  /** Supply-weight currently stationed (shrinks on partial desertion). */
  weight: number;
  troopsByType: Record<string, number>;
  heroes: string[];
  sentAt: number;
}

/** Cross-account side effects the domain layer cannot apply itself: the
 *  engine queues them on the local state; the server drains the queue and
 *  applies each to its target colony's save (alliance-transact.ts).
 *  `colonyId` is ALWAYS the target colony. Every applier is idempotent —
 *  crash-replays and re-drains can never double-apply. */
export type AllianceFx =
  | { kind: "apply-help-tick"; colonyId: string; tick: HelpTick }
  | { kind: "create-guest-mirror"; colonyId: string; mirror: GuestMirror }
  | { kind: "remove-guest-mirror"; colonyId: string; mirrorId: string; key: string }
  | {
      kind: "release-troop-lock";
      colonyId: string;
      /** Reinforcement whose lock releases; absent for generic (rally-pledge) locks. */
      reinforcementId?: string;
      weight: number;
      /** Dedupe key, set by the queuer (stable across re-drains). */
      key: string;
      /** Terminal transition for the reinforcement record, if still stationed. */
      mark?: "deserted" | "dismissed" | "recalled" | "destroyed";
    }
  | {
      kind: "bill-foreign-casualties";
      colonyId: string;
      segmentId: string;
      /** Set for reinforcement guests (their Reinforcement record shrinks);
       *  absent for rally pledgers (generic lock: survivors march home). */
      reinforcementId?: string;
      /** Absolute supply-weight to kill (mid-battle tolls). */
      weight?: number;
      /** Fraction of the segment's weight to kill (final resolve). */
      fraction?: number;
      segmentWeight: number;
      /** Dedupe key override (tolls); defaults to casualty:{battleId}:{segmentId}. */
      key?: string;
      battleId: string;
      site: string;
      season: string;
      factions: [string, string];
      allianceName?: string;
    }
  | {
      kind: "shrink-guest-mirror";
      colonyId: string;
      mirrorId: string;
      /** Monotonic sync: the mirror's weight becomes min(current, weight). */
      weight: number;
      key: string;
    }
  | {
      kind: "record-service";
      /** The FOUNDER's colony — canonical record holder. */
      colonyId: string;
      allianceId: string;
      /** The member whose troops bled. */
      memberId: string;
      /** Troop weight lost in alliance service. */
      troopsLost: number;
      battleId: string;
      key: string;
    }
  | {
      kind: "sync-alliance";
      colonyId: string;
      /** Full canonical record snapshot (deep-cloned on apply). The
       *  applier replaces the local copy iff snapshot.version is newer. */
      alliance: Alliance;
      key: string;
    }
  | {
      kind: "depart-alliance";
      colonyId: string;
      allianceId: string;
      /** Release the colony's pledges, recall its reinforcements, cancel
       *  rallies it called, and drop its local mirrors. Idempotent. */
      key: string;
    }
  | {
      kind: "sync-rally";
      colonyId: string;
      /** Full canonical record snapshot (deep-cloned on apply). The
       *  applier replaces the local copy iff snapshot.version is newer.
       *  Pledges carry each colony's troops+heroes but NEVER touch the
       *  target's garrison — the target only commits what it itself pledged
       *  through the pledge lock fx. */
      rally: Rally;
      key: string;
    }
  | {
      kind: "mirror-rally-pledge";
      /** The CALLER's colony — canonical record holder. */
      colonyId: string;
      rallyId: string;
      /** The pledger's locked pledge (troops already committed on their
       *  save). The caller's applier mirrors it into the canonical record
       *  and fans out a sync. Idempotent on pledge.id. */
      pledge: RallyPledge;
      key: string;
    }
  | {
      kind: "mirror-rally-unpledge";
      /** The CALLER's colony — canonical record holder. */
      colonyId: string;
      rallyId: string;
      pledgerId: string;
      pledgeId: string;
      key: string;
    }
  | {
      kind: "release-rally-pledge";
      colonyId: string;
      /** Idempotent unlock of one pledge: returns pledged troops to the
       *  target's garrison, unlocks its rally heroes. The weight and heroes
       *  ride the fx itself — the canonical rally may have already cleared
       *  its pledge list (cancel) by the time this delivers. */
      rallyId: string;
      pledgeId: string;
      troops: number;
      heroIds: string[];
      key: string;
    }
  | {
      kind: "deliver-rally-loot";
      colonyId: string;
      /** Post-resolution loot: adds supplies to the target's stockpile.
       *  Idempotent — share is recomputed from the canonical record. */
      rallyId: string;
      supplies: number;
      key: string;
    }
  | {
      kind: "unlock-rally-heroes";
      colonyId: string;
      /** Post-resolution: the pledged heroes come home (heroes never die in
       *  the battle engine — the lock just lifts). Idempotent. */
      rallyId: string;
      heroIds: string[];
      key: string;
    }
  // ---- ARENA (arena-market.md Part I; appliers live in war/arena.ts) ----
  | {
      kind: "arena-challenge";
      /** The CHALLENGED colony — receives the incoming proposal. */
      colonyId: string;
      challenge: ArenaChallenge;
      key: string;
    }
  | {
      kind: "arena-accept";
      /** The CHALLENGER's colony — canonical challenge holder; builds the battle. */
      colonyId: string;
      challengeId: string;
      guestForce: CommittedForce;
      guestStakes: boolean;
      key: string;
    }
  | { kind: "arena-decline"; colonyId: string; challengeId: string; key: string }
  | { kind: "arena-cancel"; colonyId: string; challengeId: string; key: string }
  | {
      kind: "arena-result";
      /** The GUEST colony — records the bout + unlocks heroes. */
      colonyId: string;
      bout: ArenaBout;
      heroIds: string[];
      challengeId: string;
      key: string;
    }
  | {
      kind: "raid-alarm";
      /** The ALLY's colony — receives the satellite klaxon. */
      colonyId: string;
      /** The fired alarm (deep-cloned on apply). Same detail level for every
       *  alliance member — the detector's satellite sets the intel. */
      alarm: import("../raid-protocol").RaidAlarm;
      key: string;
    };

/** Queue a cross-account effect (idempotent per caller — the server drains). */
export function queueAllianceFx(state: GameState, fx: AllianceFx): void {
  ensureAlliances(state);
  state.allianceFx!.push(fx);
}

/** Drain the queued effects (returns and clears). */
export function drainAllianceFx(state: GameState): AllianceFx[] {
  ensureAlliances(state);
  const out = state.allianceFx!;
  state.allianceFx = [];
  return out;
}

/** Idempotency ledger for applied cross-account effects (survives seasons —
 *  effect keys embed battle/reinforcement ids, so replays stay deduped). */
export function fxDone(state: GameState, key: string): boolean {
  ensureAlliances(state);
  return typeof state.allianceFxDone![key] === "number";
}

export function markFxDone(state: GameState, key: string, now = Date.now()): void {
  ensureAlliances(state);
  state.allianceFxDone![key] = now;
}

// ---------------------------------------------------------------------------
// Guest mirrors (host side)
// ---------------------------------------------------------------------------

function guestMirrorStore(state: GameState): GuestMirror[] {
  ensureAlliances(state);
  return state.guestMirrors!;
}

/** Stationed guests, oldest first (desertion order). */
export function guestsAt(state: GameState): GuestMirror[] {
  return guestMirrorStore(state)
    .filter((m) => m.weight > 0)
    .sort((a, b) => a.sentAt - b.sentAt);
}

/** Total stationed guest supply-weight (drives host upkeep). */
export function guestWeightAt(state: GameState): number {
  return guestsAt(state).reduce((s, m) => s + Math.max(0, m.weight), 0);
}

/** Host-side applier: create-guest-mirror. Idempotent on the mirror id. */
export function applyCreateGuestMirror(state: GameState, mirror: GuestMirror): boolean {
  const ms = guestMirrorStore(state);
  if (ms.some((m) => m.id === mirror.id)) return false;
  ms.push({
    id: mirror.id,
    fromColonyId: mirror.fromColonyId,
    fromColonyName: mirror.fromColonyName,
    weight: Math.max(0, Math.trunc(mirror.weight) || 0),
    troopsByType: { ...mirror.troopsByType },
    heroes: [...(mirror.heroes ?? [])],
    sentAt: mirror.sentAt,
  });
  return true;
}

/** Host-side applier: remove-guest-mirror. Idempotent on the key. */
export function applyRemoveGuestMirror(state: GameState, mirrorId: string, key: string): boolean {
  if (fxDone(state, key)) return false;
  markFxDone(state, key);
  const ms = guestMirrorStore(state);
  const i = ms.findIndex((m) => m.id === mirrorId);
  if (i >= 0) ms.splice(i, 1);
  return true;
}

/** Host-side applier: shrink-guest-mirror (monotonic — battle deaths on the
 *  sender's save sync back without clobbering newer local desertion). */
export function applyShrinkGuestMirror(state: GameState, mirrorId: string, weight: number, key: string): boolean {
  if (fxDone(state, key)) return false;
  markFxDone(state, key);
  const m = guestMirrorStore(state).find((x) => x.id === mirrorId);
  if (!m) return false;
  const w = Math.max(0, Math.trunc(weight) || 0);
  if (w < m.weight) {
    const f = m.weight > 0 ? w / m.weight : 0;
    for (const t of Object.keys(m.troopsByType) as (keyof typeof m.troopsByType)[]) {
      m.troopsByType[t] = Math.max(0, Math.floor(m.troopsByType[t] * f));
    }
    m.weight = w;
  }
  return true;
}

/** Shrink mirrors after host-side desertion (called from the upkeep tick).
 *  Returns per-mirror detail so the caller can queue the sender-side
 *  release fx. The band spawning already happened in troops.ts. */
export function shrinkGuestMirrors(
  state: GameState,
  deserted: { id: string; weight: number; troopsByType: Record<string, number> }[],
): { id: string; fromColonyId: string; fromColonyName: string; desertedWeight: number; gone: boolean }[] {
  const out: { id: string; fromColonyId: string; fromColonyName: string; desertedWeight: number; gone: boolean }[] = [];
  const ms = guestMirrorStore(state);
  for (const d of deserted) {
    const m = ms.find((x) => x.id === d.id);
    if (!m) continue;
    const w = Math.min(Math.max(0, Math.trunc(d.weight) || 0), m.weight);
    for (const t of Object.keys(d.troopsByType) as (keyof typeof m.troopsByType)[]) {
      m.troopsByType[t] = Math.max(0, (m.troopsByType[t] ?? 0) - (d.troopsByType[t] ?? 0));
    }
    m.weight = Math.max(0, m.weight - w);
    const gone = m.weight <= 0;
    if (gone) ms.splice(ms.indexOf(m), 1);
    out.push({ id: m.id, fromColonyId: m.fromColonyId, fromColonyName: m.fromColonyName, desertedWeight: w, gone });
  }
  return out;
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
  if (!s.guestMirrors || !Array.isArray(s.guestMirrors)) s.guestMirrors = [];
  if (!Array.isArray(s.allianceFx)) s.allianceFx = [];
  if (!s.allianceFxDone || typeof s.allianceFxDone !== "object") s.allianceFxDone = {};
  if (typeof s.helpDay !== "string") s.helpDay = "";
  if (typeof s.helpUsed !== "number") s.helpUsed = 0;
  if (!Array.isArray(s.helpLedger)) s.helpLedger = [];
  if (!Array.isArray(s.helpReceived)) s.helpReceived = [];
  // Backfill the sync version on pre-sync records.
  for (const a of Object.values(s.alliances as Record<string, Alliance>)) {
    if (typeof a.version !== "number") a.version = 1;
    // Backfill the shipyard on pre-shipyard records.
    const rec = a as unknown as Record<string, unknown>;
    if (!rec.shipyard || typeof rec.shipyard !== "object") {
      rec.shipyard = { level: 1, queue: [], ships: [], seq: 1 };
    }
    // Backfill the reverb feed on pre-feed records (owner 2026-10-04).
    if (!Array.isArray(a.activity)) a.activity = [];
  }
}

function allianceStore(state: GameState): Record<string, Alliance> {
  ensureAlliances(state);
  return (state as unknown as { alliances: Record<string, Alliance> }).alliances;
}

/** Drop a local alliance mirror (after leaving / being kicked / disband).
 *  The canonical record lives on the founder's account — this only forgets
 *  the local copy. */
export function removeAllianceMirror(state: GameState, allianceId: string): void {
  delete allianceStore(state)[allianceId];
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

/** Fetch an alliance mirror by id (membership not required — invites and
 *  applications arrive as mirrors too). */
export function allianceById(state: GameState, allianceId: string): Alliance | null {
  return allianceStore(state)[allianceId] ?? null;
}

export function memberRole(a: Alliance, colonyId: string): AllianceRole | null {
  return a.members.find((m) => m.colonyId === colonyId)?.role ?? null;
}

/**
 * Alliance reverb — the war band's aggregate strength signature (owner
 * 2026-10-02: shown in the alliance browser so players can see which
 * alliances are strong).
 *
 * Planetary reverb is troops + builds; per-alliance we can only see what the
 * alliance itself owns, so this scores the fleet: completed warships at full
 * class weight, hulls under construction at half weight. Member troop counts
 * live on each member's own save and aren't visible here — the member count
 * is displayed alongside, not folded in.
 */
const SHIP_REVERB_WEIGHT: Record<string, number> = {
  scout: 1,
  frigate: 3,
  herald: 2,
  vanguard: 6,
  bulwark: 8,
  fatcat: 4,
};

export function allianceReverb(a: Alliance): number {
  const sy = a.shipyard;
  if (!sy) return 0;
  let r = 0;
  for (const s of sy.ships ?? []) r += SHIP_REVERB_WEIGHT[s.class] ?? 1;
  for (const b of sy.queue ?? []) r += (SHIP_REVERB_WEIGHT[b.shipClass] ?? 1) * 0.5;
  return Math.round(r);
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
    version: 1,
    activity: [],
  };
  store[a.id] = a;
  logAllianceActivity(a, "founded", `🏴 ${founder.name} raised the flag of "${name}".`, {
    byColonyId: founder.id,
    byColonyName: founder.name,
    at: now,
  });
  return { ok: true, value: a };
}

/** Bump the canonical record's version after a mutation. */
export function touchAlliance(a: Alliance): void {
  a.version = (typeof a.version === "number" ? a.version : 0) + 1;
}

/** Deep-clone an alliance record for the wire (fx cross a persistence
 *  boundary — never share the live object). */
export function cloneAlliance(a: Alliance): Alliance {
  return JSON.parse(JSON.stringify(a)) as Alliance;
}

/**
 * Fan a fired raid alarm out to every alliance member. The detector's own
 * state already holds the alarm; everyone else gets a `raid-alarm` fx the
 * server drains into their save. Same alarm, same intel for the whole war
 * band — that's the point (owner 2026-10-03).
 */
export function broadcastRaidAlarm(state: GameState, alarm: import("../raid-protocol").RaidAlarm): void {
  const me = alarm.targetColonyId;
  const a = allianceOf(state, me);
  if (!a) return;
  for (const m of a.members) {
    if (m.colonyId === me) continue;
    queueAllianceFx(state, {
      kind: "raid-alarm",
      colonyId: m.colonyId,
      alarm: JSON.parse(JSON.stringify(alarm)) as import("../raid-protocol").RaidAlarm,
      key: `raid-alarm:${alarm.raidId}:${m.colonyId}`,
    });
  }
}
/**
 * Fan a canonical mutation out to every colony holding a mirror. The
 * canonical record lives on the founder's account; everyone else (members,
 * plus any extra targets like an applicant or invitee) gets a versioned
 * sync-alliance fx. The applier takes the highest-version copy, so fan-out
 * is idempotent and converges.
 */
export function syncAllianceTo(state: GameState, a: Alliance, extraColonyIds: string[] = []): void {
  const targets = new Set<string>();
  for (const m of a.members) targets.add(m.colonyId);
  for (const id of extraColonyIds) targets.add(id);
  targets.delete(a.founderId); // the canonical holder needs no mirror
  const snapshot = cloneAlliance(a);
  for (const colonyId of targets) {
    queueAllianceFx(state, {
      kind: "sync-alliance",
      colonyId,
      alliance: snapshot,
      key: `sync-alliance:${a.id}:v${a.version}`,
    });
  }
}

/** Target-side applier: sync-alliance. Highest version wins; stale or
 *  duplicate deliveries are dropped. */
export function applySyncAlliance(state: GameState, alliance: Alliance): boolean {
  const store = allianceStore(state);
  const cur = store[alliance.id];
  const incoming = typeof alliance.version === "number" ? alliance.version : 0;
  const local = cur && typeof cur.version === "number" ? cur.version : 0;
  if (cur && incoming <= local) return false;
  store[alliance.id] = cloneAlliance(alliance);
  return true;
}

export function applyToAlliance(
  state: GameState,
  allianceId: string,
  applicant: { id: string; name: string },
  now: number,
): AllianceResult {
  const a = allianceStore(state)[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  // Idempotent rejoin (2026-10-04): the canonical roster may still list the
  // applicant after their own save was wiped (e.g. a test reseed). Don't
  // block them and don't push a duplicate — refresh their mirror instead.
  if (a.members.some((m) => m.colonyId === applicant.id)) {
    syncAllianceTo(state, a, [applicant.id]);
    return { ok: true, value: undefined };
  }
  if (allianceOf(state, applicant.id)) return { ok: false, error: "One flag at a time — leave your current alliance first." };
  if (a.members.length >= ALLIANCE_CONFIG.sizeCap) return { ok: false, error: "Their war band is full (100)." };
  // Open policy (owner 2026-10-03): free join, no application needed.
  if (a.joinPolicy === "open") {
    a.members.push({ colonyId: applicant.id, colonyName: applicant.name, role: "member", joinedAt: now });
    logAllianceActivity(a, "joined", `🤝 ${applicant.name} joined the war band.`, {
      byColonyId: applicant.id,
      byColonyName: applicant.name,
      at: now,
    });
    touchAlliance(a);
    syncAllianceTo(state, a);
    return { ok: true, value: undefined };
  }
  if (a.applications.some((x) => x.colonyId === applicant.id)) return { ok: false, error: "Your application is already on their board." };
  a.applications.push({ colonyId: applicant.id, colonyName: applicant.name, appliedAt: now });
  touchAlliance(a);
  syncAllianceTo(state, a, [applicant.id]);
  return { ok: true, value: undefined };
}

export function setJoinPolicy(
  state: GameState,
  allianceId: string,
  actorId: string,
  policy: "open" | "apply",
): AllianceResult {
  const a = allianceStore(state)[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  if (!isOfficerOrAbove(a, actorId)) return { ok: false, error: "Only officers can change the join policy." };
  a.joinPolicy = policy;
  const actorName = a.members.find((m) => m.colonyId === actorId)?.colonyName ?? "An officer";
  logAllianceActivity(
    a,
    "policy",
    `⚙️ ${actorName} set the join policy to ${policy === "open" ? "open (free join)" : "apply (review applications)"}.`,
    { byColonyId: actorId, byColonyName: actorName },
  );
  touchAlliance(a);
  syncAllianceTo(state, a);
  return { ok: true, value: undefined };
}

/** Set the shipyard tithe rate (owner 2026-10-03): 0-100%. Officer+. */
export function setTitheRate(
  state: GameState,
  allianceId: string,
  actorId: string,
  rate: number,
): AllianceResult {
  const a = allianceStore(state)[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  if (!isOfficerOrAbove(a, actorId)) return { ok: false, error: "Only officers can set the shipyard tithe." };
  const r = Math.max(0, Math.min(100, Math.round(rate)));
  a.titheRate = r;
  const actorName = a.members.find((m) => m.colonyId === actorId)?.colonyName ?? "An officer";
  logAllianceActivity(a, "tithe", `⚙️ ${actorName} set the shipyard tithe to ${r}%.`, {
    byColonyId: actorId,
    byColonyName: actorName,
  });
  touchAlliance(a);
  syncAllianceTo(state, a);
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
  if (a.members.length >= ALLIANCE_CONFIG.sizeCap) return { ok: false, error: "The war band is full (100)." };
  if (a.invites.some((x) => x.colonyId === target.id)) return { ok: false, error: "They're already invited." };
  a.invites.push({ colonyId: target.id, colonyName: target.name, invitedAt: now, byColonyId: actorId });
  const actorName = a.members.find((m) => m.colonyId === actorId)?.colonyName ?? "An officer";
  logAllianceActivity(a, "invited", `✉️ ${actorName} invited ${target.name} to the war band.`, {
    byColonyId: actorId,
    byColonyName: actorName,
    at: now,
  });
  touchAlliance(a);
  syncAllianceTo(state, a, [target.id]);
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
  if (a.members.length >= ALLIANCE_CONFIG.sizeCap) return { ok: false, error: "The war band is full (100)." };
  if (allianceOf(state, colonyId)) return { ok: false, error: "They already fly a flag." };
  const rec = a.invites.find((x) => x.colonyId === colonyId) ?? a.applications.find((x) => x.colonyId === colonyId)!;
  a.invites = a.invites.filter((x) => x.colonyId !== colonyId);
  a.applications = a.applications.filter((x) => x.colonyId !== colonyId);
  a.members.push({ colonyId, colonyName: rec.colonyName, role: "member", joinedAt: now });
  logAllianceActivity(a, "joined", `🤝 ${rec.colonyName} joined the war band.`, {
    byColonyId: colonyId,
    byColonyName: rec.colonyName,
    at: now,
  });
  touchAlliance(a);
  syncAllianceTo(state, a);
  // NOTE: welcome mail is sent by the API layer (allianceAnswerFn) via a
  // separate transaction on the new member's colony — sending here would
  // land in the founder's mailbox (state is the founder's GameState).
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
  touchAlliance(a);
  syncAllianceTo(state, a, [colonyId]);
  return { ok: true, value: undefined };
}

/** The leaver's own reinforcement cleanup (their troops, their save):
 *  stationed reinforcements auto-recall and the host-side mirrors are
 *  cleaned through the seam. Rally pledges are handled separately — they
 *  live on the rally callers' canonical records. */
export function leaveAllianceLocal(state: GameState, colonyId: string): void {
  queueDepartureFx(state, colonyId);
  autoRecallReinforcements(state, colonyId);
}

/**
 * Canonical record removal: drop a colony from the member roll, pass
 * leadership (oldest officer, else oldest member), dissolve when empty.
 * Bumps the version and fans the new record out to the remaining members.
 * No troop handling — the colony's own save does that (leaveAllianceLocal
 * for a voluntary leave, the depart-alliance applier for kick/disband).
 */
export function removeAllianceMemberRecord(
  state: GameState,
  allianceId: string,
  colonyId: string,
  opts?: { why?: "left" | "kicked"; at?: number },
): AllianceResult<{ dissolved: boolean }> {
  const store = allianceStore(state);
  const a = store[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  const departing = a.members.find((m) => m.colonyId === colonyId);
  if (!departing) {
    return { ok: false, error: "They're not in this alliance." };
  }
  const why = opts?.why ?? "left";
  a.members = a.members.filter((m) => m.colonyId !== colonyId);
  if (a.members.length === 0) {
    delete store[allianceId];
    return { ok: true, value: { dissolved: true } };
  }
  logAllianceActivity(
    a,
    why,
    why === "kicked" ? `🥾 ${departing.colonyName} was cast out of the war band.` : `🚶 ${departing.colonyName} left the war band.`,
    { byColonyId: colonyId, byColonyName: departing.colonyName, at: opts?.at },
  );
  // Leadership passes: oldest officer, else oldest member.
  const wasLeader = !a.members.some((m) => m.role === "leader");
  if (wasLeader) {
    const officers = a.members.filter((m) => m.role === "officer").sort((x, y) => x.joinedAt - y.joinedAt);
    const heir = officers[0] ?? [...a.members].sort((x, y) => x.joinedAt - y.joinedAt)[0];
    if (heir) heir.role = "leader";
  }
  touchAlliance(a);
  syncAllianceTo(state, a);
  return { ok: true, value: { dissolved: false } };
}

/** Queue the full departure cleanup for a colony on another save. The
 *  applier (alliance-transact) releases their rally pledges, recalls
 *  their reinforcements, cancels rallies they called, and drops their
 *  local mirrors — idempotent. */
export function queueDepartAlliance(state: GameState, allianceId: string, colonyId: string): void {
  queueAllianceFx(state, {
    kind: "depart-alliance",
    colonyId,
    allianceId,
    key: `depart:${allianceId}:${colonyId}`,
  });
}

/** Leaving is free and instant. Pledged rally troops in OPEN rallies return
 *  at once; troops in a LAUNCHED rally finish the fight (no mid-march
 *  desertion); stationed reinforcements auto-recall. The name stays on the
 *  plaques it earned — history doesn't unhappen. */
export function leaveAlliance(state: GameState, colonyId: string, now: number): AllianceResult {
  const a = allianceOf(state, colonyId);
  if (!a) return { ok: false, error: "You're not in an alliance." };
  const name = a.name;
  releaseOpenRallyPledges(state, a.id, colonyId);
  leaveAllianceLocal(state, colonyId);
  const r = removeAllianceMemberRecord(state, a.id, colonyId, { why: "left", at: now });
  if (r.ok) {
    // Mailbox: you left the war band (owner 2026-10-03).
    sendMail(state, {
      from: "alliance",
      fromName: name,
      subject: `You left ${name}`,
      body: `You've left the war band "${name}". Your pledges were released. The door stays open — rejoin whenever you're ready.`,
      category: "alliance",
      sentAt: now,
      goTo: { tab: "battles", label: "Browse war bands" },
    });
  }
  void now;
  return r.ok ? { ok: true, value: undefined } : r;
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
  const r = removeAllianceMemberRecord(state, allianceId, targetId, { why: "kicked", at: now });
  if (!r.ok) return r;
  // The target's troops live on their save — the applier cleans them up.
  queueDepartAlliance(state, allianceId, targetId);
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
  const actorName = a.members.find((m) => m.colonyId === actorId)?.colonyName ?? "The leader";
  logAllianceActivity(a, "promoted", `⭐ ${actorName} promoted ${t.colonyName} to officer.`, {
    byColonyId: actorId,
    byColonyName: actorName,
  });
  touchAlliance(a);
  syncAllianceTo(state, a);
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
  const actorName = a.members.find((m) => m.colonyId === actorId)?.colonyName ?? "The leader";
  logAllianceActivity(a, "demoted", `📉 ${actorName} demoted ${t.colonyName} to member.`, {
    byColonyId: actorId,
    byColonyName: actorName,
  });
  touchAlliance(a);
  syncAllianceTo(state, a);
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
  // The canonical record stays on the founder's account — leadership is a
  // role, not a storage move. Every write still serializes there.
  logAllianceActivity(a, "leadership", `👑 ${actor.colonyName} passed the flag to ${t.colonyName}.`, {
    byColonyId: actorId,
    byColonyName: actor.colonyName,
  });
  touchAlliance(a);
  syncAllianceTo(state, a);
  return { ok: true, value: undefined };
}

export function disbandAlliance(state: GameState, allianceId: string, actorId: string): AllianceResult {
  const store = allianceStore(state);
  const a = store[allianceId];
  if (!a) return { ok: false, error: "That alliance doesn't exist." };
  if (memberRole(a, actorId) !== "leader") return { ok: false, error: "Only the leader can disband." };
  // Every member's troops live on their own save — each gets a
  // depart-alliance fx; the applier does the per-colony cleanup.
  for (const m of a.members) queueDepartAlliance(state, allianceId, m.colonyId);
  delete store[allianceId];
  return { ok: true, value: undefined };
}

/** Sender-side applier: release-troop-lock. Frees `weight` of the sender's
 *  committed troops (desertion/dismiss/recall/rally-release) and applies the
 *  terminal reinforcement transition. Idempotent on the fx key. */
export function applyReleaseTroopLock(
  state: GameState,
  fx: { reinforcementId?: string; weight: number; key: string; mark?: "deserted" | "dismissed" | "recalled" | "destroyed" },
): { released: number } {
  if (fxDone(state, fx.key)) return { released: 0 };
  markFxDone(state, fx.key);
  const roster = rosterForCommit(state, { kind: "home" });
  const w = Math.max(0, Math.trunc(fx.weight) || 0);
  let released = 0;
  const r = fx.reinforcementId
    ? reinforcementStore(state).find((x) => x.id === fx.reinforcementId)
    : undefined;
  if (r) {
    // Reinforcement lock: never release more than the record still holds.
    const rel = Math.min(w, Math.max(0, r.troops));
    if (roster && rel > 0) releaseWeight(roster, rel);
    r.troops = Math.max(0, r.troops - rel);
    released = rel;
    if (r.state === "stationed") {
      if (fx.mark) r.state = fx.mark;
      else if (r.troops <= 0) r.state = "deserted";
    }
    if (r.state !== "stationed" && state.warReserve) {
      for (const h of r.heroes) {
        const lock = state.warReserve.lockedHeroes[h];
        if (lock && lock.battleId === `reinforce-${r.sentAt}`) delete state.warReserve.lockedHeroes[h];
      }
    }
    if (released > 0 || fx.mark) {
      alog(state, fx.mark === "deserted"
        ? `Your guests at ${r.toColonyName} deserted — ${released} weight released.`
        : fx.mark === "dismissed"
          ? `${r.toColonyName} sent your guests home — ${released} weight released.`
          : `${released} troop weight released.`);
    }
  } else if (roster && w > 0) {
    // Generic lock (rally pledge survivors): the pool just shrinks.
    const before = roster.committedWeight;
    releaseWeight(roster, w);
    released = Math.max(0, before - roster.committedWeight);
  }
  return { released };
}

/** Sender-side applier: bill-foreign-casualties. Kills the dead from the
 *  sender's committed troops (newest-first, like every casualty path),
 *  shrinks the reinforcement record, and writes the sender's own memorial
 *  entry with alliance attribution. Idempotent per battle+segment. */
export function applyBillForeignCasualties(
  state: GameState,
  fx: {
    segmentId: string;
    reinforcementId?: string;
    weight?: number;
    fraction?: number;
    segmentWeight: number;
    key?: string;
    battleId: string;
    site: string;
    season: string;
    factions: [string, string];
    allianceName?: string;
  },
  now = Date.now(),
): { killed: number } {
  const key = fx.key ?? `casualty:${fx.battleId}:${fx.segmentId}`;
  if (fxDone(state, key)) return { killed: 0 };
  markFxDone(state, key, now);
  const roster = rosterForCommit(state, { kind: "home" });
  if (!roster) return { killed: 0 };
  const r = fx.reinforcementId
    ? reinforcementStore(state).find((x) => x.id === fx.reinforcementId)
    : undefined;
  if (fx.reinforcementId && (!r || r.state !== "stationed")) return { killed: 0 };
  const basis = r ? Math.min(fx.segmentWeight, r.troops) : fx.segmentWeight;
  const dead = fx.weight != null
    ? Math.min(Math.max(0, Math.trunc(fx.weight) || 0), basis)
    : Math.round(basis * Math.min(1, Math.max(0, fx.fraction ?? 0)));
  let killed = 0;
  if (dead > 0) {
    const res = applyCommittedCasualties(roster, dead);
    killed = res.weightKilled;
    if (killed > 0 && state.troops) {
      recordCasualties(state.troops.history, {
        battleId: fx.battleId,
        site: fx.site,
        season: fx.season,
        factions: fx.factions,
        lossesByType: res.losses,
        fallenHeroes: [],
        allianceName: fx.allianceName,
        colonyName: state.playerName || "An unnamed colony",
      });
    }
  }
  if (r) {
    r.troops = Math.max(0, r.troops - killed);
    if (r.troops <= 0 && r.state === "stationed") {
      r.state = "destroyed";
      if (state.warReserve) {
        for (const h of r.heroes) {
          const lock = state.warReserve.lockedHeroes[h];
          if (lock && lock.battleId === `reinforce-${r.sentAt}`) delete state.warReserve.lockedHeroes[h];
        }
      }
    }
    if (killed > 0) alog(state, `Your guests bled at ${fx.site} — ${killed} weight fallen.`);
    // Service record (owner 2026-10-11): troops committed to the alliance
    // cause and lost — sacrifice, not waste. Queued to the canonical
    // record; the war band sees it on the member's profile.
    queueServiceRecord(state, fx.battleId, fx.segmentId, killed);
    // Sync the host's mirror back to reality (monotonic — never clobbers
    // newer local desertion). Without this the next battle would simulate
    // dead guests back into the line.
    queueAllianceFx(state, {
      kind: "shrink-guest-mirror",
      colonyId: r.toColonyId,
      mirrorId: r.id,
      weight: r.troops,
      key: `shrink:${(fx.key ?? `casualty:${fx.battleId}:${fx.segmentId}`).replace(/^casualty:/, "")}`,
    });
  } else {
    // Rally pledger: survivors march home (their lock was only this battle).
    releaseWeight(roster, Math.max(0, fx.segmentWeight - killed));
    if (killed > 0) alog(state, `Your rally pledge bled at ${fx.site} — ${killed} weight fallen.`);
    // Rally pledges are alliance service too — the fallen count.
    queueServiceRecord(state, fx.battleId, fx.segmentId, killed);
  }
  return { killed };
}

/**
 * Queue a record-service fx to the canonical alliance record (owner
 * 2026-10-11): the sender's troops died in alliance service. No-op when
 * the sender holds no alliance or nothing was lost.
 */
function queueServiceRecord(state: GameState, battleId: string, segmentId: string, killed: number): void {
  if (killed <= 0) return;
  const me = state.gameId;
  if (!me) return;
  const a = allianceOf(state, me);
  if (!a) return;
  queueAllianceFx(state, {
    kind: "record-service",
    colonyId: a.founderId,
    allianceId: a.id,
    memberId: me,
    troopsLost: Math.trunc(killed),
    battleId,
    key: `service:${battleId}:${segmentId}:${me}`,
  });
}

/** Target-side applier: apply-help-tick. Shaves the target's build/research
 *  timers and records the tick on their "who helped you" list. Fizzles
 *  gracefully (still consumed) when nothing is underway. */
export function applyHelpFx(
  state: GameState,
  tick: HelpTick,
  now = Date.now(),
): { ok: true; shavedMs: number } {
  if (fxDone(state, `help:${tick.id}`)) return { ok: true, shavedMs: 0 };
  markFxDone(state, `help:${tick.id}`, now);
  const r = applyHelpTick(state, tick.minutes);
  if (r.ok) {
    recordHelpReceived(state, tick, now);
    alog(state, `${tick.fromColonyName} lent a hand — ${(r.shavedMs / 60000).toFixed(0)} min shaved off your work.`);
  } else {
    alog(state, `${tick.fromColonyName} lent a hand, but you had nothing underway.`);
  }
  return { ok: true, shavedMs: r.ok ? r.shavedMs : 0 };
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
  // The timer-shave lands on the TARGET's save — the server drains this fx
  // through the cross-account seam (idempotent on the tick id).
  queueAllianceFx(state, { kind: "apply-help-tick", colonyId: target.id, tick });
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
  if (!fa) return { ok: false, error: "Reinforcements march for alliance-mates only." };
  // Cross-account: the target's own save can't be read here, so the alliance
  // ROSTER on the sender's save is the authority for "is my ally".
  if (!fa.members.some((m) => m.colonyId === to.id)) {
    return { ok: false, error: "Reinforcements march for alliance-mates only." };
  }
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
  // Snapshot the type mix of the locked troops (newest-first, like the
  // desertion order) so the host can spawn a faithful mercenary band if
  // these guests starve at their post. Troops are indivisible: the snapshot
  // rounds UP to whole troops (one thunder weighs 2), so top the lock up to
  // the snapshot's actual weight — the lock, the mirror, and any future band
  // must agree on what marched, or a 1-weight lock could spawn a 2-weight
  // mercenary band out of nothing.
  const mix = previewTakeNewestFirst(roster, committed);
  const locked = Math.max(committed, mixWeight(mix));
  if (locked > committed) commitWeight(roster, locked - committed);
  const r: Reinforcement = {
    id: `reinf-${now.toString(36)}-${from.id.slice(-4)}`,
    fromColonyId: from.id,
    fromColonyName: from.name,
    toColonyId: to.id,
    toColonyName: to.name,
    toFobServerId: to.fobServerId,
    troops: locked,
    troopsByType: { ...mix },
    heroes: [...heroIds],
    sentAt: now,
    state: "stationed",
  };
  reinforcementStore(state).push(r);
  // The host learns about its guests through the seam: the mirror drives
  // host-side upkeep, guest-first desertion, and battle commits (idempotent
  // on the reinforcement id).
  queueAllianceFx(state, {
    kind: "create-guest-mirror",
    colonyId: to.id,
    mirror: {
      id: r.id,
      fromColonyId: from.id,
      fromColonyName: from.name,
      weight: locked,
      troopsByType: { ...mix },
      heroes: [...heroIds],
      sentAt: now,
    },
  });
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
  // The host's mirror must go too — through the seam (idempotent).
  queueAllianceFx(state, {
    kind: "remove-guest-mirror",
    colonyId: r.toColonyId,
    mirrorId: r.id,
    key: `unmirror:${r.id}:recalled`,
  });
  return { ok: true, value: undefined };
}

/** The host dismisses guests at any time: the mirror goes locally, and the
 *  sender's lock releases through the seam (idempotent). Takes the MIRROR id
 *  (== the reinforcement id). */
export function dismissReinforcement(state: GameState, mirrorId: string): AllianceResult {
  const ms = guestMirrorStore(state);
  const i = ms.findIndex((m) => m.id === mirrorId);
  if (i < 0) return { ok: false, error: "Those aren't your guests to dismiss." };
  const [m] = ms.splice(i, 1);
  queueAllianceFx(state, {
    kind: "release-troop-lock",
    colonyId: m.fromColonyId,
    reinforcementId: m.id,
    weight: m.weight,
    key: `unmirror:${m.id}:dismissed`,
    mark: "dismissed",
  });
  return { ok: true, value: undefined };
}

/** Reinforcements sent BY a colony (its troops abroad). */
export function reinforcementsFrom(state: GameState, colonyId: string): Reinforcement[] {
  return reinforcementStore(state).filter((r) => r.fromColonyId === colonyId && r.state === "stationed");
}

/** Stamp one authoritative "aid" segment per stationed guest onto a home-
 *  defense battle. The segments carry the sender's colonyId (+ the
 *  reinforcement id) so casualty resolution bills the SENDER's roster
 *  through the seam — never the host's. Returns the guest weight added;
 *  the caller adds it to the side's CommittedForce.troops.
 *
 *  Deliberately NOT wired into the Act I prologue front: that battle's
 *  §12.3 shape is pinned by the calibration harness (act1-entry-verify.ts),
 *  and the prologue predates alliances narratively — guests can never be
 *  stationed there in practice. This is the seam for real home-defense
 *  battles (PvP raids, beachhead defense) when they land. */
export function commitGuestsToDefense(
  state: GameState,
  battle: Battle,
  side: BattleSide,
  now: number,
): number {
  let added = 0;
  for (const m of guestsAt(state)) {
    if (m.weight <= 0) continue;
    stampRosterSegment(battle, side, {
      id: `guest-${battle.id}-${m.id}`,
      kind: "aid",
      home: { kind: "home" },
      weight: m.weight,
      tollsPaid: 0,
      colonyId: m.fromColonyId,
      reinforcementId: m.id,
      committedAt: now,
    });
    added += m.weight;
  }
  return added;
}

/** Leaving/kicked/disbanded: every stationed reinforcement auto-recalls. */
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

/** Queue the cross-account half of a departure: the leaver's troops abroad
 *  lose their host mirrors, and guests stationed with the leaver are sent
 *  home (their senders' locks release through the seam). Must run BEFORE
 *  autoRecallReinforcements marks the local records. */
export function queueDepartureFx(state: GameState, colonyId: string): void {
  for (const r of reinforcementStore(state)) {
    if (r.fromColonyId === colonyId && r.state === "stationed") {
      queueAllianceFx(state, {
        kind: "remove-guest-mirror",
        colonyId: r.toColonyId,
        mirrorId: r.id,
        key: `unmirror:${r.id}:departed`,
      });
    }
  }
  const ms = guestMirrorStore(state);
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i];
    ms.splice(i, 1);
    queueAllianceFx(state, {
      kind: "release-troop-lock",
      colonyId: m.fromColonyId,
      reinforcementId: m.id,
      weight: m.weight,
      key: `unmirror:${m.id}:host-departed`,
      mark: "dismissed",
    });
  }
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
