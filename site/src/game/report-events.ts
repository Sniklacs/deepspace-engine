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
import { getZone } from "./zones";
import { TECH_TREE, ARMORY_TREE, REVELATION_TREE } from "./research";
import { familyFor } from "./armory";

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
      out.push({ text: `Expedition to ${zone ? zone.name : e.label || e.zoneId} returned — the salvage is in the Cradle's stores.` });
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