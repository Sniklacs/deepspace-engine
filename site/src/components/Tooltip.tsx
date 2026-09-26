import {
  useState,
  useRef,
  useEffect,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

// Small reusable hover-tooltip. Wraps any element; on hover shows a dark,
// amber-accented explanation (what / what it does / how you get·use it) that
// follows the mouse. Matches the site design language (bg-[#070910], amber-400,
// white/5 cards). Pure client, no deps.
//
// Desktop: hover shows the tooltip after a 350ms delay, following the cursor;
// leaving the element hides it. (Unchanged.)
//
// Touch (coarse-pointer phones/tablets): there is no hover, so a LONG-PRESS
// (~480ms hold with <10px of movement) shows the tooltip near the touch point.
// It stays up until you tap anywhere or scroll. Critically, a long-press is a
// gesture, not a click: it swallows the synthesized click (preventDefault on
// touchend plus a capture-phase click backstop) so the wrapped element's own
// onClick — Feedback/Help/Games/Mute and any modal/panel opener — does NOT fire,
// and a normal QUICK TAP still opens the modal/panel on the FIRST tap. Quick
// taps never show tooltips, so the earlier double-tap regression (first tap
// eaten by mid-tap tooltip DOM insertion) cannot return.

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}

const HOVER_DELAY_MS = 350;
const LONG_PRESS_MS = 480;
const MOVE_SLOP_PX = 10;
// Reserve room for the widest tooltip (max-w-260px + border) when clamping.
const TOOLTIP_WIDTH = 270;
// On touch, flip a "top" tooltip below the touch point when pressed too close
// to the top edge so the pop-up never renders off-screen.
const TOP_FLIP_THRESHOLD = 160;

export function Tooltip({ content, children, side = "top", className = "" }: TooltipProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  // Non-null once mounted. Defaults to fine pointer so any exotic environment
  // (no matchMedia) still behaves like a desktop browser.
  const finePointer = useRef(true);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef(false);
  // Armed when a long-press releases; the next synthesized click (if any) is
  // swallowed so it can never trigger the wrapped element's onClick.
  const suppressClick = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia?.("(hover: hover) and (pointer: fine)");
    finePointer.current = mq ? mq.matches : true;
  }, []);

  // Clear mouse/touch timers on unmount.
  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    },
    []
  );

  // Swallow the click some browsers still synthesize right after a long-press
  // release. Capture at document so it runs BEFORE React/button onClick.
  useEffect(() => {
    const swallow = (e: MouseEvent) => {
      if (!suppressClick.current) return;
      e.stopPropagation();
      e.preventDefault();
      suppressClick.current = false;
    };
    document.addEventListener("click", swallow, true);
    return () => document.removeEventListener("click", swallow, true);
  }, []);

  // A new touch gesture anywhere clears the suppression, so the click that
  // belongs to the NEXT tap is never wrongly eaten.
  useEffect(() => {
    const clearSuppression = () => {
      suppressClick.current = false;
    };
    document.addEventListener("touchstart", clearSuppression, { passive: true });
    return () => document.removeEventListener("touchstart", clearSuppression, { passive: true });
  }, []);

  // While the tooltip is up, a tap anywhere or a scroll dismisses it (touch).
  useEffect(() => {
    if (!show) return;
    const dismiss = () => setShow(false);
    const dismissScroll = () => setShow(false);
    document.addEventListener("touchstart", dismiss, { passive: true });
    document.addEventListener("scroll", dismissScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("touchstart", dismiss, { passive: true });
      document.removeEventListener("scroll", dismissScroll, { passive: true, capture: true });
    };
  }, [show]);

  // ---- Desktop: hover to show, follows the cursor ----
  const scheduleHover = (e: ReactMouseEvent) => {
    if (!finePointer.current) return; // touch: long-press instead
    setPos({ x: e.clientX, y: e.clientY });
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setShow(true), HOVER_DELAY_MS);
  };

  const cancelHover = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (finePointer.current) setShow(false);
  };

  // ---- Touch: long-press to show ----
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const onTouchStart = (e: ReactTouchEvent) => {
    if (finePointer.current) return; // desktop stick: hover handles it
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY };
    longPressFired.current = false;
    cancelLongPress();
    const sx = t.clientX;
    const sy = t.clientY;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      setPos({ x: sx, y: sy });
      setShow(true);
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (e: ReactTouchEvent) => {
    if (finePointer.current || !touchStart.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    if (Math.hypot(dx, dy) > MOVE_SLOP_PX) {
      cancelLongPress();
      touchStart.current = null;
    }
  };

  const onTouchEnd = (e: ReactTouchEvent) => {
    if (finePointer.current) return;
    cancelLongPress();
    touchStart.current = null;
    if (longPressFired.current) {
      longPressFired.current = false;
      // A long-press must NOT trigger the wrapped element's onClick: cancel the
      // touchend default (that default is what synthesizes the click) AND arm
      // the capture-phase swallow as a backstop for browsers that ignore it.
      suppressClick.current = true;
      e.preventDefault();
      // Leave the tooltip up so the reader can absorb it; the next tap/scroll
      // dismisses it (the requirement allows "release hides it, or it stays
      // until you tap away" — staying up reads better on a phone).
    }
  };

  const onTouchCancel = () => {
    if (finePointer.current) return;
    cancelLongPress();
    touchStart.current = null;
    longPressFired.current = false;
  };

  // Auto-flip to below-the-point on touch when pressed near the top edge; on
  // desktop the caller's `side` prop is honored exactly (no desktop change).
  const placeBelow =
    side === "bottom" || (side === "top" && !finePointer.current && (pos?.y ?? 999) < TOP_FLIP_THRESHOLD);
  // Clamp inside the viewport so a tooltip near the right/top edge stays
  // readable on small screens (fixed positioning can't cause page overflow,
  // but it can push the pop-up off-screen).
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 800;
  const left = pos ? Math.max(8, Math.min(pos.x + 14, viewportW - TOOLTIP_WIDTH)) : 0;

  return (
    <span
      ref={ref}
      className={"inline-flex " + className}
      // Block text selection / the iOS-Android callout during long-press so the
      // press gesture is clean (these are UI chrome, never selectable text).
      style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
      onMouseEnter={scheduleHover}
      onMouseMove={(e) => {
        if (finePointer.current) setPos({ x: e.clientX, y: e.clientY });
      }}
      onMouseLeave={cancelHover}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      {show && pos && (
        <div
          className="pointer-events-none fixed z-[100] max-w-[260px] whitespace-normal rounded-lg border border-amber-400/40 bg-[#0b0e16]/95 px-3 py-2 text-start text-xs leading-relaxed text-gray-200 shadow-xl shadow-black/60 backdrop-blur"
          style={{
            left,
            top: placeBelow ? pos.y + 16 : pos.y - 10,
            transform: placeBelow ? undefined : "translateY(-100%)",
          }}
        >
          {content}
        </div>
      )}
    </span>
  );
}