// squad-command — the commander's quick-pick domain (owner 2026-10-12).
//
// Hans: battles are commanded through squad panels, never by tapping
// troops on the ground. Tap a squad → quick-pick:
//   FIRE CONTROL: Stop Fire / Hold Fire / Cease Fire / Weapons Free / Bombard
//   MOVE: tap radar destination → squad moves there
//   COVER: assign the squad to cover another (e.g. squad 2 covers squad 3)
//   HOLD: move to position and hold — only fire when the enemy enters
//         weapon range.
// After the scout flyby, the ENEMY FORCES window lists enemy composition
// per squad; tap an enemy unit → Pressure / Target → pick your squads.
// Linked squads carry a bullseye marker. Unlinked squads follow the war
// room formation by default, or cover a linked squad in manual mode.

/** Fire discipline per squad. "free" is the default — weapons live. */
export type SquadFireMode = "stop" | "hold" | "cease" | "free" | "bombard";

export const FIRE_MODES: {
  id: SquadFireMode;
  label: string;
  glyph: string;
  desc: string;
}[] = [
  { id: "stop", label: "Stop Fire", glyph: "⛔", desc: "All weapons silent — immediately" },
  { id: "hold", label: "Hold Fire", glyph: "🔇", desc: "Hold fire until ordered otherwise" },
  { id: "cease", label: "Cease Fire", glyph: "✋", desc: "Cease fire — standing order" },
  { id: "free", label: "Weapons Free", glyph: "🔥", desc: "Engage any target in range" },
  { id: "bombard", label: "Bombard", glyph: "💥", desc: "Maximum fire — everything, now" },
];

export function fireModeLabel(id: SquadFireMode): string {
  return FIRE_MODES.find((m) => m.id === id)?.label ?? "Weapons Free";
}

export function fireModeGlyph(id: SquadFireMode): string {
  return FIRE_MODES.find((m) => m.id === id)?.glyph ?? "🔥";
}

/**
 * Design-default weapon ranges in meters (owner 2026-10-12). Hold-fire
 * respects range: a holding squad only fires when the enemy is inside its
 * longest weapon's reach. Tune freely — the UI reads this table.
 */
export const WEAPON_RANGE_M: Record<string, number> = {
  bulwark: 90, // chain guns
  reaver: 150, // assault rifles
  longeye: 400, // long rifles
  thunder: 900, // siege cannons
  warden: 120, // emitters
  turret: 350,
  dropship: 200,
};

/** Longest weapon reach across the squad's troop kinds. */
export function squadWeaponRangeM(kinds: string[]): number {
  let r = 0;
  for (const k of kinds) r = Math.max(r, WEAPON_RANGE_M[k] ?? 100);
  return r;
}

/**
 * One enemy UNIT's intel row (owner 2026-10-13, itemized targeting).
 * Published per living unit by the scene once the scout reveals the
 * enemy. `distM` = meters to the nearest living friendly unit — the
 * range read a commander aims with.
 */
export interface EnemyUnitIntel {
  id: string;
  /** troop class key (warden, bulwark, reaver, longeye, thunder) */
  kind: string;
  /** the enemy squad this unit belongs to */
  squadId: string;
  /** living health, 0..1 */
  hp01: number;
  /** meters to the nearest living friendly unit */
  distM: number;
  /** the force's leader/hero, when it fields one — pinned atop the list */
  leader?: boolean;
  /** the leader's name, when the force fields one */
  name?: string;
}

/** The cover-supplier facts the picker reads off a squad summary. */
export interface CoverCandidateFacts {
  alive: number;
  /** still embarked in staging — not on the field yet */
  onCallReserve?: boolean;
  /** carries siege guns (thunder) */
  hasThunders?: boolean;
}

/**
 * Can this squad supply cover for another? (owner 2026-10-13, the cover
 * picker). Returns null when it can — or the reason it can't, which the
 * picker SHOWS on the disabled row (never silently absent):
 *   out of action · still in staging · siege (siege holds its ground and
 *   never repositions — the maneuver-legality maxims).
 * A squad already covering the requester is eligible (tapping releases).
 */
export function coverIneligibility(
  candidate: CoverCandidateFacts,
  isCurrentSupplier: boolean,
): string | null {
  if (isCurrentSupplier) return null;
  if (candidate.alive <= 0) return "Out of action";
  if (candidate.onCallReserve) return "Still in staging — not on the field yet";
  if (candidate.hasThunders) return "Siege — holds its ground, can't reposition to cover";
  return null;
}

/** One enemy squad as revealed by the scout flyby. */
export interface EnemySquadIntel {
  id: string;
  /** display name, e.g. "Logistics Train" */
  name: string;
  /** primary troop kind label, e.g. "wardens" */
  kindLabel: string;
  /** "120 Wardens, 80 Reavers" */
  composition: string;
  headcount: number;
  morale: number;
  /** friendly squad ids currently pressuring / targeting this unit */
  targetedBy: string[];
}

export interface DefenderUnitLite {
  squadId: string;
  kind: string;
  alive: boolean;
  morale?: number;
}

/**
 * Build intel rows from defender units, grouped by squad. Pure — safe for
 * replays and tests.
 */
export function buildEnemyIntel(units: DefenderUnitLite[]): EnemySquadIntel[] {
  const bySquad = new Map<string, DefenderUnitLite[]>();
  for (const u of units) {
    const list = bySquad.get(u.squadId) ?? [];
    list.push(u);
    bySquad.set(u.squadId, list);
  }
  const rows: EnemySquadIntel[] = [];
  for (const [squadId, list] of bySquad) {
    const alive = list.filter((u) => u.alive);
    if (alive.length === 0) continue;
    const counts = new Map<string, number>();
    for (const u of alive) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1);
    const parts = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
    const morale =
      list.reduce((s, u) => s + (u.morale ?? 60), 0) / Math.max(1, list.length);
    rows.push({
      id: squadId,
      name: squadIntelName(squadId, top),
      kindLabel: top,
      composition: parts.join(", "),
      headcount: alive.length,
      morale: Math.round(morale),
      targetedBy: [],
    });
  }
  return rows.sort((a, b) => b.headcount - a.headcount);
}

/** Friendly display name for an enemy squad from its id + dominant kind. */
export function squadIntelName(squadId: string, topKind: string): string {
  const k = topKind.toLowerCase();
  if (k.includes("warden")) return "Warden Line";
  if (k.includes("thunder")) return "Siege Battery";
  if (k.includes("longeye")) return "Longeye Screen";
  if (k.includes("reaver")) return "Reaver Pack";
  if (k.includes("bulwark")) return "Bulwark Wall";
  return `Enemy ${squadId}`;
}

/** Demo intel for UI QA when no live scout data exists yet. */
export const DEMO_ENEMY_INTEL: EnemySquadIntel[] = [
  { id: "e-logi", name: "Logistics Train", kindLabel: "wardens", composition: "60 Wardens, 40 Bulwarks", headcount: 100, morale: 55, targetedBy: [] },
  { id: "e-ward", name: "Warden Line", kindLabel: "wardens", composition: "120 Wardens", headcount: 120, morale: 72, targetedBy: [] },
  { id: "e-siege", name: "Siege Battery", kindLabel: "thunders", composition: "24 Thunders, 30 Reavers", headcount: 54, morale: 64, targetedBy: [] },
  { id: "e-reav", name: "Reaver Pack", kindLabel: "reavers", composition: "90 Reavers", headcount: 90, morale: 48, targetedBy: [] },
];
