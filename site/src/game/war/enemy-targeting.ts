// enemy-targeting.ts — the itemized target list model (owner 2026-10-13).
//
// Hans: "I'm not talking about enemy squads, I'm talking about a target
// like a WARDEN. I want an itemized list — a Warden and everything else —
// so I can pick them apart." And: "I want to see their leader or their
// hero if they've got one — especially when I'm fighting a player."
//
// buildTargetList shapes the published per-unit intel into what the
// Enemy Forces panel renders:
//   • the leader/hero (when the force fields one) is pulled OUT of its
//     kind group and pinned at the top, badged — targetable like any
//     other troop. No leader in the intel → no leader row (never faked).
//   • the rest group by troop class, each unit numbered within its class
//     (Warden 1, Warden 2, …) and sorted by distance, nearest first —
//     the pick-apart order a commander actually works in.
// The intel itself carries only LIVING units (the scene stops publishing
// the dead), so rows leave the list as troops fall.
import type { EnemyUnitIntel } from "./squad-command";

export interface TargetListModel {
  leader: EnemyUnitIntel | null;
  groups: Array<{
    kind: string;
    /** units in distance order, each with its 1-based number in-class */
    units: Array<{ unit: EnemyUnitIntel; n: number }>;
  }>;
  /** total living enemy troops in the list */
  total: number;
}

export function buildTargetList(intel: EnemyUnitIntel[]): TargetListModel {
  const leader = intel.find((u) => u.leader) ?? null;
  const byKind = new Map<string, EnemyUnitIntel[]>();
  for (const u of intel) {
    if (leader && u.id === leader.id) continue;
    const arr = byKind.get(u.kind) ?? [];
    arr.push(u);
    byKind.set(u.kind, arr);
  }
  const groups = [...byKind.entries()].map(([kind, units]) => {
    const sorted = [...units].sort((a, b) => a.distM - b.distM);
    return { kind, units: sorted.map((unit, i) => ({ unit, n: i + 1 })) };
  });
  // Busiest class first — the bulk of the enemy line leads the list.
  groups.sort((a, b) => b.units.length - a.units.length);
  return { leader, groups, total: intel.length };
}
