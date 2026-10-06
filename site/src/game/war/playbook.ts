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
  type TroopRoster,
} from "./troops";
import {
  buildSceneFromPlaced,
  deploySeedFor,
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
};

export const PLAYBOOK: readonly Play[] = [mixedWedge, lineAdvance, shieldWall, hammerAnvil];

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
