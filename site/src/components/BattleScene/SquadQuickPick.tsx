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
//
// Styling: command-console compact (owner 2026-10-12) — small, delicate,
// dense. Tight command-console feel.

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
import {
  cockpitThemeById,
  cockpitAccentStyle,
} from "../../game/war/cockpit-theme";
import type { SceneSquad } from "./SquadControls";
import { CMD, CMD_THEME } from "./command-console";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className={CMD.section}>{children}</p>;
}

function PickBtn({
  active,
  onClick,
  testid,
  label,
  title,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  testid: string;
  label: React.ReactNode;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      aria-pressed={active}
      aria-label={ariaLabel}
      title={title}
      className={`${CMD.btn} ${CMD.btnH} ${active ? CMD.btnActive : ""}`}
    >
      {label}
    </button>
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
      className={`flex flex-col ${CMD.panel} ${CMD_THEME}`}
      style={cockpitAccentStyle(cockpitThemeById(ui.cockpitThemeId))}
      data-testid={`squad-quickpick-${squad.id}`}
    >
      <div className="flex items-center justify-between">
        <span className={CMD.title}>
          {targets.length > 0 && <span aria-hidden="true" className="mr-1">🎯</span>}
          {squad.name} — orders
        </span>
        <span className={CMD.meta} title="Longest weapon reach">
          📏 {rangeM}m
        </span>
      </div>
      {targets.length > 0 && (
        <p className={`${CMD.body} text-[var(--cmd-accent)]`} data-testid={`quickpick-targets-${squad.id}`}>
          🎯 Targeting {targets.length} {targets.length === 1 ? "unit" : "units"}
        </p>
      )}
      {cover && (
        <p className={CMD.body} data-testid={`quickpick-cover-${squad.id}`}>
          🛡️ Covering {ui.squads.find((s) => s.id === cover)?.name ?? cover}
          <button
            type="button"
            onClick={() => { battleSfx.uiClick(); setSquadCover(squad.id, null); }}
            className="ml-1.5 underline"
            aria-label="Stop covering"
          >
            release
          </button>
        </p>
      )}

      <SectionLabel>Fire control</SectionLabel>
      <div className={CMD.grid}>
        {FIRE_MODES.map((m) => (
          <PickBtn
            key={m.id}
            active={fireMode === m.id}
            onClick={() => setFire(m.id)}
            testid={`quickpick-fire-${m.id}`}
            title={m.desc}
            ariaLabel={`${squad.name}: ${m.label}. ${m.desc}`}
            label={<>{m.glyph} {m.label}</>}
          />
        ))}
      </div>

      <SectionLabel>Move</SectionLabel>
      <PickBtn
        active={moveArmed}
        onClick={() => {
          battleSfx.uiClick();
          setMoveArmedFor(moveArmed ? null : squad.id);
        }}
        testid="quickpick-move"
        ariaLabel={
          moveArmed
            ? `${squad.name}: move armed — tap the map or radar for the destination`
            : `${squad.name}: arm move — then tap the map or radar`
        }
        label={moveArmed ? "📍 Tap map / radar…" : "➤ Move…"}
      />

      <SectionLabel>Cover</SectionLabel>
      <div className={CMD.grid}>
        {ui.squads
          .filter((s) => s.id !== squad.id)
          .map((s) => (
            <PickBtn
              key={s.id}
              active={cover === s.id}
              onClick={() => {
                battleSfx.uiClick();
                setSquadCover(squad.id, cover === s.id ? null : s.id);
              }}
              testid={`quickpick-cover-${s.id}`}
              ariaLabel={`${squad.name}: ${cover === s.id ? "stop covering" : "cover"} ${s.name}`}
              label={<>🛡️ {s.name}</>}
            />
          ))}
      </div>

      <SectionLabel>Hold</SectionLabel>
      <PickBtn
        active={stance.holdPosition}
        onClick={() => {
          battleSfx.uiClick();
          setSquadHoldPosition(squad.id, !stance.holdPosition);
        }}
        testid="quickpick-hold"
        title={`Hold position — weapons stay silent until the enemy is inside ${rangeM}m`}
        ariaLabel={
          stance.holdPosition
            ? `${squad.name}: holding position, fires only inside ${rangeM}m. Tap to release.`
            : `${squad.name}: hold position — move here and hold, fire only inside ${rangeM}m`
        }
        label={stance.holdPosition ? `⚓ Holding (${rangeM}m)` : "⚓ Hold position"}
      />

      {squad.hasThunders && (
        <PickBtn
          active={ui.siegeAimArmed}
          onClick={() => { battleSfx.uiClick(); setSiegeAimArmed(!ui.siegeAimArmed); }}
          testid="quickpick-siege-aim"
          ariaLabel={
            ui.siegeAimArmed
              ? "Siege aim armed — tap the map to place the targeter"
              : "Arm the siege aim — tap the map to drop the targeter"
          }
          label={ui.siegeAimArmed ? "✥ Aiming… tap map" : "✥ Siege aim"}
        />
      )}
    </div>
  );
}
