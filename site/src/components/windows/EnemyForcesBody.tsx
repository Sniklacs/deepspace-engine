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
  toggleFocusTarget,
} from "../../game/war/battle-scene-ui-store";
import { buildTargetList } from "../../game/war/enemy-targeting";
import { UNIT_KIND_LABEL, type SceneUnitKind } from "../../game/war/battle-scene-model";
import { battleSfx } from "../../game/war/battle-sfx";
import { CMD, CMD_THEME } from "../BattleScene/command-console";
import {
  cockpitThemeById,
  cockpitAccentStyle,
} from "../../game/war/cockpit-theme";

function MoraleChip({ morale }: { morale: number }) {
  const color = morale > 60 ? "text-emerald-300" : morale > 35 ? "text-amber-300" : "text-red-300";
  return <span className={`tabular-nums ${color}`}>{morale}%</span>;
}

export function EnemyForcesBody() {
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  const squadNames = new Map(ui.squads.map((s) => [s.id, s.name]));

  if (!ui.scoutIntelReady || ui.enemyIntel.length === 0) {
    return (
      <div className={`flex flex-col ${CMD.panel} ${CMD_THEME}`} style={cockpitAccentStyle(cockpitThemeById(ui.cockpitThemeId))} data-testid="enemy-forces-empty">
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
    <div className={`flex flex-col overflow-y-auto ${CMD.panel} ${CMD_THEME}`} style={cockpitAccentStyle(cockpitThemeById(ui.cockpitThemeId))} data-testid="enemy-forces-body">
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
          <p className={`${CMD.title} mb-1 text-[var(--cmd-accent)]`}>
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
            <p className={`${CMD.body} mt-0.5 text-[var(--cmd-accent)]`}>
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

      {/* ITEMIZED TARGETS (owner 2026-10-13): every enemy troop, one row
          each — "a Warden and everything else, so I can pick them apart."
          Tap a row → that unit is the FOCUS: engaged squads concentrate
          fire on it (same engagement radius, no reach cheat) and the
          field marks it. Tap again to clear. The leader/hero pins at the
          top when the force fields one — Hans's warning stands: the hero
          is an HP sponge; killing him first is a known trap. Rows are
          live: health + distance refresh on the scene's tick, and the
          dead leave the list. */}
      {ui.enemyUnitIntel.length > 0 && (
        <div data-testid="enemy-target-list">
          <p className={`${CMD.section} mt-2`}>
            Targets — tap one to focus fire
          </p>
          <p className={CMD.meta}>
            your engaged squads concentrate on the marked troop
          </p>
          {(() => {
            const list = buildTargetList(ui.enemyUnitIntel);
            const row = (
              u: (typeof ui.enemyUnitIntel)[number],
              label: string,
              badge?: string,
            ) => {
              const focused = ui.focusTargetId === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { battleSfx.uiClick(); toggleFocusTarget(u.id); }}
                  data-testid={`enemy-target-row-${u.id}`}
                  aria-pressed={focused}
                  aria-label={
                    focused
                      ? `${label} is the focus target — tap to clear`
                      : `Focus fire on ${label}`
                  }
                  className={`${CMD.btn} ${CMD.btnH} flex w-full items-center justify-between ${focused ? CMD.btnActive : ""}`}
                >
                  <span>
                    {focused ? "🎯 " : ""}
                    {badge ? `${badge} ` : ""}
                    {label}
                  </span>
                  <span className={CMD.meta}>
                    HP {Math.round(u.hp01 * 100)}% · {u.distM} m
                  </span>
                </button>
              );
            };
            return (
              <div className="mt-1 flex flex-col gap-1">
                {list.leader &&
                  row(
                    list.leader,
                    list.leader.name ?? UNIT_KIND_LABEL[list.leader.kind as SceneUnitKind] ?? list.leader.kind,
                    "👑 LEADER",
                  )}
                {list.groups.map((g) => (
                  <div key={g.kind} className="flex flex-col gap-1">
                    <p className={CMD.meta}>
                      {UNIT_KIND_LABEL[g.kind as SceneUnitKind] ?? g.kind} × {g.units.length}
                    </p>
                    {g.units.map(({ unit, n }) =>
                      row(unit, `${UNIT_KIND_LABEL[g.kind as SceneUnitKind] ?? g.kind} ${n}`),
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
