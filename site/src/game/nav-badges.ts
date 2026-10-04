// NAV BADGES — the closed predicate list (game-ui-shell-spec §1.3/§5.4).
//
// A badge means "there is an action available here" — never a notification.
// Every predicate is a PURE function of state (no clock read, no randomness)
// except the live-fight count, which is inherently a state fact too (battles
// carry their own status). The list is closed: adding a badge means adding an
// entry here, and the harness asserts the purity of each one.
import type { GameState } from "./types";
import { engineHelpers } from "./client-utils";
import { raceFamilies, ARMORY_FAMILY_TECH } from "./armory";
import { allianceOf, memberRole } from "./war/alliances";
import type { Tab } from "./nav-slots";

export interface NavBadge {
  /** a real count (teams away, fights live) — never a decoration */
  count?: number;
  /** "there is an action available here" */
  lit?: boolean;
  live?: boolean;
  /** what awaits — used as the slot's accessible name */
  label?: string;
}

/** Devotion has something to bank (the Cradle's only daily action). */
export function devotionReady(state: GameState): boolean {
  const list = state.daily?.list ?? [];
  const completed = state.daily?.completed ?? [];
  const claimed = state.daily?.claimed ?? [];
  if (list.length === 0) return false;
  const pending = completed.filter((id) => !claimed.includes(id));
  const allDone = completed.length >= list.length;
  return pending.length > 0 || (allDone && !state.daily?.bonusClaimed);
}

/** Teams currently in the field. */
export function teamsAway(state: GameState): number {
  return state.expeditions.filter((e) => e.status === "out").length;
}

/** A recovered AI can be deployed (any domain affordable — §11.1 source). */
export function recoveryReady(state: GameState): boolean {
  return (["weaponry", "agriculture", "economy", "industry", "logistics"] as const).some(
    (d) => engineHelpers.domainAffordable(state, d),
  );
}

/** A war family can be forged or upgraded (§11.1 source). */
export function forgeReady(state: GameState): boolean {
  if (!state.race) return false;
  if (!engineHelpers.hasTech(state, "armory_hub")) return false;
  if (!raceFamilies(state.race).length) return false;
  return raceFamilies(state.race).some((f) => {
    const techId = ARMORY_FAMILY_TECH[f.id];
    if (!techId || !engineHelpers.hasTech(state, techId)) return false;
    if (state.armoryBuilds?.[f.id]) return false;
    return engineHelpers.armoryFamilyAffordable(state, f.id);
  });
}

/** Muster queues currently running at the barracks. */
export function mustersRunning(state: GameState): number {
  return state.troops?.home.musterQueue.length ?? 0;
}

/** Applications waiting on your officers' answer (officer+ only). */
export function allianceApplicationsPending(state: GameState): number {
  const me = state.gameId;
  if (!me) return 0;
  const a = allianceOf(state, me);
  if (!a) return 0;
  const role = memberRole(a, me);
  if (role !== "leader" && role !== "officer") return 0;
  return a.applications.length;
}

/** Fights running on your fronts. */
export function liveFights(state: GameState): number {
  return (state.battles ?? []).filter((b) => b.status === "active").length;
}

/** The war posture: the Fall's height, a live fight, or a public war phase. */
export function atWar(state: GameState, tab: Tab): boolean {
  return state.prologue?.stage === "height" || liveFights(state) > 0 || tab === "battles";
}

export function navBadges(state: GameState, tab: Tab): Record<string, NavBadge> {
  const out: Record<string, NavBadge> = {};
  if (devotionReady(state)) out.colony = { lit: true, label: "Cradle — Devotion awaits" };
  const away = teamsAway(state);
  if (away > 0) out.expeditions = { count: away, label: `Explorations — ${away} teams away` };
  if (recoveryReady(state)) out.lab = { lit: true, label: "Lab — a recovery can be deployed" };
  if (forgeReady(state)) out.armory = { lit: true, label: "Armory — a family can be forged" };
  const mustering = mustersRunning(state);
  if (mustering > 0) out.troops = { count: mustering, label: `Barracks — ${mustering} muster${mustering === 1 ? "" : "s"} training` };
  const apps = allianceApplicationsPending(state);
  if (apps > 0) out.alliance = { count: apps, label: `Alliance — ${apps} application${apps === 1 ? "" : "s"} awaiting review` };
  const live = liveFights(state);
  if (atWar(state, tab)) out.battles = { live: live > 0, count: live, label: live > 0 ? `Battles — ${live} fights live` : "Battles — the front" };
  return out;
}
