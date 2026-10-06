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
  demoBreakVictor,
  mulberry32,
  sceneNightFactor,
  scenePhaseAt,
  VECTOR_LANES,
  UNIT_KIND_LABEL,
  type SceneBattle,
  type ScenePhase,
  type SceneTurret,
  type SceneUnit,
  type SceneUnitKind,
} from "../../game/war/battle-scene-model";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
  setVectorOn,
  setTurretsOn,
  setLogisticsFx,
  setManual,
  setCameraMode,
  cycleDayNight,
  setLabelsOn,
  setGunner,
  setGunTarget,
  setClock,
  bumpKill,
  registerTurrets,
  registerRoster,
  registerSquads,
  setSelectedSquad,
  logOrder,
  resetSceneUI,
  setZoomLevel,
  recenterMap,
  BATTLE_SPEED_MUL,
} from "../../game/war/battle-scene-ui-store";
import {
  buildSquads,
  isDrivable,
  judgeMoveOrder,
  destLabel,
} from "../../game/war/scene-orders";
import { battleSfx } from "../../game/war/battle-sfx";
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
import { BattleLegend } from "./BattleLegend";
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

// Near-field silhouettes for the ground camera: dark blurred tufts along the
// bottom of the frame plus drifting dust motes. They slide against the camera
// anchor (near field moves faster) — that's what sells "down in the dirt"
// instead of "magnifying glass". Deterministic per tuft, positioned in
// screen space each frame.
const TUFTS = (() => {
  const rnd = mulberry32(4242);
  return Array.from({ length: 18 }, () => ({
    x: rnd(),
    y: 0.8 + rnd() * 0.25,
    s: 16 + rnd() * 52,
    depth: 0.4 + rnd() * 0.6,
    mote: rnd() < 0.3,
  }));
})();

interface CameraRig {
  zoom: number;
  ax: number;
  ay: number;
  /** vertical squash — the low grazing angle, not just a magnifier */
  ysq: number;
  /** screen-space focus height (0.5 = centered; ground sits lower) */
  fy: number;
  /** anchor when ground mode engaged — parallax reference */
  gx: number;
  gy: number;
  wasGround: boolean;
  /** user pan anchor (tactical) — drag scrolls the map, eased like the rest */
  uax: number;
  uay: number;
  /** user pan offset (ground) — added to the follow-cam anchor, clamped */
  pox: number;
  poy: number;
  /** last mapNonce seen — bump it (double-tap / Recenter) to reset pan+zoom */
  reNonce: number;
}

const CAM_HOME: CameraRig = { zoom: 1, ax: 0.5, ay: 0.5, ysq: 1, fy: 0.5, gx: 0.5, gy: 0.5, wasGround: false, uax: 0.5, uay: 0.5, pox: 0, poy: 0, reNonce: 0 };

// Zoom bounds. Tactical roams the full field; ground keeps it sensible so
// the follow-cam still reads.
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 4;
const GROUND_ZOOM_MAX = 1.6;
// The frame may roam a padded battlefield, never void.
const FIELD_PAD = 0.08;

/** Clamp a pan anchor so the visible window stays on the battlefield. */
function clampAnchor(ax: number, half: number): number {
  const lo = -FIELD_PAD + half;
  const hi = 1 + FIELD_PAD - half;
  if (lo >= hi) return 0.5;
  return Math.max(lo, Math.min(hi, ax));
}

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
  // Speed-scaled sim clock (seconds) — the battle-speed toggle scales this,
  // not the wall clock, so SLOW actually gives a commander time to think.
  const simTRef = useRef(0);
  // Click-to-command visuals (canvas-local, not store state):
  //  - orderPing: the accepted order's dashed path + pulsing destination.
  //  - toast: the judge's refusal, shown on-canvas — never silent.
  const orderPingRef = useRef<{ x: number; y: number; fx: number; fy: number; born: number } | null>(null);
  const toastRef = useRef<{ text: string; born: number } | null>(null);
  // Threshold victory (demo): when a side loses >= DEMO_BREAK_FRAC of its
  // force, the field breaks — the other side holds it. Doctrine: casualty
  // thresholds, not mutual annihilation.
  const victorRef = useRef<"attacker" | "defender" | null>(null);
  // Last doctrine phase seen — phase transitions earn SFX stingers.
  const phaseRef = useRef<string | null>(null);
  // Last squad alive-counts pushed to the store — the SQUADS panel refreshes
  // only when something actually died.
  const squadAliveRef = useRef<string>("");
  // Camera rig — the mode lives in the shared store; zoom/anchor ease here
  // so flipping the toggle glides instead of cutting.
  const camRef = useRef<CameraRig>({ ...CAM_HOME });
  if (unitsRef.current.length === 0) {
    unitsRef.current = scene.units.map((u) => ({ ...u }));
    turretsRef.current = scene.turrets.map((t) => ({ ...t }));
  }

  // The SFX engine needs the live camera for distance-muffled blasts.
  // Idempotent — re-assigning the getter each render is harmless.
  battleSfx.setCamera(() => {
    const cam = camRef.current;
    return {
      x: cam.ax,
      y: cam.ay,
      radius: 0.55 / Math.max(0.2, cam.zoom),
      ground: sceneUISnapshot().cameraMode === "ground",
    };
  });

  // Reset working copy + shared UI when the scene identity changes.
  const sceneIdRef = useRef(scene.id);
  useEffect(() => {
    if (sceneIdRef.current !== scene.id) {
      sceneIdRef.current = scene.id;
      unitsRef.current = scene.units.map((u) => ({ ...u }));
      turretsRef.current = scene.turrets.map((t) => ({ ...t }));
      camRef.current = { ...CAM_HOME };
      simTRef.current = 0;
      victorRef.current = null;
      phaseRef.current = null;
      battleSfx.reset();
      resetSceneUI();
    }
    registerTurrets(
      turretsRef.current
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.side === "attacker" && t.hp01 > 0)
        .map(({ t, i }) => ({ id: t.id, idx: i })),
    );
    // Force roster for the FIELD FORCE panel — what's on the field by type,
    // with a tier breakdown per row (owner 2026-10-05: read force quality).
    // (The practice scene is canned; real loadout-to-field mapping is P2.)
    const counts = new Map<string, { count: number; tiers: [number, number, number, number] }>();
    for (const u of unitsRef.current) {
      const k = `${u.side}:${u.kind}`;
      let e = counts.get(k);
      if (!e) { e = { count: 0, tiers: [0, 0, 0, 0] }; counts.set(k, e); }
      e.count += 1;
      e.tiers[u.tier - 1] += 1;
    }
    registerRoster(
      [...counts.entries()].map(([k, e]) => {
        const [side, kind] = k.split(":");
        return { side: side as "attacker" | "defender", kind: kind as SceneUnitKind, count: e.count, tiers: e.tiers };
      }),
    );
    // Command squads for the SQUADS panel — the five buses, living strength.
    // (Drivable: attacker only. The defender is the Chorus AI.)
    registerSquads(
      buildSquads(unitsRef.current)
        .filter((s) => isDrivable(s))
        .map((s) => ({ id: s.id, name: s.name, alive: s.unitIds.length, total: s.unitIds.length })),
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

    // Desktop zoom: wheel over the map. Native listener (non-passive) so we
    // can preventDefault the page scroll/zoom; focal point stays put.
    const onWheelNative = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoomBy(Math.exp(-ev.deltaY * 0.0012), ev.clientX - r.left, ev.clientY - r.top);
    };
    canvas.addEventListener("wheel", onWheelNative, { passive: false });

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
      battleSfx.explosion(u.x, u.y, u.kind === "thunder");
      bumpKill(u.side as "attacker" | "defender");
      // Demo only: the field breaks at the casualty threshold — the other
      // side holds it. Live battles resolve on the engine's own ticks.
      if (!liveCasualties && !victorRef.current) {
        const v = demoBreakVictor(unitsRef.current);
        if (v) {
          victorRef.current = v;
          battleSfx.victor(v === "attacker");
        }
      }
    };

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const ui = sceneUISnapshot();
      // Battle speed scales the SIM — the clock, movement, tracers, and
      // casualty ticks all run at the player's chosen pace. SLOW (0.5x) is
      // the default: the fight breathes, the commander gets time to think.
      // Resolved: the field is decided — freeze the sim, keep rendering.
      const sdt = victorRef.current ? 0 : dt * BATTLE_SPEED_MUL[ui.battleSpeed];
      simTRef.current += sdt;
      const t = simTRef.current;
      const phase = scenePhaseAt(t);
      // Doctrine phase transitions earn SFX stingers — ears know where you
      // are before your eyes catch up.
      if (phase !== phaseRef.current) {
        phaseRef.current = phase;
        battleSfx.phase(phase);
      }

      // --- unit state machine -------------------------------------------
      for (const u of unitsRef.current) {
        if (u.state === "dead") continue;
        if (u.state === "staging" && t >= u.enterAtS && (phase === "touchdown" || phase === "contact" || phase === "weapons-free")) {
          u.state = "advancing";
          // Delayed waves arrive loud: dropship engines on late entries,
          // a crash swell when a flank hits the field weapons-free.
          if (u.enterAtS > 60) battleSfx.dropship();
          if (phase === "weapons-free" && (u.vector === "FLANK_LEFT" || u.vector === "FLANK_RIGHT")) {
            battleSfx.flankCrash();
          }
        }
        if (u.state === "advancing") {
          const dx = u.tx - u.x;
          const dy = u.ty - u.y;
          const d = Math.hypot(dx, dy);
          const speed = (u.kind === "thunder" ? 0.02 : u.kind === "warden" ? 0.035 : 0.05) * sdt * 10;
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
      fireAcc += sdt;
      if (phase === "weapons-free" && fireAcc > 0.28) {
        fireAcc = 0;
        const engaged = unitsRef.current.filter((u) => u.state === "engaged");
        // Cap simultaneous exchanges for perf + readability.
        for (const u of engaged.slice(0, 40)) {
          if (Math.random() < 0.55) continue;
          const e = nearestEnemy(u.x, u.y, u.side, 0.3);
          if (!e) { u.state = "holding"; continue; }
          fx.fire(X(u.x), Y(u.y), X(e.x), Y(e.y), u.side === "attacker" ? "#ffd27a" : "#fda4af");
          battleSfx.tracer(u.kind === "thunder" ? "snipe" : "crack"); // T4s sniping crack
          // Tuned down (owner 2026-10-05): the demo used to annihilate both
          // sides in under a minute of weapons-free. Hits stay frequent so
          // the tracers keep flying — they just don't kill as fast.
          e.hp01 -= 0.015 + Math.random() * 0.03;
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
            battleSfx.tracer("turret");
            // Tuned down with the rest (owner 2026-10-05).
            target.hp01 -= 0.04 + Math.random() * 0.05;
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
        // Demo curve: slow-burn attrition so the scene tells a longer story.
        // Tuned down (owner 2026-10-05): approach through first contact stays
        // near-bloodless, mid-battle mounts, late battle grinds — but the
        // field breaks at the casualty threshold before mutual annihilation.
        if (Math.random() < sdt * 0.3) {
          const cands = unitsRef.current.filter((u) => u.state === "engaged" || u.state === "holding");
          const v = cands[Math.floor(Math.random() * cands.length)];
          if (v) { v.hp01 -= 0.25; if (v.hp01 <= 0) killUnit(v); }
        }
      }

      // --- logistics autopilot: jamming rings + target painting -----------
      jamAcc += sdt;
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
      fx.update(sdt); // fx runs on sim time — tracers/explosions slow with the battle

      // --- camera: tactical overhead ↔ ground-level follow cam --------------
      // The mode lives in the shared store; the rig eases toward its target
      // (~1s exponential glide — no jarring cuts). Ground follows the
      // friendly advance: the centroid of attackers on the move.
      // Player zoom (pinch/wheel/±) multiplies the mode zoom; drag pans.
      const cam = camRef.current;
      const ground = ui.cameraMode === "ground";
      if (ground && !cam.wasGround) {
        cam.gx = cam.ax;
        cam.gy = cam.ay;
      }
      if (!ground && cam.wasGround) {
        // Coming back up: the tactical anchor starts where the follow-cam
        // left off — no jump, and the player pans from there.
        cam.uax = cam.ax;
        cam.uay = cam.ay;
      }
      cam.wasGround = ground;
      // Recenter token (double-tap / Recenter button): reset pan + zoom.
      if (ui.mapNonce !== cam.reNonce) {
        cam.reNonce = ui.mapNonce;
        cam.uax = 0.5;
        cam.uay = 0.5;
        cam.pox = 0;
        cam.poy = 0;
        if (ui.zoomLevel !== 1) setZoomLevel(1);
      }
      // User zoom multiplies the mode zoom; ground clamps tighter so the
      // follow-cam still reads.
      const uz = ground ? Math.min(ui.zoomLevel, GROUND_ZOOM_MAX) : ui.zoomLevel;
      const modeZoom = ground ? (W() > H() ? 3.2 : 2.6) : 1;
      const targetZoom = modeZoom * uz;
      const targetYsq = ground ? 0.78 : 1; // low grazing angle, not a magnifier
      const targetFy = ground ? (W() > H() ? 0.62 : 0.55) : 0.5;
      let anx = 0.32;
      let any = 0.5;
      let nn = 0;
      for (const u of unitsRef.current) {
        if (u.side !== "attacker" || u.state === "dead" || u.state === "staging") continue;
        if (u.state !== "advancing" && u.state !== "engaged" && u.state !== "holding") continue;
        anx += u.x; any += u.y; nn++;
      }
      if (nn > 0) { anx /= nn; any /= nn; }
      const halfW = 0.5 / targetZoom;
      const halfH = 0.5 / (targetZoom * targetYsq);
      let tax: number;
      let tay: number;
      if (ground) {
        // Follow the advance, plus the player's pan offset — clamped tight
        // so a pan never leaves the fighting.
        tax = clampAnchor(anx + cam.pox, halfW);
        tay = clampAnchor(any + cam.poy, halfH);
      } else {
        tax = clampAnchor(cam.uax, halfW);
        tay = clampAnchor(cam.uay, halfH);
      }
      const k = 1 - Math.exp(-dt * 3.4);
      cam.zoom += (targetZoom - cam.zoom) * k;
      cam.ysq += (targetYsq - cam.ysq) * k;
      cam.fy += (targetFy - cam.fy) * k;
      cam.ax += (tax - cam.ax) * k;
      cam.ay += (tay - cam.ay) * k;

      // --- ground-mode texture: dust under the advance, near-miss tracers --
      if (ground) {
        for (const u of unitsRef.current) {
          if (u.side === "attacker" && u.state === "advancing" && Math.random() < sdt * 7) {
            fx.dust(X(u.x), Y(u.y));
          }
        }
        if (phase === "weapons-free" && Math.random() < sdt * 2.2) {
          // A tracer rips across the frame near the camera.
          const jx = (Math.random() - 0.5) * 0.3;
          const jy = (Math.random() - 0.5) * 0.24;
          const x1 = (cam.ax + jx - 0.22) * W();
          const x2 = (cam.ax + jx + 0.22) * W();
          const y = (cam.ay + jy) * H();
          fx.tracers.push({
            x1, y1: y, x2, y2: y + (Math.random() - 0.5) * 30,
            life: 0.3, maxLife: 0.3,
            color: Math.random() < 0.5 ? "#ffd27a" : "#fda4af",
            width: 3,
          });
        }
      }

      // --- clock state (throttled) -----------------------------------------
      clockAcc += dt;
      if (clockAcc > 0.25) {
        clockAcc = 0;
        setClock(t);
        // SQUADS panel: refresh living strength only when it changed.
        const squads = buildSquads(unitsRef.current).filter(isDrivable);
        const key = squads.map((s) => `${s.id}:${s.unitIds.length}`).join(",");
        if (key !== squadAliveRef.current) {
          squadAliveRef.current = key;
          registerSquads(
            squads.map((s) => ({ id: s.id, name: s.name, alive: s.unitIds.length, total: s.unitIds.length })),
          );
        }
        // Rejection toast + order ping expire on their own.
        const nowMs = performance.now();
        if (toastRef.current && nowMs - toastRef.current.born > 2600) toastRef.current = null;
        if (orderPingRef.current && t - orderPingRef.current.born > 3) orderPingRef.current = null;
      }

      render(ctx, phase);
      raf = requestAnimationFrame(step);
    };

    const render = (c: CanvasRenderingContext2D, phase: ScenePhase) => {
      const ui = sceneUISnapshot();
      const cam = camRef.current;
      const ground = ui.cameraMode === "ground";
      const w = W();
      const h = H();
      const s = S();
      c.save();
      c.scale(dpr(), dpr());
      // Explosions hit harder down at ground level.
      const sh = fx.shake(ground ? 16 : 9);
      c.translate(sh.x, sh.y);

      // --- camera ----------------------------------------------------------
      // Tactical: identity (zoom 1, anchor 0.5/0.5, focus 0.5). Ground: the
      // rig glides low over the friendly advance — zoomed, vertically
      // squashed for a grazing angle, focused below center. Everything drawn
      // inside this block is world space; overlays come after the restore.
      c.save();
      c.translate(w / 2, h * cam.fy);
      c.scale(cam.zoom, cam.zoom * cam.ysq);
      c.translate(-X(cam.ax), -Y(cam.ay));

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
        // Lanes span the padded roam area so panning past the 0..1 field
        // never shows cutoff markings.
        const lx0 = X(-0.15);
        const lx1 = X(1.15);
        c.save();
        c.globalAlpha = 0.05;
        c.fillStyle = lc;
        c.fillRect(lx0, y0, lx1 - lx0, y1 - y0);
        c.restore();
        c.save();
        c.globalAlpha = 0.5;
        c.strokeStyle = lc;
        c.lineWidth = 1.5;
        c.setLineDash([10, 8]);
        c.beginPath(); c.moveTo(lx0, y0); c.lineTo(lx1, y0); c.stroke();
        c.beginPath(); c.moveTo(lx0, y1); c.lineTo(lx1, y1); c.stroke();
        c.restore();
      }

      // --- grid -------------------------------------------------------------
      c.save();
      c.strokeStyle = "rgba(255,255,255,0.05)";
      c.lineWidth = 1;
      for (let i = -1; i <= 11; i++) {
        c.beginPath(); c.moveTo(X(i / 10), Y(-0.15)); c.lineTo(X(i / 10), Y(1.15)); c.stroke();
      }
      for (let i = -1; i <= 7; i++) {
        c.beginPath(); c.moveTo(X(-0.15), Y(i / 6)); c.lineTo(X(1.15), Y(i / 6)); c.stroke();
      }
      c.restore();

      // --- radar sweep during contact ---------------------------------------
      // Tactical only — zoomed in it would sit off-frame and read as noise.
      if (fx.sweepOn && cam.zoom < 1.5) {
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

      // Per-kind fallback glyph, traced as a path (caller sets paint + fills).
      // Square = Bulwark, triangle = Reaver, diamond = Longeye,
      // hexagon = Thunder, dot = Warden/dropship. Wrecks reuse it dimmed so
      // the fallen keep their identity (owner 2026-10-05: every icon named,
      // even the wrecks).
      const traceKindGlyph = (u: SceneUnit, x: number, y: number, rr: number) => {
        c.beginPath();
        if (u.kind === "bulwark") {
          c.rect(x - rr, y - rr, rr * 2, rr * 2);
        } else if (u.kind === "reaver") {
          c.moveTo(x, y - rr);
          c.lineTo(x + rr, y + rr);
          c.lineTo(x - rr, y + rr);
          c.closePath();
        } else if (u.kind === "longeye") {
          c.moveTo(x, y - rr);
          c.lineTo(x + rr, y);
          c.lineTo(x, y + rr);
          c.lineTo(x - rr, y);
          c.closePath();
        } else if (u.kind === "thunder") {
          for (let i = 0; i < 6; i++) {
            const a = Math.PI / 6 + (i * Math.PI) / 3;
            const gx = x + rr * Math.cos(a);
            const gy = y + rr * Math.sin(a);
            if (i === 0) c.moveTo(gx, gy);
            else c.lineTo(gx, gy);
          }
          c.closePath();
        } else {
          // warden: ring; dropship/turret: dot.
          c.arc(x, y, rr, 0, Math.PI * 2);
        }
      };

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
          // Distinct fallback glyph per kind — types read even before the
          // art loads (or where dots are all that fit): square = Bulwark,
          // triangle = Reaver, diamond = Longeye, hexagon = Thunder,
          // ring = Warden. Side-colored like everything else.
          const rr = r * 0.85;
          c.fillStyle = SIDE_COLOR[u.side];
          traceKindGlyph(u, x, y, rr);
          c.fill();
          c.strokeStyle = SIDE_DIM[u.side];
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(x, y, r * 0.35, 0, Math.PI * 2);
          c.stroke();
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
        // Selected squad: the commander's hand is on this bus — a bright
        // pulsing outer ring, unmistakable at any zoom.
        if (ui.selectedSquadId === u.squadId) {
          c.save();
          c.globalAlpha = 0.6 + 0.4 * Math.sin(Date.now() / 160);
          c.strokeStyle = "#ffffff";
          c.lineWidth = 2;
          c.beginPath(); c.arc(x, y, r + 9, 0, Math.PI * 2); c.stroke();
          c.restore();
        }
        c.restore();
      };

      // Wrecks first (dead units as scorch marks) — but named ones: a dim
      // per-kind glyph + (via the label pass below) a dim side-colored tag,
      // so the graveyard still reads instead of going anonymous.
      c.save();
      for (const u of unitsRef.current) {
        if (u.state !== "dead" || !ui.vectorsOn[u.vector]) continue;
        const wx = X(u.x);
        const wy = Y(u.y);
        c.fillStyle = "rgba(0,0,0,0.45)";
        c.beginPath();
        c.ellipse(wx, wy, s * 0.02, s * 0.014, 0, 0, Math.PI * 2);
        c.fill();
        c.save();
        c.globalAlpha = 0.5;
        c.fillStyle = SIDE_DIM[u.side];
        traceKindGlyph(u, wx, wy, Math.max(7, s * 0.022) * 0.55);
        c.fill();
        c.restore();
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
      // Kicked-up dust around the advance — the ground cam's texture.
      c.save();
      for (const d of fx.dusts) {
        const da = alpha(d.life, d.maxLife);
        c.globalAlpha = da * 0.32;
        c.fillStyle = "#cbb98f";
        c.beginPath(); c.arc(d.x, d.y, d.size, 0, Math.PI * 2); c.fill();
      }
      c.restore();

      // --- order ping: the accepted order, drawn then fading ----------------
      // Dashed path from the squad's old centroid to the destination plus a
      // pulsing gold ring on the objective. The order READS on the map.
      const ping = orderPingRef.current;
      if (ping) {
        const age = simTRef.current - ping.born; // sim seconds — slows with battle speed
        const plife = Math.max(0, 1 - age / 3);
        if (plife > 0) {
          c.save();
          c.globalAlpha = plife;
          c.strokeStyle = "rgba(255,255,255,0.85)";
          c.lineWidth = 1.5;
          c.setLineDash([8, 6]);
          c.beginPath();
          c.moveTo(X(ping.fx), Y(ping.fy));
          c.lineTo(X(ping.x), Y(ping.y));
          c.stroke();
          c.setLineDash([]);
          const pr = s * 0.032 * (1 + 0.25 * Math.sin(Date.now() / 150));
          c.strokeStyle = "#fbbf24";
          c.lineWidth = 2.5;
          c.beginPath(); c.arc(X(ping.x), Y(ping.y), pr, 0, Math.PI * 2); c.stroke();
          c.restore();
        }
      }

      c.restore(); // camera off — overlays below are screen space

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

      // --- unit labels ---------------------------------------------------------
      // "Name the damn icons." Every unit carries its type tag in screen
      // space (crisp at any zoom — no squash distortion): BULWARK, REAVER,
      // LONGEYE, THUNDER, WARDEN, DROPSHIP. Side-colored text on a dark
      // pill, matching the friend/foe rings. Staging ghosts get dim tags so
      // the muster reads too, and wrecks get dim tags so the fallen keep
      // their names. Toggleable in the Controls glass (LABELS).
      if (ui.labelsOn) {
        c.save();
        c.font = "700 9px system-ui, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        for (const u of unitsRef.current) {
          if (!ui.vectorsOn[u.vector]) continue;
          const sx = (u.x - cam.ax) * cam.zoom * w + w / 2;
          const sy = (u.y - cam.ay) * cam.zoom * cam.ysq * h + h * cam.fy;
          if (sx < -70 || sx > w + 70 || sy < -40 || sy > h + 40) continue;
          const dim = u.state === "staging" ? 0.55 : u.state === "dead" ? 0.38 : 1;
          const label = `${UNIT_KIND_LABEL[u.kind].toUpperCase()} · T${u.tier}`;
          const tw = c.measureText(label).width;
          const rScr = Math.max(7, s * 0.022) * cam.zoom;
          const ly = sy - rScr - 13;
          const pw = tw + 9;
          const ph = 13;
          c.globalAlpha = 0.62 * dim;
          c.fillStyle = "#000";
          c.beginPath();
          const bx = sx - pw / 2;
          const by = ly - ph / 2;
          const br = 4;
          c.moveTo(bx + br, by);
          c.arcTo(bx + pw, by, bx + pw, by + ph, br);
          c.arcTo(bx + pw, by + ph, bx, by + ph, br);
          c.arcTo(bx, by + ph, bx, by, br);
          c.arcTo(bx, by, bx + pw, by, br);
          c.closePath();
          c.fill();
          const sel = ui.selectedSquadId === u.squadId;
          if (sel) {
            c.globalAlpha = dim;
            c.strokeStyle = "#ffffff";
            c.lineWidth = 1;
            c.stroke();
          }
          c.globalAlpha = dim;
          c.fillStyle = sel ? "#ffffff" : SIDE_COLOR[u.side];
          c.fillText(label, sx, ly + 0.5);
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
      const pc = PHASE_COLORS[victorRef.current ? "resolved" : phase];
      c.font = "700 11px system-ui, sans-serif";
      c.fillStyle = pc;
      c.globalAlpha = 0.95;
      c.fillText(
        victorRef.current ? "RESOLVED" : (SCENE_PHASES.find((p) => p.phase === phase)?.label ?? phase),
        12, 20,
      );
      c.restore();

      // --- victor banner: threshold victory, center screen ------------------
      // The field breaks at the casualty threshold — one side holds it.
      const victor = victorRef.current;
      if (victor) {
        const vname = victor === "attacker" ? scene.attackerName : scene.defenderName;
        const vcolor = victor === "attacker" ? "#34d399" : "#ef4444";
        c.save();
        c.textAlign = "center";
        c.textBaseline = "middle";
        const vtext = `${vname.toUpperCase()} HOLDS THE FIELD`;
        c.font = "800 24px system-ui, sans-serif";
        const vw = c.measureText(vtext).width + 64;
        c.fillStyle = "rgba(0,0,0,0.62)";
        c.beginPath();
        c.roundRect(w / 2 - vw / 2, h / 2 - 44, vw, 88, 12);
        c.fill();
        c.strokeStyle = vcolor;
        c.globalAlpha = 0.7;
        c.lineWidth = 1.5;
        c.stroke();
        c.globalAlpha = 1;
        c.fillStyle = vcolor;
        c.fillText(vtext, w / 2, h / 2 - 12);
        c.font = "600 12px system-ui, sans-serif";
        c.fillStyle = "#d4d4d8";
        c.fillText("casualty threshold reached — the field breaks", w / 2, h / 2 + 20);
        c.restore();
      }

      // --- order toast: the judge's refusal, on the canvas ------------------
      // Illegal orders are never silent — the reason shows where the tap
      // happened to be seen: top-center, red-bordered, 2.6 seconds.
      const toast = toastRef.current;
      if (toast) {
        const ageMs = performance.now() - toast.born;
        const tlife = Math.max(0, 1 - ageMs / 2600);
        if (tlife > 0) {
          c.save();
          c.globalAlpha = Math.min(1, tlife * 2.5);
          c.font = "700 12px system-ui, sans-serif";
          c.textAlign = "center";
          c.textBaseline = "middle";
          const ttw = c.measureText(toast.text).width;
          const tpw = ttw + 28;
          const tph = 30;
          const tbx = w / 2 - tpw / 2;
          const tby = 44;
          const tbr = 8;
          c.beginPath();
          c.moveTo(tbx + tbr, tby);
          c.arcTo(tbx + tpw, tby, tbx + tpw, tby + tph, tbr);
          c.arcTo(tbx + tpw, tby + tph, tbx, tby + tph, tbr);
          c.arcTo(tbx, tby + tph, tbx, tby, tbr);
          c.arcTo(tbx, tby, tbx + tpw, tby, tbr);
          c.closePath();
          c.fillStyle = "rgba(24,10,10,0.9)";
          c.fill();
          c.strokeStyle = "#f87171";
          c.lineWidth = 1.5;
          c.stroke();
          c.fillStyle = "#fca5a5";
          c.fillText(toast.text, w / 2, tby + tph / 2 + 0.5);
          c.restore();
        }
      }

      // --- ground-cam foreground --------------------------------------------------
      // Near-field silhouettes sliding against the camera anchor: the near
      // field moves opposite and faster, which is what reads as LOW.
      if (cam.zoom > 1.4) {
        const mdx = (cam.ax - cam.gx) * w;
        const mdy = (cam.ay - cam.gy) * h;
        c.save();
        for (const t of TUFTS) {
          const px = t.x * w - mdx * 2.4 * t.depth;
          const py = t.y * h - mdy * 2.4 * t.depth;
          const wrapW = w + 160;
          const wx = ((((px + 80) % wrapW) + wrapW) % wrapW) - 80;
          if (t.mote) {
            c.globalAlpha = 0.35;
            c.fillStyle = "#d6c9a8";
            c.beginPath(); c.arc(wx, py, 1.6, 0, Math.PI * 2); c.fill();
          } else {
            const g5 = c.createRadialGradient(wx, py, 0, wx, py, t.s);
            g5.addColorStop(0, "rgba(12,9,6,0.5)");
            g5.addColorStop(1, "rgba(12,9,6,0)");
            c.globalAlpha = 1;
            c.fillStyle = g5;
            c.beginPath();
            c.ellipse(wx, py, t.s, t.s * 0.55, 0, 0, Math.PI * 2);
            c.fill();
          }
        }
        c.restore();
      }

      c.restore(); // un-scale
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheelNative);
      battleSfx.detach(); // silence the war when the scene closes
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id]);

  // ---- gestures: drag = pan, pinch = zoom, tap = select -------------------
  // The click-to-command layer coming next uses tap-to-select then
  // tap-to-move, so pan/zoom must never swallow taps: a pointer that moves
  // less than 10px is a tap, period. Double-tap recenters the map.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const downRef = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const lastTapRef = useRef(0);
  const pinchRef = useRef<{ d: number } | null>(null);

  const canvasCss = () => {
    const canvas = canvasRef.current;
    if (!canvas) return { w: 1, h: 1 };
    const r = canvas.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  };

  /** Drag-scroll the map. Ground mode pans a tight offset around the
   *  follow-cam; tactical pans the anchor itself. Always clamped on-field. */
  const panBy = (dxCss: number, dyCss: number) => {
    const cam = camRef.current;
    const ui = sceneUISnapshot();
    const { w, h } = canvasCss();
    const ez = Math.max(0.2, cam.zoom);
    if (ui.cameraMode === "ground") {
      cam.pox = Math.max(-0.18, Math.min(0.18, cam.pox - dxCss / (ez * w)));
      cam.poy = Math.max(-0.18, Math.min(0.18, cam.poy - dyCss / (ez * cam.ysq * h)));
    } else {
      const halfW = 0.5 / ez;
      const halfH = 0.5 / (ez * cam.ysq);
      cam.uax = clampAnchor(cam.uax - dxCss / (ez * w), halfW);
      cam.uay = clampAnchor(cam.uay - dyCss / (ez * cam.ysq * h), halfH);
      cam.ax = cam.uax;
      cam.ay = cam.uay;
    }
  };

  /** Zoom around a focal point (canvas-relative CSS px). */
  const zoomBy = (factor: number, fxCss: number, fyCss: number) => {
    const cam = camRef.current;
    const ui = sceneUISnapshot();
    const ground = ui.cameraMode === "ground";
    const newUz = Math.max(ZOOM_MIN, Math.min(ground ? GROUND_ZOOM_MAX : ZOOM_MAX, ui.zoomLevel * factor));
    if (newUz === ui.zoomLevel) return;
    const { w, h } = canvasCss();
    const oldEz = Math.max(0.2, cam.zoom);
    // World point under the focal point, in tactical fractions.
    const wxx = cam.ax + (fxCss - w / 2) / (oldEz * w);
    const wyy = cam.ay + (fyCss - h * cam.fy) / (oldEz * cam.ysq * h);
    setZoomLevel(newUz);
    if (!ground) {
      // Keep the focal world point under the cursor — no drift while zooming.
      const newEz = newUz; // tactical modeZoom = 1
      const halfW = 0.5 / newEz;
      const halfH = 0.5 / (newEz * cam.ysq);
      cam.uax = clampAnchor(wxx - (fxCss - w / 2) / (newEz * w), halfW);
      cam.uay = clampAnchor(wyy - (fyCss - h * cam.fy) / (newEz * cam.ysq * h), halfH);
      cam.ax = cam.uax;
      cam.ay = cam.uay;
    }
  };

  /** Issue a click-to-command move order: judge it against the doctrine,
   *  then move the squad or refuse with the reason — never silent. */
  const issueOrder = (squadId: string, dx: number, dy: number) => {
    const squadUnits = unitsRef.current.filter((u) => u.squadId === squadId && u.state !== "dead");
    const squad = buildSquads(unitsRef.current).find((s) => s.id === squadId);
    const name = squad ? squad.name : squadId;
    const dest = { x: Math.max(0.05, Math.min(0.95, dx)), y: Math.max(0.05, Math.min(0.95, dy)) };
    const verdict = judgeMoveOrder(squadUnits, dest);
    logOrder({
      squadName: name,
      dest: destLabel(dest.x, dest.y),
      verdict: verdict.ok ? "accepted" : "rejected",
      reason: verdict.ok ? undefined : verdict.reason,
    });
    if (!verdict.ok) {
      // The judge refused — say why, on the canvas, where the tap happened.
      toastRef.current = { text: verdict.reason, born: performance.now() };
      battleSfx.orderRejected(); // the judge's gavel — illegal orders SOUND refused
      return;
    }
    battleSfx.orderAccepted();
    // Accepted: the squad moves, holding formation around its centroid.
    let cx = 0;
    let cy = 0;
    for (const u of squadUnits) { cx += u.x; cy += u.y; }
    cx /= squadUnits.length;
    cy /= squadUnits.length;
    for (const u of squadUnits) {
      u.tx = Math.max(0.06, Math.min(0.94, dest.x + (u.x - cx)));
      u.ty = Math.max(0.06, Math.min(0.94, dest.y + (u.y - cy)));
      if (u.state === "holding" || u.state === "advancing") u.state = "advancing";
    }
    orderPingRef.current = { x: dest.x, y: dest.y, fx: cx, fy: cy, born: simTRef.current };
  };

  /** Tap: gunner view → click an enemy to target; your turret → take the
   *  gun; your unit → select its squad; with a squad selected → the tap is
   *  a move order, judged by the doctrine. (Fractions 0..1 of the canvas.) */
  const handleTap = (px: number, py: number) => {
    battleSfx.attach(); // user gesture — wake the war (autoplay-safe)
    // Invert the camera transform: screen fractions → tactical 0..1 coords,
    // so turret picks and gunner targeting land in ground mode too.
    const cam = camRef.current;
    const { w, h } = canvasCss();
    const tx = ((px * w - w / 2) / cam.zoom + cam.ax * w) / w;
    const ty = ((py * h - h * cam.fy) / (cam.zoom * cam.ysq) + cam.ay * h) / h;
    const ui = sceneUISnapshot();
    if (ui.gunnerId) {
      // Gunner view: click an enemy unit to target it.
      let best: SceneUnit | null = null;
      let bd = 0.06;
      for (const u of unitsRef.current) {
        if (u.side === "attacker" || u.state === "dead" || u.state === "staging") continue;
        const d = Math.hypot(u.x - tx, u.y - ty);
        if (d < bd) { bd = d; best = u; }
      }
      if (best) setGunTarget(best.id);
      return;
    }
    // Click one of YOUR turrets to enter the gunner view.
    let best: SceneTurret | null = null;
    let bd = 0.05;
    for (const tr of turretsRef.current) {
      if (tr.side !== "attacker" || tr.hp01 <= 0) continue;
      const d = Math.hypot(tr.x - tx, tr.y - ty);
      if (d < bd) { bd = d; best = tr; }
    }
    if (best) {
      setGunner(best.id);
      setManual(true); // hands on the weapon ⇒ manual mode
      return;
    }
    // Click one of YOUR units → select its squad (the bus).
    let su: SceneUnit | null = null;
    let sd = 0.06;
    for (const u of unitsRef.current) {
      if (u.side !== "attacker" || u.state === "dead") continue;
      const d = Math.hypot(u.x - tx, u.y - ty);
      if (d < sd) { sd = d; su = u; }
    }
    if (su) {
      setSelectedSquad(su.squadId);
      return;
    }
    // With a squad selected, the tap is a destination — judge the order.
    if (ui.selectedSquadId) {
      issueOrder(ui.selectedSquadId, tx, ty);
      return;
    }
    // Empty tap, nothing selected: make sure nothing lingers selected.
    setSelectedSquad(null);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    battleSfx.attach(); // user gesture — wake the war (autoplay-safe)
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      downRef.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    } else if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      downRef.current = null; // two fingers: no tap
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pts = pointersRef.current;
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId)!;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const pr = pinchRef.current;
      if (pr && pr.d > 0 && d > 0) {
        const r = e.currentTarget.getBoundingClientRect();
        zoomBy(d / pr.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        panBy(dx / 2, dy / 2);
      }
      pinchRef.current = { d };
      return;
    }
    const dn = downRef.current;
    if (dn && dn.id === e.pointerId && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 10) {
      panBy(dx, dy);
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const pts = pointersRef.current;
    const wasDown = downRef.current;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinchRef.current = null;
    if (cancelled || !wasDown || wasDown.id !== e.pointerId) {
      if (pts.size === 0) downRef.current = null;
      return;
    }
    const moved = Math.hypot(e.clientX - wasDown.x, e.clientY - wasDown.y);
    const held = performance.now() - wasDown.t;
    downRef.current = null;
    if (moved <= 10 && held < 600 && pts.size === 0) {
      const now = performance.now();
      if (now - lastTapRef.current < 350) {
        lastTapRef.current = 0;
        recenterMap(); // double-tap: back to the full field
      } else {
        lastTapRef.current = now;
        const r = e.currentTarget.getBoundingClientRect();
        handleTap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => endPointer(e, false);
  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => endPointer(e, true);

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
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            className="block cursor-crosshair"
            style={{ touchAction: "none" }}
            aria-label="Battle scene tactical map"
          />
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

        {/* collapsible icon key — what am I looking at */}
        <BattleLegend />
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
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          className="block cursor-crosshair"
          style={{ touchAction: "none" }}
          aria-label="Battle scene tactical map"
        />
        {gunnerOverlay}
        <BattleLegend />
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
            <ToggleSwitch label="Labels" on={ui.labelsOn} onChange={setLabelsOn} accent="#fbbf24" />
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
            <ToggleSwitch
              label={ui.cameraMode === "ground" ? "Ground" : "Tactical"}
              on={ui.cameraMode === "ground"}
              onChange={(on) => setCameraMode(on ? "ground" : "tactical")}
              accent="#f0abfc"
            />
            <div
              className="flex items-center overflow-hidden rounded-lg border border-black/60"
              style={{ background: "linear-gradient(180deg,#1b1d24 0%,#101218 60%,#1b1d24 100%)" }}
              role="group"
              aria-label="Map zoom"
            >
              <button type="button" aria-label="Zoom out" onClick={() => setZoomLevel(ui.zoomLevel / 1.3)} className="px-3 py-2 text-sm font-bold text-zinc-300 hover:text-white">−</button>
              <span className="px-1 text-[10px] font-bold tabular-nums text-amber-300">{Math.round(ui.zoomLevel * 100)}%</span>
              <button type="button" aria-label="Zoom in" onClick={() => setZoomLevel(ui.zoomLevel * 1.3)} className="px-3 py-2 text-sm font-bold text-zinc-300 hover:text-white">+</button>
              <button type="button" onClick={recenterMap} title="Back to the full field" aria-label="Recenter map" className="border-l border-black/60 px-2.5 py-2 text-[11px] text-zinc-300 hover:text-white">⌖</button>
            </div>
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
          Click one of your squads, then click the map — the judge rules every order.
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
