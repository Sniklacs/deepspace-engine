// WindowFrame — the EVE-style window chrome (owner 2026-10-01).
//
// A window is NOT a modal: no backdrop, no backdrop-tap close, no swipe-down
// close, no Esc close. It stays open until the player closes it with the
// explicit × button (or minimizes it with −). Clicking a window brings it to
// the front.
//
// Phone: near-full-screen panel. Desktop (sm+): centered panel, narrower.
// Windows never auto-close on navigation — the store is the truth and the
// host remounts them.
import type { ReactNode } from "react";
import { useT } from "../i18n/I18n";
import { Icon } from "../icons";
import { focusWindow, type WindowInstance } from "../../game/windows/window-store";

export function WindowFrame({ win, onMinimize, onClose, children }: {
  win: WindowInstance;
  onMinimize: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const title = t(win.titleKey, win.titleFallback);
  return (
    <section
      role="dialog"
      aria-label={title}
      data-testid={`window-${win.kind}`}
      data-kind={win.kind}
      data-window-id={win.id}
      onPointerDown={() => focusWindow(win.id)}
      className="win-frame"
      style={{ zIndex: 70 + win.z }}
    >
      {/* title bar — the window's nameplate. − parks it, × closes it. */}
      <div className="win-titlebar">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-text-1">{title}</h2>
        <div className="flex flex-none items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMinimize(); }}
            aria-label={t("windows.minimize", "Minimize")}
            data-testid={`window-min-${win.id}`}
            className="win-chrome-btn"
          >
            <Icon name="minus" size={15} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            aria-label={t("windows.close", "Close")}
            data-testid={`window-close-${win.id}`}
            className="win-chrome-btn"
          >
            <Icon name="x" size={15} />
          </button>
        </div>
      </div>
      <div className="win-body">{children}</div>
    </section>
  );
}
