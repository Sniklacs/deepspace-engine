// EnemyForcesBody — the "battle-enemy-forces" EVE window (owner 2026-10-12).
//
// Hans: after the scout flyby, this window opens with the enemy composition
// per squad. Tap an enemy unit → Pressure / Target buttons pop up → pick
// which of YOUR squads take it. Linked squads carry a bullseye; a squad can
// pressure multiple targets and a target can draw multiple squads.

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
import type { EnemySquadIntel } from "../../game/war/squad-command";

const BTN =
  "pointer-events-auto touch-manipulation rounded-lg border px-3 py-2 text-[11px] font-bold transition active:scale-[0.97]";

function MoraleChip({ morale }: { morale: number }) {
  const color = morale > 60 ? "text-emerald-300" : morale > 35 ? "text-amber-300" : "text-red-300";
  return <span className={`tabular-nums ${color}`}>{morale}%</span>;
}

function TargetedBy({ intel, squadNames }: { intel: EnemySquadIntel; squadNames: Map<string, string> }) {
  if (intel.targetedBy.length === 0) return null;
  return (
    <p className="mt-1 text-[10px] text-orange-300/90">
      🎯 {intel.targetedBy.map((id) => squadNames.get(id) ?? id).join(", ")}
    </p>
  );
}

export function EnemyForcesBody() {
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  const squadNames = new Map(ui.squads.map((s) => [s.id, s.name]));

  if (!ui.scoutIntelReady || ui.enemyIntel.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-3" data-testid="enemy-forces-empty">
        <p className="text-[12px] font-semibold text-zinc-300">No scout intel yet.</p>
        <p className="text-[11px] leading-snug text-zinc-500">
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
    <div className="flex flex-col gap-2 overflow-y-auto p-2.5" data-testid="enemy-forces-body">
      <p className="px-1 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
        Scout intel — pick a target, assign your squads
      </p>

      {/* squad picker: which of YOUR squads take the pending target */}
      {pending && (
        <div
          className="rounded-lg border border-orange-400/40 bg-orange-950/40 p-2"
          data-testid="enemy-forces-picker"
        >
          <p className="mb-1.5 text-[11px] font-bold text-orange-200">
            Assign squads → {pending.name}
          </p>
          <div className="flex flex-col gap-1">
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
                  className={`${BTN} flex items-center justify-between ${
                    linked
                      ? "border-orange-300/60 bg-orange-900/50 text-orange-100"
                      : "border-white/15 bg-black/55 text-zinc-200"
                  }`}
                >
                  <span>
                    {linked ? "🎯 " : ""}
                    {s.name}
                  </span>
                  <span className="tabular-nums text-zinc-400">
                    {s.alive}/{s.total}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => { battleSfx.uiClick(); setPendingTargetId(null); }}
            className={`${BTN} mt-2 w-full border-white/15 bg-black/55 text-zinc-300`}
          >
            Done
          </button>
        </div>
      )}

      {/* enemy squad list */}
      {ui.enemyIntel.map((e) => (
        <div
          key={e.id}
          className="rounded-lg border border-red-400/25 bg-red-950/25 p-2"
          data-testid={`enemy-intel-${e.id}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-red-100">{e.name}</span>
            <span className="text-[11px] text-zinc-400">
              <MoraleChip morale={e.morale} /> · {e.headcount}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] leading-tight text-zinc-400">{e.composition}</p>
          <TargetedBy intel={e} squadNames={squadNames} />
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => { battleSfx.uiClick(); setPendingTargetId(e.id); }}
              data-testid={`enemy-pressure-${e.id}`}
              aria-label={`Pressure ${e.name} — pick squads to harass it`}
              className={`${BTN} flex-1 border-amber-300/40 bg-amber-950/50 text-amber-200`}
            >
              ⚡ Pressure
            </button>
            <button
              type="button"
              onClick={() => { battleSfx.uiClick(); setPendingTargetId(e.id); }}
              data-testid={`enemy-target-${e.id}`}
              aria-label={`Target ${e.name} — pick squads to destroy it`}
              className={`${BTN} flex-1 border-red-300/40 bg-red-950/50 text-red-200`}
            >
              🎯 Target
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
