// BATTLE PLAYBOOK — the war room's plays (owner 2026-10-06).
//
// A play is a named formation with a SLOT LAYOUT: named slots, each mapped
// to a battle vector + staging position + entry timing. Deploying means:
// pick a play, LOAD TROOPS ONTO its slots from the real barracks roster,
// lock the formation down under a name — then it's one tap, every battle.
//
// Pure data model + logic. Scene building lives in deploy-loadout.ts
// (slotsToPlaced → buildSceneFromPlaced); persistence in engine/api.

import {
  TROOP_TYPES,
  label as troopLabel,
  type TroopRoster,
  type TroopTier,
  type TroopType,
} from "./troops";
import {
  buildSceneFromPlaced,
  deploySeedFor,
  DEPLOY_CAP,
  type DeploymentPick,
  type DeployOptions,
  type PlacedUnit,
  type ChorusGrade,
  DEFAULT_CHORUS_GRADE,
} from "./deploy-loadout";
import type { ManeuverVector } from "./war-types";
import type { SceneBattle } from "./battle-scene-model";

export type PlayCategory = "Offensive" | "Defensive" | "Mixed";

/** When a slot's troops enter the field. */
export type SlotEntry =
  | { kind: "start" } // touchdown wave, with everybody else
  | { kind: "delayed"; atS: number } // timed entry (siege drops, late waves)
  | { kind: "oncall"; atS: number }; // ON-CALL RESERVE — the raid leader commits
// it by hand when driving (hot drop); on auto it enters at atS.

export interface PlaySlot {
  id: string;
  name: string;
  vector: ManeuverVector;
  entry: SlotEntry;
  /** diagram position 0..1 in play space — south (player's edge) at bottom */
  dx: number;
  dy: number;
}

export type PlayShape = "wedge" | "line" | "wall" | "custom";

export interface Play {
  id: string;
  name: string;
  category: PlayCategory;
  /** leader level that unlocks this play — L1 sees the generics */
  minLeaderLevel: number;
  blurb: string;
  shape: PlayShape;
  slots: PlaySlot[];
  /** The commander's recommended troop assignment for this play — what
   *  auto-loads for players who haven't learned to build yet (owner
   *  2026-10-06: most players run these until customs start working). */
  suggested: SuggestedSlotLoad[];
}

// ============================================================================
// SUGGESTED LOADS (owner 2026-10-06) — every play ships with a recommended
// troop assignment sized for a ~80–100-unit mid-game force. `autoloadSuggested`
// fills it from the player's REAL roster: never over-owned, never over the
// 100-unit field cap, scales down proportionally for small rosters
// (frontline/wedge slots first) and reports exactly what's missing — never
// silently. Compositions obey doctrine: siege sits rear with Warden escort
// weight (the escort warning stays quiet), Longeyes cover the middle,
// reserves stay on-call.
// ============================================================================

export interface SuggestedItem {
  type: TroopType;
  count: number;
}

export interface SuggestedSlotLoad {
  slotId: string;
  /** Fill priority when troops run short — lower fills first. */
  rank: number;
  /** Prime slots (wedge / frontline / the siege point) draw the highest
   *  tiers first; support slots take lowest tiers first. */
  prime?: boolean;
  items: SuggestedItem[];
}

const S = (
  id: string,
  name: string,
  vector: ManeuverVector,
  entry: SlotEntry,
  dx: number,
  dy: number,
): PlaySlot => ({ id, name, vector, entry, dx, dy });

/** Mixed Wedge (owner 2026-10-06, his spec): the wedge punches — Reavers
 *  and Bulwarks in the teeth of it, Longeyes in the middle working over
 *  whatever the wedge cracks open, Bulwarks refusing both flanks, Thunders
 *  staged rear for the delayed siege drop, Reavers + Bulwarks held as the
 *  on-call reserve. */
const mixedWedge: Play = {
  id: "mixed-wedge",
  name: "Mixed Wedge",
  category: "Mixed",
  minLeaderLevel: 1,
  blurb:
    "Hans's wedge — Reavers and Bulwarks in the teeth, Longeyes in the middle, Bulwarks on both flanks, Thunder staged rear, reserve on call.",
  shape: "wedge",
  slots: [
    S("wedge", "Wedge", "MAIN", { kind: "start" }, 0.5, 0.42),
    S("middle", "Middle", "MAIN", { kind: "start" }, 0.5, 0.62),
    S("flank-l", "Left Flank", "FLANK_LEFT", { kind: "start" }, 0.18, 0.55),
    S("flank-r", "Right Flank", "FLANK_RIGHT", { kind: "start" }, 0.82, 0.55),
    S("rear", "Rear", "REAR", { kind: "delayed", atS: 300 }, 0.5, 0.8),
    S("reserve", "Reserve", "RESERVE", { kind: "oncall", atS: 240 }, 0.5, 0.94),
  ],
  // Teeth first: Reavers + Bulwarks punch, Bulwarks refuse the flanks,
  // Longeyes work the middle, escorted Thunder drops late, fist on call.
  suggested: [
    { slotId: "wedge", rank: 0, prime: true, items: [{ type: "reaver", count: 16 }, { type: "bulwark", count: 12 }] },
    { slotId: "flank-l", rank: 1, prime: true, items: [{ type: "bulwark", count: 10 }, { type: "warden", count: 2 }] },
    { slotId: "flank-r", rank: 1, prime: true, items: [{ type: "bulwark", count: 10 }, { type: "warden", count: 2 }] },
    { slotId: "middle", rank: 2, items: [{ type: "longeye", count: 12 }, { type: "warden", count: 4 }] },
    { slotId: "rear", rank: 3, prime: true, items: [{ type: "thunder", count: 6 }, { type: "warden", count: 4 }] },
    { slotId: "reserve", rank: 4, items: [{ type: "reaver", count: 8 }, { type: "bulwark", count: 6 }] },
  ],
};

/** Line Advance (Offensive, L1 generic): the plain honest attack — Bulwarks
 *  up front in two lines, Longeyes + Reavers working the second, Thunder
 *  walking up behind, a fist held in reserve. */
const lineAdvance: Play = {
  id: "line-advance",
  name: "Line Advance",
  category: "Offensive",
  minLeaderLevel: 1,
  blurb: "The plain honest attack — two Bulwark lines forward, support behind, siege walking up, a fist in reserve.",
  shape: "line",
  slots: [
    S("front", "Front Line", "MAIN", { kind: "start" }, 0.5, 0.4),
    S("second", "Second Line", "MAIN", { kind: "start" }, 0.5, 0.58),
    S("flank-l", "Left Flank", "FLANK_LEFT", { kind: "start" }, 0.18, 0.52),
    S("flank-r", "Right Flank", "FLANK_RIGHT", { kind: "start" }, 0.82, 0.52),
    S("rear", "Rear", "REAR", { kind: "delayed", atS: 300 }, 0.5, 0.8),
    S("reserve", "Reserve", "RESERVE", { kind: "oncall", atS: 240 }, 0.5, 0.94),
  ],
  // A wall of Bulwarks walks forward, Reavers + Longeyes work behind it,
  // escorted Thunder walks up, small fist on call.
  suggested: [
    { slotId: "front", rank: 0, prime: true, items: [{ type: "bulwark", count: 24 }] },
    { slotId: "flank-l", rank: 1, prime: true, items: [{ type: "bulwark", count: 8 }, { type: "reaver", count: 4 }] },
    { slotId: "flank-r", rank: 1, prime: true, items: [{ type: "bulwark", count: 8 }, { type: "reaver", count: 4 }] },
    { slotId: "second", rank: 2, items: [{ type: "reaver", count: 12 }, { type: "longeye", count: 10 }, { type: "warden", count: 2 }] },
    { slotId: "rear", rank: 3, prime: true, items: [{ type: "thunder", count: 5 }, { type: "warden", count: 4 }] },
    { slotId: "reserve", rank: 4, items: [{ type: "reaver", count: 6 }, { type: "bulwark", count: 4 }] },
  ],
};

/** Shield Wall (Defensive, L1 generic): for when the other guy is coming to
 *  you — deep Bulwark lines, Longeyes behind the shields, Wardens screening,
 *  everything else held. */
const shieldWall: Play = {
  id: "shield-wall",
  name: "Shield Wall",
  category: "Defensive",
  minLeaderLevel: 1,
  blurb: "Dig in — deep Bulwark lines, Longeyes behind the shields, Warden screen, reserve held for the break.",
  shape: "wall",
  slots: [
    S("wall-1", "Outer Wall", "MAIN", { kind: "start" }, 0.5, 0.38),
    S("wall-2", "Inner Wall", "MAIN", { kind: "start" }, 0.5, 0.56),
    S("screen-l", "Left Screen", "FLANK_LEFT", { kind: "start" }, 0.18, 0.5),
    S("screen-r", "Right Screen", "FLANK_RIGHT", { kind: "start" }, 0.82, 0.5),
    S("support", "Support", "REAR", { kind: "start" }, 0.5, 0.74),
    S("reserve", "Reserve", "RESERVE", { kind: "oncall", atS: 240 }, 0.5, 0.94),
  ],
  // Deep Bulwark walls, Longeyes shooting over the shields, Warden screens
  // on the wings, a counter-battery tucked behind, relief held back.
  suggested: [
    { slotId: "wall-1", rank: 0, prime: true, items: [{ type: "bulwark", count: 22 }, { type: "warden", count: 4 }] },
    { slotId: "wall-2", rank: 1, items: [{ type: "bulwark", count: 14 }, { type: "longeye", count: 10 }] },
    { slotId: "screen-l", rank: 2, items: [{ type: "warden", count: 6 }, { type: "bulwark", count: 4 }] },
    { slotId: "screen-r", rank: 2, items: [{ type: "warden", count: 6 }, { type: "bulwark", count: 4 }] },
    { slotId: "support", rank: 3, items: [{ type: "longeye", count: 6 }, { type: "warden", count: 4 }, { type: "thunder", count: 2 }] },
    { slotId: "reserve", rank: 4, items: [{ type: "bulwark", count: 6 }, { type: "reaver", count: 6 }] },
  ],
};

/** Hammer & Anvil (Offensive, L3): the main line pins, the heavy flank
 *  hammer swings late and wraps — for leaders who've earned the timing. */
const hammerAnvil: Play = {
  id: "hammer-anvil",
  name: "Hammer & Anvil",
  category: "Offensive",
  minLeaderLevel: 3,
  blurb: "Pin with the main line, swing the heavy flank late and wrap. Timing is everything — for proven leaders.",
  shape: "line",
  slots: [
    S("anvil", "Anvil", "MAIN", { kind: "start" }, 0.5, 0.44),
    S("second", "Second Line", "MAIN", { kind: "start" }, 0.5, 0.62),
    S("hammer", "Hammer", "FLANK_RIGHT", { kind: "delayed", atS: 150 }, 0.82, 0.6),
    S("screen-l", "Left Screen", "FLANK_LEFT", { kind: "start" }, 0.18, 0.55),
    S("rear", "Rear", "REAR", { kind: "delayed", atS: 300 }, 0.5, 0.8),
    S("reserve", "Reserve", "RESERVE", { kind: "oncall", atS: 240 }, 0.5, 0.94),
  ],
  // The anvil pins and takes the hit; the hammer — Reavers with a Bulwark
  // spine — swings in late off the right; Thunder cracks what's pinned.
  suggested: [
    { slotId: "hammer", rank: 0, prime: true, items: [{ type: "reaver", count: 18 }, { type: "bulwark", count: 6 }] },
    { slotId: "anvil", rank: 1, prime: true, items: [{ type: "bulwark", count: 20 }, { type: "longeye", count: 6 }] },
    { slotId: "screen-l", rank: 2, items: [{ type: "bulwark", count: 8 }, { type: "warden", count: 2 }] },
    { slotId: "second", rank: 3, items: [{ type: "longeye", count: 10 }, { type: "reaver", count: 6 }, { type: "warden", count: 2 }] },
    { slotId: "rear", rank: 4, prime: true, items: [{ type: "thunder", count: 6 }, { type: "warden", count: 5 }] },
    { slotId: "reserve", rank: 5, items: [{ type: "reaver", count: 6 }, { type: "bulwark", count: 4 }] },
  ],
};

/** Pincer (Offensive, L2): a light anvil pins the center while both horns
 *  drop late and close from the wings — the enemy has to face three ways. */
const pincer: Play = {
  id: "pincer",
  name: "Pincer",
  category: "Offensive",
  minLeaderLevel: 2,
  blurb: "Pin the center light, drop both horns late and close the jaws. Needs timing — and Reavers to burn.",
  shape: "custom",
  slots: [
    S("horn-l", "Left Horn", "FLANK_LEFT", { kind: "delayed", atS: 120 }, 0.14, 0.34),
    S("horn-r", "Right Horn", "FLANK_RIGHT", { kind: "delayed", atS: 120 }, 0.86, 0.34),
    S("anvil", "Anvil", "MAIN", { kind: "start" }, 0.5, 0.52),
    S("rear", "Rear", "REAR", { kind: "delayed", atS: 300 }, 0.5, 0.78),
    S("reserve", "Reserve", "RESERVE", { kind: "oncall", atS: 240 }, 0.5, 0.94),
  ],
  // The horns ARE the play — they fill first and take the best tiers.
  // Escorted Thunder works the pinned center from the rear.
  suggested: [
    { slotId: "horn-l", rank: 0, prime: true, items: [{ type: "reaver", count: 14 }, { type: "bulwark", count: 6 }] },
    { slotId: "horn-r", rank: 0, prime: true, items: [{ type: "reaver", count: 14 }, { type: "bulwark", count: 6 }] },
    { slotId: "anvil", rank: 1, prime: true, items: [{ type: "bulwark", count: 16 }, { type: "longeye", count: 6 }] },
    { slotId: "rear", rank: 2, prime: true, items: [{ type: "thunder", count: 5 }, { type: "longeye", count: 4 }, { type: "warden", count: 6 }] },
    { slotId: "reserve", rank: 3, items: [{ type: "reaver", count: 6 }, { type: "bulwark", count: 6 }] },
  ],
};

/** Redoubt (Defensive, L2): the Shield Wall grown teeth — deeper walls,
 *  Warden screens, and a real counter-battery behind the shields. */
const redoubt: Play = {
  id: "redoubt",
  name: "Redoubt",
  category: "Defensive",
  minLeaderLevel: 2,
  blurb: "Dig in deeper — twin Bulwark walls, Warden screens, and a counter-battery that answers their siege.",
  shape: "wall",
  slots: [
    S("wall-1", "Outer Wall", "MAIN", { kind: "start" }, 0.5, 0.36),
    S("wall-2", "Inner Wall", "MAIN", { kind: "start" }, 0.5, 0.54),
    S("screen-l", "Left Screen", "FLANK_LEFT", { kind: "start" }, 0.16, 0.48),
    S("screen-r", "Right Screen", "FLANK_RIGHT", { kind: "start" }, 0.84, 0.48),
    S("battery", "Rear Battery", "REAR", { kind: "start" }, 0.5, 0.74),
    S("reserve", "Reserve", "RESERVE", { kind: "oncall", atS: 240 }, 0.5, 0.94),
  ],
  suggested: [
    { slotId: "wall-1", rank: 0, prime: true, items: [{ type: "bulwark", count: 24 }, { type: "warden", count: 4 }] },
    { slotId: "wall-2", rank: 1, items: [{ type: "bulwark", count: 12 }, { type: "longeye", count: 12 }] },
    { slotId: "screen-l", rank: 2, items: [{ type: "warden", count: 6 }, { type: "bulwark", count: 4 }] },
    { slotId: "screen-r", rank: 2, items: [{ type: "warden", count: 6 }, { type: "bulwark", count: 4 }] },
    { slotId: "battery", rank: 3, prime: true, items: [{ type: "thunder", count: 4 }, { type: "longeye", count: 6 }, { type: "warden", count: 4 }] },
    { slotId: "reserve", rank: 4, items: [{ type: "bulwark", count: 8 }, { type: "reaver", count: 4 }] },
  ],
};

export const PLAYBOOK: readonly Play[] = [mixedWedge, lineAdvance, pincer, shieldWall, redoubt, hammerAnvil];

export function playById(id: string): Play | undefined {
  return PLAYBOOK.find((p) => p.id === id);
}

export interface PlayAccess {
  play: Play;
  locked: boolean;
  requiredLevel: number;
}

/** Plays with the leader's access resolved — locked plays stay visible with
 *  their requirement (nothing-without-a-button). */
export function playsForLevel(level: number): PlayAccess[] {
  return PLAYBOOK.map((play) => ({
    play,
    locked: level < play.minLeaderLevel,
    requiredLevel: play.minLeaderLevel,
  }));
}

/** Total headcount of a play's suggested load. */
export function suggestedTotal(play: Play): number {
  return play.suggested.reduce((n, s) => n + s.items.reduce((m, i) => m + i.count, 0), 0);
}

/** Suggested load composition by type (card summaries, deficit math). */
export function suggestedComposition(play: Play): { total: number; byType: Record<TroopType, number> } {
  const byType: Record<TroopType, number> = { bulwark: 0, reaver: 0, longeye: 0, thunder: 0, warden: 0 };
  let total = 0;
  for (const s of play.suggested)
    for (const i of s.items) {
      byType[i.type] += i.count;
      total += i.count;
    }
  return { total, byType };
}

/** One unmet piece of a suggested load: this slot wants `missing` more of a
 *  type than the roster could give it. */
export interface SlotDeficit {
  slotId: string;
  slotName: string;
  type: TroopType;
  missing: number;
}

export interface AutoloadResult {
  loads: SlotLoads;
  suggestedTotal: number;
  loadedTotal: number;
  /** True when the roster couldn't field the suggestion as written. */
  scaled: boolean;
  deficits: SlotDeficit[];
}

const TIER_HIGH_FIRST: readonly TroopTier[] = [4, 3, 2, 1];
const TIER_LOW_FIRST: readonly TroopTier[] = [1, 2, 3, 4];

/**
 * Fill a play's suggested load from the real roster. Pure and deterministic.
 *
 *   • Never exceeds owned type×tier counts; never exceeds DEPLOY_CAP total.
 *   • Small rosters scale proportionally (each item shrinks by the roster's
 *     coverage of the suggestion), slots filled in rank order — the
 *     frontline/wedge gets first claim, then a top-up pass walks the same
 *     order spending what's left toward the full suggestion.
 *   • Prime slots draw the highest tiers first; support slots the lowest.
 *   • Deficits name every shortfall per slot ("Wedge: need +12 Bulwarks") —
 *     an under-filled suggestion is always surfaced, never silent.
 */
export function autoloadSuggested(play: Play, roster: TroopRoster): AutoloadResult {
  const slotById = new Map(play.slots.map((s) => [s.id, s]));
  const ownedLeft = new Map<string, number>();
  let ownedTotal = 0;
  for (const c of roster.cohorts) {
    const k = `${c.type}:${c.tier}`;
    ownedLeft.set(k, (ownedLeft.get(k) ?? 0) + Math.max(0, Math.trunc(c.count)));
    ownedTotal += Math.max(0, Math.trunc(c.count));
  }
  const sugTotal = suggestedTotal(play);
  const scale = sugTotal > 0 ? Math.min(1, ownedTotal / sugTotal) : 1;
  const ordered = [...play.suggested].sort((a, b) => a.rank - b.rank);
  const loads: SlotLoads = {};
  const got = new Map<string, number>(); // `${slotId}:${type}` -> allocated
  let capLeft = DEPLOY_CAP;

  const draw = (s: SuggestedSlotLoad, type: TroopType, wantN: number): number => {
    let need = Math.max(0, Math.trunc(wantN));
    let taken = 0;
    if (need <= 0 || capLeft <= 0) return 0;
    const picks: DeploymentPick[] = [...(loads[s.slotId] ?? [])];
    for (const tier of s.prime ? TIER_HIGH_FIRST : TIER_LOW_FIRST) {
      if (need <= 0 || capLeft <= 0) break;
      const k = `${type}:${tier}`;
      const n = Math.min(ownedLeft.get(k) ?? 0, capLeft, need);
      if (n <= 0) continue;
      ownedLeft.set(k, (ownedLeft.get(k) ?? 0) - n);
      capLeft -= n;
      need -= n;
      taken += n;
      const existing = picks.find((p) => p.type === type && p.tier === tier);
      if (existing) existing.count += n;
      else picks.push({ type, tier, count: n });
    }
    if (taken > 0) loads[s.slotId] = picks;
    return taken;
  };

  // Phase A — proportional fill, frontline first.
  for (const s of ordered) {
    for (const it of s.items) {
      const key = `${s.slotId}:${it.type}`;
      const wantN = Math.floor(it.count * scale);
      got.set(key, (got.get(key) ?? 0) + draw(s, it.type, wantN));
    }
  }
  // Phase B — top-up toward the full suggestion, same rank order, spending
  // whatever the roster still holds (a roster rich in one type fields the
  // front at full strength even when the support types run short).
  for (const s of ordered) {
    for (const it of s.items) {
      const key = `${s.slotId}:${it.type}`;
      const have = got.get(key) ?? 0;
      if (have >= it.count) continue;
      got.set(key, have + draw(s, it.type, it.count - have));
    }
  }

  const deficits: SlotDeficit[] = [];
  for (const s of play.suggested) {
    for (const it of s.items) {
      const missing = it.count - (got.get(`${s.slotId}:${it.type}`) ?? 0);
      if (missing > 0) {
        deficits.push({
          slotId: s.slotId,
          slotName: slotById.get(s.slotId)?.name ?? s.slotId,
          type: it.type,
          missing,
        });
      }
    }
  }
  const loadedTotal = Object.values(loads).reduce(
    (n, picks) => n + picks.reduce((m, p) => m + p.count, 0),
    0,
  );
  return {
    loads,
    suggestedTotal: sugTotal,
    loadedTotal,
    scaled: loadedTotal < sugTotal,
    deficits,
  };
}

/** "need +12 Bulwarks, +6 Thunders" — deficits aggregated by type, biggest
 *  first. Empty string when the suggestion fielded in full. */
export function deficitHeadline(deficits: SlotDeficit[], maxTypes = 3): string {
  const byType = new Map<TroopType, number>();
  for (const d of deficits) byType.set(d.type, (byType.get(d.type) ?? 0) + d.missing);
  const parts = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTypes)
    .map(([t, n]) => `+${n} ${troopLabel(t)}${n === 1 ? "" : "s"}`);
  return parts.length > 0 ? `need ${parts.join(", ")}` : "";
}

/** The one-tap deployable formation for a play's suggested load, filled from
 *  the player's current roster. `locked: false` — it is NOT a war-room
 *  formation; it only becomes one through "Save in war room". */
export function suggestedFormation(play: Play, roster: TroopRoster, now: number): SavedFormation {
  const { loads } = autoloadSuggested(play, roster);
  return {
    id: `suggested-${play.id}`,
    name: `${play.name} — Suggested`,
    playId: play.id,
    locked: false,
    loads,
    createdAt: now,
    updatedAt: now,
  };
}

/** Troops loaded into slots: slotId -> picks. */
export type SlotLoads = Record<string, DeploymentPick[]>;

/** A locked-down (or in-progress) formation: the play plus what's loaded
 *  into every slot. playId "custom" = built from blank. */
export interface SavedFormation {
  id: string;
  name: string;
  playId: string;
  /** locked-down formations are the only ones selectable on deploy */
  locked: boolean;
  loads: SlotLoads;
  /** custom/renamed slot metadata: slotId -> overrides */
  slotMeta?: Record<string, { name?: string; vector?: ManeuverVector; entry?: SlotEntry; dx?: number; dy?: number }> & { __slots?: PlaySlot[] };
  createdAt: number;
  updatedAt: number;
}

export interface WarRoomState {
  formations: SavedFormation[];
  seq: number;
}

export function emptyWarRoomState(): WarRoomState {
  return { formations: [], seq: 1 };
}

/** Effective slots for a formation: the play's slots with custom overrides
 *  applied (renames, re-vectors, re-timings). Custom formations carry their
 *  own slot list in slotMeta.__slots. */
export function formationSlots(f: SavedFormation): PlaySlot[] {
  const custom = f.slotMeta?.__slots as PlaySlot[] | undefined;
  if (f.playId === "custom" && custom) return custom;
  const play = playById(f.playId);
  const base = play ? play.slots : [];
  if (!f.slotMeta) return base;
  return base.map((s) => {
    const m = f.slotMeta![s.id];
    if (!m) return s;
    return {
      ...s,
      name: m.name ?? s.name,
      vector: m.vector ?? s.vector,
      entry: m.entry ?? s.entry,
      dx: m.dx ?? s.dx,
      dy: m.dy ?? s.dy,
    };
  });
}

/** Default slot set for a from-blank custom formation. */
export function blankSlots(): PlaySlot[] {
  return [
    S("front", "Front", "MAIN", { kind: "start" }, 0.5, 0.42),
    S("second", "Second", "MAIN", { kind: "start" }, 0.5, 0.6),
    S("flank-l", "Left Flank", "FLANK_LEFT", { kind: "start" }, 0.18, 0.55),
    S("flank-r", "Right Flank", "FLANK_RIGHT", { kind: "start" }, 0.82, 0.55),
    S("rear", "Rear", "REAR", { kind: "delayed", atS: 300 }, 0.5, 0.8),
    S("reserve", "Reserve", "RESERVE", { kind: "oncall", atS: 240 }, 0.5, 0.94),
  ];
}

export function formationPicks(f: SavedFormation): DeploymentPick[] {
  const out: DeploymentPick[] = [];
  for (const picks of Object.values(f.loads)) out.push(...picks);
  return out;
}

export function formationCount(f: SavedFormation): number {
  return formationPicks(f).reduce((n, p) => n + Math.max(0, Math.trunc(p.count)), 0);
}

/** Validate slot loads against the real roster: every pick must fit what
 *  Hans owns (per type×tier, across all slots combined). Pure. */
export function validateLoads(loads: SlotLoads, roster: TroopRoster): string[] {
  const errors: string[] = [];
  const owned = new Map<string, number>();
  for (const c of roster.cohorts) {
    const k = `${c.type}:${c.tier}`;
    owned.set(k, (owned.get(k) ?? 0) + c.count);
  }
  const used = new Map<string, number>();
  for (const [slotId, picks] of Object.entries(loads)) {
    for (const p of picks) {
      if (!TROOP_TYPES.includes(p.type)) {
        errors.push(`Slot ${slotId}: unknown troop type.`);
        continue;
      }
      const n = Math.trunc(p.count);
      if (n < 0) errors.push(`Slot ${slotId}: negative count.`);
      if (n > 0) used.set(`${p.type}:${p.tier}`, (used.get(`${p.type}:${p.tier}`) ?? 0) + n);
    }
  }
  for (const [k, n] of used) {
    const have = owned.get(k) ?? 0;
    if (n > have) errors.push(`Over roster: ${k} loads ${n}, owns ${have}.`);
  }
  return errors;
}

/** Clamp slot loads to the roster (deploy-time safety): drops empties. */
export function clampLoadsToRoster(loads: SlotLoads, roster: TroopRoster): SlotLoads {
  const owned = new Map<string, number>();
  for (const c of roster.cohorts) {
    const k = `${c.type}:${c.tier}`;
    owned.set(k, (owned.get(k) ?? 0) + c.count);
  }
  const out: SlotLoads = {};
  for (const [slotId, picks] of Object.entries(loads)) {
    const kept = picks
      .map((p) => {
        const k = `${p.type}:${p.tier}`;
        const take = Math.max(0, Math.min(Math.trunc(p.count), owned.get(k) ?? 0));
        owned.set(k, (owned.get(k) ?? 0) - take);
        return take > 0 ? { ...p, count: take } : null;
      })
      .filter((p): p is DeploymentPick => p !== null);
    if (kept.length > 0) out[slotId] = kept;
  }
  return out;
}

/** Human entry-timing label for badges and lists. */
export function entryLabel(e: SlotEntry): string {
  if (e.kind === "start") return "T+0";
  if (e.kind === "delayed") return `T+${e.atS}s`;
  return `on-call · auto T+${e.atS}s`;
}

/** Suggested name when locking down — play name + date (owner: pre-fill). */
export function suggestedFormationName(playId: string, now: number): string {
  const play = playById(playId);
  const base = play ? play.name : "Custom";
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${base} ${mm}/${dd}`;
}

/** Expand a formation's slot loads into placed units: each slot's troops
 *  take the slot's vector and entry timing. On-call slots ride as on-call
 *  reserves — the raid leader commits them by hand (hot drop) when driving
 *  manually; on auto they enter at their preset time. */
export function slotsToPlaced(f: SavedFormation): PlacedUnit[] {
  const slots = formationSlots(f);
  const byId = new Map(slots.map((s) => [s.id, s]));
  const placed: PlacedUnit[] = [];
  for (const [slotId, picks] of Object.entries(f.loads)) {
    const slot = byId.get(slotId);
    if (!slot) continue; // stale slot — skip, never crash a deploy
    const entry = slot.entry;
    const enterAtS = entry.kind === "start" ? 30 : entry.atS;
    for (const p of picks) {
      const n = Math.max(0, Math.trunc(p.count));
      for (let i = 0; i < n; i++) {
        placed.push({
          type: p.type,
          tier: p.tier,
          vector: slot.vector,
          enterAtS,
          onCall: entry.kind === "oncall" ? true : undefined,
        });
      }
    }
  }
  return placed;
}

/** Build a bloodless practice battle from a locked-down formation. Pure —
 *  the roster is never touched. The seed derives from the loads so the same
 *  formation always musters the same field. */
export function buildFormationScene(
  f: SavedFormation,
  opts: DeployOptions,
  grade?: ChorusGrade,
): SceneBattle {
  const placed = slotsToPlaced(f);
  const total = placed.length;
  const seed = opts.seed ?? deploySeedFor(formationPicks(f));
  return buildSceneFromPlaced(placed, total, seed, grade ?? DEFAULT_CHORUS_GRADE, opts);
}
