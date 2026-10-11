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

import { useSyncExternalStore } from "react";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
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
          (owner 2026-10-11) */}
      <div
        className="pointer-events-none absolute left-2 z-30"
        style={{ bottom: `calc(${stripBottom} + 3rem)` }}
        data-testid="battle-hud-radar"
      >
        <BattleRadar />
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
