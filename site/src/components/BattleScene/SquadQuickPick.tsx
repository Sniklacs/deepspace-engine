// SquadQuickPick — the commander's quick-pick menu (owner 2026-10-12).
//
// Hans: tap a squad (in the squad panel, never on the battlefield) and the
// quick-pick opens:
//   FIRE CONTROL: Stop Fire / Hold Fire / Cease Fire / Weapons Free / Bombard
//   MOVE: arm it, then tap the map or radar — the squad moves there
//   COVER: assign this squad to cover another (e.g. cover Squad 2)
//   HOLD: hold position — only fire when the enemy enters weapon range
// Every weapon shows its range. Buttons always render; tapping when the
// action can't run says what needs to happen (Hans's UI rule).

import { useSyncExternalStore } from "react";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
  setSquadFireMode,
  squadFireModeOf,
  setSquadCover,
  squadCoverOf,
  squadTargetIdsOf,
  setMoveArmedFor,
  setSquadHoldPosition,
  setSquadWeaponsHold,
  squadStanceOf,
  setSiegeAimArmed,
} from "../../game/war/battle-scene-ui-store";
import { battleSfx } from "../../game/war/battle-sfx";
import {
  FIRE_MODES,
  squadWeaponRangeM,
  type SquadFireMode,
} from "../../game/war/squad-command";
import type { SceneSquad } from "./SquadControls";
import { CHIP } from "./SquadControls";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.25em] text-zinc-500">
      {children}
    </p>
  );
}

export function SquadQuickPick({ squad }: { squad: SceneSquad }) {
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  const fireMode = squadFireModeOf(squad.id);
  const cover = squadCoverOf(squad.id);
  const targets = squadTargetIdsOf(squad.id);
  const stance = squadStanceOf(ui, squad.id, squad.hasThunders ?? false);
  const moveArmed = ui.moveArmedFor === squad.id;
  // Weapon range: best-effort from the squad's registered kinds. The store
  // doesn't carry per-unit kinds, so fall back to a sensible default band.
  const rangeM = squadWeaponRangeM([]);

  const setFire = (mode: SquadFireMode) => {
    battleSfx.uiClick();
    setSquadFireMode(squad.id, mode);
    // Keep the legacy weaponsHold flag in sync so anything reading the old
    // stance still agrees: stop/hold/cease = silent, free/bombard = live.
    const silent = mode === "stop" || mode === "hold" || mode === "cease";
    setSquadWeaponsHold(squad.id, silent);
  };

  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-white/15 bg-black/70 p-2 backdrop-blur-md"
      data-testid={`squad-quickpick-${squad.id}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-zinc-100">
          {targets.length > 0 && <span aria-hidden="true" className="mr-1">🎯</span>}
          {squad.name} — orders
        </span>
        <span className="text-[10px] tabular-nums text-zinc-400" title="Longest weapon reach">
          📏 {rangeM}m
        </span>
      </div>
      {targets.length > 0 && (
        <p className="text-[10px] text-orange-300/90" data-testid={`quickpick-targets-${squad.id}`}>
          🎯 Targeting {targets.length} {targets.length === 1 ? "unit" : "units"}
        </p>
      )}
      {cover && (
        <p className="text-[10px] text-sky-300/90" data-testid={`quickpick-cover-${squad.id}`}>
          🛡️ Covering {ui.squads.find((s) => s.id === cover)?.name ?? cover}
          <button
            type="button"
            onClick={() => { battleSfx.uiClick(); setSquadCover(squad.id, null); }}
            className="ml-2 underline"
            aria-label={`Stop covering`}
          >
            release
          </button>
        </p>
      )}

      <SectionLabel>Fire control</SectionLabel>
      <div className="grid grid-cols-2 gap-1">
        {FIRE_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setFire(m.id)}
            data-testid={`quickpick-fire-${m.id}`}
            aria-pressed={fireMode === m.id}
            title={m.desc}
            aria-label={`${squad.name}: ${m.label}. ${m.desc}`}
            className={`${CHIP} pointer-events-auto min-h-[40px] touch-manipulation ${
              fireMode === m.id
                ? "border-amber-300/60 bg-amber-950/60 text-amber-200"
                : "border-white/15 bg-black/55 text-zinc-200"
            }`}
          >
            {m.glyph} {m.label}
          </button>
        ))}
      </div>

      <SectionLabel>Move</SectionLabel>
      <button
        type="button"
        onClick={() => {
          battleSfx.uiClick();
          setMoveArmedFor(moveArmed ? null : squad.id);
        }}
        data-testid="quickpick-move"
        aria-pressed={moveArmed}
        aria-label={
          moveArmed
            ? `${squad.name}: move armed — tap the map or radar for the destination`
            : `${squad.name}: arm move — then tap the map or radar`
        }
        className={`${CHIP} pointer-events-auto min-h-[40px] touch-manipulation ${
          moveArmed
            ? "border-sky-300/60 bg-sky-950/60 text-sky-200"
            : "border-white/15 bg-black/55 text-zinc-200"
        }`}
      >
        {moveArmed ? "📍 Tap map / radar…" : "➤ Move…"}
      </button>

      <SectionLabel>Cover</SectionLabel>
      <div className="grid grid-cols-2 gap-1">
        {ui.squads
          .filter((s) => s.id !== squad.id)
          .map((s) => {
            const active = cover === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  battleSfx.uiClick();
                  setSquadCover(squad.id, active ? null : s.id);
                }}
                data-testid={`quickpick-cover-${s.id}`}
                aria-pressed={active}
                aria-label={`${squad.name}: ${active ? "stop covering" : "cover"} ${s.name}`}
                className={`${CHIP} pointer-events-auto min-h-[40px] touch-manipulation ${
                  active
                    ? "border-sky-300/60 bg-sky-950/60 text-sky-200"
                    : "border-white/15 bg-black/55 text-zinc-200"
                }`}
              >
                🛡️ {s.name}
              </button>
            );
          })}
      </div>

      <SectionLabel>Hold</SectionLabel>
      <button
        type="button"
        onClick={() => {
          battleSfx.uiClick();
          setSquadHoldPosition(squad.id, !stance.holdPosition);
        }}
        data-testid="quickpick-hold"
        aria-pressed={stance.holdPosition}
        aria-label={
          stance.holdPosition
            ? `${squad.name}: holding position, fires only inside ${rangeM}m. Tap to release.`
            : `${squad.name}: hold position — move here and hold, fire only inside ${rangeM}m`
        }
        title={`Hold position — weapons stay silent until the enemy is inside ${rangeM}m`}
        className={`${CHIP} pointer-events-auto min-h-[40px] touch-manipulation ${
          stance.holdPosition
            ? "border-emerald-300/60 bg-emerald-950/60 text-emerald-200"
            : "border-white/15 bg-black/55 text-zinc-200"
        }`}
      >
        {stance.holdPosition ? `⚓ Holding (${rangeM}m)` : "⚓ Hold position"}
      </button>

      {squad.hasThunders && (
        <button
          type="button"
          onClick={() => { battleSfx.uiClick(); setSiegeAimArmed(!ui.siegeAimArmed); }}
          data-testid="quickpick-siege-aim"
          aria-pressed={ui.siegeAimArmed}
          className={`${CHIP} pointer-events-auto min-h-[40px] touch-manipulation ${
            ui.siegeAimArmed
              ? "border-orange-300/60 bg-orange-950/60 text-orange-200"
              : "border-white/15 bg-black/55 text-zinc-200"
          }`}
        >
          {ui.siegeAimArmed ? "✥ Aiming… tap map" : "✥ Siege aim"}
        </button>
      )}
    </div>
  );
}
