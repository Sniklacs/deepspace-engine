// NAV — the shell's slot table (game-ui-shell-spec §1.3, amendment A1).
//
// Pure data: id + label + icon. The Battles slot is the conditional WAR slot;
// the others are fixed (the rung-1 §E consolidation: Cradle · Expeditions ·
// Lab · Armory · Loadout · Circuit, plus World — the colony map). The label
// is the accessible name verbatim.
//
// A10 (vocabulary): every label here is a ratified noun — no new player-facing
// word is coined by the nav.
import type { IconName } from "../components/icons";

export const NAV_IDS = ["colony", "expeditions", "lab", "armory", "troops", "heroes", "loadout", "formations", "arena", "alliance", "battles", "beachhead", "circuit", "world"] as const;
export type NavTabId = (typeof NAV_IDS)[number];
/** The Tab union the router/screens use — derived, so no screen can be orphaned. */
export type Tab = NavTabId;

export interface NavSlot {
  id: NavTabId;
  label: string;
  icon: IconName;
  /** true for the one conditional war slot */
  war?: boolean;
}

export const NAV: readonly NavSlot[] = [
  { id: "colony", label: "Cradle", icon: "building" },
  { id: "expeditions", label: "Exploration", icon: "march" },
  { id: "lab", label: "Lab", icon: "flask" },
  { id: "armory", label: "Armory", icon: "armor" },
  // BARRACKS (owner 2026-10-04): the dedicated troop-building page — artwork,
  // role explanations, muster queues, garrison counts. "Don't be afraid to
  // make pages."
  { id: "troops", label: "Barracks", icon: "users" },
  // HEROES & LEADERS HALL (owner 2026-10-12): the spot that shows the heroes
  // and leaders — their attributes, their tiers, and how they level with
  // experience. Earned, never bought; the Hall displays, it never sells.
  { id: "heroes", label: "Heroes", icon: "star" },
  { id: "loadout", label: "Loadout", icon: "shield" },
  // FORMATIONS (owner 2026-10-04): the dedicated loadout page — raid
  // loadouts, exploration loadouts, response teams. Pre-built battle groups:
  // ships reserved and loaded, supplies staged, hero leader assigned.
  // "Don't be afraid to make pages."
  { id: "formations", label: "Formations", icon: "beacon" },
  // The arena is a permanent per-server fixture (owner 2026-10-01) — it is NOT
  // the war slot. Battles stays war-gated; the arena is always one tap away.
  { id: "arena", label: "Arena", icon: "gamepad" },
  // ALLIANCE (owner 2026-10-04): the war band gets its own page — reverb
  // feed, roster, settings, shipyard. "Don't be afraid to make pages."
  // One module, one page — never cram modules into shared tabs.
  { id: "alliance", label: "Alliance", icon: "shield" },
  { id: "battles", label: "Battles", icon: "sword", war: true },
  // BEACHHEAD (owner 2026-10-15): the wide war gets its own full-screen
  // page — one module, one page. Always present (the Proving Shore is a
  // standing rehearsal front), NOT war-gated like Battles.
  { id: "beachhead", label: "Beachhead", icon: "emblem" },
  { id: "circuit", label: "Circuit", icon: "map" },
  // WORLD MAP (design/abandoned-colonies-world-map.md §2): colonies, not
  // sites. Owner-named markers, abandonment states, scout reports.
  { id: "world", label: "World", icon: "globe" },
];

/** The five slots that always exist; Battles joins them while the war is on. */
export const FIXED_NAV_IDS: readonly NavTabId[] = NAV.filter((n) => !n.war).map((n) => n.id);
export const WAR_SLOT_ID: NavTabId = "battles";

/** The slots to render for a given state of the world (§1.3 slot-count rule). */
export function visibleNavIds(atWar: boolean): readonly NavTabId[] {
  return NAV.filter((n) => !n.war || atWar).map((n) => n.id);
}
