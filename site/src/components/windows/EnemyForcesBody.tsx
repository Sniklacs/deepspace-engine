// EnemyForcesBody — the "battle-enemy-forces" EVE window (owner 2026-10-12).
//
// Hans: after the scout flyby, this window opens with the enemy composition
// per squad. Tap an enemy unit → Pressure / Target buttons pop up → pick
// which of YOUR squads take it. Linked squads carry a bullseye; a squad can
// pressure multiple targets and a target can draw multiple squads.
//
// Styling: EVE Online command console (owner 2026-10-12) — brassy bold
// headers that pop, small tight dense detail text underneath.

import { useSyncExternalStore } from "react";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
  setPendingTargetId,
  linkSquadTarget,
  unlinkSquadTarget,
} from "../../game/war/battle-scene-ui-store";
import { battleSfx } from "../../game/war/battle-sfx";
import { CMD, CMD_THEME } from "../BattleScene/command-console";

function MoraleChip({ morale }: { morale: number }) {
  const color = morale > 60 ? "text-emerald-300" : morale > 35 ? "text-amber-300" : "text-red-300";
  return <span className={`tabular-nums ${color}`}>{morale}%</span>;
}

export function EnemyForcesBody() {
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  const squadNames = new Map(ui.squads.map((s) => [s.id, s.name]));

  if (!ui.scoutIntelReady || ui.enemyIntel.length === 0) {
    return (
      <div className={`flex flex-col ${CMD.panel} ${CMD_THEME}`} data-testid="enemy-forces-empty">
        <p className={CMD.section}>Enemy Forces</p>
        <p className={`${CMD.body} text-[var(--cmd-text)]`}>No scout intel yet.</p>
        <p className={CMD.body}>
          The scout hasn't completed its flyby. When it returns, enemy
          composition per squad appears here for target assignment.
        </p>
      </div>
    );
  }

  const pending = ui.pendingTargetId
    ? ui.enemyIntel.find((e) => e.id === ui.pendingTargetId) ?? null
    : null;

  return (
    <div className={`flex flex-col overflow-y-auto ${CMD.panel} ${CMD_THEME}`} data-testid="enemy-forces-body">
      <p className={CMD.section}>
        Enemy Forces — scout intel
      </p>
      <p className={CMD.meta}>
        pick a target, assign your squads
      </p>

      {/* squad picker: which of YOUR squads take the pending target */}
      {pending && (
        <div
          className={CMD.surface}
          data-testid="enemy-forces-picker"
        >
          <p className={`${CMD.title} mb-1 text-[var(--cmd-brass)]`}>
            Assign squads → {pending.name}
          </p>
          <div className="flex flex-col gap-0.5">
            {ui.squads.map((s) => {
              const linked = (ui.squadTargets[s.id] ?? []).includes(pending.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    battleSfx.uiClick();
                    if (linked) unlinkSquadTarget(s.id, pending.id);
                    else linkSquadTarget(s.id, pending.id);
                  }}
                  data-testid={`enemy-forces-pick-${s.id}`}
                  aria-pressed={linked}
                  aria-label={`${linked ? "Unassign" : "Assign"} ${s.name} ${linked ? "from" : "to"} ${pending.name}`}
                  className={`${CMD.btn} ${CMD.btnH} flex items-center justify-between ${linked ? CMD.btnActive : ""}`}
                >
                  <span>
                    {linked ? "🎯 " : ""}
                    {s.name}
                  </span>
                  <span className={CMD.meta}>
                    {s.alive}/{s.total}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => { battleSfx.uiClick(); setPendingTargetId(null); }}
            className={`${CMD.btn} ${CMD.btnH} mt-1 w-full`}
          >
            Done
          </button>
        </div>
      )}

      {/* enemy squad list */}
      {ui.enemyIntel.map((e) => (
        <div
          key={e.id}
          className={CMD.surface}
          data-testid={`enemy-intel-${e.id}`}
        >
          <div className="flex items-center justify-between">
            <span className={CMD.title}>{e.name}</span>
            <span className={CMD.meta}>
              <MoraleChip morale={e.morale} /> · {e.headcount}
            </span>
          </div>
          <p className={`${CMD.body} mt-0.5`}>{e.composition}</p>
          {e.targetedBy.length > 0 && (
            <p className={`${CMD.body} mt-0.5 text-[var(--cmd-brass)]`}>
              🎯 {e.targetedBy.map((id) => squadNames.get(id) ?? id).join(", ")}
            </p>
          )}
          <div className="mt-1 flex gap-1">
            <button
              type="button"
              onClick={() => { battleSfx.uiClick(); setPendingTargetId(e.id); }}
              data-testid={`enemy-pressure-${e.id}`}
              aria-label={`Pressure ${e.name} — pick squads to harass it`}
              className={`${CMD.btn} ${CMD.btnH} flex-1`}
            >
              ⚡ Pressure
            </button>
            <button
              type="button"
              onClick={() => { battleSfx.uiClick(); setPendingTargetId(e.id); }}
              data-testid={`enemy-target-${e.id}`}
              aria-label={`Target ${e.name} — pick squads to destroy it`}
              className={`${CMD.btn} ${CMD.btnH} flex-1`}
            >
              🎯 Target
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
