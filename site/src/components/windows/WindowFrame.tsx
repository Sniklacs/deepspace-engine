// WindowFrame — the EVE-style window chrome (owner 2026-10-01).
//
// A window is NOT a modal: no backdrop, no backdrop-tap close, no swipe-down
// close, no Esc close. It stays open until the player closes it with the
// explicit × button (or minimizes it with −). Clicking a window brings it to
// the front.
//
// Windows are resizable (owner 2026-10-01): drag the corner grip to scale the
// window bigger or smaller, EVE-style. Double-click the grip to snap back to
// the default size. Sizes are remembered per window kind.
//
// Phone: near-full-screen panel by default. Desktop (sm+): centered panel.
// Windows never auto-close on navigation — the store is the truth and the
// host remounts them.
import { useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "../i18n/I18n";
import { Icon } from "../icons";
import {
  focusWindow,
  resizeWindow,
  resetWindowSize,
  WIN_MIN_W,
  WIN_MIN_H,
  type WindowInstance,
} from "../../game/windows/window-store";

export function WindowFrame({ win, onMinimize, onClose, children }: {
  win: WindowInstance;
  onMinimize: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const title = t(win.titleKey, win.titleFallback);
  const frameRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  // Inline geometry once the player has resized: explicit width/height, with
  // the conflicting pinned edges released. Chat anchors to the BOTTOM so the
  // virtual-keyboard offset in CSS keeps working; other windows anchor
  // top-left. (Untouched windows keep the pure-CSS default sizing.)
  const sizeStyle = win.size
    ? {
        width: win.size.w,
        height: win.size.h,
        right: "auto" as const,
        ...(win.kind === "chat" ? { top: "auto" as const } : { bottom: "auto" as const }),
      }
    : undefined;

  const onResizeStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const el = frameRef.current;
    if (!el) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: el.offsetWidth,
      startH: el.offsetHeight,
    };
    // Track the pointer even when it leaves the grip.
    e.currentTarget.setPointerCapture(e.pointerId);
    focusWindow(win.id);
  };

  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const w = Math.min(drag.startW + (e.clientX - drag.startX), vw - 16);
    const h = Math.min(drag.startH + (e.clientY - drag.startY), vh - 16);
    // persist=false mid-drag; the final size is persisted on pointer-up.
    resizeWindow(win.id, Math.max(w, WIN_MIN_W), Math.max(h, WIN_MIN_H), false);
  };

  const onResizeEnd = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    const s = win.size;
    if (s) resizeWindow(win.id, s.w, s.h, true);
  };

  return (
    <section
      role="dialog"
      aria-label={title}
      data-testid={`window-${win.kind}`}
      data-kind={win.kind}
      data-window-id={win.id}
      ref={frameRef}
      onPointerDown={() => focusWindow(win.id)}
      className="win-frame"
      style={{ zIndex: 70 + win.z, ...sizeStyle }}
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
      {/* resize grip — drag to scale the window, double-click to reset */}
      <div
        className="win-resize-handle"
        role="separator"
        aria-label={t("windows.resize", "Resize window")}
        data-testid={`window-resize-${win.id}`}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={(e) => { e.stopPropagation(); resetWindowSize(win.id); }}
      />
    </section>
  );
}
