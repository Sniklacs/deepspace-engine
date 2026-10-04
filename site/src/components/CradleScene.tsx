// CradleScene — the Cradle page as a place, not a page (owner 2026-10-04).
//
// The home colony rendered as one illustrated scene: the player pans
// across it in every direction (drag on touch, wheel-zoom on desktop, pinch),
// and the BUILDINGS are the navigation — tap the Laboratory and you're in the
// Lab, tap the Barracks and you're mustering troops. No text-link menus; you
// walk the scene.
//
// The scene is the top of the colony tab; the colony's business panels
// (overview, devotion, roster, stores…) live below it in the normal page
// scroll, reachable via the Great Hall hotspot and the floating pill.
//
// ART DIRECTION (owner, rev 2026-10-04): HIGH steep aerial camera — nearly
// top-down (~65° from horizontal), the whole colony fitting on screen at
// once; users zoom in for detail. TINTED film-noir SKY (deep indigo and
// charcoal clouds broken by BLUE storm light and RED hues — distant fires,
// warning beacons — for colored depth; only a sliver of skyline shows, just
// enough to set the mood) over a BRIGHT colony below: good colors,
// brightness AND shade, real depth, colored luster. Grounded and cinematic,
// not gloomy. One lean 1920×1080 WebP panorama; hotspots sit on the painted
// buildings. If the art ever fails to load the scene quietly removes itself
// and the panels below carry on.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { Tab } from "../game/nav-slots";
import { sound } from "../game/sound";
import { useT } from "./i18n/I18n";

export const SCENE_ART = "/art/cradle/scene-panorama.webp";
// Natural size of the panorama — the pan world is measured in these units.
export const WORLD_W = 1920;
export const WORLD_H = 1080;
const MAX_ZOOM = 3;
const TAP_SLOP_PX = 10;

export interface SceneHotspot {
  id: string;
  /** percent of the world width/height */
  x: number;
  y: number;
  labelKey: string;
  defaultLabel: string;
  /** tab to open, or a scene-local action */
  target: Tab | "forge" | "business" | "shipyard";
}

/**
 * Building → destination map. Positions are % coordinates on the panorama,
 * matched by eye to the painted buildings (high steep aerial, near top-down:
 * glass lab dome · burning forge hall · central keep · barracks rows ·
 * white alliance spires · shipyard gantry · depot crates and rovers ·
 * mustering plaza with fountain).
 */
export const CRADLE_HOTSPOTS: readonly SceneHotspot[] = [
  { id: "lab", x: 14, y: 54, labelKey: "cradle.scene.lab", defaultLabel: "Laboratory", target: "lab" },
  { id: "forge", x: 7, y: 75, labelKey: "cradle.scene.forge", defaultLabel: "Forge", target: "forge" },
  { id: "keep", x: 51, y: 49, labelKey: "cradle.scene.keep", defaultLabel: "Great Hall", target: "business" },
  { id: "formations", x: 58, y: 81, labelKey: "cradle.scene.formations", defaultLabel: "Formations Grounds", target: "formations" },
  { id: "barracks", x: 59, y: 66, labelKey: "cradle.scene.barracks", defaultLabel: "Barracks", target: "troops" },
  { id: "alliance", x: 72, y: 49, labelKey: "cradle.scene.alliance", defaultLabel: "Alliance Hall", target: "alliance" },
  { id: "depot", x: 83, y: 85, labelKey: "cradle.scene.depot", defaultLabel: "Exploration Depot", target: "expeditions" },
  { id: "shipyard", x: 93, y: 62, labelKey: "cradle.scene.shipyard", defaultLabel: "Shipyard", target: "shipyard" },
];

export interface PanTransform {
  x: number;
  y: number;
  z: number;
}

/** Smallest zoom that still covers the viewport — the world never shows gaps. */
export function minZoom(viewW: number, viewH: number): number {
  if (viewW <= 0 || viewH <= 0) return 1;
  return Math.max(viewW / WORLD_W, viewH / WORLD_H);
}

/** Clamp a pan so the world always covers the viewport (centers if smaller). */
export function clampPan(
  x: number,
  y: number,
  z: number,
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  const w = WORLD_W * z;
  const h = WORLD_H * z;
  const cx = w <= viewW ? (viewW - w) / 2 : Math.min(0, Math.max(viewW - w, x));
  const cy = h <= viewH ? (viewH - h) / 2 : Math.min(0, Math.max(viewH - h, y));
  return { x: cx, y: cy };
}

function scrollToTestid(testid: string) {
  if (typeof document === "undefined") return;
  document
    .querySelector(`[data-testid="${testid}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function CradleScene({
  onNavigate,
  onOpenForge,
}: {
  /** open a nav tab (Lab, Barracks, Alliance, Formations, Exploration…) */
  onNavigate: (tab: Tab) => void;
  /** open the Forge room sheet */
  onOpenForge: () => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const [artOk, setArtOk] = useState(true);
  const [view, setView] = useState<PanTransform | null>(null);
  const viewRef = useRef<PanTransform | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef(0);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  const setClamped = useCallback((x: number, y: number, z: number) => {
    const box = boxRef.current;
    if (!box) return;
    const vw = box.clientWidth;
    const vh = box.clientHeight;
    const mz = minZoom(vw, vh);
    const cz = Math.min(MAX_ZOOM, Math.max(mz, z));
    const c = clampPan(x, y, cz, vw, vh);
    const next = { x: c.x, y: c.y, z: cz };
    viewRef.current = next;
    setView(next);
  }, []);

  // Initial framing: slightly zoomed past cover, centered on the keep.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const frame = () => {
      const vw = box.clientWidth;
      const vh = box.clientHeight;
      if (vw === 0 || vh === 0) return;
      const mz = minZoom(vw, vh);
      const z = Math.min(MAX_ZOOM, mz * 1.18);
      setClamped((vw - WORLD_W * z) / 2, (vh - WORLD_H * z) / 2, z);
    };
    frame();
    const ro = new ResizeObserver(frame);
    ro.observe(box);
    return () => ro.disconnect();
  }, [setClamped]);

  const zoomBy = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      const v = viewRef.current;
      const box = boxRef.current;
      if (!v || !box) return;
      const px = cx ?? box.clientWidth / 2;
      const py = cy ?? box.clientHeight / 2;
      const mz = minZoom(box.clientWidth, box.clientHeight);
      const nz = Math.min(MAX_ZOOM, Math.max(mz, v.z * factor));
      // Keep the point under the cursor fixed while zooming.
      const nx = px - ((px - v.x) * nz) / v.z;
      const ny = py - ((py - v.y) * nz) / v.z;
      setClamped(nx, ny, nz);
    },
    [setClamped],
  );

  const recenter = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const vw = box.clientWidth;
    const vh = box.clientHeight;
    const mz = minZoom(vw, vh);
    const z = Math.min(MAX_ZOOM, mz * 1.18);
    setClamped((vw - WORLD_W * z) / 2, (vh - WORLD_H * z) / 2, z);
  }, [setClamped]);

  // ---- pointer pan + pinch (touch-action:none owns the gesture) -----------
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const onDown = (e: PointerEvent) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      downAt.current = { x: e.clientX, y: e.clientY };
      suppressClick.current = false;
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onMove = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (downAt.current) {
        const moved = Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y);
        if (moved > TAP_SLOP_PX) suppressClick.current = true;
      }
      const v = viewRef.current;
      if (!v) return;
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist.current > 0 && d > 0) {
          const rect = box.getBoundingClientRect();
          zoomBy(d / pinchDist.current, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
        }
        pinchDist.current = d;
      } else {
        setClamped(v.x + (e.clientX - prev.x), v.y + (e.clientY - prev.y), v.z);
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinchDist.current = 0;
      if (pointers.current.size === 0) downAt.current = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = box.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX - rect.left, e.clientY - rect.top);
    };

    box.addEventListener("pointerdown", onDown);
    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerup", onUp);
    box.addEventListener("pointercancel", onUp);
    box.addEventListener("wheel", onWheel, { passive: false });
    // Mouse drags can end off-element (no implicit capture for mouse) —
    // clean up there too so a stray pointer never sticks the pan.
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      box.removeEventListener("pointerdown", onDown);
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerup", onUp);
      box.removeEventListener("pointercancel", onUp);
      box.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [setClamped, zoomBy]);

  const onHotspot = (h: SceneHotspot) => {
    if (suppressClick.current) return;
    if (h.target === "forge") {
      sound.tab();
      onOpenForge();
    } else if (h.target === "business") {
      scrollToTestid("cradle-overview");
    } else if (h.target === "shipyard") {
      scrollToTestid("cradle-shipyard");
    } else {
      onNavigate(h.target);
    }
  };

  const onBoxKeyDown = (e: ReactKeyboardEvent) => {
    const v = viewRef.current;
    if (!v) return;
    const step = 72;
    if (e.key === "ArrowLeft") setClamped(v.x + step, v.y, v.z);
    else if (e.key === "ArrowRight") setClamped(v.x - step, v.y, v.z);
    else if (e.key === "ArrowUp") setClamped(v.x, v.y + step, v.z);
    else if (e.key === "ArrowDown") setClamped(v.x, v.y - step, v.z);
    else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(0.8);
    else return;
    e.preventDefault();
  };

  if (!artOk) return null;

  const z = view?.z ?? 1;
  return (
    <section
      aria-label={t("cradle.scene.label", "Your colony")}
      data-testid="cradle-scene"
      className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-sky-300/40 via-sky-200/20 to-emerald-200/20"
      style={{ height: "clamp(420px, 82dvh, 760px)", touchAction: "none" }}
    >
      {/* the pan surface */}
      <div
        ref={boxRef}
        role="application"
        tabIndex={0}
        aria-label={t("cradle.scene.panLabel", "Colony scene — drag to look around, tap a building to enter")}
        onKeyDown={onBoxKeyDown}
        className="absolute inset-0 cursor-grab outline-none active:cursor-grabbing"
      >
        {view && (
          <div
            className="absolute left-0 top-0"
            style={{
              width: WORLD_W,
              height: WORLD_H,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
              transformOrigin: "0 0",
            }}
          >
            <img
              src={SCENE_ART}
              alt=""
              aria-hidden="true"
              draggable={false}
              onError={() => setArtOk(false)}
              className="block h-full w-full select-none"
              style={{ WebkitUserDrag: "none" } as CSSProperties}
            />
            {/* building hotspots */}
            {CRADLE_HOTSPOTS.map((h) => (
              <button
                key={h.id}
                type="button"
                data-hotspot={h.id}
                aria-label={t(h.labelKey, h.defaultLabel)}
                onClick={() => onHotspot(h)}
                className="group absolute flex min-h-[48px] min-w-[48px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 p-2"
                style={{ left: `${h.x}%`, top: `${h.y}%` }}
              >
                <span
                  aria-hidden="true"
                  className="block h-4 w-4 rounded-full border-2 border-amber-200 bg-amber-400/90 shadow-[0_0_12px_rgba(251,191,36,0.9)] transition-transform group-hover:scale-125 group-active:scale-110"
                />
                <span className="whitespace-nowrap rounded-full border border-amber-200/50 bg-black/65 px-2.5 py-1 text-[11px] font-semibold text-amber-100 shadow-lg backdrop-blur-sm">
                  {t(h.labelKey, h.defaultLabel)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* floating controls */}
      <div className="absolute right-3 top-3 flex flex-col gap-2">
        <SceneControl label={t("cradle.scene.zoomIn", "Zoom in")} onClick={() => zoomBy(1.3)}>
          <span aria-hidden="true" className="text-lg leading-none">+</span>
        </SceneControl>
        <SceneControl label={t("cradle.scene.zoomOut", "Zoom out")} onClick={() => zoomBy(0.77)}>
          <span aria-hidden="true" className="text-lg leading-none">−</span>
        </SceneControl>
        <SceneControl label={t("cradle.scene.recenter", "Back to the keep")} onClick={recenter}>
          <span aria-hidden="true" className="text-base leading-none">⌂</span>
        </SceneControl>
      </div>
      <button
        type="button"
        onClick={() => scrollToTestid("cradle-overview")}
        className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/25 bg-black/65 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-sm hover:bg-black/80"
      >
        {t("cradle.scene.business", "▼ Colony business")}
      </button>
      {/* current zoom, for orientation */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/50 px-2 py-1 text-[10px] text-white/80"
      >
        {Math.round(z * 100)}%
      </div>
    </section>
  );
}

function SceneControl({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/65 text-white shadow-lg backdrop-blur-sm hover:bg-black/80"
    >
      {children}
    </button>
  );
}
