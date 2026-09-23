// CRADLE SLOTS — the base plate's six tiles (game-ui-shell-spec §2.3).
//
// PURE DATA + two pure predicates per slot:
//   • level(state) — the Lv the tile prints (workshop: how many kits are held)
//   • ready(state) — the §5.4 closed predicate: "there is an action available
//                    here". No clock, no randomness, no new state.
// Labels come from the DOMAINS catalog so they can never drift (DOMAINS itself
// is NOT edited — the emoji→line-icon map lives here, §11.2). `x`/`y` are the
// Phase-2 isometric hotspot fractions: swapping the CSS grid for an authored
// render is a coordinate swap, not a redesign.
import { DOMAINS, DOMAIN_BY_ID } from "./zones";
import { CRAFT, CRAFT_RESOURCE_KEY, canForgeAlloy } from "./engine";
import { engineHelpers } from "./client-utils";
import type { CraftKind } from "./engine";
import type { DomainId, GameState } from "./types";
import type { IconName } from "../components/icons";

export type CradleSlotId = DomainId | "workshop";

export interface CradleSlot {
  id: CradleSlotId;
  /** the domain this tile advances (null for the Workshop) */
  domain: DomainId | null;
  label: string;
  icon: IconName;
  /** the numeral under the label, with its unit when it is not a level */
  counter?: string;
  level(state: GameState): number;
  ready(state: GameState): boolean;
  /** Phase-2 hotspot, fraction of the plate (0–1) */
  x: number;
  y: number;
}

/** Kits held: how many of the nine forgeable kinds the colony has in stores. */
export function kitsHeld(state: GameState): number {
  return (Object.keys(CRAFT) as CraftKind[]).filter(
    (k) => (state.resources[CRAFT_RESOURCE_KEY[k]] ?? 0) > 0,
  ).length;
}

/** Any kit forgeable right now (alloy included, via its recipe). */
export function workshopReady(state: GameState): boolean {
  return (Object.keys(CRAFT) as CraftKind[]).some((k) => {
    const def = CRAFT[k];
    const affordable = state.resources.supplies >= def.supplies;
    if (k === "alloy") return affordable && canForgeAlloy(state);
    return affordable;
  });
}

function domainSlot(id: DomainId, icon: IconName, x: number, y: number): CradleSlot {
  return {
    id,
    domain: id,
    label: DOMAIN_BY_ID[id].name, // never a duplicated string
    icon,
    level: (state) => state.deployedDomains[id],
    ready: (state) => engineHelpers.domainAffordable(state, id),
    x,
    y,
  };
}

export const CRADLE_SLOTS: readonly CradleSlot[] = [
  domainSlot("weaponry", "sword", 0.22, 0.34),
  domainSlot("agriculture", "wheat", 0.5, 0.26),
  domainSlot("economy", "coin", 0.78, 0.34),
  domainSlot("industry", "hammer", 0.3, 0.68),
  domainSlot("logistics", "cart", 0.7, 0.68),
  {
    id: "workshop",
    domain: null,
    label: "Workshop",
    icon: "gear",
    counter: "kits",
    level: kitsHeld,
    ready: workshopReady,
    x: 0.5,
    y: 0.52,
  },
];

export const CRADLE_SLOT_BY_ID: Record<CradleSlotId, CradleSlot> = Object.fromEntries(
  CRADLE_SLOTS.map((s) => [s.id, s]),
) as Record<CradleSlotId, CradleSlot>;

/** The domains the plate covers, in the catalog's own order. */
export const CRADLE_DOMAIN_IDS: readonly DomainId[] = DOMAINS.map((d) => d.id);
