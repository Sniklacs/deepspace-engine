// BattleHud — the on-field command layer (owner 2026-10-06, reworked
// 2026-10-11).
//
// Hans: the battle view stays CLEAN — just the battle. Every control the
// commander touches lives in EVE windows they place where they want:
//   • the SQUADS window — the vertical squad list with live casualties,
//     selection banner, stance toggles, siege aim, order receipts.
//   • the CONTROLS window — command, speed, turrets, siege panic, camera,
//     vectors, gunner cam.
// This HUD keeps only what is INFORMATION, never controls:
//   • comms bubbles (transient field reports, tap to confirm read)
//   • the radar widget (the whole field at a glance)
//   • a slim window-launcher strip — small buttons that summon the Squads
//     and Controls windows when closed, plus the fullscreen toggle in the
//     embedded battle view. The strip is the only chrome on the field.

import { useEffect, useRef, useSyncExternalStore, useState } from "react";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
  setMoveArmedFor,
  setSelectedSquad,
  queueRadarMove,
} from "../../game/war/battle-scene-ui-store";
import {
  subscribeWindows,
  windowSnapshot,
  windowServerSnapshot,
  openWindow,
  isWindowOpen,
  minimizeBattleWindows,
} from "../../game/windows/window-store";
import { battleSfx } from "../../game/war/battle-sfx";
import type { CommsBubble } from "../../game/war/battle-comms";
import { CommsBubbles } from "./CommsBubbles";
import { BattleRadar } from "./BattleRadar";
import {
  cockpitThemeById,
  cockpitAccentStyle,
} from "../../game/war/cockpit-theme";

const LAUNCHER =
  "pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 py-2 text-[11px] font-semibold text-zinc-200 backdrop-blur-md transition active:scale-[0.97]";

export function BattleHud({
  comms,
  onDismissComms,
  variant,
  onRequestFullscreen,
}: {
  comms: CommsBubble[];
  onDismissComms: (id: number) => void;
  /** embedded: rides the canvas wrap; fullscreen: rides the viewport */
  variant: "embedded" | "fullscreen";
  /** embedded only: jump this battle to the fullscreen scene */
  onRequestFullscreen?: () => void;
}) {
  // Scene store for nothing here directly — the windows own the controls.
  // (Kept subscribed so the launcher strip re-renders with battle state.)
  useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  useSyncExternalStore(subscribeWindows, windowSnapshot, windowServerSnapshot);
  const fs = variant === "fullscreen";
  // Below the slim header overlay in fullscreen; top of the wrap embedded.
  const commsStyle = fs
    ? { top: "calc(env(safe-area-inset-top) + 6.75rem)" }
    : undefined;

  const squadsOpen = isWindowOpen("battle-squads");
  const controlsOpen = isWindowOpen("battle-controls");
  const enemyForcesOpen = isWindowOpen("battle-enemy-forces");
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  // The cockpit deck (owner 2026-10-12) owns the bottom edge — the strip
  // and radar ride above it while the frame is up.
  const stripBottom = fs
    ? `calc(env(safe-area-inset-bottom) + ${ui.cockpitOn ? "8.5rem" : "4.25rem"})`
    : ui.cockpitOn
      ? "4.9rem"
      : "0.5rem";
  const [radarBig, setRadarBig] = useState(false);
  const moveArmed = ui.moveArmedFor !== null;
  const armedSquad = ui.squads.find((s) => s.id === ui.moveArmedFor) ?? null;
  // Hans 2026-10-13: the radar commands with a squad SELECTED, not only
  // with a move pre-armed in the panel — selected is enough: the tap IS
  // the order. (Armed still wins when both are set.)
  const selectedSquad = ui.squads.find((s) => s.id === ui.selectedSquadId) ?? null;
  const commandSquad = armedSquad ?? selectedSquad;

  // Hans 2026-10-12: the radar is the movement instrument — when a squad's
  // MOVE is armed, the radar OPENS LARGE on its own so the destination tap
  // is a fat-finger target, not a 148px guess.
  // Hans 2026-10-13: arming a move (or the siege aim) also parks the battle
  // windows in the tray — the arming tap happens INSIDE a window that
  // otherwise covers the whole field, and the follow-up tap (map or radar)
  // could never land. The windows wait in the tray; the receipt lands on
  // the field.
  const prevArmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (ui.moveArmedFor && !prevArmedRef.current) {
      minimizeBattleWindows();
      setRadarBig(true);
    }
    prevArmedRef.current = ui.moveArmedFor;
  }, [ui.moveArmedFor]);
  const prevSiegeRef = useRef(false);
  useEffect(() => {
    if (ui.siegeAimArmed && !prevSiegeRef.current) minimizeBattleWindows();
    prevSiegeRef.current = ui.siegeAimArmed;
  }, [ui.siegeAimArmed]);

  // Small radar tap while armed: enlarge — precision lives in the overlay.
  const onRadarTap = () => {
    battleSfx.uiClick();
    setRadarBig(true);
  };

  // Overlay tap: the destination. Queue it through the store — the scene
  // routes it through the order judge, and the receipt (order ping + log +
  // the judge's toast on a refusal) lands on the field as the panel closes.
  // Works for an armed squad AND for a merely-selected one (owner
  // 2026-10-13: "when I open up the radar I can't move troops there" —
  // opening the radar with a squad selected must be enough to command).
  const onOverlayRadarTap = (x: number, y: number) => {
    if (!commandSquad) return;
    battleSfx.uiClick();
    queueRadarMove(commandSquad.id, x, y);
    setRadarBig(false);
  };

  // Overlay blip tap with nothing selected/armed: select that squad, stay
  // open — the next tap is its destination.
  const onOverlaySquadTap = (squadId: string) => {
    battleSfx.uiClick();
    setSelectedSquad(squadId);
  };

  const bigRadarSize =
    typeof window !== "undefined"
      ? Math.max(250, Math.min(430, Math.floor(Math.min(window.innerWidth * 0.84, window.innerHeight * 0.56))))
      : 320;

  return (
    <>
      {/* comms — persistent bubbles, tap to confirm read */}
      <CommsBubbles
        comms={comms}
        onDismiss={onDismissComms}
        className={fs ? "" : "top-2"}
        style={commsStyle}
      />

      {/* radar — bottom-left, above the Legend chip. The whole field in one
          glance: friend/foe dots, turret diamonds, event pings, scale bar.
          (owner 2026-10-11). Hans 2026-10-12: the radar is a command surface —
          when a squad's MOVE is armed, tap it for the destination; the ⤢
          button opens it large. */}
      <div
        className="absolute left-2 z-30"
        style={{
          bottom: `calc(${stripBottom} + 3rem)`,
          ...cockpitAccentStyle(cockpitThemeById(ui.cockpitThemeId)),
        }}
        data-testid="battle-hud-radar"
      >
        <div className={`relative ${moveArmed ? "pointer-events-auto" : "pointer-events-none"}`}>
          <BattleRadar
            interactive={moveArmed}
            onTapWorld={onRadarTap}
            selectedSquadId={ui.selectedSquadId}
            size={148}
          />
          {moveArmed && armedSquad && (
            <p className="pointer-events-none absolute -top-6 left-0 whitespace-nowrap rounded border border-[var(--cmd-accent)] bg-[#0b0f16] px-1.5 py-0.5 text-[8px] font-bold text-[var(--cmd-accent)]">
              📍 {armedSquad.name}: tap radar to aim
            </p>
          )}
          <button
            type="button"
            onClick={() => { battleSfx.uiClick(); setRadarBig(true); }}
            data-testid="hud-radar-expand"
            aria-pressed={radarBig}
            aria-label="Enlarge the radar"
            className="pointer-events-auto absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-[rgba(255,255,255,0.2)] bg-[#0b0f16] text-[10px] text-[#eef1f6] active:scale-95"
          >
            ⤢
          </button>
          {moveArmed && (
            <button
              type="button"
              onClick={() => { battleSfx.uiClick(); setMoveArmedFor(null); }}
              data-testid="hud-radar-cancel-move"
              aria-label="Cancel the armed move"
              className="pointer-events-auto absolute -bottom-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border border-[rgba(255,255,255,0.2)] bg-[#0b0f16] text-[10px] text-[#eef1f6] active:scale-95"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* EXPANDED RADAR (Hans 2026-10-12): the radar opens LARGE — an
          EVE-style panel over the field. A tap on the big field IS the
          destination for the commanding squad (MOVE armed, or simply
          selected — owner 2026-10-13): it queues through the order judge
          and the receipt lands on the field as this panel closes. With
          nothing selected, tapping one of your squads' blips selects it.
          Works the same in POV and Map — the radar is the movement
          instrument when the view itself can't be tapped for ground
          positions. This overlay is the seed of the wide-picture
          battlefield screen: it commands through the same world-coord /
          squad-id model a full-screen panning view will use. */}
      {radarBig && (
        <div
          className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/55 p-3"
          data-testid="battle-radar-overlay"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setRadarBig(false);
          }}
        >
          <div
            className="rounded-xl border border-[rgba(255,255,255,0.18)] bg-[#0b0f16] p-3 shadow-2xl"
            style={cockpitAccentStyle(cockpitThemeById(ui.cockpitThemeId))}
            role="dialog"
            aria-modal="true"
            aria-label="Expanded battle radar"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#eef1f6]">
                📡 Radar
                {commandSquad ? (
                  <span className="ml-2 normal-case tracking-normal text-[var(--cmd-accent)]">
                    {commandSquad.name} — tap the destination
                  </span>
                ) : (
                  <span className="ml-2 normal-case tracking-normal text-zinc-400">
                    tap one of your squads to select it
                  </span>
                )}
              </p>
              <button
                type="button"
                onClick={() => { battleSfx.uiClick(); setRadarBig(false); }}
                data-testid="hud-radar-close"
                aria-label="Close the expanded radar"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[rgba(255,255,255,0.2)] bg-black/40 text-[10px] text-[#eef1f6] active:scale-95"
              >
                ✕
              </button>
            </div>
            <BattleRadar
              interactive={commandSquad !== null}
              onTapWorld={onOverlayRadarTap}
              onTapSquad={commandSquad ? undefined : onOverlaySquadTap}
              selectedSquadId={ui.selectedSquadId ?? ui.moveArmedFor}
              size={bigRadarSize}
            />
            {moveArmed && (
              <button
                type="button"
                onClick={() => { battleSfx.uiClick(); setMoveArmedFor(null); setRadarBig(false); }}
                data-testid="hud-radar-overlay-cancel-move"
                className="mt-2 w-full rounded border border-[rgba(255,255,255,0.16)] bg-black/40 px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-300 active:scale-[0.98]"
              >
                Cancel move
              </button>
            )}
          </div>
        </div>
      )}

      {/* window launchers — the only chrome on the field. Each button
          summons its EVE window; when the window is open the button hides
          (the window's own − / × park or close it, the tray restores it). */}
      <div
        className="pointer-events-none absolute right-2 z-30 flex flex-col items-end gap-1.5"
        style={{ bottom: stripBottom }}
        data-testid="battle-hud-launchers"
      >
        {!squadsOpen && (
          <button
            type="button"
            onClick={() => { battleSfx.uiClick(); openWindow("battle-squads", { titleFallback: "Squads" }); }}
            data-testid="hud-launch-squads"
            aria-label="Open the squads window"
            className={LAUNCHER}
          >
            🪖 Squads
          </button>
        )}
        {!controlsOpen && (
          <button
            type="button"
            onClick={() => { battleSfx.uiClick(); openWindow("battle-controls", { titleFallback: "Battle controls" }); }}
            data-testid="hud-launch-controls"
            aria-label="Open the battle controls window"
            className={LAUNCHER}
          >
            ⚙ Controls
          </button>
        )}
        {/* Hans 2026-10-12: the Enemy Forces window — scout intel per enemy
            squad, tap to assign Pressure/Target. Always rendered (UI rule);
            tapping before the scout returns says what's missing. */}
        {!enemyForcesOpen && (
          <button
            type="button"
            onClick={() => {
              battleSfx.uiClick();
              if (ui.scoutIntelReady) {
                openWindow("battle-enemy-forces", { titleFallback: "Enemy Forces" });
              } else {
                battleSfx.orderRejected();
              }
            }}
            data-testid="hud-launch-enemy-forces"
            aria-label={
              ui.scoutIntelReady
                ? "Open the enemy forces intel window"
                : "Enemy forces: scout hasn't returned yet"
            }
            title={
              ui.scoutIntelReady
                ? "Enemy forces intel"
                : "Scout hasn't completed its flyby yet"
            }
            className={LAUNCHER}
          >
            🎯 Enemy Forces{ui.scoutIntelReady ? "" : "…"}
          </button>
        )}
        {!fs && onRequestFullscreen && (
          <button
            type="button"
            onClick={() => { battleSfx.uiClick(); onRequestFullscreen(); }}
            data-testid="hud-fullscreen-toggle"
            aria-label="Watch this battle fullscreen"
            className={LAUNCHER}
          >
            ⤢ Fullscreen
          </button>
        )}
      </div>
    </>
  );
}
