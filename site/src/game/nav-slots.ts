// NAV — the shell's slot table (game-ui-shell-spec §1.3, amendment A1).
//
// Pure data: id + label + icon. The Battles slot is the conditional WAR slot;
// the other five are fixed (the rung-1 §E consolidation: Cradle · Expeditions ·
// Lab · Armory · Circuit). The label is the accessible name verbatim.
//
// A10 (vocabulary): every label here is a ratified noun — no new player-facing
// word is coined by the nav.
import type { IconName } from "../components/icons";

export const NAV_IDS = ["colony", "expeditions", "lab", "armory", "battles", "circuit"] as const;
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
  { id: "expeditions", label: "Expeditions", icon: "march" },
  { id: "lab", label: "Lab", icon: "flask" },
  { id: "armory", label: "Armory", icon: "armor" },
  { id: "battles", label: "Battles", icon: "sword", war: true },
  { id: "circuit", label: "Circuit", icon: "map" },
];

/** The five slots that always exist; Battles joins them while the war is on. */
export const FIXED_NAV_IDS: readonly NavTabId[] = NAV.filter((n) => !n.war).map((n) => n.id);
export const WAR_SLOT_ID: NavTabId = "battles";

/** The slots to render for a given state of the world (§1.3 slot-count rule). */
export function visibleNavIds(atWar: boolean): readonly NavTabId[] {
  return NAV.filter((n) => !n.war || atWar).map((n) => n.id);
}
