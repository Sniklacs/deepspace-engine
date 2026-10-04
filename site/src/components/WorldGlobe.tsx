// WorldGlobe — THE WORLD. Hans (Oct 4 2026): "the globe is the world" — the
// main core workstation. An interactive spinnable globe: touch-drag to spin,
// pinch/wheel to zoom, tap a marker for a beautiful detail sheet.
//
// PHASE 1 = LAYOUT (Hans, Oct 4 2026): the globe, layers, markers, legend and
// detail sheets stand on their own, spaced out and beautiful. Wiring markers
// to destinations (enter colony, launch raid, rally defense) is the linking
// pass — action buttons render per Hans's "nothing without a button" rule and
// explain inline that wiring lands next.
//
// Canvas 2D, 2D Plus style, and per Hans's universal rule it POPS: atmosphere
// glow, terminator shading, city lights, glowing pulse markers, starfield.
// Interaction model mirrors StarMap (drag threshold tap-vs-spin, inertia,
// smoothed pinch/wheel zoom).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "../game/types";
import {
  buildGlobeMarkers,
  countByLayer,
  declutterMarkers,
  GLOBE_LAYERS,
  GLOBE_LAYER_META,
  projectGlobe,
  type GlobeLayerId,
  type GlobeMarker,
  type ScreenMarker,
} from "../game/globe-layers";
import { racePortrait } from "./HeroCard";
import { useT } from "./i18n/I18n";
import { playClick, playDeselect, playSelect, playWhoosh } from "../game/audio/ui-sounds";

const LAYER_STORE_KEY = "worldglobe.layers.v1";
const MIN_DIST_PX = 26;
const TILT_MAX = 55;

type ViewState = { spin: number; tilt: number; scale: number; targetScale: number };

// Seeded RNG — stable procedural detail across sessions.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Blob { lat: number; lon: number; r: number; shade: number }
interface Light { lat: number; lon: number }
interface Star { x: number; y: number; r: number; tw: number; ph: number }

// Procedural geography — one alien world, same every visit.
const BLOBS: Blob[] = (() => {
  const rng = mulberry32(20261004);
  const out: Blob[] = [];
  for (let i = 0; i < 46; i++) {
    out.push({
      lat: (rng() * 2 - 1) * 62,
      lon: rng() * 360 - 180,
      r: 5 + rng() * 11,
      shade: rng(),
    });
  }
  return out;
})();

const CITY_LIGHTS: Light[] = (() => {
  const rng = mulberry32(777);
  const out: Light[] = [];
  for (let i = 0; i < 110; i++) {
    out.push({ lat: (rng() * 2 - 1) * 60, lon: rng() * 360 - 180 });
  }
  return out;
})();

const STARS: Star[] = (() => {
  const rng = mulberry32(4242);
  const out: Star[] = [];
  for (let i = 0; i < 150; i++) {
    out.push({ x: rng(), y: rng(), r: 0.4 + rng() * 1.3, tw: 0.4 + rng() * 0.6, ph: rng() * Math.PI * 2 });
  }
  return out;
})();

// Glow sprite cache — one radial-gradient canvas per color, reused for every
// marker so the POP stays cheap.
const glowCache = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string): HTMLCanvasElement {
  let c = glowCache.get(color);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, color + "b0");
    grad.addColorStop(1, color + "00");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(color, c);
  }
  return c;
}

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export default function WorldGlobe({ state, now }: { state: GameState; now: number }) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<ViewState>({ spin: 24, tilt: 14, scale: 1, targetScale: 1 });
  const drag = useRef<{
    x: number; y: number; startX: number; startY: number; moved: boolean;
    lastT: number; velSpin: number; velTilt: number;
  } | null>(null);
  const pinch = useRef<{ d: number } | null>(null);
  const lastInteract = useRef(0);
  const screenPos = useRef(new Map<string, { x: number; y: number; r: number }>());
  const markersRef = useRef<GlobeMarker[]>([]);
  const reduceMotion = useRef(false);

  const [layersOn, setLayersOn] = useState<Record<GlobeLayerId, boolean>>(() => {
    const init = Object.fromEntries(GLOBE_LAYERS.map((l) => [l.id, l.defaultOn])) as Record<GlobeLayerId, boolean>;
    try {
      const raw = localStorage.getItem(LAYER_STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Record<GlobeLayerId, boolean>>;
        for (const l of GLOBE_LAYERS) if (typeof saved[l.id] === "boolean") init[l.id] = saved[l.id]!;
      }
    } catch { /* corrupted prefs → defaults */ }
    return init;
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkHint, setLinkHint] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(true);

  const markers = useMemo(() => buildGlobeMarkers(state, now), [state, now]);
  const counts = useMemo(() => countByLayer(markers), [markers]);
  markersRef.current = markers;
  const selected = useMemo(() => markers.find((m) => m.id === selectedId) ?? null, [markers, selectedId]);

  const toggleLayer = useCallback((id: GlobeLayerId) => {
    setLayersOn((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(LAYER_STORE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
    playClick();
  }, []);

  // "Tap to enter" (owner 2026-10-04): the legend's home row promises the
  // colony sheet, so tapping it opens the home detail sheet instead of just
  // toggling. The layer is forced visible so the marker is there to see.
  const openHomeSheet = useCallback(() => {
    setLayersOn((prev) => {
      if (prev.home) return prev;
      const next = { ...prev, home: true };
      try { localStorage.setItem(LAYER_STORE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
    playSelect();
    setSelectedId("home");
    setLinkHint(null);
  }, []);

  // layersOn/selectedId refs for the render loop (avoid re-subscribing)
  const layersOnRef = useRef(layersOn);
  layersOnRef.current = layersOn;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // ---- render loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    reduceMotion.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let w = 0, h = 0, dpr = 1;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      dpr = Math.min(2.5, window.devicePixelRatio || 1);
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Native non-passive wheel listener so globe zoom doesn't fight page scroll.
    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      lastInteract.current = performance.now();
      const v = view.current;
      v.targetScale = Math.min(3, Math.max(0.7, v.targetScale * (e.deltaY < 0 ? 1.12 : 0.89)));
    };
    canvas.addEventListener("wheel", wheelHandler, { passive: false });

    let raf = 0;
    let last = performance.now();
    const frame = (ms: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (ms - last) / 1000);
      last = ms;
      const v = view.current;

      // smooth zoom
      v.scale += (v.targetScale - v.scale) * Math.min(1, dt * 8);
      // gentle ambient drift when idle (never while dragging)
      if (!drag.current && !reduceMotion.current && ms - lastInteract.current > 5000) {
        v.spin += dt * 1.6;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) * 0.40 * v.scale;
      const time = ms / 1000;

      // 1 — starfield (parallax drift with spin)
      ctx.fillStyle = "#02040a";
      ctx.fillRect(0, 0, w, h);
      for (const s of STARS) {
        const sx = (((s.x * w - v.spin * 1.5) % w) + w) % w;
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * s.tw + s.ph));
        ctx.globalAlpha = a * 0.8;
        ctx.fillStyle = "#cfe4ff";
        ctx.beginPath();
        ctx.arc(sx, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 2 — atmosphere glow (behind the sphere)
      const atm = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.32);
      atm.addColorStop(0, "rgba(56,189,248,0.30)");
      atm.addColorStop(0.75, "rgba(56,189,248,0.10)");
      atm.addColorStop(1, "rgba(56,189,248,0)");
      ctx.fillStyle = atm;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.32, 0, Math.PI * 2);
      ctx.fill();

      // 3 — ocean sphere
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      const ocean = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.38, R * 0.1, cx, cy, R * 1.35);
      ocean.addColorStop(0, "#1d5a8a");
      ocean.addColorStop(0.55, "#0d2f52");
      ocean.addColorStop(1, "#071a30");
      ctx.fillStyle = ocean;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

      // 4 — landmasses (true 3D rotation)
      for (const b of BLOBS) {
        const p = projectGlobe(b.lat, b.lon, v.spin, v.tilt);
        if (!p.visible) continue;
        const rPx = (b.r * Math.PI) / 180 * R;
        const a = 0.45 + 0.55 * p.z;
        ctx.globalAlpha = a * 0.9;
        ctx.fillStyle = b.shade > 0.5 ? "#17604c" : "#124a44";
        ctx.beginPath();
        ctx.ellipse(cx + p.x * R, cy + p.y * R, rPx, rPx * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 5 — ice caps
      for (const capLat of [78, -78]) {
        const p = projectGlobe(capLat, 0, v.spin, v.tilt);
        if (!p.visible) continue;
        const rPx = (15 * Math.PI) / 180 * R;
        const g2 = ctx.createRadialGradient(cx + p.x * R, cy + p.y * R, 0, cx + p.x * R, cy + p.y * R, rPx);
        g2.addColorStop(0, `rgba(226,240,250,${0.85 * p.z})`);
        g2.addColorStop(1, "rgba(226,240,250,0)");
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(cx + p.x * R, cy + p.y * R, rPx, 0, Math.PI * 2);
        ctx.fill();
      }

      // 6 — graticule
      ctx.strokeStyle = "rgba(148,163,184,0.10)";
      ctx.lineWidth = 1;
      for (let lon = -180; lon < 180; lon += 30) {
        ctx.beginPath();
        let pen = false;
        for (let lat = -90; lat <= 90; lat += 6) {
          const p = projectGlobe(lat, lon, v.spin, v.tilt);
          if (!p.visible) { pen = false; continue; }
          const x = cx + p.x * R, y = cy + p.y * R;
          if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath();
        let pen = false;
        for (let lon = -180; lon <= 180; lon += 6) {
          const p = projectGlobe(lat, lon, v.spin, v.tilt);
          if (!p.visible) { pen = false; continue; }
          const x = cx + p.x * R, y = cy + p.y * R;
          if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // 7 — city lights on the night band
      ctx.globalCompositeOperation = "lighter";
      for (const L of CITY_LIGHTS) {
        const p = projectGlobe(L.lat, L.lon, v.spin, v.tilt);
        if (p.z < -0.15 || p.z > 0.5) continue;
        ctx.globalAlpha = 0.55 * (0.5 - p.z);
        ctx.fillStyle = "#fcd34d";
        ctx.fillRect(cx + p.x * R - 0.8, cy + p.y * R - 0.8, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      // 8 — terminator shading
      const term = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      term.addColorStop(0, "rgba(2,6,14,0)");
      term.addColorStop(1, "rgba(2,6,14,0.55)");
      ctx.fillStyle = term;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.restore();

      // 9 — rim light (the POP)
      ctx.save();
      ctx.strokeStyle = "rgba(125,211,252,0.55)";
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 14;
      ctx.shadowColor = "#38bdf8";
      ctx.beginPath();
      ctx.arc(cx, cy, R - 1, Math.PI * 0.55, Math.PI * 1.45);
      ctx.stroke();
      ctx.restore();

      // 10 — satellite orbit ring
      if (layersOnRef.current.satellites) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-0.32);
        ctx.strokeStyle = "rgba(56,189,248,0.25)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(0, 0, R * 1.5, R * 1.5 * 0.36, 0, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const a = time * 0.12 + (i * Math.PI) / 2;
          const ex = Math.cos(a) * R * 1.5;
          const ey = Math.sin(a) * R * 1.5 * 0.36;
          const blink = 0.5 + 0.5 * Math.sin(time * 3 + i * 2);
          ctx.globalAlpha = 0.5 + 0.5 * blink;
          ctx.fillStyle = "#7dd3fc";
          ctx.beginPath();
          ctx.arc(ex, ey, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      // 11 — markers
      const projected: ScreenMarker[] = [];
      for (const m of markersRef.current) {
        if (!layersOnRef.current[m.layer]) continue;
        const p = projectGlobe(m.lat, m.lon, v.spin, v.tilt);
        if (!p.visible) continue;
        projected.push({ marker: m, sx: cx + p.x * R, sy: cy + p.y * R });
      }
      const shown = declutterMarkers(projected, MIN_DIST_PX);
      screenPos.current.clear();
      for (const s of shown) {
        const m = s.marker;
        const isSel = m.id === selectedIdRef.current;
        const base = isSel ? 15 : 10;
        const spr = glowSprite(m.color);
        const sprSize = base * 3.2;
        ctx.drawImage(spr, s.sx - sprSize / 2, s.sy - sprSize / 2, sprSize, sprSize);
        // core
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, isSel ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
        // pulse ring for raids (and selected)
        if (m.pulse || isSel) {
          const pr = base + 5 + 4 * Math.sin(time * 4);
          ctx.strokeStyle = m.color + "cc";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(s.sx, s.sy, Math.max(4, pr), 0, Math.PI * 2);
          ctx.stroke();
        }
        screenPos.current.set(m.id, { x: s.sx, y: s.sy, r: Math.max(20, base + 8) });
        // label pill for the selected marker
        if (isSel) {
          ctx.font = "600 11px system-ui, sans-serif";
          const tw = ctx.measureText(m.label).width;
          const px = Math.min(Math.max(s.sx, tw / 2 + 12), w - tw / 2 - 12);
          const py = Math.max(26, s.sy - 34);
          roundRectPath(ctx, px - tw / 2 - 8, py - 14, tw + 16, 24, 12);
          ctx.fillStyle = "rgba(2,6,14,0.85)";
          ctx.fill();
          ctx.strokeStyle = m.color;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(m.label, px, py - 1);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("wheel", wheelHandler);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- interaction ----
  const hitTest = useCallback((x: number, y: number): string | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const lx = x - rect.left, ly = y - rect.top;
    // highest priority first
    const entries = [...screenPos.current.entries()].sort((a, b) => {
      const ma = markersRef.current.find((m) => m.id === a[0]);
      const mb = markersRef.current.find((m) => m.id === b[0]);
      return (mb?.priority ?? 0) - (ma?.priority ?? 0);
    });
    for (const [id, p] of entries) {
      const dx = lx - p.x, dy = ly - p.y;
      if (dx * dx + dy * dy <= p.r * p.r) return id;
    }
    return null;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    lastInteract.current = performance.now();
    drag.current = {
      x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY,
      moved: false, lastT: performance.now(), velSpin: 0, velTilt: 0,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 6) d.moved = true;
    if (!d.moved) return;
    lastInteract.current = performance.now();
    const v = view.current;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    const dSpin = dx * 0.22;
    const dTilt = dy * 0.15;
    v.spin += dSpin;
    v.tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, v.tilt + dTilt));
    d.velSpin = d.velSpin * 0.8 + (dSpin / dt) * 1000 * 0.2;
    d.velTilt = d.velTilt * 0.8 + (dTilt / dt) * 1000 * 0.2;
    d.x = e.clientX;
    d.y = e.clientY;
    d.lastT = now;
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    lastInteract.current = performance.now();
    if (!d.moved) {
      const id = hitTest(e.clientX, e.clientY);
      if (id) {
        if (id === selectedIdRef.current) {
          playDeselect();
          setSelectedId(null);
        } else {
          playSelect();
          setSelectedId(id);
        }
        setLinkHint(null);
      } else if (selectedIdRef.current) {
        playDeselect();
        setSelectedId(null);
        setLinkHint(null);
      }
      return;
    }
    // fling → inertia
    if (Math.abs(d.velSpin) > 30 || Math.abs(d.velTilt) > 30) playWhoosh();
    let vs = d.velSpin, vt = d.velTilt;
    const tick = () => {
      if (drag.current) return;
      vs *= 0.94;
      vt *= 0.94;
      if (Math.abs(vs) < 2 && Math.abs(vt) < 2) return;
      const v = view.current;
      v.spin += (vs * 16) / 1000;
      v.tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, v.tilt + (vt * 16) / 1000));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [hitTest]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      lastInteract.current = performance.now();
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch.current) {
        const v = view.current;
        v.targetScale = Math.min(3, Math.max(0.7, v.targetScale * (d / pinch.current.d)));
      }
      pinch.current = { d };
    }
  }, []);
  const onTouchEnd = useCallback(() => { pinch.current = null; }, []);

  const zoomBy = useCallback((f: number) => {
    lastInteract.current = performance.now();
    const v = view.current;
    v.targetScale = Math.min(3, Math.max(0.7, v.targetScale * f));
    playClick();
  }, []);

  const recenter = useCallback(() => {
    lastInteract.current = performance.now();
    const v = view.current;
    v.spin = 24;
    v.tilt = 14;
    v.targetScale = 1;
    playClick();
  }, []);

  const closeSheet = useCallback(() => {
    setSelectedId(null);
    setLinkHint(null);
    playDeselect();
  }, []);

  const soonHint = useCallback((label: string) => {
    setLinkHint(
      t("worldglobe.linkingSoon", "{label} wires up in the linking pass — this is the layout preview.", { label }),
    );
    playClick();
  }, [t]);

  return (
    <section aria-label={t("worldglobe.title", "The World")} className="relative">
      <div
        ref={wrapRef}
        className="relative w-full touch-none select-none overflow-hidden rounded-2xl border border-white/10 bg-[#02040a]"
        style={{ height: "62dvh", minHeight: 400 }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t("worldglobe.canvasLabel", "Interactive globe of the world. Drag to spin, pinch or scroll to zoom, tap a marker for details.")}
          className="absolute inset-0 h-full w-full"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { drag.current = null; }}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />

        {/* Legend — every layer toggleable */}
        <div className="absolute left-2 top-2 z-10 max-h-[70%] overflow-y-auto rounded-xl border border-white/10 bg-black/55 p-1.5 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setLegendOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 px-1.5 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-200"
            aria-expanded={legendOpen}
          >
            {t("worldglobe.legend", "Legend")}
            <span aria-hidden>{legendOpen ? "▾" : "▸"}</span>
          </button>
          {legendOpen && (
            <ul className="mt-0.5 space-y-0.5">
              {GLOBE_LAYERS.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => (l.id === "home" ? openHomeSheet() : toggleLayer(l.id))}
                    aria-pressed={layersOn[l.id]}
                    title={l.blurb}
                    className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12px] transition-opacity ${
                      layersOn[l.id] ? "text-gray-100" : "text-gray-500 opacity-60"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        background: l.color,
                        boxShadow: layersOn[l.id] ? `0 0 6px ${l.color}` : "none",
                      }}
                    />
                    <span className="flex-1">{t(`worldglobe.layer.${l.id}`, l.label)}</span>
                    <span className="rounded-full bg-white/10 px-1.5 text-[10px] text-gray-300">{counts[l.id]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-2 right-2 z-10 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => zoomBy(1.25)}
            aria-label={t("worldglobe.zoomIn", "Zoom in")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/55 text-lg text-white backdrop-blur-sm"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomBy(0.8)}
            aria-label={t("worldglobe.zoomOut", "Zoom out")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/55 text-lg text-white backdrop-blur-sm"
          >
            −
          </button>
          <button
            type="button"
            onClick={recenter}
            aria-label={t("worldglobe.recenter", "Recenter the globe")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/55 text-base text-white backdrop-blur-sm"
          >
            ⌂
          </button>
        </div>

        {/* Detail sheet */}
        {selected && (
          <DetailSheet marker={selected} onClose={closeSheet} onAction={soonHint} hint={linkHint} />
        )}
      </div>
      <p className="mt-1.5 text-center text-[11px] text-gray-500">
        {t("worldglobe.hint", "Drag to spin the world — tap a glowing marker for its story.")}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Detail sheet — beautiful, never an ugly popup
// ---------------------------------------------------------------------------

function DetailSheet({
  marker,
  onClose,
  onAction,
  hint,
}: {
  marker: GlobeMarker;
  onClose: () => void;
  onAction: (label: string) => void;
  hint: string | null;
}) {
  const t = useT();
  const meta = GLOBE_LAYER_META[marker.layer];

  return (
    <div
      role="dialog"
      aria-label={marker.label}
      className="absolute inset-x-0 bottom-0 z-20 max-h-[58%] overflow-y-auto rounded-t-2xl border-t bg-[#0a0d18]/95 backdrop-blur-md"
      style={{ borderTopColor: `${marker.color}66`, boxShadow: `0 -12px 48px ${marker.color}33` }}
    >
      <div className="flex justify-center pt-2">
        <div className="h-1 w-10 rounded-full bg-white/25" />
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("worldglobe.close", "Close")}
        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/5 text-base text-white"
      >
        ✕
      </button>

      <div className="flex gap-3 px-4 pb-5 pt-1">
        <SheetArt marker={marker} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: marker.color }}>
            {t(`worldglobe.layer.${marker.layer}`, meta.label)}
          </p>
          <h3 className="mt-0.5 text-[17px] font-bold leading-tight text-white">{marker.label}</h3>
          <p className="mt-0.5 text-[12px] text-gray-400">{marker.sublabel}</p>
          <SheetStats marker={marker} />
        </div>
      </div>

      <div className="px-4 pb-4">
        <SheetActions marker={marker} onAction={onAction} />
        {hint && (
          <p role="status" className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] text-gray-300">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

function SheetArt({ marker }: { marker: GlobeMarker }) {
  const r = marker.ref;
  let src: string | null = null;
  let alt = "";
  if (r.kind === "chorus") {
    src = "/" + r.site.art;
    alt = `Grade ${r.site.gradeLabel} Chorus site`;
  } else if (r.kind === "colony" || r.kind === "home") {
    const raceId = r.kind === "colony" ? r.colony.race : undefined;
    if (raceId) {
      try { src = racePortrait(raceId); } catch { src = null; }
      alt = "Colony";
    }
  }
  if (!src) {
    return (
      <div
        aria-hidden
        className="h-20 w-16 shrink-0 rounded-lg border"
        style={{
          borderColor: `${marker.color}55`,
          background: `radial-gradient(circle at 50% 35%, ${marker.color}55, rgba(0,0,0,0.4))`,
          boxShadow: `0 0 18px ${marker.color}33`,
        }}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="h-24 w-20 shrink-0 rounded-lg border object-cover"
      style={{ borderColor: `${marker.color}55`, boxShadow: `0 0 18px ${marker.color}44` }}
      loading="lazy"
    />
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">{k}</div>
      <div className="text-[13px] font-semibold text-gray-100">{v}</div>
    </div>
  );
}

function SheetStats({ marker }: { marker: GlobeMarker }) {
  const t = useT();
  const r = marker.ref;
  if (r.kind === "chorus") {
    const s = r.site;
    return (
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat k={t("worldglobe.strength", "Strength")} v={s.strength.toLocaleString()} />
        <Stat k={t("worldglobe.garrison", "Garrison")} v={s.garrisonTroops.toLocaleString()} />
        <Stat k={t("worldglobe.recTroops", "Rec. troops")} v={s.recommendedTroops.toLocaleString()} />
        <Stat k={t("worldglobe.recReverb", "Rec. reverb")} v={s.recommendedReverb.toLocaleString()} />
      </div>
    );
  }
  if (r.kind === "site") {
    return (
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat k={t("worldglobe.tier", "Tier")} v={`T${r.tier}`} />
        <Stat k={t("worldglobe.risk", "Risk")} v={`${r.zone.risk}/100`} />
        <Stat k={t("worldglobe.embers", "Embers")} v={`${r.zone.emberYield}`} />
        <Stat k={t("worldglobe.chorusRisk", "Chorus risk")} v={`${Math.round(r.zone.chorusRisk * 100)}%`} />
      </div>
    );
  }
  if (r.kind === "colony") {
    const c = r.colony;
    return (
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat k={t("worldglobe.status", "Status")} v={c.status} />
        {typeof c.reverb === "number" && (
          <Stat k={t("worldglobe.reverb", "Reverb")} v={c.reverb.toLocaleString()} />
        )}
        {typeof c.approxTroops === "number" && (
          <Stat k={t("worldglobe.troops", "Troops")} v={`~${c.approxTroops.toLocaleString()}`} />
        )}
      </div>
    );
  }
  if (r.kind === "raid") {
    const rd = r.raid;
    return (
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Stat k={t("worldglobe.from", "From")} v={rd.attackerWorldName || "?"} />
        <Stat k={t("worldglobe.ships", "Ships")} v={`${rd.shipCount}`} />
      </div>
    );
  }
  return null;
}

function ActionButton({ label, primary, onClick }: { label: string; primary?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-4 py-2.5 text-[13px] font-bold ${
        primary
          ? "bg-red-500/80 text-white shadow-[0_0_16px_rgba(239,68,68,0.45)]"
          : "border border-white/15 bg-white/5 text-gray-100"
      }`}
    >
      {label}
    </button>
  );
}

function SheetActions({ marker, onAction }: { marker: GlobeMarker; onAction: (label: string) => void }) {
  const t = useT();
  const r = marker.ref;
  const go = (label: string) => () => onAction(label);

  if (r.kind === "chorus") {
    return (
      <div className="flex flex-wrap gap-2">
        <ActionButton primary label={t("worldglobe.launchRaid", "⚔️ LAUNCH RAID")} onClick={go(t("worldglobe.launchRaid", "Raid launch"))} />
      </div>
    );
  }
  if (r.kind === "home") {
    return (
      <div className="flex flex-wrap gap-2">
        <ActionButton primary label={t("worldglobe.enterColony", "Enter colony")} onClick={go(t("worldglobe.enterColony", "Enter colony"))} />
      </div>
    );
  }
  if (r.kind === "colony") {
    const c = r.colony;
    return (
      <div className="flex flex-wrap gap-2">
        {c.status === "husk" ? (
          <ActionButton primary label={t("worldglobe.claimHusk", "Claim as sub colony")} onClick={go(t("worldglobe.claimHusk", "Husk claim"))} />
        ) : (
          <>
            <ActionButton primary label={t("worldglobe.raid", "Raid")} onClick={go(t("worldglobe.raid", "Raid"))} />
            {c.status === "abandoned" && (
              <ActionButton label={t("worldglobe.glean", "Glean")} onClick={go(t("worldglobe.glean", "Glean"))} />
            )}
          </>
        )}
      </div>
    );
  }
  if (r.kind === "site") {
    return (
      <div className="flex flex-wrap gap-2">
        <ActionButton primary label={t("worldglobe.explore", "Explore")} onClick={go(t("worldglobe.explore", "Explore"))} />
      </div>
    );
  }
  if (r.kind === "raid") {
    return (
      <div className="flex flex-wrap gap-2">
        <ActionButton primary label={t("worldglobe.rallyDefense", "🛡️ Rally the defense")} onClick={go(t("worldglobe.rallyDefense", "Defense rally"))} />
      </div>
    );
  }
  return null;
}
