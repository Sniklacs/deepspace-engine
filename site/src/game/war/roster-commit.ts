// ROSTER COMMIT — binding real mustered troops to battle entities
// (muster-troops.md §5, forward-base.md §6).
//
// The battle engine simulates with CommittedForce.troops (a plain number).
// This module is the war layer's handshake between that number and a REAL
// roster: at commit time it locks supply-weight via commitWeight(); at
// resolve time it converts the battle's stamped casualty number back into
// dead cohorts via resolveBattleCasualties() and appends the losses to the
// colony's memorial feed (the plaques' source).
//
// A battle side is roster-backed only when its creator stamps
// battle.internal.rosterCommits[side]. The Chorus never commits — it has no
// roster, and its casualties stay ghost numbers by design.
//
// Two homes can back a side: "home" (the Cradle garrison) or a forward base
// (kind "base", keyed by foreign serverId) — the beachhead's last stand
// spends its own garrison, never the colony's.
//
// Design notes the future war Phase 1 path must respect:
//   • Commit BEFORE createBattle: the creator sets CommittedForce.troops to
//     the committed weight, so the battle simulates what was actually sent.
//     (The Act I prologue is the exception: its troop numbers are pinned by
//     prologue-tests/act1-entry-verify.ts, so it simulates the scripted
//     number while committing min(scripted, available) — real troops die
//     proportionally, the story calibration never moves.)
//   • Casualties are stamped at creation (finalCasualties) and never
//     re-priced at resolve — the fraction applied here is
//     battle.casualties[side] / simulated troops.
//   • Mid-battle decision tolls (withdrawal rearguard, retreat) are NOT
//     roster-applied yet — they stay numbers until the decision layer learns
//     to commit. The resolve path below is the floor, not the ceiling.
//   • Reinforcements currently pay from BattleReserves (ghost numbers).
//     When reinforcements learn to muster-commit, they stamp additional
//     RosterCommits onto battle.internal — resolveRosterCasualties already
//     iterates every stamped side.
//
// Pure module: deterministic, no Math.random. The engine (engine.ts
// advance()) owns the clocks; this module owns the math.

import {
  availableWeight,
  commitWeight,
  recordCasualties,
  resolveBattleCasualties,
  type TroopRoster,
} from "./troops";
import type { Battle, BattleSide, RosterCommit, RosterHome } from "./war-types";
import type { GameState } from "../types";

/** The real roster behind a commit — null when the home doesn't exist
 *  (pre-muster saves, unplanted beachheads: commit degrades to 0). */
export function rosterForCommit(state: GameState, home: RosterHome): TroopRoster | null {
  if (home.kind === "home") return state.troops?.home.roster ?? null;
  return state.forwardBases?.[home.serverId]?.home.roster ?? null;
}

/**
 * Commit a detachment: lock up to `weight` supply-weight out of the roster.
 * Returns the weight actually committed — never more than availableWeight().
 * The creator sets CommittedForce.troops to the return BEFORE createBattle:
 * the battle simulates what you actually send. Never ghost numbers.
 */
export function commitRosterWeight(
  state: GameState,
  home: RosterHome,
  weight: number,
): number {
  const r = rosterForCommit(state, home);
  if (!r) return 0;
  const w = Math.min(Math.max(0, Math.trunc(weight)), availableWeight(r));
  if (w <= 0) return 0;
  commitWeight(r, w); // w <= availableWeight, so this always succeeds
  return w;
}

/** Stamp a side's commit onto a battle under construction (server-only —
 *  battlePublicView strips `internal`). */
export function stampRosterCommit(
  battle: Battle,
  side: BattleSide,
  commit: RosterCommit,
): void {
  if (!battle.internal.rosterCommits) battle.internal.rosterCommits = {};
  battle.internal.rosterCommits[side] = commit;
}

/**
 * Apply stamped casualties for battles that resolved since the last tick.
 * Idempotent per battle (rosterResolved stamp): repeated advances, repeated
 * saves, and crash-replays can never double-kill. Losses append to the
 * colony's memorial feed — the plaques read them.
 *
 * Returns the number of battles whose losses were applied.
 */
export function resolveRosterCasualties(state: GameState, season?: string): number {
  // No season engine exists yet (seasons.md) — the caller may pass one
  // explicitly; otherwise read the battle-pass window, else the pre-season
  // label. The memorial feed needs a season string; it must never be blank.
  const seasonId = season ?? state.battlePass?.seasonId ?? "s1";
  if (!Array.isArray(state.battles)) return 0;
  let applied = 0;
  for (const b of state.battles) {
    if (b.status === "active") continue;
    const commits = b.internal.rosterCommits;
    if (!commits || b.internal.rosterResolved) continue;
    for (const side of ["attacker", "defender"] as BattleSide[]) {
      const c = commits[side];
      if (!c || c.weight <= 0) continue;
      const r = rosterForCommit(state, c.home);
      if (!r) continue; // home vanished mid-battle (razed beachhead) — nothing to bill
      const force = side === "attacker" ? b.attacker : b.defender;
      const simulated = Math.max(0, Math.trunc(force.troops) || 0);
      const stamped = side === "attacker" ? b.casualties.attacker : b.casualties.defender;
      // The stamped casualties are troop-equivalents of the SIMULATED force;
      // the fraction is what the real detachment pays.
      const fraction = simulated > 0 ? Math.min(1, stamped / simulated) : 0;
      if (fraction <= 0) continue;
      const losses = resolveBattleCasualties(r, c.weight, fraction);
      if (state.troops) {
        recordCasualties(state.troops.history, {
          battleId: b.id,
          site: b.zoneName,
          season: seasonId,
          factions: [b.attacker.colonyName, b.defender.colonyName],
          lossesByType: losses,
          fallenHeroes: [],
        });
      }
    }
    b.internal.rosterResolved = true;
    applied += 1;
  }
  return applied;
}
