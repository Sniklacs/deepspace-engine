// REPORT EVENTS — the client-side "something came home" signal (owner 2026-09-13).
//
// Drives the header Reports bell: it must blink ONLY on REAL state transitions
// (an item that was in-flight and is now done), never a fake loop or countdown.
// This pure module diffs two consecutive server states and returns the events
// that RESOLVED between them:
//   • expedition  "out"          → no longer "out"   (the server removes a
//                                 resolved run from state.expeditions)
//   • study       "studying"     → "complete"/gone
//   • research    "researching"  → "complete"/gone
//   • armory build present       → absent (the build record is consumed only
//                                 on completion; nothing else deletes it)
// Text is built from the same state fields the engine uses, so a report reads
// consistently with the Chronicle without duplicating server-side phrasing.
import type { GameState } from "./types";
import { getZone, zoneName } from "./zones";
import { TECH_TREE, ARMORY_TREE, REVELATION_TREE, techText, leaderName } from "./research";
import { familyFor, familyText } from "./armory";

export interface ReportEvent {
  text: string;
}

/** Resolve a research/armory/revelation job id to display text. */
function techNameFor(id: string): { icon: string; name: string } {
  const t = TECH_TREE.find((x) => x.id === id);
  if (t) return { icon: t.icon, name: t.name };
  const a = ARMORY_TREE.find((x) => x.id === id);
  if (a) return { icon: a.icon, name: a.name };
  const r = REVELATION_TREE.find((x) => x.id === id);
  if (r) return { icon: r.glyph, name: r.name };
  return { icon: "", name: id };
}

/** Events that RESOLVED between two consecutive states of the SAME game.
 *  Returns [] when nothing in-flight finished. Callers guard the gameId. */
export function diffResolvedEvents(prev: GameState, next: GameState): ReportEvent[] {
  const out: ReportEvent[] = [];

  // 1 · Expeditions — "out" that is no longer "out".
  for (const e of prev.expeditions) {
    if (e.status !== "out") continue;
    const nxt = next.expeditions.find((x) => x.id === e.id);
    if (!nxt || nxt.status !== "out") {
      const zone = getZone(e.zoneId);
      out.push({ text: `Exploration of ${zone ? zone.name : e.label || e.zoneId} returned — the salvage is in the Cradle's stores.` });
    }
  }

  // 2 · Studies — "studying" that is now complete/gone.
  for (const s of prev.studies) {
    if (s.status !== "studying") continue;
    const nxt = next.studies.find((x) => x.id === s.id);
    if (!nxt || nxt.status !== "studying") {
      out.push({
        text: `A scientist finished studying ${s.kind === "ember" ? "an Ember" : "a Chipset"} — insight distilled.`,
      });
    }
  }

  // 3 · Research — "researching" that is now complete/gone.
  for (const j of prev.researchJobs) {
    if (j.status !== "researching") continue;
    const nxt = next.researchJobs.find((x) => x.id === j.id);
    if (!nxt || nxt.status !== "researching") {
      const { icon, name } = techNameFor(j.techId);
      const leader = next.leaders.find((l) => l.id === j.leaderId);
      out.push({ text: `${icon} ${name} — research complete${leader ? ` (${leader.name})` : ""}.` });
    }
  }

  // 4 · Armory builds — in-flight record consumed (only ever on completion).
  if (next.race) {
    for (const fam of Object.keys(prev.armoryBuilds)) {
      if (!next.armoryBuilds[fam]) {
        const family = familyFor(next.race, fam);
        out.push({ text: `🏛️ The Armory finished ${family ? family.name : fam}.` });
      }
    }
  }
  // 5 · Battles (V9, the real-time battle engine) — "active" in the previous
  //     state that is now resolved. The server flips status + appends the
  //     ledger report lazily in advance(); this diff rides the same 4 s poll.
  for (const b of prev.battles ?? []) {
    if (b.status !== "active") continue;
    const nxt = (next.battles ?? []).find((x) => x.id === b.id);
    if (!nxt || nxt.status === "resolved") {
      const outcome = nxt?.result?.outcome ?? b.result?.outcome ?? "standoff";
      const verb = outcome === "attacker_victory" ? "the attacker breaks the line"
        : outcome === "defender_victory" ? "the defender holds the ground"
          : "both sides break off";
      out.push({ text: `⚔️ The battle at ${b.zoneName || b.zoneId} is decided — ${verb}.` });
    }
  }

  return out;
}
// ============================================================================
// i18n helpers — render-time views of the report-event texts (no logic
// changes). Keys live in cfg.reports.*; the English literals above stay the
// source of truth per the DATA-file convention.
// ============================================================================
import type { T } from "./i18n/types";

/** "Exploration of {zone} returned — …" */
export function reportExpeditionT(t: T, zone: string): string {
  return t(
    "cfg.reports.expeditionReturned",
    `Exploration of ${zone} returned — the salvage is in the Cradle's stores.`,
    { zone },
  );
}

/** "A scientist finished studying an Ember/Chipset — insight distilled." */
export function reportStudyT(t: T, kind: "ember" | "chipset"): string {
  return kind === "ember"
    ? t("cfg.reports.studyEmber", "A scientist finished studying an Ember — insight distilled.")
    : t("cfg.reports.studyChipset", "A scientist finished studying a Chipset — insight distilled.");
}

/** "{icon} {name} — research complete." / "… ({leader})." */
export function reportResearchT(t: T, icon: string, name: string, leader?: string): string {
  return leader
    ? t("cfg.reports.researchCompleteLeader", `${icon} ${name} — research complete (${leader}).`, { icon, name, leader })
    : t("cfg.reports.researchComplete", `${icon} ${name} — research complete.`, { icon, name });
}

/** "🏛️ The Armory finished {family}." */
export function reportArmoryT(t: T, family: string): string {
  return t("cfg.reports.armoryComplete", `🏛️ The Armory finished ${family}.`, { family });
}

/** "⚔️ The battle at {zone} is decided — {verb}." */
export function reportBattleT(
  t: T,
  zone: string,
  outcome: "attacker_victory" | "defender_victory" | "standoff",
): string {
  const key =
    outcome === "attacker_victory" ? "cfg.reports.battleAttacker"
    : outcome === "defender_victory" ? "cfg.reports.battleDefender"
    : "cfg.reports.battleStandoff";
  const verb =
    outcome === "attacker_victory" ? "the attacker breaks the line"
    : outcome === "defender_victory" ? "the defender holds the ground"
    : "both sides break off";
  return t(key, `⚔️ The battle at ${zone} is decided — ${verb}.`, { zone });
}

/** Translated twin of diffResolvedEvents: identical gating, every user-facing
 *  name resolved through the render helpers (zoneName/techText/leaderName/
 *  familyText) before it reaches the report helpers. */
export function diffResolvedEventsT(t: T, prev: GameState, next: GameState): ReportEvent[] {
  const out: ReportEvent[] = [];

  // 1 · Expeditions
  for (const e of prev.expeditions) {
    if (e.status !== "out") continue;
    const nxt = next.expeditions.find((x) => x.id === e.id);
    if (!nxt || nxt.status !== "out") {
      const zone = getZone(e.zoneId);
      out.push({ text: reportExpeditionT(t, zone ? zoneName(t, zone) : e.label || e.zoneId) });
    }
  }

  // 2 · Studies
  for (const s of prev.studies) {
    if (s.status !== "studying") continue;
    const nxt = next.studies.find((x) => x.id === s.id);
    if (!nxt || nxt.status !== "studying") {
      out.push({ text: reportStudyT(t, s.kind) });
    }
  }

  // 3 · Research
  for (const j of prev.researchJobs) {
    if (j.status !== "researching") continue;
    const nxt = next.researchJobs.find((x) => x.id === j.id);
    if (!nxt || nxt.status !== "researching") {
      const { icon, name } = techNameFor(j.techId);
      const leader = next.leaders.find((l) => l.id === j.leaderId);
      out.push({
        text: reportResearchT(t, icon, techText(t, j.techId, "name", name), leader ? leaderName(t, leader) : undefined),
      });
    }
  }

  // 4 · Armory builds
  if (next.race) {
    for (const fam of Object.keys(prev.armoryBuilds)) {
      if (!next.armoryBuilds[fam]) {
        const family = familyFor(next.race, fam);
        out.push({
          text: reportArmoryT(t, family ? familyText(t, next.race, family, "name", family.name) : fam),
        });
      }
    }
  }

  // 5 · Battles
  for (const b of prev.battles ?? []) {
    if (b.status !== "active") continue;
    const nxt = (next.battles ?? []).find((x) => x.id === b.id);
    if (!nxt || nxt.status === "resolved") {
      const outcome = nxt?.result?.outcome ?? b.result?.outcome ?? "standoff";
      out.push({ text: reportBattleT(t, b.zoneName || b.zoneId, outcome) });
    }
  }

  return out;
}
