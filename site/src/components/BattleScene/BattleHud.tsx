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

import { useSyncExternalStore, useState } from "react";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
  setMoveArmedFor,
  queueRadarMove,
} from "../../game/war/battle-scene-ui-store";
import {
  subscribeWindows,
  windowSnapshot,
  windowServerSnapshot,
  openWindow,
  isWindowOpen,
} from "../../game/windows/window-store";
import { battleSfx } from "../../game/war/battle-sfx";
import type { CommsBubble } from "../../game/war/battle-comms";
import { CommsBubbles } from "./CommsBubbles";
import { BattleRadar } from "./BattleRadar";

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
  const stripBottom = fs
    ? "calc(env(safe-area-inset-bottom) + 4.25rem)"
    : "0.5rem";

  const squadsOpen = isWindowOpen("battle-squads");
  const controlsOpen = isWindowOpen("battle-controls");
  const enemyForcesOpen = isWindowOpen("battle-enemy-forces");
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  const [radarBig, setRadarBig] = useState(false);
  const moveArmed = ui.moveArmedFor !== null;
  const armedSquad = ui.squads.find((s) => s.id === ui.moveArmedFor) ?? null;

  const onRadarTap = (x: number, y: number) => {
    if (!ui.moveArmedFor) return;
    battleSfx.uiClick();
    queueRadarMove(ui.moveArmedFor, x, y);
  };

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
        style={{ bottom: `calc(${stripBottom} + 3rem)` }}
        data-testid="battle-hud-radar"
      >
        <div className={`relative ${moveArmed ? "pointer-events-auto" : "pointer-events-none"}`}>
          <BattleRadar
            interactive={moveArmed}
            onTapWorld={onRadarTap}
            size={radarBig ? 260 : 148}
          />
          {moveArmed && armedSquad && (
            <p className="pointer-events-none absolute -top-6 left-0 whitespace-nowrap rounded border border-sky-400/50 bg-[#0b0f16] px-1.5 py-0.5 text-[8px] font-bold text-sky-300">
              📍 {armedSquad.name}: tap radar
            </p>
          )}
          <button
            type="button"
            onClick={() => { battleSfx.uiClick(); setRadarBig(!radarBig); }}
            data-testid="hud-radar-expand"
            aria-pressed={radarBig}
            aria-label={radarBig ? "Shrink the radar" : "Enlarge the radar"}
            className="pointer-events-auto absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-[rgba(255,255,255,0.2)] bg-[#0b0f16] text-[10px] text-[#eef1f6] active:scale-95"
          >
            {radarBig ? "⤡" : "⤢"}
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
