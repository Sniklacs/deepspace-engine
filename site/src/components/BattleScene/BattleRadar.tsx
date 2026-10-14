// BattleRadar — the tactical minimap (owner 2026-10-11).
//
// The whole 1.5×1.5 field in one glance: friendly dots vs enemy dots,
// turret diamonds, and event pings that flash where things are happening
// (kills, shell impacts, hot-drop landings). Dark and bordered so it reads
// over the battle; a scale bar gives the distance read.
//
// Reads the shared radar feed (game/war/battle-radar-feed.ts) on its own
// ~10Hz tick — the scene loop writes at ~4Hz and never waits on this.
//
// MAP PAN/ZOOM (owner 2026-10-14: "I just want to fucking scroll in the
// MAP VIEW"): the EXPANDED instance (`pannable`) is a real map — drag to
// pan, pinch or wheel to zoom, ◎ centers on the selected squad, ⤢
// returns to the whole field. Taps still command: a pointer-up that
// didn't travel is a tap (select / order), exactly as before — the drag
// threshold is what separates looking from ordering. The small HUD
// instance stays a fixed whole-field glance, unchanged.

import { useEffect, useRef, useState } from "react";
import {
  radarFeed,
  RADAR_PING_TTL_MS,
  RADAR_VIEW_FULL,
  centerRadarView,
  panRadarView,
  radarBoxToWorld,
  radarViewSpan,
  radarWorldToBox,
  zoomRadarView,
  type RadarView,
} from "../../game/war/battle-radar-feed";
import { WORLD_W, WORLD_H } from "../../game/war/battle-scene-model";

const PAD = 10; // panel padding around the field

const FRIEND = "#34d399";
const FOE = "#f87171";

/** Drag distance (CSS px) past which a pointer stops being a tap. */
const TAP_SLOP_PX = 7;

/**
 * Hans 2026-10-12: the radar is a command surface, not just a picture.
 * Pass `interactive` + `onTapWorld` to let taps direct troop movements
 * (e.g. when a squad's MOVE is armed). `size` scales the canvas.
 */
export function BattleRadar({
  interactive = false,
  onTapWorld,
  onTapSquad,
  selectedSquadId = null,
  size = 148,
  pannable = false,
}: {
  interactive?: boolean;
  onTapWorld?: (x: number, y: number) => void;
  /** Blip tap (owner 2026-10-13): when no move is being aimed, tapping one
   *  of your squads' blips selects that squad — the radar commands, it
   *  doesn't just show. */
  onTapSquad?: (squadId: string) => void;
  /** The selected squad's blips are ringed so the commander can see which
   *  part of the line the next order will move. */
  selectedSquadId?: string | null;
  size?: number;
  /** The expanded map view: drag-pan, pinch/wheel zoom, center-on. */
  pannable?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const CSS = size;
  const selectedRef = useRef<string | null>(selectedSquadId);
  selectedRef.current = selectedSquadId;
  // The viewport (pannable instance only; the HUD glance stays FULL).
  const viewRef = useRef<RadarView>({ ...RADAR_VIEW_FULL });
  const [, setViewTick] = useState(0);
  const gestureRef = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    downAt: { x: number; y: number } | null;
    dragged: boolean;
    pinched: boolean;
    lastPinchD: number;
  }>({ pointers: new Map(), downAt: null, dragged: false, pinched: false, lastPinchD: 0 });

  const syncViewAttrs = () => {
    const c = canvasRef.current;
    if (!c) return;
    const v = viewRef.current;
    c.dataset.viewSpan = radarViewSpan(v).toFixed(3);
    c.dataset.viewCx = ((v.x0 + v.x1) / 2).toFixed(3);
    c.dataset.viewCy = ((v.y0 + v.y1) / 2).toFixed(3);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = CSS * dpr;
    canvas.height = CSS * dpr;
    syncViewAttrs();
    let raf = 0;
    let last = 0;

    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      if (nowMs - last < 100) return; // ~10Hz — dots don't need 60fps
      last = nowMs;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, CSS, CSS);

      // panel — dark and opaque so it reads over the fighting
      ctx.fillStyle = "rgba(4,7,13,0.86)";
      ctx.beginPath();
      ctx.roundRect(0, 0, CSS, CSS, 10);
      ctx.fill();
      // the visible border — the whole map scene inside it
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(1, 1, CSS - 2, CSS - 2, 9);
      ctx.stroke();

      const fw = CSS - PAD * 2;
      const fh = CSS - PAD * 2 - 14; // room for the scale bar
      const view = viewRef.current;
      const sx = (x: number) => PAD + radarWorldToBox(x, 0, view).fx * fw;
      const sy = (y: number) => PAD + radarWorldToBox(0, y, view).fy * fh;

      // Everything field-shaped clips to the field box — when zoomed,
      // off-view dots and the world edge slide under the frame honestly.
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD, PAD, fw, fh);
      ctx.clip();

      // the world boundary, projected through the view
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx(0), sy(0), sx(WORLD_W) - sx(0), sy(WORLD_H) - sy(0));

      // dots
      for (const d of radarFeed.dots) {
        const x = sx(d.x), y = sy(d.y);
        if (x < PAD - 6 || y < PAD - 6 || x > PAD + fw + 6 || y > PAD + fh + 6) continue;
        const c = d.side === "attacker" ? FRIEND : FOE;
        if (d.kind === "turret") {
          ctx.fillStyle = c;
          ctx.globalAlpha = 0.95;
          const r = 3.2;
          ctx.beginPath();
          ctx.moveTo(x, y - r); ctx.lineTo(x + r, y);
          ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
          ctx.closePath(); ctx.fill();
        } else {
          ctx.fillStyle = c;
          ctx.globalAlpha = d.alive ? 0.9 : 0.25;
          ctx.beginPath();
          ctx.arc(x, y, d.alive ? 2.1 : 1.6, 0, Math.PI * 2);
          ctx.fill();
          // The selected squad reads as a ringed cluster — the commander
          // sees exactly which stretch of the line the next tap moves.
          if (d.squadId && d.squadId === selectedRef.current) {
            ctx.globalAlpha = 0.95;
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.arc(x, y, 4.1, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;

      // event pings — expanding rings where things just happened
      const now = Date.now();
      for (const p of radarFeed.pings) {
        const age = now - p.atMs;
        if (age >= RADAR_PING_TTL_MS) continue;
        const k = age / RADAR_PING_TTL_MS; // 0 → 1
        const x = sx(p.x), y = sy(p.y);
        const col =
          p.kind === "shell" ? "255,170,60" :
          p.kind === "blast" ? "255,120,80" : "255,255,255";
        ctx.strokeStyle = `rgba(${col},${(1 - k) * 0.95})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 3 + k * 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(${col},${(1 - k) * 0.9})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // scale bar — 0.5 world units AT THE CURRENT VIEW, so distances
      // read at a glance at any zoom
      const barUnits = 0.5;
      const barPx = (barUnits / radarViewSpan(view)) * fw;
      const by = PAD + fh + 8;
      ctx.strokeStyle = "rgba(255,255,255,0.65)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(PAD, by); ctx.lineTo(PAD + barPx, by);
      ctx.moveTo(PAD, by - 3); ctx.lineTo(PAD, by + 3);
      ctx.moveTo(PAD + barPx, by - 3); ctx.lineTo(PAD + barPx, by + 3);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.font = "600 9px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("0.5", PAD + barPx + 5, by);

      // tag
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "700 8px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText("RADAR", CSS - PAD, by);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [CSS]);

  // Wheel zoom (pannable only) — native listener so preventDefault works.
  useEffect(() => {
    if (!pannable) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const fw = CSS - PAD * 2;
      const fh = CSS - PAD * 2 - 14;
      const fx = ((e.clientX - rect.left) / rect.width * CSS - PAD) / fw;
      const fy = ((e.clientY - rect.top) / rect.height * CSS - PAD) / fh;
      const anchor = radarBoxToWorld(fx, fy, viewRef.current);
      const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      viewRef.current = zoomRadarView(viewRef.current, factor, anchor.x, anchor.y);
      syncViewAttrs();
      setViewTick((n) => n + 1);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [pannable, CSS]);

  // Tap → world coords → the commander's destination. The mapping is the
  // exact inverse of the draw transform (same PAD/field box), THROUGH the
  // current view: a tap lands where the blip under the finger says it
  // lands, at any pan/zoom.
  const tapWorld = (clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } | null => {
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    const fw = CSS - PAD * 2;
    const fh = CSS - PAD * 2 - 14;
    const fx = (px * CSS - PAD) / fw;
    const fy = (py * CSS - PAD) / fh;
    if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return null;
    const w = radarBoxToWorld(fx, fy, viewRef.current);
    if (w.x < 0 || w.y < 0 || w.x > WORLD_W || w.y > WORLD_H) return null;
    return w;
  };

  const handleTapAt = (clientX: number, clientY: number, rect: DOMRect) => {
    const w = tapWorld(clientX, clientY, rect);
    if (!w) return;
    if (interactive && onTapWorld) {
      onTapWorld(w.x, w.y);
      return;
    }
    // No move being aimed: a tap on (or near) one of your squads' blips
    // selects that squad. Fat-finger radius — squads are clusters, so the
    // nearest friendly unit dot within the radius names the squad.
    if (onTapSquad) {
      let best: string | null = null;
      let bd = 0.09; // world units — ~20px on the expanded radar
      for (const d of radarFeed.dots) {
        if (d.side !== "attacker" || d.kind !== "unit" || !d.alive || !d.squadId) continue;
        const dist = Math.hypot(d.x - w.x, d.y - w.y);
        if (dist < bd) { bd = dist; best = d.squadId; }
      }
      if (best) onTapSquad(best);
    }
  };

  const handleTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    handleTapAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
  };

  // --- pannable gesture layer -------------------------------------------
  // Pointer-down NO LONGER fires the tap on the pannable instance: the
  // gesture must first prove it isn't a drag or a pinch. Tap fires on
  // pointer-up within TAP_SLOP_PX of travel.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pannable) {
      if (tappable) handleTap(e);
      return;
    }
    const g = gestureRef.current;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pointers.size === 1) { g.dragged = false; g.pinched = false; g.downAt = { x: e.clientX, y: e.clientY }; }
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.lastPinchD = Math.hypot(a.x - b.x, a.y - b.y);
      g.pinched = true;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pannable) return;
    const g = gestureRef.current;
    const prev = g.pointers.get(e.pointerId);
    if (!prev) return;
    const dxPx = e.clientX - prev.x;
    const dyPx = e.clientY - prev.y;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = e.currentTarget.getBoundingClientRect();
    const fw = CSS - PAD * 2;
    const fh = CSS - PAD * 2 - 14;
    if (g.pointers.size === 2) {
      // pinch: zoom around the (moving) midpoint
      const [a, b] = [...g.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.lastPinchD > 0 && d > 0) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const fx = ((mid.x - rect.left) / rect.width * CSS - PAD) / fw;
        const fy = ((mid.y - rect.top) / rect.height * CSS - PAD) / fh;
        const anchor = radarBoxToWorld(fx, fy, viewRef.current);
        viewRef.current = zoomRadarView(viewRef.current, g.lastPinchD / d, anchor.x, anchor.y);
        syncViewAttrs();
        setViewTick((n) => n + 1);
      }
      g.lastPinchD = d;
      g.dragged = true;
      return;
    }
    if (dxPx !== 0 || dyPx !== 0) {
      // Pan: dragging the CONTENT — the view moves opposite the finger.
      const span = radarViewSpan(viewRef.current);
      viewRef.current = panRadarView(viewRef.current, -(dxPx / fw) * span, -(dyPx / fh) * span);
      syncViewAttrs();
      setViewTick((n) => n + 1);
      // A gesture is a drag once its TOTAL travel passes the slop.
      if (g.downAt && Math.hypot(e.clientX - g.downAt.x, e.clientY - g.downAt.y) > TAP_SLOP_PX) {
        g.dragged = true;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pannable) return;
    const g = gestureRef.current;
    const wasTap = !g.dragged && !g.pinched && g.pointers.size === 1;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size === 0) {
      if (wasTap && tappable) handleTapAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
      g.dragged = false;
      g.pinched = false;
    }
  };

  const centerOnSelected = () => {
    const sel = selectedRef.current;
    if (!sel) return;
    const dots = radarFeed.dots.filter((d) => d.squadId === sel && d.alive);
    if (dots.length === 0) return;
    const cx = dots.reduce((s, d) => s + d.x, 0) / dots.length;
    const cy = dots.reduce((s, d) => s + d.y, 0) / dots.length;
    viewRef.current = centerRadarView(cx, cy, 0.8);
    syncViewAttrs();
    setViewTick((n) => n + 1);
  };

  const fullView = () => {
    viewRef.current = { ...RADAR_VIEW_FULL };
    syncViewAttrs();
    setViewTick((n) => n + 1);
  };

  const tappable = interactive || !!onTapSquad;

  const canvas = (
    <canvas
      ref={canvasRef}
      style={{ width: CSS, height: CSS, touchAction: pannable ? "none" : undefined }}
      onPointerDown={tappable || pannable ? onPointerDown : undefined}
      onPointerMove={pannable ? onPointerMove : undefined}
      onPointerUp={pannable ? onPointerUp : undefined}
      onPointerCancel={pannable ? onPointerUp : undefined}
      className={`block ${tappable ? "cursor-crosshair" : ""} ${pannable ? "" : "touch-manipulation"} ${!tappable && !pannable ? "pointer-events-none" : ""}`}
      data-testid="battle-radar"
      data-interactive={interactive ? "true" : undefined}
      data-pannable={pannable ? "true" : undefined}
      aria-label={
        interactive
          ? "Battle radar: tap to set the squad's destination"
          : onTapSquad
            ? "Battle radar: tap one of your squads to select it"
            : "Battle radar: whole-field minimap"
      }
    />
  );

  if (!pannable) return canvas;

  return (
    <div className="relative" data-testid="battle-radar-pannable">
      {canvas}
      <div className="absolute bottom-4 right-1 flex gap-1">
        <button
          type="button"
          onClick={centerOnSelected}
          data-testid="radar-center-selected"
          aria-label="Center the map on the selected squad"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(255,255,255,0.25)] bg-[#0b0f16]/90 text-[13px] text-[#eef1f6] active:scale-95"
        >
          ◎
        </button>
        <button
          type="button"
          onClick={fullView}
          data-testid="radar-full-view"
          aria-label="Show the whole field"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(255,255,255,0.25)] bg-[#0b0f16]/90 text-[13px] text-[#eef1f6] active:scale-95"
        >
          ⤢
        </button>
      </div>
    </div>
  );
}
