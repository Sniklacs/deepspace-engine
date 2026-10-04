// BEACHHEAD SITE NAMING — the land remembers (design/forward-base.md §9.1).
//
// Every forward-base site (keyed by foreign serverId — the "coordinates"
// until real map coordinates exist) has a NAME. A fresh planting starts
// generic: "Beachhead <phonetic>" (e.g. "Beachhead Kestrel"). After a battle
// resolves at the site, the site is named for the BIGGEST battle fought
// there, in honor of that battle's BIGGEST CONTRIBUTOR.
//
//   Biggest battle:      total supply-weight committed, both sides combined.
//   Biggest contributor: weight committed + 10 × kills (either side can win
//                        the honor — your beachhead can end up named after the
//                        enemy commander who broke your siege).
//
// Name format: "<PlayerName>'s <epithet>"
//   Attacker planted or held the site → "Landing"  ("Drakkar's Landing")
//   Defender held                      → "Stand"    ("Drakkar's Stand")
//   The base was destroyed             → "Fall"     ("Drakkar's Fall")
//   The honored player may rename the epithet ONCE (free text, filtered).
//
// A later, BIGGER battle re-names the site. Names are announced server-wide
// over the world speaker (mailbox "announcement") and persist per
// server+coordinates across seasons in the Chronicle — the names registry
// is NOT wiped by abandonForwardBasesForSeason.
//
// Pure module: deterministic, no Math.random. Phonetic designations derive
// from a seeded hash of the site key so every load agrees.

import type { GameState } from "../types";
import { sendMail } from "../mailbox";

// ============================================================================
// §0 CONFIG
// ============================================================================

/** Contribution knob: kills are worth 10× their weight (forward-base.md §9.1). */
export const CONTRIBUTION_KILL_MULTIPLIER = 10;

/** Phonetic designations for fresh, unnamed beachheads. */
const PHONETIC = [
  "Kestrel", "Harrier", "Merlin", "Falcon", "Osprey",
  "Raven", "Condor", "Egret", "Heron", "Ibis",
  "Jay", "Lark", "Marten", "Newt", "Otter",
] as const;

/** Minimal profanity/name filter for custom epithets. Extend as needed. */
const BLOCKED_WORDS = [
  "fuck", "shit", "cunt", "nigger", "faggot", "hitler", "nazi",
] as const;

// ============================================================================
// §1 TYPES
// ============================================================================

export type BeachheadSide = "attacker" | "defender";

export interface BeachheadContributor {
  colonyId: string;
  colonyName: string;
  side: BeachheadSide;
  /** Supply-weight committed to this battle. */
  weightCommitted: number;
  /** Troop kills + hero kills credited to this player. */
  kills: number;
}

export interface SiteBattleInput {
  /** Foreign serverId — the site key until real coordinates exist. */
  siteKey: string;
  battleId: string;
  season: string;
  at: number;
  attacker: BeachheadContributor;
  defender: BeachheadContributor;
  winner: BeachheadSide | "standoff";
  /** True when the forward base was razed in this battle. */
  baseDestroyed: boolean;
}

export interface SiteNameRecord {
  battleId: string;
  weight: number;
  name: string;
  honoredColonyName: string;
  at: number;
  season: string;
}

export interface BeachheadSiteName {
  siteKey: string;
  /** Full display name: "Drakkar's Stand" or "Beachhead Kestrel". */
  name: string;
  /** The epithet after the name: "Landing" | "Stand" | "Fall" | custom. */
  epithet: string;
  honoredColonyId: string | null;
  honoredColonyName: string | null;
  /** Biggest battle weight recorded at this site. */
  recordWeight: number;
  recordBattleId: string | null;
  namedAt: number | null;
  season: string | null;
  /** The honored player has used their one epithet rename. */
  epithetRenamed: boolean;
  baseDestroyedInRecord: boolean;
  /** Prior names, newest first — the Chronicle. */
  history: SiteNameRecord[];
}

export type BeachheadNameRegistry = Record<string, BeachheadSiteName>;

// ============================================================================
// §2 REGISTRY
// ============================================================================

export function emptyBeachheadNames(): BeachheadNameRegistry {
  return {};
}

/** Lazily ensure the registry exists (migration-safe for old saves). */
export function ensureBeachheadNames(state: GameState): BeachheadNameRegistry {
  const s = state as GameState & { beachheadNames?: BeachheadNameRegistry };
  if (!s.beachheadNames) s.beachheadNames = emptyBeachheadNames();
  return s.beachheadNames;
}

/** Deterministic phonetic designation for a fresh site (seeded by siteKey). */
export function phoneticForSite(siteKey: string): string {
  let h = 0;
  for (let i = 0; i < siteKey.length; i++) {
    h = (Math.imul(h, 31) + siteKey.charCodeAt(i)) | 0;
  }
  return PHONETIC[Math.abs(h) % PHONETIC.length];
}

/** A fresh, unnamed beachhead. */
export function freshSiteName(siteKey: string): BeachheadSiteName {
  return {
    siteKey,
    name: `Beachhead ${phoneticForSite(siteKey)}`,
    epithet: "",
    honoredColonyId: null,
    honoredColonyName: null,
    recordWeight: 0,
    recordBattleId: null,
    namedAt: null,
    season: null,
    epithetRenamed: false,
    baseDestroyedInRecord: false,
    history: [],
  };
}

/** Get (creating if needed) the site record for a key. */
export function siteFor(
  registry: BeachheadNameRegistry,
  siteKey: string,
): BeachheadSiteName {
  const key = siteKey.trim();
  if (!registry[key]) registry[key] = freshSiteName(key);
  return registry[key];
}

// ============================================================================
// §3 SCORING — biggest battle, biggest contributor
// ============================================================================

/** Total supply-weight committed, both sides combined. */
export function battleWeight(input: SiteBattleInput): number {
  return (
    Math.max(0, Math.floor(input.attacker.weightCommitted)) +
    Math.max(0, Math.floor(input.defender.weightCommitted))
  );
}

/** Contribution score: weight committed + 10 × kills. */
export function contributionScore(c: BeachheadContributor): number {
  return Math.max(0, Math.floor(c.weightCommitted)) + CONTRIBUTION_KILL_MULTIPLIER * Math.max(0, Math.floor(c.kills));
}

/** The honored player — highest contribution score. Ties go to the attacker
 *  (the one who jumped is the story's protagonist). */
export function biggestContributor(input: SiteBattleInput): BeachheadContributor {
  const a = contributionScore(input.attacker);
  const d = contributionScore(input.defender);
  return a >= d ? input.attacker : input.defender;
}

/** Epithet from the battle's outcome at the site (forward-base.md §9.1). */
export function epithetFor(input: SiteBattleInput): "Landing" | "Stand" | "Fall" {
  if (input.baseDestroyed) return "Fall";
  if (input.winner === "defender") return "Stand";
  if (input.winner === "attacker") return "Landing";
  // Standoff: the bigger contributor's side held the field.
  return biggestContributor(input).side === "defender" ? "Stand" : "Landing";
}

// ============================================================================
// §4 RECORDING — name/rename on the biggest battle
// ============================================================================

export interface RecordSiteBattleResult {
  /** True when this battle re-named the site (announce it). */
  renamed: boolean;
  site: BeachheadSiteName;
  /** World-speaker announcement line, present only when renamed. */
  announcement?: string;
  weight: number;
  honored: BeachheadContributor;
}

/**
 * Record a resolved battle at a forward-base site. If it's the biggest
 * battle at the site so far, the site is (re-)named for its biggest
 * contributor. Idempotent per battleId: re-recording the same battle is a
 * no-op. A bigger later battle re-names the site — history is rewritten by
 * bigger deeds.
 */
export function recordSiteBattle(
  registry: BeachheadNameRegistry,
  input: SiteBattleInput,
): RecordSiteBattleResult {
  const site = siteFor(registry, input.siteKey);
  const weight = battleWeight(input);
  const honored = biggestContributor(input);
  if (site.recordBattleId === input.battleId) {
    return { renamed: false, site, weight, honored };
  }
  // Must strictly exceed the record — ties keep the incumbent name.
  if (weight <= site.recordWeight) {
    return { renamed: false, site, weight, honored };
  }
  // Archive the outgoing name (if it was a real naming, not the phonetic).
  if (site.honoredColonyName) {
    site.history.unshift({
      battleId: site.recordBattleId ?? "",
      weight: site.recordWeight,
      name: site.name,
      honoredColonyName: site.honoredColonyName,
      at: site.namedAt ?? input.at,
      season: site.season ?? input.season,
    });
  }
  const epithet = epithetFor(input);
  const name = `${honored.colonyName}'s ${epithet}`;
  site.name = name;
  site.epithet = epithet;
  site.honoredColonyId = honored.colonyId;
  site.honoredColonyName = honored.colonyName;
  site.recordWeight = weight;
  site.recordBattleId = input.battleId;
  site.namedAt = input.at;
  site.season = input.season;
  site.epithetRenamed = false; // new honor, new rename token
  site.baseDestroyedInRecord = input.baseDestroyed;
  const announcement =
    `The beachhead at ${site.siteKey} is now ${name.toUpperCase()}.`;
  return { renamed: true, site, announcement, weight, honored };
}

// ============================================================================
// §5 EPITHET RENAME — the honored player's one rewrite
// ============================================================================

export interface RenameEpithetResult {
  ok: boolean;
  site?: BeachheadSiteName;
  error?: string;
}

function epithetClean(epithet: string): string | null {
  const t = epithet.trim().replace(/\s+/g, " ");
  if (t.length < 2 || t.length > 24) return null;
  if (!/^[A-Za-z][A-Za-z '\-]*$/.test(t)) return null;
  const lower = t.toLowerCase();
  if (BLOCKED_WORDS.some((w) => lower.includes(w))) return null;
  return t;
}

/**
 * The honored player may rename the epithet ONCE (free text, filtered).
 * Only the currently-honored colony may do it, and only once per naming.
 */
export function renameSiteEpithet(
  registry: BeachheadNameRegistry,
  siteKey: string,
  colonyId: string,
  newEpithet: string,
): RenameEpithetResult {
  const site = siteFor(registry, siteKey);
  if (!site.honoredColonyId) {
    return { ok: false, error: "This beachhead hasn't earned a name yet — win a battle here first." };
  }
  if (site.honoredColonyId !== colonyId) {
    return {
      ok: false,
      error: `Only ${site.honoredColonyName} — the honored commander — may rename this site.`,
    };
  }
  if (site.epithetRenamed) {
    return { ok: false, error: "The epithet has already been rewritten once — history is sealed." };
  }
  const clean = epithetClean(newEpithet);
  if (!clean) {
    return {
      ok: false,
      error: "That epithet won't fly — 2–24 letters, no profanity.",
    };
  }
  site.epithet = clean;
  site.name = `${site.honoredColonyName}'s ${clean}`;
  site.epithetRenamed = true;
  return { ok: true, site };
}

// ============================================================================
// §6 WORLD SPEAKER — the announcement line
// ============================================================================

/** Subject line for the server-wide naming announcement. */
export function namingAnnouncementSubject(site: BeachheadSiteName): string {
  return `📢 The beachhead at ${site.siteKey} is now ${site.name.toUpperCase()}`;
}

/** Body for the server-wide naming announcement. */
export function namingAnnouncementBody(
  site: BeachheadSiteName,
  input: SiteBattleInput,
  honored: BeachheadContributor,
): string {
  const side = honored.side === "attacker" ? "the attackers" : "the defenders";
  return [
    `By deed of arms, the beachhead at ${site.siteKey} bears a new name: ${site.name}.`,
    ``,
    `${honored.colonyName} of ${side} committed ${Math.floor(honored.weightCommitted)} weight and ${Math.floor(honored.kills)} kills — the greatest contribution in the site's bloodiest battle yet (${Math.floor(battleWeight(input))} total weight).`,
    ``,
    `The land remembers.`,
  ].join("\n");
}

// ============================================================================
// §7 STATE SEAM — record + announce in one call
// ============================================================================

export interface RecordSiteBattleOnStateResult extends RecordSiteBattleResult {
  /** True when a world-speaker announcement was mailed. */
  announced: boolean;
}

/**
 * Record a resolved battle at a forward-base site against the colony's
 * GameState: ensures the registry, records the battle, and — when the site
 * is (re-)named — broadcasts server-wide over the world speaker (mailbox
 * "announcement"). The names registry is NOT touched by season rollover;
 * names persist in the Chronicle across seasons.
 */
export function recordSiteBattleOnState(
  state: GameState,
  input: SiteBattleInput,
): RecordSiteBattleOnStateResult {
  const registry = ensureBeachheadNames(state);
  const result = recordSiteBattle(registry, input);
  let announced = false;
  if (result.renamed && result.announcement) {
    // World speaker: server-wide announcement.
    sendMail(state, {
      from: "system",
      subject: namingAnnouncementSubject(result.site),
      body: namingAnnouncementBody(result.site, input, result.honored),
      category: "announcement",
      sentAt: input.at,
      goTo: { tab: "world", label: "View world map" },
    });
    announced = true;
  }
  return { ...result, announced };
}
