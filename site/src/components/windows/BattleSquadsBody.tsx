// BattleSquadsBody — the "battle-squads" EVE window (owner 2026-10-11).
//
// Hans: the squad buttons live in a movable, resizable, minimizable,
// opacity-adjustable EVE window — not fixed chrome on the battle view.
// The window carries the vertical squad list (1·2·3, Reserve, Rear) with
// live casualties plus the selected squad's stance toggles, so the whole
// command surface travels with the window. Shares the scene UI store with
// the canvas, so taps here and taps on the map never disagree.

import { SquadList, SelectedSquadPanel } from "../BattleScene/SquadControls";

export function BattleSquadsBody() {
  return (
    <div
      className="flex flex-col gap-1 overflow-y-auto p-1.5"
      data-testid="battle-squads-body"
    >
      <SelectedSquadPanel />
      <div className="flex flex-col items-stretch gap-1" data-testid="battle-squads-list">
        <SquadList />
      </div>
    </div>
  );
}
