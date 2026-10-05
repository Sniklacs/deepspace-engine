// BATTLE SCENE — the 2D battle scene canvas (Battle Scene P1).
//
// Read-only live view + full presentation. NO command sending (phase 2).
// Tactical map with terrain, unit models, day/night skins, tracers, muzzle
// flashes, explosions, screen shake, toggle-switch control deck, gunner
// targeting view, and the shared battle clock with doctrine phase markers.
//
// Feeds from a SceneBattle (demo) or sceneFromBattle(live Battle). Casualty
// ticks come from the engine's battleMoment when provided; otherwise a
// scripted demo curve.

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  SCENE_PHASES,
  sceneClockS,
  sceneNightFactor,
  scenePhaseAt,
  VECTOR_LANES,
  type SceneBattle,
  type ScenePhase,
  type SceneTurret,
  type SceneUnit,
} from "../../game/war/battle-scene-model";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
  setVectorOn,
  setTurretsOn,
  setLogisticsFx,
  setManual,
  cycleDayNight,
  setGunner,
  setGunTarget,
  setClock,
  bumpKill,
  registerTurrets,
  resetSceneUI,
} from "../../game/war/battle-scene-ui-store";
import {
  subscribeWindows,
  windowSnapshot,
  windowServerSnapshot,
  isWindowOpen,
  openWindow,
  closeWindowsOfKind,
} from "../../game/windows/window-store";
import type { ManeuverVector } from "../../game/war/war-types";
import { Fx } from "./effects";
import { ToggleSwitch } from "./ToggleSwitch";
import { BattleClock } from "./BattleClock";
import { SceneHeader } from "../SceneHeader";

const ART = "/art/battle/units";
const UNIT_ART: Record<string, string> = {
  bulwark: `${ART}/bulwark.webp`,
  reaver: `${ART}/reaver.webp`,
  longeye: `${ART}/longeye.webp`,
  thunder: `${ART}/thunder.webp`,
  warden: `${ART}/warden.webp`,
  dropship: `${ART}/dropship.webp`,
  turret: `${ART}/turret.webp`,
};
const GROUND_ART = `${ART}/ground-arid.webp`;

// Pre-scaled integer-sized ground tile for the seamless pattern fill.
// Rebuilt only when the tile size changes (resize), never per-frame.
let groundTile: { canvas: HTMLCanvasElement | null; size: number } = { canvas: null, size: -1 };

// Friend/foe identity (owner 2026-10-05): friendlies read blue-green,
// enemies read red — unit rings, staging markers, turret fallback, HP pips.
const SIDE_COLOR: Record<string, string> = { attacker: "#34d399", defender: "#ef4444" };
const SIDE_DIM: Record<string, string> = { attacker: "#065f46", defender: "#7f1d1d" };

interface Props {
  scene: SceneBattle;
  /** Live casualty counts from battleMoment — drives unit deaths when present. */
  liveCasualties?: { attacker: number; defender: number } | null;
  /**
   * "embedded" (default): the panel layout used inside tabs — header, canvas,
   * control deck, footer. "fullscreen": the canvas fills the viewport
   * edge-to-edge behind a slim header overlay; the controls live in the
   * floating glass window instead of a deck (owner 2026-10-05).
   */
  variant?: "embedded" | "fullscreen";
  /** fullscreen only: back out to wherever the scene was opened from */
  onClose?: () => void;
}

interface SpriteSet { [k: string]: HTMLImageElement | null; ground: HTMLImageElement | null }

function loadSprites(): SpriteSet {
  const set: SpriteSet = { ground: null };
  const mk = (src: string) => {
    const img = new Image();
    img.src = src;
    return img;
  };
  for (const [k, src] of Object.entries(UNIT_ART)) set[k] = mk(src);
  set.ground = mk(GROUND_ART);
  return set;
}

const VEC_LABEL: Record<ManeuverVector, string> = {
  MAIN: "Main", FLANK_LEFT: "Flank L", FLANK_RIGHT: "Flank R", REAR: "Rear", RESERVE: "Reserve",
};

export function BattleScene({ scene, liveCasualties = null, variant = "embedded", onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sprites = useMemo(loadSprites, []);
  const fx = useMemo(() => new Fx(), []);
  const fullscreen = variant === "fullscreen";
  // Ref mirror of the variant for the animation loop (avoids re-subscribing).
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;

  // Shared UI state: the canvas and the floating glass control window read
  // and write the same store (owner 2026-10-05).
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  // Whether the floating controls window is open (fullscreen only).
  useSyncExternalStore(subscribeWindows, windowSnapshot, windowServerSnapshot);
  const controlsOpen = isWindowOpen("battle-controls");

  // Working copy of units — the animation loop mutates this, never the model.
  const unitsRef = useRef<SceneUnit[]>([]);
  const turretsRef = useRef<SceneTurret[]>([]);
  if (unitsRef.current.length === 0) {
    unitsRef.current = scene.units.map((u) => ({ ...u }));
    turretsRef.current = scene.turrets.map((t) => ({ ...t }));
  }

  // Reset working copy + shared UI when the scene identity changes.
  const sceneIdRef = useRef(scene.id);
  useEffect(() => {
    if (sceneIdRef.current !== scene.id) {
      sceneIdRef.current = scene.id;
      unitsRef.current = scene.units.map((u) => ({ ...u }));
      turretsRef.current = scene.turrets.map((t) => ({ ...t }));
      resetSceneUI();
    }
    registerTurrets(
      turretsRef.current
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.side === "attacker" && t.hp01 > 0)
        .map(({ t, i }) => ({ id: t.id, idx: i })),
    );
  }, [scene]);

  // ---- main loop ---------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let clockAcc = 0;
    let fireAcc = 0;
    let jamAcc = 0;
    const W = () => canvas.width / dpr();
    const H = () => canvas.height / dpr();
    const dpr = () => Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const d = dpr();
      canvas.width = Math.max(320, Math.floor(r.width * d));
      // Fullscreen: the canvas fills the viewport; embedded: 16:10-ish panel.
      const hCss = fullscreenRef.current ? Math.max(200, r.height) : Math.max(200, r.width * 0.62);
      canvas.height = Math.max(200, Math.floor(hCss * d));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${hCss}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const X = (x: number) => x * W();
    const Y = (y: number) => y * H();
    const S = () => Math.min(W(), H()); // scale unit

    const enemiesOf = (side: string) => unitsRef.current.filter((u) => u.side !== side && u.state !== "dead" && u.state !== "staging");
    const nearestEnemy = (x: number, y: number, side: string, maxD: number) => {
      let best: SceneUnit | null = null;
      let bd = maxD;
      for (const e of enemiesOf(side)) {
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    };

    const killUnit = (u: SceneUnit) => {
      if (u.state === "dead") return;
      u.state = "dead";
      u.hp01 = 0;
      fx.explode(X(u.x), Y(u.y), u.kind === "thunder" ? 1.5 : 1);
      bumpKill(u.side as "attacker" | "defender");
    };

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = sceneClockS(scene, Date.now());
      const ui = sceneUISnapshot();
      const phase = scenePhaseAt(t);

      // --- unit state machine -------------------------------------------
      for (const u of unitsRef.current) {
        if (u.state === "dead") continue;
        if (u.state === "staging" && t >= u.enterAtS && (phase === "touchdown" || phase === "contact" || phase === "weapons-free")) {
          u.state = "advancing";
        }
        if (u.state === "advancing") {
          const dx = u.tx - u.x;
          const dy = u.ty - u.y;
          const d = Math.hypot(dx, dy);
          const speed = (u.kind === "thunder" ? 0.02 : u.kind === "warden" ? 0.035 : 0.05) * dt * 10;
          if (d < 0.015) {
            u.x = u.tx; u.y = u.ty;
            u.state = "holding";
          } else {
            u.x += (dx / d) * Math.min(d, speed);
            u.y += (dy / d) * Math.min(d, speed);
          }
        }
        if ((u.state === "holding" || u.state === "advancing") && phase === "weapons-free") {
          const e = nearestEnemy(u.x, u.y, u.side, 0.3);
          if (e) u.state = "engaged";
        }
      }

      // --- combat ---------------------------------------------------------
      fireAcc += dt;
      if (phase === "weapons-free" && fireAcc > 0.28) {
        fireAcc = 0;
        const engaged = unitsRef.current.filter((u) => u.state === "engaged");
        // Cap simultaneous exchanges for perf + readability.
        for (const u of engaged.slice(0, 40)) {
          if (Math.random() < 0.55) continue;
          const e = nearestEnemy(u.x, u.y, u.side, 0.3);
          if (!e) { u.state = "holding"; continue; }
          fx.fire(X(u.x), Y(u.y), X(e.x), Y(e.y), u.side === "attacker" ? "#ffd27a" : "#fda4af");
          e.hp01 -= 0.06 + Math.random() * 0.1;
          if (e.hp01 <= 0) killUnit(e);
        }
        // Turret fire (auto mode, or gunner-directed).
        for (const tr of turretsRef.current) {
          if (tr.hp01 <= 0) continue;
          if (ui.manual && ui.gunnerId !== tr.id) continue; // manual: only the gunner's turret fires
          let target: SceneUnit | null = null;
          if (ui.gunnerId === tr.id && ui.gunTarget) {
            target = unitsRef.current.find((u) => u.id === ui.gunTarget && u.state !== "dead") ?? null;
          } else if (!ui.manual) {
            target = nearestEnemy(tr.x, tr.y, tr.side, 0.45);
          }
          if (target) {
            tr.aim = Math.atan2(Y(target.y) - Y(tr.y), X(target.x) - X(tr.x));
            fx.fire(X(tr.x), Y(tr.y), X(target.x), Y(target.y), "#a5f3fc");
            target.hp01 -= 0.12 + Math.random() * 0.12;
            if (target.hp01 <= 0) killUnit(target);
          }
        }
      }

      // --- live casualty matching: the engine's ticks kill units ----------
      if (liveCasualties) {
        for (const side of ["attacker", "defender"] as const) {
          const want = Math.min(
            unitsRef.current.filter((u) => u.side === side).length,
            Math.round((liveCasualties[side] / Math.max(1, scene.troops[side])) * unitsRef.current.filter((u) => u.side === side).length),
          );
          const dead = unitsRef.current.filter((u) => u.side === side && u.state === "dead").length;
          if (want > dead) {
            const cands = unitsRef.current
              .filter((u) => u.side === side && u.state !== "dead" && u.state !== "staging")
              .sort((a, b) => a.hp01 - b.hp01);
            const victim = cands[0];
            if (victim && Math.random() < 0.3) killUnit(victim);
          }
        }
      } else if (phase === "weapons-free") {
        // Demo curve: steady attrition so the scene tells a story.
        if (Math.random() < dt * 1.2) {
          const cands = unitsRef.current.filter((u) => u.state === "engaged" || u.state === "holding");
          const v = cands[Math.floor(Math.random() * cands.length)];
          if (v) { v.hp01 -= 0.34; if (v.hp01 <= 0) killUnit(v); }
        }
      }

      // --- logistics autopilot: jamming rings + target painting -----------
      jamAcc += dt;
      if (ui.logisticsFx && jamAcc > 1.4) {
        jamAcc = 0;
        for (const u of unitsRef.current) {
          if (u.kind !== "warden" || u.state === "dead" || u.state === "staging") continue;
          fx.jam(X(u.x), Y(u.y));
          if (Math.random() < 0.6) {
            const e = nearestEnemy(u.x, u.y, u.side, 0.4);
            if (e) {
              e.painted = true;
              fx.paint(X(u.x), Y(u.y), X(e.x), Y(e.y));
            }
          }
        }
      }
      fx.sweepOn = phase === "contact";
      fx.update(dt);

      // --- clock state (throttled) -----------------------------------------
      clockAcc += dt;
      if (clockAcc > 0.25) {
        clockAcc = 0;
        setClock(t);
      }

      render(ctx, phase);
      raf = requestAnimationFrame(step);
    };

    const render = (c: CanvasRenderingContext2D, phase: ScenePhase) => {
      const ui = sceneUISnapshot();
      const w = W();
      const h = H();
      const s = S();
      c.save();
      c.scale(dpr(), dpr());
      const sh = fx.shake(9);
      c.translate(sh.x, sh.y);

      // Night factor: auto from battle longitude, or manual override.
      const night = ui.dayNight === "auto" ? sceneNightFactor(scene.lonDeg, Date.now()) : ui.dayNight === "night" ? 1 : 0;

      // --- ground ----------------------------------------------------------
      // Seamless: draw the ground as a repeating pattern from a pre-scaled
      // integer-sized tile. The old manual tile loop drew tiles at fractional
      // offsets (gw = s*1.4 is rarely an integer), and the screen-shake
      // translate kept tile edges on sub-pixel boundaries — the rasterizer
      // then left a faint 1px hairline down each tile boundary (visible as a
      // vertical seam). A pattern fills the same tile grid continuously, so
      // no boundary can ever open up.
      const g = sprites.ground;
      if (g && g.complete && g.naturalWidth > 0) {
        const gw = s * 1.4;
        const tilePx = Math.max(1, Math.round(gw));
        let tileCanvas = groundTile.canvas;
        if (!tileCanvas || groundTile.size !== tilePx) {
          tileCanvas = document.createElement("canvas");
          tileCanvas.width = tilePx;
          tileCanvas.height = tilePx;
          const tc = tileCanvas.getContext("2d");
          if (tc) {
            tc.imageSmoothingQuality = "high";
            tc.drawImage(g, 0, 0, tilePx, tilePx);
          }
          groundTile = { canvas: tileCanvas, size: tilePx };
        }
        const pat = c.createPattern(tileCanvas, "repeat");
        if (pat) {
          c.save();
          c.globalAlpha = 0.9;
          // Keep the tile grid aligned as before (origin at -gw).
          c.translate(-gw, -gw);
          c.fillStyle = pat;
          c.fillRect(0, 0, w + gw * 2, h + gw * 2);
          c.restore();
        }
      } else {
        const grad = c.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "#3a3226");
        grad.addColorStop(1, "#2a241b");
        c.fillStyle = grad;
        c.fillRect(-12, -12, w + 24, h + 24);
      }

      // --- vector lanes ----------------------------------------------------
      // Tactical lane markings, not color bands: a whisper of fill plus
      // dashed edge lines in the lane color. The old solid 0.16 fills stacked
      // where lanes overlap (MAIN/REAR/RESERVE all sit at y=0.5) into muddy
      // saturated bands — that was the "weird offset colors" on the phone.
      const LANE_COLOR: Record<ManeuverVector, string> = {
        MAIN: "#f59e0b",
        FLANK_LEFT: "#a78bfa",
        FLANK_RIGHT: "#a78bfa",
        REAR: "#a78bfa",
        RESERVE: "#38bdf8",
      };
      for (const v of Object.keys(VECTOR_LANES) as ManeuverVector[]) {
        if (!ui.vectorsOn[v]) continue;
        const lane = VECTOR_LANES[v];
        const y0 = Y(lane.y - lane.spread);
        const y1 = Y(lane.y + lane.spread);
        const lc = LANE_COLOR[v];
        c.save();
        c.globalAlpha = 0.05;
        c.fillStyle = lc;
        c.fillRect(0, y0, w, y1 - y0);
        c.restore();
        c.save();
        c.globalAlpha = 0.5;
        c.strokeStyle = lc;
        c.lineWidth = 1.5;
        c.setLineDash([10, 8]);
        c.beginPath(); c.moveTo(0, y0); c.lineTo(w, y0); c.stroke();
        c.beginPath(); c.moveTo(0, y1); c.lineTo(w, y1); c.stroke();
        c.restore();
      }

      // --- grid -------------------------------------------------------------
      c.save();
      c.strokeStyle = "rgba(255,255,255,0.05)";
      c.lineWidth = 1;
      for (let i = 1; i < 10; i++) {
        c.beginPath(); c.moveTo((w / 10) * i, 0); c.lineTo((w / 10) * i, h); c.stroke();
      }
      for (let i = 1; i < 6; i++) {
        c.beginPath(); c.moveTo(0, (h / 6) * i); c.lineTo(w, (h / 6) * i); c.stroke();
      }
      c.restore();

      // --- radar sweep during contact ---------------------------------------
      if (fx.sweepOn) {
        c.save();
        c.translate(w / 2, h / 2);
        c.rotate(fx.sweep);
        const rg = c.createConicGradient ? c.createConicGradient(0, 0, 0) : null;
        void rg;
        const grad = c.createLinearGradient(0, 0, w / 2, 0);
        grad.addColorStop(0, "rgba(56,189,248,0.28)");
        grad.addColorStop(1, "rgba(56,189,248,0)");
        c.fillStyle = grad;
        c.beginPath();
        c.moveTo(0, 0);
        c.arc(0, 0, Math.max(w, h) * 0.7, -0.35, 0.35);
        c.closePath();
        c.fill();
        c.restore();
      }

      const drawUnit = (u: SceneUnit) => {
        if (!ui.vectorsOn[u.vector]) return;
        const x = X(u.x);
        const y = Y(u.y);
        const r = Math.max(7, s * 0.022) * (u.kind === "thunder" ? 1.7 : u.kind === "dropship" ? 2.2 : 1);
        // Staging: ghost at muster, with a side-colored dashed ring so you
        // know whose muster it is at a glance.
        if (u.state === "staging") {
          c.save();
          c.globalAlpha = 0.25;
          c.fillStyle = SIDE_COLOR[u.side];
          c.beginPath(); c.arc(x, y, r * 0.8, 0, Math.PI * 2); c.fill();
          c.restore();
          c.save();
          c.globalAlpha = 0.8;
          c.strokeStyle = SIDE_COLOR[u.side];
          c.lineWidth = 1.5;
          c.setLineDash([4, 4]);
          c.beginPath(); c.arc(x, y, r * 0.8 + 2, 0, Math.PI * 2); c.stroke();
          c.restore();
          return;
        }
        if (u.state === "dead") return;
        const img = sprites[u.kind];
        c.save();
        // Target-painted enemies get a red diamond.
        if (u.painted && phase === "weapons-free") {
          c.strokeStyle = "rgba(248,113,113,0.9)";
          c.lineWidth = 1.5;
          c.save();
          c.translate(x, y);
          c.rotate(Math.PI / 4);
          c.strokeRect(-r - 3, -r - 3, (r + 3) * 2, (r + 3) * 2);
          c.restore();
        }
        if (u.state === "engaged") {
          c.strokeStyle = SIDE_COLOR[u.side];
          c.globalAlpha = 0.7 + 0.3 * Math.sin(Date.now() / 130);
          c.lineWidth = 1.5;
          c.beginPath(); c.arc(x, y, r + 4, 0, Math.PI * 2); c.stroke();
          c.globalAlpha = 1;
        }
        if (img && img.complete && img.naturalWidth > 0) {
          c.drawImage(img, x - r, y - r, r * 2, r * 2);
        } else {
          c.fillStyle = SIDE_COLOR[u.side];
          c.beginPath(); c.arc(x, y, r * 0.8, 0, Math.PI * 2); c.fill();
          c.fillStyle = SIDE_DIM[u.side];
          c.beginPath(); c.arc(x, y, r * 0.4, 0, Math.PI * 2); c.fill();
        }
        // HP pip with a side-colored border so the pip also reads friend/foe.
        if (u.hp01 < 1) {
          c.fillStyle = "rgba(0,0,0,0.6)";
          c.fillRect(x - r, y - r - 6, r * 2, 3);
          c.fillStyle = u.hp01 > 0.5 ? "#a3e635" : u.hp01 > 0.25 ? "#fbbf24" : "#f87171";
          c.fillRect(x - r, y - r - 6, r * 2 * Math.max(0, u.hp01), 3);
          c.strokeStyle = SIDE_COLOR[u.side];
          c.lineWidth = 1;
          c.strokeRect(x - r - 0.5, y - r - 6.5, r * 2 + 1, 4);
        }
        // Friend/foe ring: crisp side-colored ring over a soft under-glow —
        // at a glance you know which dots are yours. 2D Plus glow, no cartoon.
        c.save();
        c.globalAlpha = 0.3;
        c.strokeStyle = SIDE_COLOR[u.side];
        c.lineWidth = 6;
        c.beginPath(); c.arc(x, y, r + 4, 0, Math.PI * 2); c.stroke();
        c.restore();
        c.save();
        c.globalAlpha = 0.9;
        c.strokeStyle = SIDE_COLOR[u.side];
        c.lineWidth = 1.5;
        c.beginPath(); c.arc(x, y, r + 4, 0, Math.PI * 2); c.stroke();
        c.restore();
        c.restore();
      };

      // Wrecks first (dead units as scorch marks).
      c.save();
      for (const u of unitsRef.current) {
        if (u.state !== "dead" || !ui.vectorsOn[u.vector]) continue;
        c.fillStyle = "rgba(0,0,0,0.45)";
        c.beginPath();
        c.ellipse(X(u.x), Y(u.y), s * 0.02, s * 0.014, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();

      for (const u of unitsRef.current) drawUnit(u);

      // --- turrets ------------------------------------------------------------
      if (ui.turretsOn) {
        for (const tr of turretsRef.current) {
          if (tr.hp01 <= 0) continue;
          const x = X(tr.x);
          const y = Y(tr.y);
          const r = Math.max(10, s * 0.03);
          const img = sprites.turret;
          c.save();
          if (ui.gunnerId === tr.id) {
            c.strokeStyle = "#a5f3fc";
            c.lineWidth = 2;
            c.setLineDash([5, 4]);
            c.beginPath(); c.arc(x, y, r + 8, 0, Math.PI * 2); c.stroke();
            c.setLineDash([]);
          }
          if (img && img.complete && img.naturalWidth > 0) {
            // The sprite's barrel points up-left in source space (≈ −135°);
            // rotate the whole sprite — the sandbag ring is circularly
            // symmetric, so only the barrel visibly turns.
            c.save();
            c.translate(x, y);
            c.rotate(tr.aim + Math.PI * 0.75);
            c.drawImage(img, -r, -r, r * 2, r * 2);
            c.restore();
          } else {
            c.fillStyle = "#3f3f46";
            c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
            c.strokeStyle = SIDE_COLOR[tr.side];
            c.lineWidth = 2;
            c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
            // Rotating barrel (fallback only).
            c.save();
            c.translate(x, y);
            c.rotate(tr.aim);
            c.fillStyle = "#d4d4d8";
            c.fillRect(0, -2, r * 1.5, 4);
            c.restore();
          }
          c.restore();
        }
      }

      // --- fx: beams, tracers, flashes, booms, rings ---------------------------
      const alpha = (life: number, max: number) => Math.max(0, Math.min(1, life / max));
      c.save();
      c.globalCompositeOperation = "lighter";
      for (const b of fx.beams) {
        c.strokeStyle = b.color;
        c.globalAlpha = alpha(b.life, b.maxLife) * 0.8;
        c.lineWidth = 1.5;
        c.setLineDash([6, 5]);
        c.beginPath(); c.moveTo(b.x1, b.y1); c.lineTo(b.x2, b.y2); c.stroke();
        c.setLineDash([]);
      }
      for (const tr of fx.tracers) {
        c.strokeStyle = tr.color;
        c.globalAlpha = alpha(tr.life, tr.maxLife);
        c.lineWidth = tr.width;
        c.shadowColor = tr.color;
        c.shadowBlur = 8;
        c.beginPath(); c.moveTo(tr.x1, tr.y1); c.lineTo(tr.x2, tr.y2); c.stroke();
      }
      c.shadowBlur = 0;
      for (const f of fx.flashes) {
        const a = alpha(f.life, f.maxLife);
        const g2 = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius);
        g2.addColorStop(0, `rgba(255,240,200,${0.9 * a})`);
        g2.addColorStop(1, "rgba(255,180,80,0)");
        c.globalAlpha = 1;
        c.fillStyle = g2;
        c.beginPath(); c.arc(f.x, f.y, f.radius, 0, Math.PI * 2); c.fill();
      }
      for (const b of fx.booms) {
        const a = alpha(b.life, b.maxLife);
        const g3 = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.radius * (1.6 - a * 0.6));
        g3.addColorStop(0, `rgba(255,220,150,${0.85 * a})`);
        g3.addColorStop(0.5, `rgba(255,120,40,${0.5 * a})`);
        g3.addColorStop(1, "rgba(255,80,20,0)");
        c.fillStyle = g3;
        c.beginPath(); c.arc(b.x, b.y, b.radius * (1.6 - a * 0.6), 0, Math.PI * 2); c.fill();
        for (const p of b.particles) {
          if (p.life <= 0) continue;
          c.globalAlpha = alpha(p.life, p.maxLife);
          c.fillStyle = p.color;
          c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        c.globalAlpha = 1;
      }
      c.restore();
      c.save();
      for (const rg2 of fx.rings) {
        const a = alpha(rg2.life, rg2.maxLife);
        c.strokeStyle = rg2.color;
        c.globalAlpha = a;
        c.lineWidth = rg2.width;
        c.beginPath();
        c.arc(rg2.x, rg2.y, rg2.maxR * (1 - a), 0, Math.PI * 2);
        c.stroke();
      }
      c.restore();
      // Smoke (normal blend, under night).
      c.save();
      for (const b of fx.booms) {
        for (const sm of b.smoke) {
          if (sm.life <= 0) continue;
          c.globalAlpha = alpha(sm.life, sm.maxLife) * 0.35;
          c.fillStyle = "#1c1917";
          c.beginPath(); c.arc(sm.x, sm.y, sm.size, 0, Math.PI * 2); c.fill();
        }
      }
      c.restore();

      // --- night overlay --------------------------------------------------------
      if (night > 0.02) {
        c.save();
        c.fillStyle = `rgba(8,12,40,${0.62 * night})`;
        c.fillRect(-14, -14, w + 28, h + 28);
        // City-light-style glints on muzzle flashes read through; add lamp dots at turrets.
        if (ui.turretsOn) {
          c.globalCompositeOperation = "lighter";
          for (const tr of turretsRef.current) {
            if (tr.hp01 <= 0) continue;
            const g4 = c.createRadialGradient(X(tr.x), Y(tr.y), 0, X(tr.x), Y(tr.y), 26);
            g4.addColorStop(0, `rgba(147,197,253,${0.5 * night})`);
            g4.addColorStop(1, "rgba(147,197,253,0)");
            c.fillStyle = g4;
            c.beginPath(); c.arc(X(tr.x), Y(tr.y), 26, 0, Math.PI * 2); c.fill();
          }
        }
        c.restore();
      }

      // --- vignette ---------------------------------------------------------------
      const vg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.5)");
      c.fillStyle = vg;
      c.fillRect(-14, -14, w + 28, h + 28);

      // --- phase banner -------------------------------------------------------------
      c.save();
      const PHASE_COLORS: Record<ScenePhase, string> = {
        approach: "#38bdf8",
        touchdown: "#a3e635",
        contact: "#fbbf24",
        "weapons-free": "#f87171",
        resolved: "#a1a1aa",
      };
      const pc = PHASE_COLORS[phase];
      c.font = "700 11px system-ui, sans-serif";
      c.fillStyle = pc;
      c.globalAlpha = 0.95;
      c.fillText(SCENE_PHASES.find((p) => p.phase === phase)?.label ?? phase, 12, 20);
      c.restore();

      c.restore(); // un-scale
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id]);

  // ---- pointer: turret select → gunner view → target -------------------------
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const ui = sceneUISnapshot();
    if (ui.gunnerId) {
      // Gunner view: click an enemy unit to target it.
      let best: SceneUnit | null = null;
      let bd = 0.06;
      for (const u of unitsRef.current) {
        if (u.side === "attacker" || u.state === "dead" || u.state === "staging") continue;
        const d = Math.hypot(u.x - px, u.y - py);
        if (d < bd) { bd = d; best = u; }
      }
      if (best) setGunTarget(best.id);
      return;
    }
    // Otherwise: click one of YOUR turrets to enter the gunner view.
    let best: SceneTurret | null = null;
    let bd = 0.05;
    for (const tr of turretsRef.current) {
      if (tr.side !== "attacker" || tr.hp01 <= 0) continue;
      const d = Math.hypot(tr.x - px, tr.y - py);
      if (d < bd) { bd = d; best = tr; }
    }
    if (best) {
      setGunner(best.id);
      setManual(true); // hands on the weapon ⇒ manual mode
    }
  };

  const toggleControls = () => {
    if (isWindowOpen("battle-controls")) closeWindowsOfKind("battle-controls");
    else openWindow("battle-controls", { titleFallback: "Battle controls" });
  };

  const gunner = ui.gunnerId ? turretsRef.current.find((t) => t.id === ui.gunnerId) : null;

  const sceneSub = (
    <>
      <span className="text-amber-400">{scene.attackerName}</span>
      <span className="mx-1.5 text-zinc-600">vs</span>
      <span className="text-rose-400">{scene.defenderName}</span>
    </>
  );

  const gunnerOverlay = gunner && (
    <>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="rounded-full border-2 border-cyan-300/70" style={{ width: "46%", aspectRatio: "1", boxShadow: "0 0 40px rgba(103,232,249,0.25), inset 0 0 60px rgba(0,0,0,0.55)" }}>
          <div className="flex h-full items-center justify-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-200/90">
              {ui.gunTarget ? "target locked" : "gunner cam — click an enemy to engage"}
            </span>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setGunner(null)}
        className="absolute right-3 top-3 rounded-lg border border-cyan-300/40 bg-black/70 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-black/90"
      >
        Exit gunner ✕
      </button>
    </>
  );

  // ---- fullscreen: the scene owns the whole viewport -----------------------
  // Clean screen by default: slim SceneHeader overlay + one small Controls
  // button. The toggle deck, doctrine clock, and gunner picker live in the
  // floating glass window (summoned with Controls, dismissed by tapping it
  // again or closing the window).
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[60] bg-[#0b0d13]" data-testid="battle-scene-fullscreen">
        {/* canvas fills the viewport edge to edge */}
        <div ref={wrapRef} className="absolute inset-0">
          <canvas ref={canvasRef} onClick={onCanvasClick} className="block cursor-crosshair" aria-label="Battle scene tactical map" />
          {gunnerOverlay}
        </div>

        {/* slim header overlay — where you're standing + tier + BATTLE CLOCK.
            Mid-fight the doctrine timeline is what matters, not the world UTC
            clock. The floating Battle controls window keeps its own clock copy. */}
        <div
          className="absolute inset-x-0 top-0 z-10 border-b border-white/10 bg-black/55 backdrop-blur-md"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
        >
          <div className="flex items-start justify-between gap-3 px-3 pb-2">
            <div className="min-w-0 flex-1">
              <SceneHeader name={scene.name} tier={scene.tier} sub={sceneSub} clock={false} />
              <div className="mt-1.5 max-w-[430px]" data-testid="battle-scene-header-clock">
                <BattleClock tS={ui.tS} compact />
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              data-testid="battle-scene-close"
              aria-label="Back to the Arena"
              className="flex-none rounded-full border border-white/20 bg-black/55 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-200 backdrop-blur-md hover:bg-black/80"
            >
              ✕ Arena
            </button>
          </div>
        </div>

        {/* the one small control: summons/dismisses the floating glass deck */}
        <button
          type="button"
          onClick={toggleControls}
          data-testid="battle-controls-toggle"
          aria-expanded={controlsOpen}
          className={`absolute bottom-4 right-3 z-10 rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-wider backdrop-blur-md ${
            controlsOpen
              ? "border-cyan-300/50 bg-cyan-950/60 text-cyan-200"
              : "border-white/20 bg-black/55 text-zinc-200 hover:bg-black/80"
          }`}
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
        >
          ⚙ Controls
        </button>
      </div>
    );
  }

  // ---- embedded: the tab panel layout (unchanged) ---------------------------
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-[#0b0d13]">
      {/* header — where you're standing + tier + server clock */}
      <div className="border-b border-line/60 px-4 py-2.5">
        <SceneHeader
          name={scene.name}
          tier={scene.tier}
          sub={sceneSub}
        />
        <div className="mt-2">
          <BattleClock tS={ui.tS} compact />
        </div>
      </div>

      {/* canvas */}
      <div ref={wrapRef} className="relative w-full">
        <canvas ref={canvasRef} onClick={onCanvasClick} className="block cursor-crosshair" aria-label="Battle scene tactical map" />
        {gunnerOverlay}
      </div>

      {/* control deck */}
      <div className="grid gap-4 border-t border-line/60 bg-[#0e1119] p-4 md:grid-cols-[1fr_auto]">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Vector layers</p>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            {(Object.keys(VEC_LABEL) as ManeuverVector[]).map((v) => (
              <ToggleSwitch
                key={v}
                label={VEC_LABEL[v]}
                on={ui.vectorsOn[v]}
                onChange={(on) => setVectorOn(v, on)}
                accent="#a78bfa"
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">
            <ToggleSwitch label="Turrets" on={ui.turretsOn} onChange={setTurretsOn} accent="#67e8f9" />
            <ToggleSwitch label="Logistics FX" on={ui.logisticsFx} onChange={setLogisticsFx} accent="#5eead4" />
          </div>
        </div>
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Command</p>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            <ToggleSwitch label={ui.manual ? "Manual" : "Auto"} on={ui.manual} onChange={setManual} accent={ui.manual ? "#f87171" : "#a3e635"} />
            <ToggleSwitch
              label={ui.dayNight === "auto" ? "Day/Night auto" : ui.dayNight === "day" ? "Day" : "Night"}
              on={ui.dayNight !== "day"}
              onChange={cycleDayNight}
              accent="#38bdf8"
            />
          </div>
          <p className="mt-2 max-w-[220px] text-[10px] leading-relaxed text-zinc-500">
            {ui.manual
              ? "Manual: turrets hold fire until you take the gunner cam. Click one of your turrets."
              : "Auto: turrets engage on their own. Flip to manual to take a gun yourself."}
          </p>
        </div>
      </div>

      {/* footer strip */}
      <div className="flex items-center justify-between border-t border-line/60 px-4 py-2 text-[11px] text-zinc-500">
        <span>
          Phase 1 live view — observing only. Orders ship in phase 2.
        </span>
        <span className="tabular-nums">
          <span className="text-amber-400/90">{ui.kills.attacker}✕</span>
          <span className="mx-1">·</span>
          <span className="text-rose-400/90">{ui.kills.defender}✕</span>
          <span className="ml-1">down</span>
        </span>
      </div>
    </div>
  );
}
