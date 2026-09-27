// season-guard.ts — the STANDING RULE, as data: **no season objective may
// require completing a TIMED BUILD.**
//
// WHY THIS IS ITS OWN MODULE AND NOT A BLOCK IN monetization.ts (2026-09-27):
// the rule can only be enforced by a watchlist that NAMES the ids it forbids,
// and one of those ids is the armory's build objective. `armory-tests` reads
// monetization.ts line by line and fails if that file so much as names the
// armory — its earn-only tripwire ("no purchase path may NAME war hardware").
// Both guards are correct; they collide on one file. Kept here, both stay at
// FULL strength: the tripwire still scans every line of monetization.ts, and
// this list still names every id it must. Nothing about the rule narrowed —
// the list below is strictly longer than the four ids it carried before.
//
// HOW IT FAILS LOUDLY, two nets:
//   1. the explicit list — every id that has ever been a season objective;
//   2. the `complete_` PREFIX. Under the re-time every `complete_*` objective is
//      the completion of something that now runs for hours to days, so the whole
//      prefix is refused by naming convention: a re-added `complete_<anything>`
//      is caught even if nobody remembers to add it to the list.
// `retime-tests` asserts BOTH: the live objective set is clean, and a synthetic
// re-addition (including the armory one) is refused.
import { DAILY_OBJECTIVES, WEEKLY_OBJECTIVES } from "./monetization";

/**
 * Season-objective ids that are the completion of a TIMED BUILD. Listed rather
 * than matched on descriptions so that adding such an objective has to be done
 * in front of this list — and, since 2026-09-27, in front of the prefix rule as
 * well. The armory's build objective is deliberately on the list: it is a timed
 * build like the others, and leaving it off would narrow the net to whatever we
 * happened to remember.
 */
export const TIMED_BUILD_OBJECTIVE_IDS: readonly string[] = [
  "complete_research",
  "complete_build",
  "complete_armory_build",
  "complete_deploy",
  "complete_expedition",
];

/**
 * Is this objective id the completion of a timed build? True for every id on the
 * watchlist AND for anything named `complete_*` — an objective that reads as a
 * completion is a completion, whatever the list says.
 */
export function isTimedBuildObjectiveId(id: string): boolean {
  return id.startsWith("complete_") || TIMED_BUILD_OBJECTIVE_IDS.includes(id);
}

/** The same sweep over any id list — the seam a suite plants a re-addition in. */
export function timedBuildObjectiveViolationsIn(ids: readonly string[]): string[] {
  return ids.filter(isTimedBuildObjectiveId);
}

/** Objective ids that violate the standing rule. Empty today; must stay empty. */
export function timedBuildObjectiveViolations(): string[] {
  return timedBuildObjectiveViolationsIn([...DAILY_OBJECTIVES, ...WEEKLY_OBJECTIVES].map((o) => o.id));
}
