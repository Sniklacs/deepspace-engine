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
import { useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "../i18n/I18n";
import { Icon } from "../icons";
import {
  focusWindow,
  moveWindow,
  resetWindowPos,
  resizeWindow,
  resetWindowSize,
  setWindowOpacity,
  resetWindowOpacity,
  WIN_MIN_W,
  WIN_MIN_H,
  WIN_MIN_OPACITY,
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
  // Opacity popover (Hans 2026-10-11): the ◐ chrome button opens a small
  // translucency slider under the title bar. 30–100%, per window kind.
  const [opacityOpen, setOpacityOpen] = useState(false);
  const opacity = win.opacity ?? 1;
  const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  // Title-bar float drag (owner 2026-10-05): EVE-style windows are floatable —
  // grab the title bar to move the window around the screen. Double-click the
  // title bar to snap back to the default placement.
  const moveRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; lastX: number; lastY: number; moved: boolean } | null>(null);

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

  // ---- title-bar float drag ----------------------------------------------
  const onTitleDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Chrome buttons handle their own taps.
    if ((e.target as HTMLElement).closest("button")) return;
    const el = frameRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const baseX = win.pos?.x ?? r.left;
    const baseY = win.pos?.y ?? r.top;
    moveRef.current = { startX: e.clientX, startY: e.clientY, baseX, baseY, lastX: baseX, lastY: baseY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onTitleDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const m = moveRef.current;
    if (!m) return;
    if (!m.moved && Math.abs(e.clientX - m.startX) + Math.abs(e.clientY - m.startY) > 4) {
      m.moved = true;
      focusWindow(win.id);
    }
    if (!m.moved) return;
    m.lastX = m.baseX + (e.clientX - m.startX);
    m.lastY = m.baseY + (e.clientY - m.startY);
    // persist=false mid-drag; the final position is persisted on pointer-up.
    moveWindow(win.id, m.lastX, m.lastY, false);
  };

  const onTitleDragEnd = () => {
    const m = moveRef.current;
    if (!m) return;
    moveRef.current = null;
    if (!m.moved) return;
    moveWindow(win.id, m.lastX, m.lastY, true);
  };

  // Inline geometry once the player has moved/resized: explicit position and
  // size, with the conflicting pinned edges released. Chat anchors to the
  // BOTTOM when only resized (so the virtual-keyboard offset in CSS keeps
  // working); a dragged window pins to its dragged top-left. Untouched
  // windows keep the pure-CSS default sizing/placement.
  const frameStyle: CSSProperties = {
    zIndex: 70 + win.z,
    // Per-window translucency (Hans 2026-10-11): the whole frame fades,
    // title bar included, so the game shows through a parked window.
    ...(win.opacity != null ? { opacity: win.opacity } : {}),
    ...(win.pos ? { left: win.pos.x, top: win.pos.y, right: "auto" as const, bottom: "auto" as const } : {}),
    ...(win.size
      ? {
          width: win.size.w,
          height: win.size.h,
          ...(win.pos ? {} : { right: "auto" as const, ...(win.kind === "chat" ? { top: "auto" as const } : { bottom: "auto" as const }) }),
        }
      : {}),
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
      style={frameStyle}
    >
      {/* title bar — the window's nameplate and drag handle. − parks it, ×
          closes it. Double-click snaps back to the default placement. */}
      <div
        className="win-titlebar"
        onPointerDown={onTitleDragStart}
        onPointerMove={onTitleDragMove}
        onPointerUp={onTitleDragEnd}
        onPointerCancel={onTitleDragEnd}
        onDoubleClick={(e) => { e.stopPropagation(); resetWindowPos(win.id); }}
      >
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-text-1">{title}</h2>
        <div className="flex flex-none items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpacityOpen((o) => !o); focusWindow(win.id); }}
            aria-label={t("windows.opacity", "Window translucency")}
            aria-expanded={opacityOpen}
            data-testid={`window-opacity-${win.id}`}
            className="win-chrome-btn"
            style={{ fontSize: 15 }}
          >
            <span aria-hidden="true">◐</span>
          </button>
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
      {opacityOpen && (
        <div
          className="flex flex-none items-center gap-2.5 border-b border-line bg-black/40 px-3 py-2"
          data-testid={`window-opacity-panel-${win.id}`}
        >
          <span aria-hidden="true" className="text-[13px] text-text-3">◐</span>
          <input
            type="range"
            min={Math.round(WIN_MIN_OPACITY * 100)}
            max={100}
            step={1}
            value={Math.round(opacity * 100)}
            onChange={(e) => setWindowOpacity(win.id, Number(e.target.value) / 100)}
            aria-label={t("windows.opacitySlider", "Window opacity, percent")}
            data-testid={`window-opacity-slider-${win.id}`}
            className="min-w-0 flex-1 accent-amber-400"
          />
          <span className="w-10 flex-none text-right text-[11px] tabular-nums text-text-2">
            {Math.round(opacity * 100)}%
          </span>
          {win.opacity != null && (
            <button
              type="button"
              onClick={() => resetWindowOpacity(win.id)}
              aria-label={t("windows.opacityReset", "Reset opacity to solid")}
              data-testid={`window-opacity-reset-${win.id}`}
              className="flex-none rounded-md border border-line px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-3 hover:text-text-1"
            >
              {t("windows.opacityResetShort", "Solid")}
            </button>
          )}
        </div>
      )}
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
