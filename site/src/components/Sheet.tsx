// Sheet — rung-1 §B primitive.
//
// Bottom-sheet on mobile (<640px) / centered modal ≥640px (CSS in app.css).
// 85% max height, 300ms ease-out motion, drag handle (swipe-down closes on
// the handle), focus trap, Esc close, body scroll lock, aria dialog role.
// Reduced motion is respected globally (app.css A.5 zeroes animation/transition
// durations) — this component adds no separate motion path.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Icon } from "./icons";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  labelledBy,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** id of the element that names this dialog (a11y: aria-labelledby). */
  labelledBy: string;
  /** Accessible name fallback when labelledBy is absent. */
  title: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startY: number; moved: boolean }>({ startY: 0, moved: false });

  // Esc close + body scroll lock + focus restore.
  useEffect(() => {
    if (!open) return;
    const prevActive = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey, true);
    // Move focus into the sheet after mount (title-adjacent close button is
    // the natural first stop; the panel itself is the fallback).
    const t = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panelRef.current)?.focus();
    }, 30);

    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      prevActive?.focus?.();
    };
  }, [open, onClose]);

  const t = useT();

  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        // Only the backdrop itself closes; clicks inside the panel never do.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="sheet-panel outline-none"
      >
        <div
          className="sheet-handle"
          aria-hidden="true"
          onPointerDown={(e) => {
            dragRef.current = { startY: e.clientY, moved: false };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (d.startY === 0) return;
            const delta = e.clientY - d.startY;
            if (delta > 6) d.moved = true;
            // Rubber-band the panel up to ~120px of drag, then release closes.
            const panel = panelRef.current;
            if (panel && delta > 0 && delta <= 120) {
              panel.style.transform = `translateY(${Math.round(delta)}px)`;
            }
          }}
          onPointerUp={(e) => {
            const d = dragRef.current;
            const delta = e.clientY - d.startY;
            d.startY = 0;
            const panel = panelRef.current;
            if (panel) panel.style.transform = "";
            if (d.moved && delta > 80) onClose();
          }}
          onPointerCancel={() => {
            dragRef.current = { startY: 0, moved: false };
            const panel = panelRef.current;
            if (panel) panel.style.transform = "";
          }}
        >
          <div className="sheet-handle-bar" />
        </div>
        {children}
      </div>
    </div>
  );
}

/** The standard sheet header row (title + close button, 44px hit target). */
export function SheetHeader({
  id,
  title,
  subtitle,
  onClose,
}: {
  id: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-none items-start justify-between gap-3 border-b border-line px-4 py-3 md:px-5">
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold text-text-1">
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-xs text-text-3">{subtitle}</p> : null}
      </div>
      <button
        onClick={onClose}
        aria-label={t("sheet.close")}
        className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-line text-text-2 hover:bg-surf-4 hover:text-text-1"
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}