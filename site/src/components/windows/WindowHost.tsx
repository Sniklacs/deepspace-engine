// WindowHost — renders the window manager's windows (owner 2026-10-01).
//
// Mounted in AppShell (the game frame), so windows survive tab switches and
// route changes: the store is the truth, and this host re-renders whatever is
// open whenever it mounts. Windows never auto-close.
//
// Minimized windows park in the tray (a slim strip above the nav/chat dock) —
// except chat, whose minimize collapses to the ChatDock bar (the dock IS
// chat's minimized state).
import { useSyncExternalStore } from "react";
import { useT } from "../i18n/I18n";
import { Icon } from "../icons";
import {
  subscribeWindows,
  windowSnapshot,
  windowServerSnapshot,
  visibleWindows,
  minimizedWindows,
  closeWindow,
  minimizeWindow,
  restoreWindow,
  type WindowInstance,
} from "../../game/windows/window-store";
import { WindowFrame } from "./WindowFrame";
import { ChatWindowBody } from "./ChatWindowBody";
import { SatelliteResearchBody } from "./SatelliteResearchBody";
import type { GameState } from "../../game/types";

/** What window content needs from the game. Provided by play.tsx via AppShell. */
export interface WindowCtx {
  state: GameState;
  now: number;
  onBeginResearch: (techId: string, leaderId: string) => void;
}

function WindowContent({ win, ctx }: { win: WindowInstance; ctx: WindowCtx }) {
  switch (win.kind) {
    case "chat":
      return <ChatWindowBody windowId={win.id} />;
    case "satellite-research": {
      const nodeId = win.props.nodeId ?? win.key;
      return (
        <SatelliteResearchBody
          state={ctx.state}
          now={ctx.now}
          nodeId={nodeId}
          onBeginResearch={ctx.onBeginResearch}
        />
      );
    }
  }
}

export function WindowHost({ ctx }: { ctx: WindowCtx | null }) {
  const t = useT();
  useSyncExternalStore(subscribeWindows, windowSnapshot, windowServerSnapshot);
  const visible = visibleWindows();
  const minimized = minimizedWindows();
  if (!ctx) return null;
  return (
    <>
      {visible.map((win) => (
        <WindowFrame
          key={win.id}
          win={win}
          onMinimize={() => {
            // Chat's minimize collapses to the ChatDock bar (always mounted);
            // every other kind parks in the tray.
            if (win.kind === "chat") closeWindow(win.id);
            else minimizeWindow(win.id);
          }}
          onClose={() => closeWindow(win.id)}
        >
          <WindowContent win={win} ctx={ctx} />
        </WindowFrame>
      ))}
      {minimized.length > 0 && (
        <div
          role="toolbar"
          aria-label={t("windows.trayLabel", "Minimized windows")}
          data-testid="window-tray"
          className="win-tray"
        >
          {minimized.map((win) => (
            <button
              key={win.id}
              type="button"
              onClick={() => restoreWindow(win.id)}
              data-testid={`window-tray-${win.id}`}
              className="win-tray-chip"
              aria-label={t("windows.restore", "Restore {title}", { title: t(win.titleKey, win.titleFallback) })}
            >
              <Icon name={win.kind === "satellite-research" ? "globe" : "chat"} size={13} aria-hidden="true" />
              <span className="max-w-28 truncate">{t(win.titleKey, win.titleFallback)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
