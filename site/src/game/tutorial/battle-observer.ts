// BATTLE OBSERVER — translates the battle scene's shared UI store into
// tutorial-bus events (guided-battle act). It READS the store the scene and
// the control windows already share; it never writes to it and never issues
// an order. The same differ runs in tests against fabricated snapshots.
//
// What a lesson can honestly observe here:
//   · a squad was selected                       → { name: "squad" }
//   · the judge accepted an order                → { name: "order", orderKind, vector }
//     (kind straight from the ORDERS log — move / hotdrop / jumpdrop; the
//     vector from the squad's bus A0..A4 in the training muster)
//   · a cover assignment was made                → { name: "cover" }
//   · an enemy unit was focused                  → { name: "focus", leader }
//   · the command mode flipped                   → { name: "mode", orderKind: "manual" | "auto" }
import type { SceneUIState } from "../war/battle-scene-ui-store";
import { VECTOR_PLAYER } from "../war/battle-scene-model";
import type { ManeuverVector } from "../war/war-types";
import type { TutEvent } from "./framework";

const VECTOR_BY_SQUAD_ID: Record<string, ManeuverVector> = Object.fromEntries(
  (Object.entries(VECTOR_PLAYER) as [ManeuverVector, number][]).map(([v, p]) => [`A${p}`, v]),
);

export function vectorOfSquadId(squadId: string | null | undefined): ManeuverVector | undefined {
  return squadId ? VECTOR_BY_SQUAD_ID[squadId] : undefined;
}

/** Diff two consecutive scene-UI snapshots into the events that happened
 *  between them, in a stable order (selection → orders → cover → focus →
 *  mode) so a busy tick teaches deterministically. */
export function eventsFromSceneSnapshots(prev: SceneUIState | null, next: SceneUIState): TutEvent[] {
  if (!prev) return [];
  const events: TutEvent[] = [];

  if (next.selectedSquadId && next.selectedSquadId !== prev.selectedSquadId) {
    events.push({ name: "squad", vector: vectorOfSquadId(next.selectedSquadId) });
  }

  const prevOrderIds = new Set(prev.orderLog.map((e) => e.id));
  const squadIdByName = new Map(next.squads.map((s) => [s.name, s.id]));
  // orderLog is newest-first; emit oldest-new first so a lesson sees the
  // sequence the player lived.
  const fresh = next.orderLog.filter((e) => !prevOrderIds.has(e.id)).reverse();
  for (const entry of fresh) {
    if (entry.kind === "comms") continue;
    if (entry.verdict === "accepted") {
      events.push({
        name: "order",
        orderKind: entry.kind ?? "move",
        vector: vectorOfSquadId(squadIdByName.get(entry.squadName)),
      });
    } else {
      events.push({ name: "order-rejected" });
    }
  }

  const prevCover = prev.squadCover;
  const coverMade = Object.entries(next.squadCover).some(
    ([id, covered]) => covered != null && prevCover[id] !== covered,
  );
  if (coverMade) events.push({ name: "cover" });

  if (next.focusTargetId && next.focusTargetId !== prev.focusTargetId) {
    const unit = next.enemyUnitIntel.find((u) => u.id === next.focusTargetId);
    events.push({ name: "focus", leader: unit?.leader === true });
  }

  if (next.manual !== prev.manual) {
    events.push({ name: "mode", orderKind: next.manual ? "manual" : "auto" });
  }

  return events;
}
