// SquadQuickPick — the commander's quick-pick menu (owner 2026-10-12).
//
// Hans: tap a squad (in the squad panel, never on the battlefield) and the
// quick-pick opens:
//   FIRE CONTROL: Stop Fire / Hold Fire / Cease Fire / Weapons Free / Bombard
//   MOVE: arm it, then tap the map or radar — the squad moves there
//   COVER: "Cover…" opens the supplier picker — pick WHICH of your other
//         squads covers THIS one (owner 2026-10-13: "when you hit that it
//         brings up the squad so you can supply one or pick one"). The
//         picked squad repositions onto this one in the sim and the order
//         lands in the ORDERS log as its receipt.
//   HOLD: hold position — only fire when the enemy enters weapon range
// Every weapon shows its range. Buttons always render; tapping when the
// action can't run says what needs to happen (Hans's UI rule).
//
// Styling: command-console compact (owner 2026-10-12) — small, delicate,
// dense. Tight command-console feel.

import { useState, useSyncExternalStore } from "react";
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
  logOrder,
} from "../../game/war/battle-scene-ui-store";
import { battleSfx } from "../../game/war/battle-sfx";
import {
  FIRE_MODES,
  coverIneligibility,
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
  // The cover supplier picker (owner 2026-10-13): who covers THIS squad.
  const [coverPickOpen, setCoverPickOpen] = useState(false);
  const coveredBy = ui.squads.find((s) => squadCoverOf(s.id) === squad.id) ?? null;

  /** Order `supplier` to cover this squad — store assignment + the ORDERS
   *  log receipt, the same receipt surface every other order lands on.
   *  The sim's cover block does the walking (see BattleScene). */
  const orderCover = (supplier: SceneSquad) => {
    battleSfx.uiClick();
    // One covering squad per covered squad: a new assignment relieves the
    // previous supplier (it keeps its position; its orders are its own).
    for (const s of ui.squads) {
      if (s.id !== supplier.id && squadCoverOf(s.id) === squad.id) setSquadCover(s.id, null);
    }
    setSquadCover(supplier.id, squad.id);
    logOrder({
      squadName: supplier.name,
      dest: squad.name,
      verdict: "accepted",
      kind: "comms",
      reason: `covering ${squad.name}`,
    });
    setCoverPickOpen(false);
  };
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
      {coveredBy && (
        <p className={CMD.body} data-testid={`quickpick-coveredby-${squad.id}`}>
          🛡️ {coveredBy.name} is covering you
          <button
            type="button"
            onClick={() => { battleSfx.uiClick(); setSquadCover(coveredBy.id, null); }}
            className="ml-1.5 underline"
            aria-label={`Release ${coveredBy.name} from covering ${squad.name}`}
          >
            release
          </button>
        </p>
      )}
      {!coverPickOpen ? (
        <PickBtn
          active={false}
          onClick={() => { battleSfx.uiClick(); setCoverPickOpen(true); }}
          testid="quickpick-cover-open"
          ariaLabel={`${squad.name}: pick a squad to cover this one`}
          label={coveredBy ? "🛡️ Change cover…" : "🛡️ Cover… pick a squad"}
        />
      ) : (
        <div className={CMD.surface} data-testid="quickpick-cover-picker">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className={CMD.title}>Who covers {squad.name}?</span>
            <button
              type="button"
              onClick={() => { battleSfx.uiClick(); setCoverPickOpen(false); }}
              data-testid="quickpick-cover-close"
              aria-label="Close the cover picker"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-[var(--cmd-line)] bg-[var(--cmd-panel)] text-[11px] text-[var(--cmd-text)] active:scale-[0.97]"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {ui.squads
              .filter((s) => s.id !== squad.id)
              .map((s) => {
                // Eligibility, with the reason SHOWN on the disabled row
                // (never silently absent) — the pure rule lives in
                // squad-command.ts (coverIneligibility) and is unit-tested.
                const reason = coverIneligibility(s, coveredBy?.id === s.id);
                if (reason) {
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled
                      data-testid={`quickpick-cover-pick-${s.id}`}
                      aria-label={`${s.name} can't cover ${squad.name}: ${reason}`}
                      className={`${CMD.btn} ${CMD.btnH} flex w-full items-center justify-between opacity-45`}
                    >
                      <span>🛡️ {s.name}</span>
                      <span className={CMD.meta}>{reason}</span>
                    </button>
                  );
                }
                const isSupplier = coveredBy?.id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      if (isSupplier) {
                        battleSfx.uiClick();
                        setSquadCover(s.id, null);
                        setCoverPickOpen(false);
                      } else {
                        orderCover(s);
                      }
                    }}
                    data-testid={`quickpick-cover-pick-${s.id}`}
                    aria-pressed={isSupplier}
                    aria-label={
                      isSupplier
                        ? `${s.name} is covering ${squad.name} — tap to release`
                        : `${s.name}: cover ${squad.name}`
                    }
                    className={`${CMD.btn} ${CMD.btnH} flex w-full items-center justify-between ${isSupplier ? CMD.btnActive : ""}`}
                  >
                    <span>🛡️ {s.name}</span>
                    <span className={CMD.meta}>
                      {isSupplier ? "covering you — tap to release" : `${s.alive}/${s.total}`}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

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
