// LEADER XP / LEVELING / SPECIALIZATION — the earned-progression layer.
//
// Owners-approved direction (2026-09-02): "give players choices and freedom to
// evolve the way they want" — progression is earned through play, never bought.
// Nothing here can be gated behind spending: XP comes only from real events,
// attribute points are allocated freely, and the Level-3 specialization is a
// one-time permanent choice among three paths, all balanced as sidegrades.
//
// XP curve: square-root, level = floor(sqrt(total_xp / K)), K = 50. Exact
// cumulative thresholds: L2=200, L3=450, L4=800, L5=1250, L6=1800, L7=2450,
// L8=3200, L9=4050, L10=5000. Cap at L10 for now.
import type { Leader } from "./types";

export const XP_K = 50; // curve constant: level = floor(sqrt(xp / XP_K))

/** Cumulative XP needed to REACH each level (index = level, 1-based; L1 = 0). */
export const LEVEL_XP: number[] = [
  0, // dummy index 0
  0, // L1
  200, // L2
  450, // L3 — specialization milestone
  800, // L4
  1250, // L5
  1800, // L6
  2450, // L7
  3200, // L8
  4050, // L9
  5000, // L10 (cap)
];

/** XP earned this game-day per Leader (soft cap: grinding research back-to-back
 *  is throttled so breadth of experience wins over spam). Server day key = UTC. */
export const DAILY_XP_CAP = 40;

export const MAX_LEVEL = 10;

/** Total XP a Leader needs to reach the given level (cumulative). */
export function xpForLevel(level: number): number {
  return LEVEL_XP[Math.max(1, Math.min(MAX_LEVEL, level))] ?? 0;
}

/** One-time mutually-exclusive specializations offered at Level 3. */
export type Specialization = "scholar" | "marshal" | "steward";

export const SPECIALIZATIONS: {
  id: Specialization;
  mandate: string; // in-fiction name
  icon: string;
  blurb: string;
  effects: string[];
  accent: string; // tailwind-ish hue on the card badge
}[] = [
  {
    id: "scholar",
    mandate: "Researcher's Mandate",
    icon: "🔬",
    blurb: "The seeker who turns answers into momentum. Their projects finish faster, and their insight sometimes becomes a breakthrough others would miss.",
    effects: ["+15% research speed on their projects", "+5% surprise-breakthrough chance"],
    accent: "border-purple-400/40 bg-purple-400/10 text-purple-200",
  },
  {
    id: "marshal",
    mandate: "Warden's Mandate",
    icon: "🛡️",
    blurb: "The warden who walks where the map ends. Their teams fight harder and the surprise encounters they survive hurt less.",
    effects: ["+10% combat effectiveness", "−20% surprise/survival damage severity on their missions"],
    accent: "border-red-400/40 bg-red-400/10 text-red-200",
  },
  {
    id: "steward",
    mandate: "Steward's Mandate",
    icon: "⚖️",
    blurb: "The caretaker who makes nothing go to waste. Their stead runs leaner: better yields, and cheaper crafting on their watch.",
    effects: ["+10% economy effectiveness (ember yield & supplies)", "−10% workshop crafting cost"],
    accent: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  },
];

export const SPECIALIZATION_BY_ID = Object.fromEntries(SPECIALIZATIONS.map((s) => [s.id, s])) as Record<
  Specialization,
  (typeof SPECIALIZATIONS)[number]
>;

export const SPECIALIZATION_MILESTONE = 3; // L3 opens the one-time choice

// ------- derived values -------

/** Current level from total XP (square-root curve, capped at L10). */
export function levelFromXp(xp: number): number {
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(Math.sqrt(Math.max(0, xp) / XP_K))));
}

/** XP remaining until the NEXT level (null at cap L10). */
export function xpToNextLevel(xp: number): number | null {
  const level = levelFromXp(xp);
  if (level >= MAX_LEVEL) return null;
  return xpForLevel(level + 1) - xp;
}

/** 0-1 progress into the current level, for the XP bar. */
export function levelProgress(xp: number): number {
  const level = levelFromXp(xp);
  if (level >= MAX_LEVEL) return 1;
  const cur = xpForLevel(level);
  const next = xpForLevel(level + 1);
  if (next <= cur) return 1;
  return Math.min(1, (xp - cur) / (next - cur));
}

/**
 * The running XP day-window for the daily cap, keyed by UTC date. Pure and
 * derivable, so legacy saves (without these fields) behave exactly like a
 * leader who earned nothing today — no migration needed, no staleness.
 */
export function xpDayKey(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

export function freshLeaderXpState(now: number): { xp: number; day: string; dayXp: number } {
  return { xp: 0, day: xpDayKey(now), dayXp: 0 };
}

/** Daily XP remaining for a leader given their rolling day-window. */
export function dailyXpRemaining(leader: Leader): number {
  const spent = typeof leader.dayXp === "number" ? leader.dayXp : 0;
  return Math.max(0, DAILY_XP_CAP - spent);
}

export function leaderLevel(leader: Leader): number {
  return levelFromXp(typeof leader.xp === "number" ? leader.xp : 0);
}