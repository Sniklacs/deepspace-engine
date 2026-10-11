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

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  CLOCK_END_S,
  COVER_REDUCTION,
  coverAt,
  FLYBY_START_S,
  HOTDROP_HOT_RADIUS,
  HOTDROP_SPLASH_DMG,
  REVEAL_S,
  SCENE_PHASES,
  scatterLanding,
  SHOOTDOWN_S,
  waveDueAt,
  weakestVector,
  WORLD_CX,
  WORLD_CY,
  WORLD_FIT_ZOOM,
  WORLD_H,
  WORLD_W,
  METERS_PER_WORLD_UNIT,
  SIEGE_BLAST_R_M,
  siegeFalloff,
  clampWorldX,
  clampWorldY,
  demoBreakVictor,
  mulberry32,
  sceneNightFactor,
  scenePhaseAt,
  scoutStatusAt,
  VECTOR_LANES,
  VECTOR_LEAN,
  UNIT_KIND_LABEL,
  type SceneBattle,
  type ScenePhase,
  type SceneTurret,
  type SceneUnit,
  type SceneUnitKind,
  type ScoutStatus,
} from "../../game/war/battle-scene-model";
import {
  CHORUS_HOLD_REDUCTION,
  counterattackOrders,
  evaluateCounterattack,
  evaluateEnvelopment,
  evaluateSpoilingAttack,
  holdingBonusApplies,
  spoilingAttackOrders,
  type CounterattackOrder,
} from "../../game/war/chorus-doctrine";
import {
  CHORUS_GRADES,
  DEFAULT_CHORUS_GRADE,
} from "../../game/war/deploy-loadout";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
  setVectorOn,
  setTurretsOn,
  setTurretMode,
  turretFires,
  turretModeOf,
  setLogisticsFx,
  setManual,
  setCameraMode,
  cycleDayNight,
  setLabelsOn,
  setGunTarget,
  setClock,
  bumpKill,
  registerTurrets,
  registerRoster,
  registerSquads,
  setSelectedSquad,
  logOrder,
  orderReceipt,
  resetSceneUI,
  setSiegeAim,
  setSiegeAimArmed,
  setSquadHoldPosition,
  squadStanceOf,
  setZoomLevel,
  recenterMap,
  BATTLE_SPEED_MUL,
} from "../../game/war/battle-scene-ui-store";
import {
  buildSquads,
  enemyLineY,
  hasLongeyeCover,
  isBehindLines,
  isDrivable,
  judgeJumpDrop,
  judgeMoveOrder,
  lineWardenCount,
  destLabel,
  ORDER_DELAY_S,
  squadEyeCount,
  stampOrder,
  stepOffUnits,
  vecShort,
} from "../../game/war/scene-orders";
import {
  commsFor,
  dismissBubble,
  pushBubble,
  REPORT_ARROW_LEN,
  watchShouldReport,
  type CommsBubble,
  type CommsEventKind,
  type MoveWatch,
  type WatchUnit,
} from "../../game/war/battle-comms";
import { battleSfx } from "../../game/war/battle-sfx";
// FRAME-TIME TELEMETRY (Phase 2, slice 14, spec §9): the battle frame loop
// feeds the rolling-window sampler AUTO's rung decisions are driven from.
import { recordFrameTime } from "../../game/graphics-quality-telemetry";
// Seamless-world camera-origin model (Phase 2, slice 7): the renderer gains
// a camera origin + tile offset; world units are the engine's, unchanged.
import {
  audioBandFor,
  bandForContinuumScale,
  detailForBand,
  screenToWorld,
  softClampX,
  softClampY,
  worldToScreen,
  type BattleCamera,
} from "../../game/war/battle-camera";
// Playbook formation type (the result sheet's "Save in war room" draft).
import {
  formationFromBattle,
  type BattleFormationSquad,
  type BattleFormationUnit,
} from "../../game/war/playbook";
import {
  storeReplay,
  markReplaySaved,
  getReplay,
  compactReplay,
  retentionForBattle,
  defaultBattleName,
  PENDING_REPLAY_TTL_MS,
  type BattleReplay,
  type ReplayFrame,
  type ReplayEvent,
} from "../../game/war/battle-replays";
import { BattleReplayViewer } from "./BattleReplayViewer";
// Troop tiers are real (owner 2026-10-05): a T4 genuinely out-hits and
// out-lasts a T1 — the same power curve the war engine prices forces at.
import { tierPowerMult, weaponKindFor } from "../../game/war/troops";
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
// SEAMLESS-WORLD §9 (slice 9): the rendered explosion/dust draw paths.
import {
  drawBloom,
  drawDebrisChunks,
  drawEmbers,
  drawExplosionBody,
  drawScorch,
  drawShockwave,
  drawShell,
  drawSpark,
  drawTracerBeam,
  drawTracerSlug,
  drawVolDust,
} from "../../game/war/rendered-fx";
import {
  clearRadarFeed,
  pushRadarFrame,
  radarPing,
} from "../../game/war/battle-radar-feed";
// SEAMLESS-WORLD §8 (slice 13): quality-gated terrain detail overlays.
import {
  createOverlaySpec,
  drawTerrainOverlays,
  overlayVisibleAtZoom,
} from "../../game/world/terrain-overlays";
import { ToggleSwitch } from "./ToggleSwitch";
import { BattleHud } from "./BattleHud";
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

const CAM_HOME: CameraRig = { zoom: 1, ax: WORLD_CX, ay: WORLD_CY, ysq: 1, fy: 0.5, gx: WORLD_CX, gy: WORLD_CY, wasGround: false, uax: WORLD_CX, uay: WORLD_CY, pox: 0, poy: 0, reNonce: 0 };

// Zoom bounds. Tactical roams the full field (fit zoom frames all 1.5×1.5);
// ground keeps it sensible so the follow-cam still reads.
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;
const GROUND_ZOOM_MAX = 1.6;
// The frame may roam a padded battlefield, never void.
const FIELD_PAD = 0.12;

/** Clamp a pan anchor so the visible window stays on the battlefield. */
function clampAnchor(ax: number, half: number, size: number, center: number): number {
  const lo = -FIELD_PAD + half;
  const hi = size + FIELD_PAD - half;
  if (lo >= hi) return center;
  return Math.max(lo, Math.min(hi, ax));
}

/** CameraRig → the shared camera-origin frame (slice 7). The tile offset
 *  is zero until tile streaming rebases it — the transform is identical
 *  to the inline math it replaces, so this is a pure wiring change. */
function rigCamera(rig: CameraRig): BattleCamera {
  return { ox: rig.ax, oy: rig.ay, zoom: rig.zoom, ysq: rig.ysq, fy: rig.fy, tileX: 0, tileY: 0 };
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
  /**
   * Called with the named formation draft when the commander taps
   * "Save formation" on the result sheet (owner 2026-10-11). The draft
   * captures the battle's own squads, composition, and starting positions
   * — works for ANY battle, not just deployed formations.
   */
  onSaveFormation?: (draft: {
    name: string;
    playId: string;
    loads: import("../../game/war/playbook").SlotLoads;
    slotMeta?: import("../../game/war/playbook").SavedFormation["slotMeta"];
    replayId?: string;
  }) => void;
  /**
   * Called with the named doctrine draft when the commander saves the
   * battle as an alliance doctrine (owner 2026-10-11). The parent posts
   * it to the alliance library (allianceSaveDoctrineFn). Absent = no
   * alliance context, the doctrine option is hidden.
   */
  onSaveDoctrine?: (draft: {
    name: string;
    playId: string;
    loads: import("../../game/war/playbook").SlotLoads;
    slotMeta?: import("../../game/war/playbook").SavedFormation["slotMeta"];
    replay?: import("../../game/war/battle-replays").CompactReplay;
    battleName: string;
    victor: "attacker" | "defender" | null;
    durationS: number;
    killsAttacker: number;
    killsDefender: number;
  }) => void;
  /**
   * Seamless-world continuum scale (the globe's z axis) when this scene is
   * embedded in the world. Drives the Z3-overview LOD (shapes vs models)
   * and the battle-bus audio LOD. Null/undefined = standalone scene:
   * Z4 ground detail + full audio, exactly today's behavior.
   */
  continuumScale?: number | null;
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

/** Battle-clock stamp for reports/replays: T+02:34. */
function fmtClock(tS: number): string {
  const m = Math.floor(Math.max(0, tS) / 60);
  const s = Math.floor(Math.max(0, tS) % 60);
  return `T+${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Snapshot a battle's starting disposition for "Save formation" (owner
 * 2026-10-11, pure): the attacker's squads, each unit's kind/tier, vector,
 * entry, and STARTING position. The saved formation redeploys exactly this.
 */
function snapshotFormation(scene: SceneBattle): {
  squads: BattleFormationSquad[];
  units: BattleFormationUnit[];
} {
  const squads = buildSquads(scene.units)
    .filter((s) => isDrivable(s))
    .map((s) => ({ id: s.id, name: s.name }));
  const units: BattleFormationUnit[] = [];
  for (const u of scene.units) {
    if (u.side !== "attacker") continue;
    if (!(u.kind === "bulwark" || u.kind === "reaver" || u.kind === "longeye" || u.kind === "thunder" || u.kind === "warden")) continue;
    units.push({
      squadId: u.squadId,
      kind: u.kind,
      tier: u.tier,
      x: u.x,
      y: u.y,
      vector: u.vector,
      onCall: u.onCall,
    });
  }
  return { squads, units };
}

export function BattleScene({ scene: sceneProp, liveCasualties = null, variant = "embedded", onClose, onSaveFormation, onSaveDoctrine, continuumScale = null }: Props) {
  // Retry / re-challenge (owner 2026-10-11): the battle can restart on the
  // same field (retry — same seed) or as a fresh challenge (same forces,
  // new seed). `scene` below is the ACTIVE scene — every downstream read
  // uses it, so a retry is a full clean reset.
  const [activeScene, setActiveScene] = useState(sceneProp);
  const [battleRunId, setBattleRunId] = useState(0);
  const scene = activeScene;
  useEffect(() => {
    // Parent handed a new battle: adopt it.
    setActiveScene((cur) => (cur.id === sceneProp.id ? cur : sceneProp));
  }, [sceneProp]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sprites = useMemo(loadSprites, []);
  const fx = useMemo(() => new Fx(), []);
  // SEAMLESS-WORLD §8 (slice 13): terrain detail overlays — the corruption
  // field recenters on the Chorus stronghold (north edge), not the map
  // center (spec §7). The spec is built once per battle at CINEMATIC
  // density; the draw call gates density per rung and visibility per zoom.
  const overlaySpec = useMemo(
    () =>
      createOverlaySpec({
        seed: (scene.seed ^ 0x51f7) >>> 0,
        worldW: WORLD_W,
        worldH: WORLD_H,
        strongholdX: WORLD_CX,
        strongholdY: WORLD_H,
        radius: 1.35,
      }),
    [scene.seed],
  );
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
  const orderPingRef = useRef<{ x: number; y: number; fx: number; fy: number; born: number; atS: number } | null>(null);
  const toastRef = useRef<{ text: string; born: number } | null>(null);
  // Battle comms — field-report bubbles (owner 2026-10-06). Every report the
  // engine posts (movement alerts, scout results, chorus warnings, clock
  // milestones, phase changes, reserve status) lands as a bubble AND a log
  // entry; the bubble persists until the commander taps it (confirmed read).
  const [comms, setComms] = useState<CommsBubble[]>([]);
  const commsIdRef = useRef(1);
  // Resolution mirror for the DOM result overlay (the canvas draws the
  // banner; the overlay carries the "Save in war room" action).
  const [resolvedSide, setResolvedSide] = useState<"attacker" | "defender" | null>(null);
  const [saveName, setSaveName] = useState("");
  const [savedInWarRoom, setSavedInWarRoom] = useState(false);
  // End-of-battle action bar (owner 2026-10-11): retry / re-challenge /
  // report / save replay / watch replay / save formation(+doctrine).
  const [resultView, setResultView] = useState<"actions" | "report" | "save">("actions");
  const [replayId, setReplayId] = useState<string | null>(null);
  const [replaySaved, setReplaySaved] = useState(false);
  const [watchingReplay, setWatchingReplay] = useState(false);
  const [saveWithReplay, setSaveWithReplay] = useState(true);
  const [saveDest, setSaveDest] = useState<"personal" | "doctrine">("personal");
  /** Replay capture: 1Hz keyframes + sparse events, finalized at resolve. */
  const replayFramesRef = useRef<ReplayFrame[]>([]);
  const replayEventsRef = useRef<ReplayEvent[]>([]);
  const replayLastRef = useRef(0);
  const replayDoneRef = useRef(false);
  const replayStartRef = useRef(Date.now());
  /** The battle's starting disposition — what "Save formation" captures. */
  const formationSnapshotRef = useRef<{ squads: BattleFormationSquad[]; units: BattleFormationUnit[] }>({ squads: [], units: [] });
  /** comms mirror for the report's key moments + the replay record. */
  const commsRef = useRef<import("../../game/war/battle-comms").CommsBubble[]>([]);
  // Longeye movement-report state (canvas-local):
  //  - watches: enemy moves in flight, reported at ~50% of progress
  //    (see watchShouldReport in battle-comms).
  //  - arrowRef: the direction vector shown with the report (fixed length —
  //    it shows the moving squad + direction, never a perfect destination).
  //  - highlightRef: the reported squad's units, pulsed on the field.
  const watchesRef = useRef<MoveWatch[]>([]);
  const arrowRef = useRef<{ x: number; y: number; dx: number; dy: number; until: number } | null>(null);
  const highlightRef = useRef<{ units: WatchUnit[]; until: number } | null>(null);
  // Whether the scout revealed the Chorus disposition (gates defender
  // rendering + the grade in the header until the flyby completes).
  const [revealed, setRevealed] = useState(false);
  // Reserve-arrival comms, announced once per vector per battle.
  const reserveAnnouncedRef = useRef<Set<string>>(new Set());
  // Threshold victory (demo): when a side loses >= DEMO_BREAK_FRAC of its
  // force, the field breaks — the other side holds it. Doctrine: casualty
  // thresholds, not mutual annihilation.
  const victorRef = useRef<"attacker" | "defender" | null>(null);
  // Last doctrine phase seen — phase transitions earn SFX stingers.
  const phaseRef = useRef<string | null>(null);
  // ATTRITION GOVERNOR (owner 2026-10-11): the reaction window is the metric.
  // A squad losing badly grinds down over 30-60s of visible losing — never
  // evaporates. Two levers:
  //  - ATTRITION_SCALE: every damage number in the scene is scaled by this.
  //  - SQUAD_DMG_CAP: max hp01 ONE squad can lose per 0.28s exchange tick,
  //    scaled by living strength (0.006 × alive). A full 20-unit squad can
  //    lose at most ~0.43 hp/s even under 3:1 focus — the wipe takes ≥45s.
  //    Even-odds fights deal under the cap naturally: slugging matches.
  const ATTRITION_SCALE = 0.6;
  const SQUAD_DMG_CAP_FRAC = 0.006;
  const SQUAD_DMG_CAP_MIN = 0.05;
  // Warden shields (owner 2026-10-11): coverage radius in world units,
  // shield max per covering Warden, and regen per sim-second while covered.
  const SHIELD_RADIUS = 0.2;
  const SHIELD_PER_WARDEN = 0.3;
  const SHIELD_MAX = 0.75;
  const SHIELD_REGEN = 0.035;
  // Siege (owner 2026-10-11): thunder guns lob shells — cooldown between
  // shots, and the per-shell damage before the governor. Blast radius and
  // falloff are meter-based (SIEGE_BLAST_R_M, siegeFalloff) — 20m of hurt
  // that doesn't discriminate between friend and foe.
  const SIEGE_COOLDOWN_S = 2.8;
  const SIEGE_SPLASH_R = SIEGE_BLAST_R_M / METERS_PER_WORLD_UNIT;
  const SIEGE_DMG = 0.5;
  // Per-frame damage ledger — every damage source accumulates here and is
  // flushed once per exchange tick through the governor (cap + shields).
  const dmgLedgerRef = useRef<Array<{ u: SceneUnit; amt: number }>>([]);
  // Engine-casualty throttle (owner 2026-10-11): live engine ticks match
  // visuals to engine casualties, but never burst-wipe — one engine kill
  // per side per ENGINE_KILL_GAP_S, and per squad per SQUAD_KILL_GAP_S.
  const engineKillAtRef = useRef<Record<string, number>>({ attacker: -99, defender: -99 });
  const squadKillAtRef = useRef<Map<string, number>>(new Map());
  const ENGINE_KILL_GAP_S = 2.0;
  const SQUAD_KILL_GAP_S = 6.0;
  // Initial squad headcounts — the SQUADS panel's casualty counts need the
  // ORIGINAL strength, not the shrinking living count.
  const squadTotalRef = useRef<Map<string, number>>(new Map());
  // Last squad alive-counts pushed to the store — the SQUADS panel refreshes
  // only when something actually died.
  const squadAliveRef = useRef<string>("");
  // Chorus doctrine (owner 2026-10-06): the survivor defends first, then
  // smells blood. Once the reserve commits, it stays committed. G5 hunts:
  // spoiling attacks + envelopment, once each.
  const counterRef = useRef(false);
  const counterAccRef = useRef(0);
  const spoilingRef = useRef(false);
  const envelopRef = useRef<{ FLANK_LEFT: boolean; FLANK_RIGHT: boolean }>({
    FLANK_LEFT: false,
    FLANK_RIGHT: false,
  });
  // Scout flyby (owner 2026-10-06): the approach-phase intel gamble.
  const scoutRef = useRef<ScoutStatus>("pending");
  // Pushed roster fn — re-run with defenders once the scout reveals them.
  const rosterPushRef = useRef<(includeDefenders: boolean) => void>(() => {});
  // Battle clock (owner 2026-10-06): reinforcement waves + expiry.
  const waveRef = useRef(0);
  const warn3Ref = useRef(false);
  const warn1Ref = useRef(false);
  const clockFailRef = useRef(false);
  // Camera rig — the mode lives in the shared store; zoom/anchor ease here
  // so flipping the toggle glides instead of cutting.
  const camRef = useRef<CameraRig>({ ...CAM_HOME });
  // Seamless-world continuum scale, read fresh in the frame loop (the main
  // loop effect only re-runs on scene.id, so the prop is mirrored here).
  const continuumScaleRef = useRef<number | null | undefined>(continuumScale);
  continuumScaleRef.current = continuumScale;
  if (unitsRef.current.length === 0) {
    unitsRef.current = scene.units.map((u) => ({ ...u }));
    turretsRef.current = scene.turrets.map((t) => ({ ...t }));
    // First mount: freeze the ORIGINAL squad headcounts for casualty counts.
    squadTotalRef.current = new Map(
      buildSquads(unitsRef.current)
        .filter((s) => isDrivable(s))
        .map((s) => [s.id, s.unitIds.length] as [string, number]),
    );
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

  // Reset working copy + shared UI when the battle identity changes:
  // a new scene, a retry (same field, same seed), or a re-challenge
  // (same forces, new seed). (owner 2026-10-11)
  const runKeyRef = useRef("");
  useEffect(() => {
    const key = `${scene.id}#${battleRunId}`;
    if (runKeyRef.current !== key) {
      runKeyRef.current = key;
      unitsRef.current = scene.units.map((u) => ({ ...u }));
      turretsRef.current = scene.turrets.map((t) => ({ ...t }));
      camRef.current = { ...CAM_HOME };
      simTRef.current = 0;
      victorRef.current = null;
      setResolvedSide(null);
      setSaveName("");
      setSavedInWarRoom(false);
      phaseRef.current = null;
      counterRef.current = false;
      counterAccRef.current = 0;
      spoilingRef.current = false;
      envelopRef.current = { FLANK_LEFT: false, FLANK_RIGHT: false };
      scoutRef.current = "pending";
      waveRef.current = 0;
      warn3Ref.current = false;
      warn1Ref.current = false;
      clockFailRef.current = false;
      reserveAnnouncedRef.current = new Set();
      battleSfx.reset();
      resetSceneUI();
      // Fresh battle: freeze the ORIGINAL squad headcounts (casualty counts
      // need them) and drop any stale radar snapshot.
      squadTotalRef.current = new Map(
        buildSquads(unitsRef.current)
          .filter((s) => isDrivable(s))
          .map((s) => [s.id, s.unitIds.length] as [string, number]),
      );
      squadKillAtRef.current = new Map();
      engineKillAtRef.current = { attacker: -99, defender: -99 };
      clearRadarFeed();
    }
    registerTurrets(
      turretsRef.current
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.side === "attacker" && t.hp01 > 0)
        .map(({ t, i }) => ({ id: t.id, idx: i })),
    );
    // Force roster for the FIELD FORCE panel — what's on the field by type,
    // with a tier breakdown per row (owner 2026-10-05: read force quality).
    // The enemy stays hidden until the scout flyby reveals the disposition
    // (owner 2026-10-06) — pushRoster(false) at setup, pushRoster(true) on reveal.
    const pushRoster = (includeDefenders: boolean) => {
      const counts = new Map<string, { count: number; tiers: [number, number, number, number] }>();
      for (const u of unitsRef.current) {
        if (u.side === "defender" && !includeDefenders) continue;
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
    };
    pushRoster(false);
    rosterPushRef.current = pushRoster;
    // Command squads for the SQUADS panel — the five buses, living strength.
    // (Drivable: attacker only. The defender is the Chorus AI.)
    // The eye glyph marks squads with living Longeyes — they watch their
    // own sector (owner 2026-10-06: positional coverage).
    registerSquads(
      buildSquads(unitsRef.current)
        .filter((s) => isDrivable(s))
        .map((s) => ({
          id: s.id,
          name: s.name,
          alive: s.unitIds.length,
          total: s.unitIds.length,
          eyes: squadEyeCount(unitsRef.current, s.id) > 0,
          onCallReserve: unitsRef.current.some(
            (u) => u.squadId === s.id && u.state === "staging" && u.onCall,
          ),
          hasThunders: s.unitIds.some((id) => {
            const u = unitsRef.current.find((w) => w.id === id);
            return u !== undefined && u.kind === "thunder" && u.state !== "dead";
          }),
        })),
    );
    // New battle, new intel: reset comms, reveal, and movement watches.
    setComms([]);
    commsIdRef.current = 1;
    setRevealed(false);
    watchesRef.current = [];
    arrowRef.current = null;
    highlightRef.current = null;
    // Replay capture + formation snapshot reset for the new run.
    replayFramesRef.current = [];
    replayEventsRef.current = [];
    replayLastRef.current = 0;
    replayDoneRef.current = false;
    replayStartRef.current = Date.now();
    setReplayId(null);
    setReplaySaved(false);
    setResultView("actions");
    setWatchingReplay(false);
    setSaveName("");
    setSavedInWarRoom(false);
    commsRef.current = [];
    formationSnapshotRef.current = snapshotFormation(scene);
  }, [scene, battleRunId]);

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
    /** Damage-taken multiplier for a unit: the Chorus hold bonus while dug
     *  in, and the terrain cover bonus — modest each, meaningful together. */
    const dmgTakenMul = (v: SceneUnit): number => {
      let m = 1;
      if (holdingBonusApplies(v)) m *= 1 - CHORUS_HOLD_REDUCTION;
      if (coverAt(v.x, v.y, scene.terrain)) m *= 1 - COVER_REDUCTION;
      return m;
    };
    const nearestEnemy = (x: number, y: number, side: string, maxD: number) => {
      let best: SceneUnit | null = null;
      let bd = maxD;
      for (const e of enemiesOf(side)) {
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    };

    /**
     * Finalize the battle replay at resolve (owner 2026-10-11): the captured
     * keyframes + events become a stored replay. PvP duels auto-save and
     * queue a ladder result; everything else pends — trashed after 24h
     * unless the commander taps Save Replay.
     */
    const finalizeReplay = (victor: "attacker" | "defender") => {
      if (replayDoneRef.current) return;
      replayDoneRef.current = true;
      const now = Date.now();
      const uiSnap = sceneUISnapshot();
      const pvp = !!scene.pvp;
      const retention = retentionForBattle(pvp);
      const replay: BattleReplay = {
        id: `rp-${scene.id}-${now.toString(36)}`,
        battleId: scene.id,
        name: defaultBattleName(scene.name, now),
        attackerName: scene.attackerName,
        defenderName: scene.defenderName,
        victor,
        startedAt: replayStartRef.current,
        endedAt: now,
        durationS: Math.round(simTRef.current),
        pvp,
        duelId: scene.pvp?.duelId,
        retention,
        expiresAt: retention === "pending" ? now + PENDING_REPLAY_TTL_MS : undefined,
        squads: uiSnap.squads.map((s) => ({ id: s.id, name: s.name, alive: s.alive, total: s.total })),
        kills: { attacker: uiSnap.kills.attacker, defender: uiSnap.kills.defender },
        orders: uiSnap.orderLog.map((o) => orderReceipt(o).text),
        keyMoments: commsRef.current
          .filter((c) => c.critical)
          .map((c) => `${fmtClock(c.atS)} — ${c.message}`),
        frames: replayFramesRef.current,
        events: replayEventsRef.current,
      };
      storeReplay(replay, now);
      setReplayId(replay.id);
      // Duels auto-save; the arena ladder is fed by the arena's own bout
      // ledger (buildLadderEntries) — no separate queue needed.
      setReplaySaved(retention !== "pending");
    };

    const killUnit = (u: SceneUnit) => {
      if (u.state === "dead") return;
      u.state = "dead";
      u.hp01 = 0;
      u.shield01 = 0;
      fx.explode(X(u.x), Y(u.y), u.kind === "thunder" ? 1.5 : 1);
      battleSfx.explosion(u.x, u.y, u.kind === "thunder");
      bumpKill(u.side as "attacker" | "defender");
      radarPing(u.x, u.y, "kill");
      replayEventsRef.current.push({
        t: simTRef.current, kind: "kill", x: u.x, y: u.y, side: u.side,
      });
      // Demo only: the field breaks at the casualty threshold — the other
      // side holds it. Live battles resolve on the engine's own ticks.
      if (!liveCasualties && !victorRef.current) {
        const v = demoBreakVictor(unitsRef.current);
        if (v) {
          victorRef.current = v;
          setResolvedSide(v);
          battleSfx.victor(v === "attacker");
          finalizeReplay(v);
        }
      }
    };

    /**
     * Damage ledger (owner 2026-10-11): every damage source accumulates
     * here; flushDamage() applies it once per exchange tick through the
     * governor — global scale, per-squad cap, shields-first. No burst wipes.
     */
    const dealDamage = (target: SceneUnit, amt: number) => {
      if (target.state === "dead" || amt <= 0) return;
      dmgLedgerRef.current.push({ u: target, amt: amt * ATTRITION_SCALE });
    };
    const flushDamage = () => {
      const ledger = dmgLedgerRef.current;
      if (ledger.length === 0) return;
      dmgLedgerRef.current = [];
      // group by squad for the per-squad cap
      const bySquad = new Map<string, Array<{ u: SceneUnit; amt: number }>>();
      for (const e of ledger) {
        const arr = bySquad.get(e.u.squadId) ?? [];
        arr.push(e);
        bySquad.set(e.u.squadId, arr);
      }
      for (const [, entries] of bySquad) {
        const alive = entries.filter((e) => e.u.state !== "dead").length;
        if (alive === 0) continue;
        const cap = Math.max(SQUAD_DMG_CAP_MIN, SQUAD_DMG_CAP_FRAC * alive);
        const total = entries.reduce((s, e) => s + e.amt, 0);
        const k = total > cap ? cap / total : 1;
        for (const { u, amt } of entries) {
          if (u.state === "dead") continue;
          let a = amt * k;
          // shields absorb first — the bubble shivers where the hit lands
          const sh = u.shield01 ?? 0;
          if (sh > 0 && a > 0) {
            const absorbed = Math.min(sh, a);
            u.shield01 = sh - absorbed;
            a -= absorbed;
            if (absorbed > 0.015) fx.shieldHit(X(u.x), Y(u.y));
          }
          if (a > 0) {
            u.hp01 -= a;
            if (u.hp01 <= 0) killUnit(u);
          }
        }
      }
    };

    // Reinforcement wave (owner 2026-10-06): the longer the attacker sits,
    // the thicker the defense gets. A bulwark-heavy wave lands on the
    // weakest defensive vector (fewest alive, excluding the reserve — that's
    // the counterattack's), entering from the defender's back edge. Capped
    // at MAX_REINFORCE_WAVES. Seeded per battle, per wave — replays stable.
    const landWave = (wave: number) => {
      const rnd = mulberry32((scene.seed ^ (0xbeef + wave * 0x9e37)) >>> 0);
      const weak = weakestVector(unitsRef.current, ["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR"]);
      const lane = VECTOR_LANES[weak];
      const count = 6 + Math.floor(rnd() * 4); // 6–9 troops
      for (let i = 0; i < count; i++) {
        const r = rnd();
        const kind: SceneUnitKind = r < 0.55 ? "bulwark" : r < 0.8 ? "reaver" : "longeye";
        const tr = rnd();
        const tier = (tr < 0.2 ? 1 : tr < 0.55 ? 2 : tr < 0.9 ? 3 : 4) as 1 | 2 | 3 | 4;
        unitsRef.current.push({
          id: `r${wave}-${i}`,
          side: "defender",
          kind,
          tier,
          vector: weak,
          squadId: "D",
          x: clampWorldX(lane.x + (rnd() - 0.5) * 2 * lane.spread),
          y: 0.08 + rnd() * 0.06,
          tx: clampWorldX(lane.x + (rnd() - 0.5) * 2 * lane.spread),
          ty: clampWorldY(WORLD_CY - VECTOR_LEAN[weak] + (rnd() - 0.5) * 0.1),
          hp01: 1,
          state: "advancing",
          enterAtS: 0,
        });
      }
      rosterPushRef.current(scoutRef.current === "revealed");
      const dirName =
        weak === "FLANK_LEFT" ? "western" : weak === "FLANK_RIGHT" ? "eastern" : weak === "MAIN" ? "center" : "rear";
      postComms("wave", dirName);
      battleSfx.dropship();
    };

    const step = (now: number) => {
      // FRAME-TIME TELEMETRY (slice 14, spec §9): feed the rolling-window
      // sampler — one cheap write; `last` still holds the previous frame.
      recordFrameTime(now - last);
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
      // REPLAY CAPTURE (owner 2026-10-11): 1Hz keyframes of living units.
      // Capped — a 20-minute battle is 1200 frames, plenty.
      if (!victorRef.current && t - replayLastRef.current >= 1 && replayFramesRef.current.length < 1200) {
        replayLastRef.current = t;
        const units: ReplayFrame["units"] = [];
        for (const u of unitsRef.current) {
          if (u.state === "dead") continue;
          units.push({
            i: u.id,
            x: Math.round(u.x * 1000) / 1000,
            y: Math.round(u.y * 1000) / 1000,
            s: u.side,
            k: u.kind,
            st: u.state,
          });
        }
        replayFramesRef.current.push({ t: Math.round(t * 10) / 10, units });
      }
      const phase = scenePhaseAt(t);
      // Doctrine phase transitions earn SFX stingers — ears know where you
      // are before your eyes catch up.
      if (phase !== phaseRef.current) {
        phaseRef.current = phase;
        battleSfx.phase(phase);
        // Phase changes arrive as comms too — the timeline steers, and the
        // commander reads it in the shared frame (owner 2026-10-06).
        if (phase === "touchdown") postComms("phase", "Touchdown — unload and set positions. 45 seconds to get your shit straight.");
        else if (phase === "contact") postComms("phase", scoutRef.current === "lost"
          ? "First contact — there they are. No scout intel; you're reading them live."
          : "First contact — the Chorus is holding its lines. It lets you come.");
        else if (phase === "weapons-free") postComms("phase", "Weapons free — the timeline is running. Break them before it runs out.");
      }

      // --- unit state machine -------------------------------------------
      // Command delay (owner 2026-10-06): stamped orders step off after
      // ORDER_DELAY_S sim-seconds — "acknowledged/plotting" → "moving".
      for (const u of stepOffUnits(unitsRef.current, t)) {
        u.moveAtS = undefined;
        if (u.state === "holding" || u.state === "advancing") u.state = "advancing";
      }
      // MOVEMENT BLOCKING precompute (owner 2026-10-11): the enemy's forward
      // line and its Warden guards, once per frame. Squads with living
      // Reavers may breach a BROKEN line (guards ground down); an intact
      // line blocks everyone.
      const atkLineY = enemyLineY(unitsRef.current, "attacker");
      const atkLineWardens = lineWardenCount(unitsRef.current, "attacker");
      const reaverSquads = new Set<string>();
      for (const u of unitsRef.current) {
        if (u.state !== "dead" && u.kind === "reaver") reaverSquads.add(u.squadId);
      }
      for (const u of unitsRef.current) {
        if (u.state === "dead") continue;
        if (u.state === "staging" && t >= u.enterAtS && (phase === "touchdown" || phase === "contact" || phase === "weapons-free")) {
          // On-call reserves (owner 2026-10-06): when the raid leader is
          // driving manually, the reserve waits for the commit — tap the
          // squad, tap the map, hot drop. On auto it enters at its preset
          // time like any other wave.
          if (u.onCall && ui.manual) continue;
          u.state = "advancing";
          // Delayed waves arrive loud: dropship engines on late entries,
          // a crash swell when a flank hits the field weapons-free.
          if (u.enterAtS > 60) battleSfx.dropship();
          if (phase === "weapons-free" && (u.vector === "FLANK_LEFT" || u.vector === "FLANK_RIGHT")) {
            battleSfx.flankCrash();
          }
          // Reserve status is a comms event — the commander knows what's on
          // the field (announced once per vector per battle).
          if ((u.vector === "REAR" || u.vector === "RESERVE") && !reserveAnnouncedRef.current.has(u.vector)) {
            reserveAnnouncedRef.current.add(u.vector);
            postComms("reserve", u.vector === "REAR" ? "Your rear wave is on the field" : "Your reserve is on the field — call it when you need it");
          }
        }
        if (u.state === "advancing") {
          // Plotting: the squad holds its ground until the order steps off.
          if (u.moveAtS !== undefined) continue;
          const dx = u.tx - u.x;
          const dy = u.ty - u.y;
          const d = Math.hypot(dx, dy);
          // Slower (owner 2026-10-11): maneuvers take time — both sides can
          // respond. Was 0.05/0.035/0.02 (a full-field cross in ~3s).
          const speed = (u.kind === "thunder" ? 0.005 : u.kind === "warden" ? 0.008 : 0.012) * sdt * 10;
          if (d < 0.015) {
            u.x = u.tx; u.y = u.ty;
            u.state = "holding";
            // Siege re-deploys (owner 2026-10-11): once the whole squad has
            // arrived, thunders limber down — toggle MOVE to displace again.
            if (u.kind === "thunder") {
              const moving = unitsRef.current.some(
                (w) => w.squadId === u.squadId && w.state === "advancing",
              );
              if (!moving) setSquadHoldPosition(u.squadId, true);
            }
          } else {
            let mx = dx / d, my = dy / d;
            // BREACH CHECK: Reaver squad vs a broken line (Wardens gone) —
            // they push through the gap. Everyone else respects the block.
            const lineY = u.side === "attacker" ? atkLineY : null;
            const breacher =
              lineY !== null &&
              atkLineWardens === 0 &&
              reaverSquads.has(u.squadId);
            if (!breacher) {
              // MOVEMENT BLOCKING: enemy units obstruct the path — probe
              // ahead; a blocker ahead steers the unit around it, a wall of
              // them stops it at contact. Never ghosts through.
              const blocker = nearestEnemy(u.x + mx * 0.07, u.y + my * 0.07, u.side, 0.08);
              if (blocker) {
                const ax = u.x - blocker.x, ay = u.y - blocker.y;
                const al = Math.hypot(ax, ay) || 1;
                mx = (mx * 1.2 + (ax / al) * 1.8) / 3;
                my = (my * 1.2 + (ay / al) * 1.8) / 3;
                const ml = Math.hypot(mx, my) || 1;
                mx /= ml; my /= ml;
              }
            }
            let nx = u.x + mx * Math.min(d, speed);
            let ny = u.y + my * Math.min(d, speed);
            // THE LINE HOLDS: attacker ground units never cross north of the
            // defender's forward line (jump ships fly over it; breachers push
            // through a broken one). Defender doctrine moves are scripted
            // and telegraphed — the clamp is the attacker's rule.
            if (u.side === "attacker" && !breacher && lineY !== null) {
              ny = Math.max(ny, lineY - 0.03);
            }
            u.x = nx; u.y = ny;
          }
        }
        if (u.state === "descending") {
          // HOT DROP (owner 2026-10-06): the committed reserve falls fast on
          // the picked spot. Hot zone = enemies near the landing point shoot
          // the descent — "a chance of getting hit". Landing is LOUD.
          const dx = u.tx - u.x;
          const dy = u.ty - u.y;
          const d = Math.hypot(dx, dy);
          const fall = 0.16 * sdt * 10;
          if (d < 0.02) {
            const res = scatterLanding(unitsRef.current, u.id, u.tx, u.ty, Math.random());
            u.x = res.x; u.y = res.y;
            u.tx = res.x; u.ty = res.y;
            u.state = "advancing";
            u.dropAtS = undefined;
            battleSfx.flankCrash(); // the loud landing — everybody hears it
            fx.explode(X(u.x), Y(u.y), 1.2);
            radarPing(u.x, u.y, "blast");
            if (res.scattered) {
              for (const id of res.splash) {
                const v = unitsRef.current.find((w) => w.id === id);
                if (v && v.state !== "dead") {
                  dealDamage(v, HOTDROP_SPLASH_DMG);
                }
              }
              postComms("reserve", "Bad drop — landed on occupied ground, casualties both ways");
            }
          } else {
            u.x += (dx / d) * Math.min(d, fall);
            u.y += (dy / d) * Math.min(d, fall);
            const hot = nearestEnemy(u.x, u.y, u.side, HOTDROP_HOT_RADIUS);
            if (hot) {
              dealDamage(u, 0.05 * sdt);
              if (Math.random() < 0.1) {
                // weapon identity: the defender shoots what it carries
                if (weaponKindFor(hot.kind) === "kinetic") fx.fireKinetic(X(hot.x), Y(hot.y), X(u.x), Y(u.y), "#fda4af");
                else fx.fire(X(hot.x), Y(hot.y), X(u.x), Y(u.y), "#fda4af");
              }
            }
          }
        }
        if ((u.state === "holding" || u.state === "advancing") && phase === "weapons-free") {
          const e = nearestEnemy(u.x, u.y, u.side, 0.45);
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
          // WEAPONS HOLD (owner 2026-10-11): the squad's direct-fire weapons
          // stay silent, even with enemies in range.
          if (ui.squadStance[u.squadId]?.weaponsHold) continue;
          const wk = weaponKindFor(u.kind);
          const col = u.side === "attacker" ? "#ffd27a" : "#fda4af";
          if (wk === "siege") {
            // SIEGE (owner 2026-10-11): thunder guns don't instant-hit —
            // they lob a visible shell on a cooldown. You SEE it coming.
            // HOLD-FIRE: the commander silences the battery before
            // friendlies walk into the blast zone — one tap, instant.
            // Either the per-gun flag or the master panic switch.
            if (u.siegeHold || ui.siegeHoldAll) continue;
            if (t < (u.nextSiegeAt ?? 0)) continue;
            // MANUAL AIM: Hans's draggable targeter if placed (his guns
            // only — the Chorus aims its own). Else nearest enemy (legacy).
            // The guns walk fire to the aim point.
            const aim = u.side === "attacker" ? ui.siegeAim : null;
            let gx: number, gy: number, tierDiv = 1;
            if (aim) {
              gx = aim.x; gy = aim.y;
            } else {
              const tgt = nearestEnemy(u.x, u.y, u.side, 0.45);
              if (!tgt) { u.state = "holding"; continue; }
              gx = tgt.x; gy = tgt.y;
              tierDiv = tierPowerMult(tgt.tier);
            }
            u.nextSiegeAt = t + SIEGE_COOLDOWN_S;
            const dist = Math.hypot(gx - u.x, gy - u.y);
            fx.lobShell(X(u.x), Y(u.y), X(gx), Y(gy), 1.0 + dist * 1.2, 1.2);
            battleSfx.tracer("snipe");
            const sh = fx.shells[fx.shells.length - 1];
            if (sh) {
              sh.dmg = (0.3 + Math.random() * 0.15) * (tierPowerMult(u.tier) / tierDiv);
              sh.side = u.side;
            }
            continue;
          }
          const e = nearestEnemy(u.x, u.y, u.side, 0.45);
          if (!e) { u.state = "holding"; continue; }
          // Weapon identity (owner 2026-10-11): lasers read as beams,
          // kinetics as rapid-fire slug bursts. Same damage event.
          if (wk === "kinetic") fx.fireKinetic(X(u.x), Y(u.y), X(e.x), Y(e.y), col);
          else fx.fire(X(u.x), Y(u.y), X(e.x), Y(e.y), col);
          battleSfx.tracer("crack");
          // Tiers are real: elites out-hit chaff and shrug off chaff fire.
          // Chorus doctrine (owner 2026-10-06): a holding defender takes ~12%
          // less — dug in, not yet engaged. Cover takes ~12% less. Flank it
          // or overwhelm it; the bonuses reward maneuver, they don't make
          // the line unbreakable.
          dealDamage(e, (((0.015 + Math.random() * 0.03) * tierPowerMult(u.tier)) / tierPowerMult(e.tier)) * dmgTakenMul(e));
        }
        // Turret fire — per-turret modes (owner 2026-10-06). AUTO command:
        // every gun free-fires. Manual: held turrets stay silent while auto
        // turrets keep shooting and the gunner's own gun takes the lock.
        // Turrets are energy weapons: sustained beams.
        for (const tr of turretsRef.current) {
          if (tr.hp01 <= 0) continue;
          if (!turretFires(ui, tr.id)) continue;
          let target: SceneUnit | null = null;
          if (ui.gunnerId === tr.id && ui.gunTarget) {
            target = unitsRef.current.find((u) => u.id === ui.gunTarget && u.state !== "dead") ?? null;
          } else if (!ui.manual || turretModeOf(ui, tr.id) === "auto") {
            target = nearestEnemy(tr.x, tr.y, tr.side, 0.68);
          }
          if (target) {
            tr.aim = Math.atan2(Y(target.y) - Y(tr.y), X(target.x) - X(tr.x));
            fx.fire(X(tr.x), Y(tr.y), X(target.x), Y(target.y), "#a5f3fc");
            battleSfx.tracer("turret");
            dealDamage(target, (0.04 + Math.random() * 0.05) * dmgTakenMul(target));
          }
        }
        // The tick's damage resolves through the governor — scaled, capped
        // per squad, shields-first. No burst wipes.
        flushDamage();
      }

      // --- siege shells in flight: advance, detonate on landing -----------
      // The AoE joins the damage ledger — the governor still caps it, and
      // the next exchange tick flushes it (≤0.28s later, imperceptible).
      if (fx.shells.length > 0) {
        for (let i = fx.shells.length - 1; i >= 0; i--) {
          const sh = fx.shells[i];
          sh.t += sdt / sh.dur;
          if (sh.t >= 1) {
            fx.shells.splice(i, 1);
            // impact: the visual fireball roughly matches the 20m damage
            // radius — what the player sees lines up with what the sim does.
            // Boom radius is 46×scale px; 1 world unit = W() px pre-zoom.
            fx.explode(X(sh.x2), Y(sh.y2), (SIEGE_SPLASH_R * W()) / 46);
            battleSfx.explosion(sh.x2, sh.y2, true);
            radarPing(sh.x2, sh.y2, "shell");
            replayEventsRef.current.push({ t: simTRef.current, kind: "shell", x: sh.x2, y: sh.y2 });
            const dmg = sh.dmg ?? SIEGE_DMG;
            // Shells don't discriminate — friend and foe alike catch the blast.
            for (const v of unitsRef.current) {
              if (v.state === "dead" || v.state === "staging") continue;
              const dM = Math.hypot(v.x - sh.x2, v.y - sh.y2) * METERS_PER_WORLD_UNIT;
              const fall = siegeFalloff(dM);
              if (fall <= 0) continue;
              dealDamage(v, dmg * fall * dmgTakenMul(v));
            }
          }
        }
      }

      // --- live casualty matching: the engine's ticks kill units ----------
      // Throttled (owner 2026-10-11): the visual match can never burst-wipe —
      // one engine kill per side per ENGINE_KILL_GAP_S, and per squad per
      // SQUAD_KILL_GAP_S. Casualties tick up gradually, always.
      if (liveCasualties) {
        for (const side of ["attacker", "defender"] as const) {
          const want = Math.min(
            unitsRef.current.filter((u) => u.side === side).length,
            Math.round((liveCasualties[side] / Math.max(1, scene.troops[side])) * unitsRef.current.filter((u) => u.side === side).length),
          );
          const dead = unitsRef.current.filter((u) => u.side === side && u.state === "dead").length;
          if (want > dead && t - (engineKillAtRef.current[side] ?? -99) > ENGINE_KILL_GAP_S) {
            const cands = unitsRef.current
              .filter((u) => u.side === side && u.state !== "dead" && u.state !== "staging")
              .sort((a, b) => a.hp01 - b.hp01);
            const victim = cands[0];
            const lastSquadKill = squadKillAtRef.current.get(victim?.squadId ?? "") ?? -99;
            if (victim && t - lastSquadKill > SQUAD_KILL_GAP_S && Math.random() < 0.5) {
              engineKillAtRef.current[side] = t;
              squadKillAtRef.current.set(victim.squadId, t);
              killUnit(victim);
            }
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
          if (v) {
            dealDamage(v, (0.25 / tierPowerMult(v.tier)) * dmgTakenMul(v));
          }
        }
        // demo-curve damage joins the ledger — flushed on the next tick.
      }

      // --- Chorus doctrine: the survivor defends, then smells blood -------
      // G1–G4 hold and wait — the reserve commits when the player bleeds
      // (grade threshold) or a player vector breaks. G5 hunts: a spoiling
      // attack on a stalled/overextended advance, and envelopment when a
      // Bastion flank engages a weakened player flank. Checked ~2x/sec.
      const gradeSpec = CHORUS_GRADES[scene.chorusGrade ?? DEFAULT_CHORUS_GRADE];
      counterAccRef.current += sdt;
      if (phase === "weapons-free" && counterAccRef.current > 2) {
        counterAccRef.current = 0;
        // Orders stamp with the same command delay the player's squads wait
        // (symmetric movement rules), and every AI move is watched — living
        // Longeyes in the destination sector report it at ~50% of progress.
        const applyOrders = (orders: CounterattackOrder[], destVector: ManeuverVector) => {
          const byId = new Map(unitsRef.current.map((u) => [u.id, u]));
          const moved: SceneUnit[] = [];
          for (const o of orders) {
            const u = byId.get(o.unitId);
            if (!u || u.state === "dead") continue;
            // Unbounded map (slice 7): orders may land past the old hard walls.
            stampOrder(u, softClampX(o.tx), softClampY(o.ty), t);
            if (o.enterNow) u.enterAtS = Math.min(u.enterAtS, t); // commit NOW, not on schedule
            moved.push(u);
          }
          if (moved.length > 0) {
            const live = moved.filter((u) => u.state !== "dead");
            const cx = live.reduce((s, u) => s + u.x, 0) / live.length;
            const cy = live.reduce((s, u) => s + u.y, 0) / live.length;
            const tx = live.reduce((s, u) => s + u.tx, 0) / live.length;
            const ty = live.reduce((s, u) => s + u.ty, 0) / live.length;
            watchesRef.current.push({
              units: live, fromX: cx, fromY: cy, toX: tx, toY: ty,
              destVector, startsAt: t + ORDER_DELAY_S, reported: false,
            });
          }
          return moved.length > 0;
        };
        // 1. The bleed trigger — the reserve commits at the grade's threshold.
        if (!counterRef.current) {
          const ev = evaluateCounterattack(unitsRef.current, gradeSpec.counterThreshold);
          if (ev.trigger && ev.weakestVector) {
            const orders = counterattackOrders(unitsRef.current, gradeSpec.counterThreshold);
            if (orders.length > 0 && applyOrders(orders, ev.weakestVector)) {
              counterRef.current = true;
              postComms("counter", "");
              battleSfx.flankCrash();
            }
          }
        }
        // 2. G5 hunts: spoiling attack on a stalled/overextended advance.
        if (gradeSpec.hunts && !spoilingRef.current && !counterRef.current) {
          const sp = evaluateSpoilingAttack(unitsRef.current, t, phase);
          if (sp.trigger && sp.targetVector) {
            const orders = spoilingAttackOrders(unitsRef.current, sp.targetVector);
            if (orders.length > 0 && applyOrders(orders, sp.targetVector)) {
              spoilingRef.current = true;
              postComms("spoiling", "");
              battleSfx.flankCrash();
            }
          }
        }
        // 3. G5 envelopment: engaged flanks swing AROUND weakened player flanks.
        if (gradeSpec.hunts) {
          for (const env of evaluateEnvelopment(unitsRef.current)) {
            if (envelopRef.current[env.flank]) continue;
            const flankUnits = unitsRef.current.filter(
              (u) => u.side === "defender" && u.vector === env.flank && u.state === "engaged",
            );
            if (flankUnits.length === 0) continue;
            envelopRef.current[env.flank] = true;
            for (const u of flankUnits) {
              stampOrder(u, softClampX(env.tx + (Math.random() - 0.5) * 0.06), softClampY(env.ty + (Math.random() - 0.5) * 0.06), t);
            }
            const cx = flankUnits.reduce((s, u) => s + u.x, 0) / flankUnits.length;
            const cy = flankUnits.reduce((s, u) => s + u.y, 0) / flankUnits.length;
            watchesRef.current.push({
              units: flankUnits, fromX: cx, fromY: cy, toX: env.tx, toY: env.ty,
              destVector: env.flank, startsAt: t + ORDER_DELAY_S, reported: false,
            });
            const side = env.flank === "FLANK_LEFT" ? "left" : "right";
            postComms("envelop", side);
          }
        }
      }

      // --- Longeye movement reports (owner 2026-10-06): positional ---------
      // An enemy move is watched from step-off; at ~50% of its progress the
      // player's Longeyes report it — but ONLY if they hold the destination
      // sector (same-vector rule). No eyes on that vector = silent: the
      // player only sees the maneuver when it arrives.
      for (const w of watchesRef.current) {
        if (!watchShouldReport(w, t)) continue;
        w.reported = true;
        if (hasLongeyeCover(unitsRef.current, w.destVector as ManeuverVector)) {
          // Highlight the moving squad + a direction vector (fixed length —
          // it shows the squad and its direction, never a perfect
          // destination readout). Arrow + ping + log = the heads-up.
          const live = w.units.filter((u) => u.state !== "dead");
          const cx = live.reduce((s, u) => s + u.x, 0) / live.length;
          const cy = live.reduce((s, u) => s + u.y, 0) / live.length;
          const dx = w.toX - w.fromX;
          const dy = w.toY - w.fromY;
          const d = Math.hypot(dx, dy) || 1;
          arrowRef.current = {
            x: cx, y: cy,
            dx: (dx / d) * REPORT_ARROW_LEN,
            dy: (dy / d) * REPORT_ARROW_LEN,
            until: t + 6,
          };
          highlightRef.current = { units: live, until: t + 6 };
          postComms("movement", vecShort(w.destVector as ManeuverVector).toUpperCase());
        }
        // else: no eyes on that vector — the maneuver completes silently.
      }
      if (watchesRef.current.length > 12) watchesRef.current = watchesRef.current.slice(-12);

      // --- scout flyby: the approach-phase intel gamble -------------------
      // 80% the sweep completes and the Chorus disposition is revealed;
      // 20% the scout is shot down (seeded — deterministic for replays) and
      // the player deploys blind. Terrain is mapped from the air either way.
      const scoutNow = scoutStatusAt(scene.seed, t);
      if (scoutNow !== scoutRef.current) {
        scoutRef.current = scoutNow;
        if (scoutNow === "revealed") {
          rosterPushRef.current(true);
          setRevealed(true);
          postComms("scout-ok", "");
        } else if (scoutNow === "lost") {
          postComms("scout-lost", "");
          // Flak kill at the shoot-down point — the sweep visual dies here.
          const kp = (SHOOTDOWN_S - FLYBY_START_S) / (REVEAL_S - FLYBY_START_S);
          battleSfx.explosion(0.75 + 0.35 * Math.sin(kp * Math.PI * 2), 1.35 - kp * 1.15, true);
        }
      }
      // Scout lost: the player meets them at first contact. The disposition
      // becomes visible when the lines meet (T+75) — but there's no intel
      // bonus: the grade stayed hidden through the whole positioning window.
      if (scoutRef.current === "lost" && t >= 75) {
        scoutRef.current = "revealed";
        rosterPushRef.current(true);
        setRevealed(true);
      }

      // --- battle clock: the shared timeline (owner 2026-10-06) ------------
      // From weapons-free the attacker has BATTLE_CLOCK_BUDGET_S sim-seconds
      // (the clock is the timeline running out, not a punishment). Every
      // ESCALATION_INTERVAL_S the defense holds, a reinforcement wave feeds
      // the weakest defensive vector (capped). The ~65% casualty break still
      // resolves bloody battles the old way — this is the backstop.
      if (phase === "weapons-free" && !victorRef.current) {
        const wfAtS = SCENE_PHASES.find((p) => p.phase === "weapons-free")?.atS ?? 90;
        const due = waveDueAt(t - wfAtS, waveRef.current);
        if (due > 0) {
          waveRef.current = due;
          landWave(due);
        }
        const remaining = CLOCK_END_S - t;
        if (remaining <= 180 && !warn3Ref.current) {
          warn3Ref.current = true;
          postComms("clock-3", "");
        }
        if (remaining <= 60 && !warn1Ref.current) {
          warn1Ref.current = true;
          postComms("clock-1", "");
        }
        if (remaining <= 0 && !clockFailRef.current) {
          clockFailRef.current = true;
          victorRef.current = "defender";
          setResolvedSide("defender");
          postComms("clock-end", "");
          battleSfx.victor(false);
          finalizeReplay("defender");
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
            const e = nearestEnemy(u.x, u.y, u.side, 0.6);
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
        cam.uax = WORLD_CX;
        cam.uay = WORLD_CY;
        cam.pox = 0;
        cam.poy = 0;
        if (ui.zoomLevel !== 1) setZoomLevel(1);
      }
      // User zoom multiplies the mode zoom; ground clamps tighter so the
      // follow-cam still reads. Tactical fit zoom frames the whole 1.5×1.5 field.
      const uz = ground ? Math.min(ui.zoomLevel, GROUND_ZOOM_MAX) : ui.zoomLevel;
      const modeZoom = ground ? WORLD_FIT_ZOOM * (W() > H() ? 3.2 : 2.6) : WORLD_FIT_ZOOM;
      const targetZoom = modeZoom * uz;
      const targetYsq = ground ? 0.78 : 1; // low grazing angle, not a magnifier
      const targetFy = ground ? (W() > H() ? 0.62 : 0.55) : 0.5;
      // Ground follows the southern advance: the attacker's centroid.
      let anx = WORLD_CX;
      let any = 1.0;
      let nn = 0;
      for (const u of unitsRef.current) {
        if (u.side !== "attacker" || u.state === "dead" || u.state === "staging") continue;
        if (u.state !== "advancing" && u.state !== "engaged" && u.state !== "holding") continue;
        anx += u.x; any += u.y; nn++;
      }
      if (nn > 0) { anx /= nn; any /= nn; }
      const halfW = WORLD_W / 2 / targetZoom;
      const halfH = WORLD_H / 2 / (targetZoom * targetYsq);
      let tax: number;
      let tay: number;
      if (ground) {
        // Follow the advance, plus the player's pan offset — clamped tight
        // so a pan never leaves the fighting.
        tax = clampAnchor(anx + cam.pox, halfW, WORLD_W, WORLD_CX);
        tay = clampAnchor(any + cam.poy, halfH, WORLD_H, WORLD_CY);
      } else {
        tax = clampAnchor(cam.uax, halfW, WORLD_W, WORLD_CX);
        tay = clampAnchor(cam.uay, halfH, WORLD_H, WORLD_CY);
      }
      const k = 1 - Math.exp(-dt * 3.4);
      cam.zoom += (targetZoom - cam.zoom) * k;
      cam.ysq += (targetYsq - cam.ysq) * k;
      cam.fy += (targetFy - cam.fy) * k;
      cam.ax += (tax - cam.ax) * k;
      cam.ay += (tay - cam.ay) * k;

      // Seamless-world audio LOD (spec §5, slice 5's real API): the current
      // zoom band drives the battle bus — Z1 orbit silent … Z4 ground full.
      // Standalone scenes sit at Z4, so the soundscape is unchanged there.
      battleSfx.setZoomAudioLevel(audioBandFor(bandForContinuumScale(continuumScaleRef.current)));

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
            kind: "beam",
          });
        }
      }

      // --- clock state (throttled) -----------------------------------------
      clockAcc += dt;
      if (clockAcc > 0.25) {
        clockAcc = 0;
        setClock(t);
        // SQUADS panel: refresh living strength only when it changed.
        // The eye glyph follows living Longeyes per squad (positional
        // coverage — the key includes eye counts so a dead eye updates it).
        const squads = buildSquads(unitsRef.current).filter(isDrivable);
        const key = squads
          .map(
            (s) =>
              `${s.id}:${s.unitIds.length}:${squadEyeCount(unitsRef.current, s.id)}:${unitsRef.current.some((u) => u.squadId === s.id && u.state === "staging" && u.onCall) ? 1 : 0}`,
          )
          .join(",");
        if (key !== squadAliveRef.current) {
          squadAliveRef.current = key;
          registerSquads(
            squads.map((s) => ({
              id: s.id,
              name: s.name,
              alive: s.unitIds.length,
              // Casualties must VISIBLY add up: total is the ORIGINAL
              // headcount, frozen at battle start — not the shrinking living
              // count (owner 2026-10-11).
              total: squadTotalRef.current.get(s.id) ?? s.unitIds.length,
              eyes: squadEyeCount(unitsRef.current, s.id) > 0,
              onCallReserve: unitsRef.current.some(
                (u) => u.squadId === s.id && u.state === "staging" && u.onCall,
              ),
              hasThunders: s.unitIds.some((id) => {
                const u = unitsRef.current.find((w) => w.id === id);
                return u !== undefined && u.kind === "thunder" && u.state !== "dead";
              }),
            })),
          );
        }
        // WARDEN SHIELDS (owner 2026-10-11): living Wardens project a shield
        // umbrella over nearby friendlies. Shield max derives from the
        // covering Warden count; it regenerates while covered and collapses
        // the moment the Wardens die. No Warden = no shield, armor+hull only.
        const wardens = unitsRef.current.filter(
          (w) => w.kind === "warden" && w.state !== "dead" && w.state !== "staging",
        );
        for (const u of unitsRef.current) {
          if (u.state === "dead" || u.state === "staging") {
            u.wardenCover = 0;
            continue;
          }
          let cover = 0;
          for (const w of wardens) {
            if (w.side !== u.side) continue;
            if (Math.hypot(w.x - u.x, w.y - u.y) < SHIELD_RADIUS) {
              cover++;
              if (cover >= 3) break;
            }
          }
          u.wardenCover = cover;
          if (cover > 0) {
            const max = Math.min(SHIELD_MAX, SHIELD_PER_WARDEN * cover);
            u.shieldMax = max;
            const cur = u.shield01 ?? 0;
            // fresh coverage seeds at half — the bubble visibly snaps on;
            // after that it regens toward max while the Wardens live.
            u.shield01 = Math.min(max, cur + (cur <= 0 ? max * 0.5 : SHIELD_REGEN * 0.25));
          } else {
            u.shield01 = 0;
            u.shieldMax = 0;
          }
        }
        // Radar snapshot — the minimap reads the same field.
        pushRadarFrame(unitsRef.current, turretsRef.current);
        // Rejection toast + order ping expire on their own.
        const nowMs = performance.now();
        if (toastRef.current && nowMs - toastRef.current.born > 2600) toastRef.current = null;
        if (orderPingRef.current && t - orderPingRef.current.atS > 4) orderPingRef.current = null;
      }

      render(ctx, phase);
      raf = requestAnimationFrame(step);
    };

    const render = (c: CanvasRenderingContext2D, phase: ScenePhase) => {
      const ui = sceneUISnapshot();
      const cam = camRef.current;
      const ground = ui.cameraMode === "ground";
      // Slice 12 — Z3 battle overview: below Z4 the battle renders unit
      // shapes + tracers, never full models. Standalone scenes stay Z4
      // (full detail), so today's look is unchanged outside the continuum.
      const overviewShapes = detailForBand(bandForContinuumScale(continuumScaleRef.current)) === "shapes";
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
        // Integer pattern origin: the fractional `gw` offset leaves tile
        // edges on sub-pixel boundaries, and the rasterizer opens a 1px
        // hairline down every tile boundary on wide screens (seen in QA as
        // the canvas "tiling into three repeated columns"). An integer
        // offset can never open a seam — same grid, same look, no lines.
        const off = Math.round(gw);
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
          // Keep the tile grid aligned as before (origin at -gw, now integral).
          c.translate(-off, -off);
          c.fillStyle = pat;
          c.fillRect(0, 0, w + off * 2, h + off * 2);
          c.restore();
        }
      } else {
        const grad = c.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "#3a3226");
        grad.addColorStop(1, "#2a241b");
        c.fillStyle = grad;
        c.fillRect(-12, -12, w + 24, h + 24);
      }

      // --- terrain detail overlays (spec §8, slice 13) -----------------------
      // Live detail at Z3+: ash drifts in the blighted bands, embers pulse +
      // heat shimmers in the burnt heart, vegetation sways in the verdant
      // outskirts. Drawn over the baked ground; the corruption gradient
      // itself stays in the tile bake. Quality-gated per rung (PERFORMANCE
      // renders nothing here).
      if (overlayVisibleAtZoom(cam.zoom, WORLD_FIT_ZOOM)) {
        drawTerrainOverlays(c, overlaySpec, simTRef.current, night);
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
        // North-south battles: lanes are vertical bands (flanks spread
        // east-west), spanning the padded roam area so panning past the
        // field never shows cutoff markings.
        const x0 = X(lane.x - lane.spread);
        const x1 = X(lane.x + lane.spread);
        const lc = LANE_COLOR[v];
        const ly0 = Y(-0.15);
        const ly1 = Y(WORLD_H + 0.15);
        c.save();
        c.globalAlpha = 0.05;
        c.fillStyle = lc;
        c.fillRect(x0, ly0, x1 - x0, ly1 - ly0);
        c.restore();
        c.save();
        c.globalAlpha = 0.5;
        c.strokeStyle = lc;
        c.lineWidth = 1.5;
        c.setLineDash([10, 8]);
        c.beginPath(); c.moveTo(x0, ly0); c.lineTo(x0, ly1); c.stroke();
        c.beginPath(); c.moveTo(x1, ly0); c.lineTo(x1, ly1); c.stroke();
        c.restore();
      }

      // --- grid -------------------------------------------------------------
      c.save();
      c.strokeStyle = "rgba(255,255,255,0.05)";
      c.lineWidth = 1;
      for (let gx = -0.15; gx <= WORLD_W + 0.15; gx += 0.15) {
        c.beginPath(); c.moveTo(X(gx), Y(-0.15)); c.lineTo(X(gx), Y(WORLD_H + 0.15)); c.stroke();
      }
      for (let gy = -0.15; gy <= WORLD_H + 0.15; gy += 0.15) {
        c.beginPath(); c.moveTo(X(-0.15), Y(gy)); c.lineTo(X(WORLD_W + 0.15), Y(gy)); c.stroke();
      }
      c.restore();

      // --- terrain: cover vs open ground (owner 2026-10-06) ------------------
      // Seeded per battle, visible from the approach — the player picks
      // positions with cover in mind. Units in/near cover take ~12% less
      // damage. Terrain is mapped from the air, so it renders whether or
      // not the scout survived.
      for (let fi = 0; fi < scene.terrain.length; fi++) {
        const f = scene.terrain[fi];
        const fx0 = X(f.x);
        const fy0 = Y(f.y);
        const rx = f.r * cam.zoom * w;
        const ry = f.r * cam.zoom * cam.ysq * h;
        c.save();
        if (f.kind === "ridge") {
          c.strokeStyle = "rgba(217,180,120,0.55)";
          c.lineWidth = 2;
          c.setLineDash([7, 5]);
          c.beginPath(); c.ellipse(fx0, fy0, rx, ry, 0, 0, Math.PI * 2); c.stroke();
          c.setLineDash([]);
          c.strokeStyle = "rgba(217,180,120,0.3)";
          c.lineWidth = 1;
          c.beginPath(); c.ellipse(fx0, fy0, rx * 0.62, ry * 0.62, 0, 0, Math.PI * 2); c.stroke();
        } else if (f.kind === "rocks") {
          c.fillStyle = "rgba(148,163,184,0.5)";
          // Deterministic scatter — the same battle always draws the same rocks.
          const srnd = mulberry32((scene.seed ^ (0x51ab + fi * 0x1f3d)) >>> 0);
          for (let d = 0; d < 7; d++) {
            const a = srnd() * Math.PI * 2;
            const rr = srnd() * 0.8;
            const dx = Math.cos(a) * rx * rr;
            const dy = Math.sin(a) * ry * rr;
            const dr = Math.max(2, rx * (0.06 + srnd() * 0.1));
            c.beginPath(); c.arc(fx0 + dx, fy0 + dy, dr, 0, Math.PI * 2); c.fill();
          }
        } else {
          // ruins: debris field — short broken strokes in a circle.
          c.strokeStyle = "rgba(113,113,122,0.6)";
          c.lineWidth = 2;
          const srnd = mulberry32((scene.seed ^ (0x77cd + fi * 0x2b51)) >>> 0);
          for (let d = 0; d < 9; d++) {
            const a = srnd() * Math.PI * 2;
            const rr = 0.25 + srnd() * 0.7;
            const sx0 = fx0 + Math.cos(a) * rx * rr;
            const sy0 = fy0 + Math.sin(a) * ry * rr;
            const la = srnd() * Math.PI;
            const ll = 4 + srnd() * 10;
            c.beginPath();
            c.moveTo(sx0, sy0);
            c.lineTo(sx0 + Math.cos(la) * ll, sy0 + Math.sin(la) * ll);
            c.stroke();
          }
        }
        // Cover glyph — reads at a glance even on a phone.
        c.globalAlpha = 0.85;
        c.fillStyle = "#d9b478";
        c.font = `700 ${Math.max(10, rx * 0.28)}px system-ui, sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("⌖", fx0, fy0);
        c.restore();
      }

      // --- radar sweep during contact ---------------------------------------
      // Tactical only — zoomed in it would sit off-frame and read as noise.
      if (fx.sweepOn && cam.zoom < WORLD_FIT_ZOOM * 2.25) {
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
        // Scout gamble: the enemy disposition stays HIDDEN until the flyby
        // completes — on a shoot-down the player deploys blind and meets
        // them at first contact. Terrain still renders (mapped from the air).
        if (u.side === "defender" && scoutRef.current !== "revealed") return;
        const x = X(u.x);
        const y = Y(u.y);
        const r = Math.max(10, s * 0.022) * (u.kind === "thunder" ? 1.7 : u.kind === "dropship" ? 2.2 : 1);
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
        // Descending: a committed hot drop — full-alpha ghost with a pulsing
        // amber ring, falling on the picked spot. Everybody sees it coming.
        if (u.state === "descending") {
          const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 150);
          c.save();
          c.globalAlpha = 0.9;
          c.fillStyle = SIDE_COLOR[u.side];
          c.beginPath(); c.arc(x, y, r * 0.8, 0, Math.PI * 2); c.fill();
          c.globalAlpha = pulse;
          c.strokeStyle = "#fbbf24";
          c.lineWidth = 2;
          c.beginPath(); c.arc(x, y, r * 0.8 + 4, 0, Math.PI * 2); c.stroke();
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
        // Z3 overview (slice 12): shapes, not models — the kind glyph reads
        // at altitude; the sprite returns at Z4. (Also the pre-art fallback.)
        if (!overviewShapes && img && img.complete && img.naturalWidth > 0) {
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
        // WARDEN SHIELD BUBBLE (owner 2026-10-11): a visible shimmering dome
        // around shielded units — no Warden, no bubble. It flickers as the
        // shield depletes and collapses when the Wardens die.
        const sh01 = u.shield01 ?? 0;
        const shMax = u.shieldMax ?? 0;
        if (sh01 > 0.01 && shMax > 0) {
          const wt = performance.now() / 1000;
          const flick = 0.55 + 0.45 * Math.sin(wt * 6 + x * 0.5 + y * 0.3);
          const frac = sh01 / shMax;
          const br = r * 1.9;
          c.save();
          c.globalAlpha = (0.25 + 0.55 * frac) * flick;
          const sg = c.createRadialGradient(x, y, br * 0.55, x, y, br);
          sg.addColorStop(0, "rgba(125,211,252,0)");
          sg.addColorStop(0.82, "rgba(125,211,252,0.12)");
          sg.addColorStop(1, "rgba(147,197,253,0.55)");
          c.fillStyle = sg;
          c.beginPath(); c.arc(x, y, br, 0, Math.PI * 2); c.fill();
          c.globalAlpha = (0.35 + 0.5 * frac) * flick;
          c.strokeStyle = "#7dd3fc";
          c.lineWidth = 1.6;
          c.beginPath(); c.arc(x, y, br, 0, Math.PI * 2); c.stroke();
          c.restore();
        }
        // Integrity bars (owner 2026-10-11): stacked, depleting top-down —
        // BLUE shield (Warden-projected, first), YELLOW armor, RED hull.
        // No shield? Just armor + hull. When red goes, the unit pops.
        if (u.hp01 < 1 || sh01 > 0.01) {
          const bw = r * 2;
          const bx = x - r;
          let by = y - r - 7;
          const bar = (frac: number, color: string) => {
            c.fillStyle = "rgba(0,0,0,0.6)";
            c.fillRect(bx, by, bw, 3);
            c.fillStyle = color;
            c.fillRect(bx, by, bw * Math.max(0, Math.min(1, frac)), 3);
            by -= 4;
          };
          if (shMax > 0) bar(sh01 / shMax, "#38bdf8"); // shield — blue
          // armor is the top half of hp01, hull the bottom half
          bar(Math.max(0, (u.hp01 - 0.5) / 0.5), "#fbbf24"); // armor — yellow
          bar(Math.max(0, u.hp01 / 0.5), "#f87171"); // hull — red
          c.strokeStyle = SIDE_COLOR[u.side];
          c.lineWidth = 1;
          c.strokeRect(bx - 0.5, by + 0.5, bw + 1, (y - r - 4) - by);
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
        if (u.side === "defender" && scoutRef.current !== "revealed") continue;
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
          if (tr.side === "defender" && scoutRef.current !== "revealed") continue;
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

      // --- fx: beams, tracers, flashes, blooms, booms, rings, sparks --------
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
        // Weapon identity (owner 2026-10-11): beams read as lasers,
        // slugs as kinetic rounds — never the same look.
        if (tr.kind === "slug") drawTracerSlug(c, tr);
        else drawTracerBeam(c, tr); // 3-pass beam: halo + body + white-hot core + bright head.
      }
      // Lobbed siege shells riding their arcs.
      for (const sh of fx.shells) drawShell(c, sh);
      // (shadowBlur retired — the layered beam strokes ARE the glow.)
      for (const f of fx.flashes) {
        const a = alpha(f.life, f.maxLife);
        const g2 = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius);
        g2.addColorStop(0, `rgba(255,240,200,${0.9 * a})`);
        g2.addColorStop(1, "rgba(255,180,80,0)");
        c.globalAlpha = 1;
        c.fillStyle = g2;
        c.beginPath(); c.arc(f.x, f.y, f.radius, 0, Math.PI * 2); c.fill();
      }
      // Point-light blooms (slice 9): drawn first in the lighter pass, over
      // ground AND units — the explosion genuinely casts light on the scene
      // for its lifetime.
      for (const bl of fx.blooms) drawBloom(c, bl);
      for (const b of fx.booms) drawExplosionBody(c, b);
      for (const sp of fx.sparks) drawSpark(c, sp);
      drawDebrisChunks(c, fx.chunks);
      drawEmbers(c, fx.embers);
      c.restore();
      c.save();
      for (const rg2 of fx.rings) {
        // Slice 9: the explosion's shockwave ring gets the rendered
        // double-stroke treatment; jammer rings keep their classic look.
        if (rg2.kind === "shock") {
          drawShockwave(c, rg2);
          continue;
        }
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
      for (const sc of fx.scorches) drawScorch(c, sc);
      for (const b of fx.booms) {
        for (const sm of b.smoke) {
          if (sm.life <= 0) continue;
          c.globalAlpha = alpha(sm.life, sm.maxLife) * 0.35;
          c.fillStyle = "#1c1917";
          c.beginPath(); c.arc(sm.x, sm.y, sm.size, 0, Math.PI * 2); c.fill();
        }
      }
      c.restore();
      // Kicked-up dust around the advance (slice 9): volumetric — layered
      // soft sprites that hang, spread, and settle; never pop in/out.
      c.save();
      for (const d of fx.dusts) drawVolDust(c, d);
      c.restore();

      // --- scout flyby: the approach-phase intel sweep -----------------------
      // A fast streak over the enemy (north) half during the approach. On a
      // shoot-down the visual ends in a flak burst + falling streak at the
      // kill point — then nothing: the disposition stays hidden.
      {
        const sc = scoutRef.current;
        const t = simTRef.current;
        if (sc === "flying") {
          const p = Math.min(1, Math.max(0, (t - FLYBY_START_S) / (REVEAL_S - FLYBY_START_S)));
          const sx = 0.75 + 0.35 * Math.sin(p * Math.PI * 2);
          const sy = 1.35 - p * 1.15;
          const px = X(sx);
          const py = Y(sy);
          c.save();
          c.strokeStyle = "rgba(165,243,252,0.85)";
          c.lineWidth = 2.5;
          c.beginPath();
          c.moveTo(px - 46, py + 30);
          c.lineTo(px, py);
          c.stroke();
          c.fillStyle = "#ecfeff";
          c.beginPath(); c.arc(px, py, 4, 0, Math.PI * 2); c.fill();
          c.fillStyle = "rgba(165,243,252,0.9)";
          c.font = "700 10px system-ui, sans-serif";
          c.textAlign = "left";
          c.textBaseline = "middle";
          c.fillText("SCOUT", px + 8, py - 8);
          c.restore();
        } else if (sc === "lost" && t < SHOOTDOWN_S + 4) {
          // Falling debris after the flak kill.
          const kp = (SHOOTDOWN_S - FLYBY_START_S) / (REVEAL_S - FLYBY_START_S);
          const kx = 0.75 + 0.35 * Math.sin(kp * Math.PI * 2);
          const ky = 1.35 - kp * 1.15;
          const fp = Math.min(1, (t - SHOOTDOWN_S) / 4);
          const dx0 = X(kx + fp * 0.12);
          const dy0 = Y(ky + fp * 0.35);
          c.save();
          c.strokeStyle = `rgba(248,113,113,${1 - fp})`;
          c.lineWidth = 3;
          c.beginPath();
          c.moveTo(X(kx), Y(ky));
          c.lineTo(dx0, dy0);
          c.stroke();
          c.fillStyle = `rgba(254,205,211,${1 - fp})`;
          c.beginPath(); c.arc(dx0, dy0, 4, 0, Math.PI * 2); c.fill();
          c.fillStyle = `rgba(248,113,113,${1 - fp * 0.7})`;
          c.font = "700 10px system-ui, sans-serif";
          c.textAlign = "left";
          c.textBaseline = "middle";
          c.fillText("SCOUT LOST", dx0 + 8, dy0 - 8);
          c.restore();
        }
      }

      // --- order ping: the accepted order, drawn then fading ----------------
      // Dashed path from the squad's old centroid to the destination plus a
      // pulsing gold ring on the objective. The order READS on the map.
      const ping = orderPingRef.current;
      if (ping) {
        const t = simTRef.current;
        // "acknowledged/plotting" → "moving": while the command delay runs,
        // the ping is dim amber and dashed; once the squad steps off it goes
        // bright. The ping lives until a few seconds after step-off.
        const plotting = t < ping.atS;
        const age = Math.max(0, t - ping.atS);
        const plife = Math.max(0, 1 - age / 4);
        if (plife > 0) {
          c.save();
          c.globalAlpha = plotting ? 0.35 : plife;
          c.strokeStyle = "rgba(255,255,255,0.85)";
          c.lineWidth = 1.5;
          c.setLineDash([8, 6]);
          c.beginPath();
          c.moveTo(X(ping.fx), Y(ping.fy));
          c.lineTo(X(ping.x), Y(ping.y));
          c.stroke();
          c.setLineDash([]);
          const pr = s * 0.032 * (1 + 0.25 * Math.sin(Date.now() / 150));
          c.strokeStyle = plotting ? "#f59e0b" : "#fbbf24";
          if (plotting) c.setLineDash([4, 3]);
          c.lineWidth = 2.5;
          c.beginPath(); c.arc(X(ping.x), Y(ping.y), pr, 0, Math.PI * 2); c.stroke();
          c.restore();
        }
      }

      // --- movement tracers (owner 2026-10-11) ------------------------------
      // OWN squads: a full dashed line from the squad's centroid to its
      // destination — Hans tracks at a glance what's moving where. ENEMY
      // squads: a short direction tick only — you SEE they're moving and
      // roughly which way, but never their destination. That's hidden intel.
      {
        const own = new Map<string, SceneUnit[]>();
        const foe = new Map<string, SceneUnit[]>();
        for (const u of unitsRef.current) {
          if (u.state !== "advancing") continue;
          const m = u.side === "attacker" ? own : foe;
          const arr = m.get(u.squadId) ?? [];
          arr.push(u);
          m.set(u.squadId, arr);
        }
        for (const [, members] of own) {
          let cx = 0, cy = 0, tx = 0, ty = 0;
          for (const u of members) { cx += u.x; cy += u.y; tx += u.tx; ty += u.ty; }
          cx /= members.length; cy /= members.length;
          tx /= members.length; ty /= members.length;
          c.save();
          c.strokeStyle = "rgba(251,191,36,0.95)";
          c.lineWidth = 3.5;
          c.setLineDash([7, 5]);
          c.beginPath(); c.moveTo(X(cx), Y(cy)); c.lineTo(X(tx), Y(ty)); c.stroke();
          c.setLineDash([]);
          // destination diamond
          c.fillStyle = "rgba(251,191,36,0.9)";
          const dr = 5;
          c.beginPath();
          c.moveTo(X(tx), Y(ty) - dr); c.lineTo(X(tx) + dr, Y(ty));
          c.lineTo(X(tx), Y(ty) + dr); c.lineTo(X(tx) - dr, Y(ty));
          c.closePath(); c.fill();
          c.restore();
        }
        for (const [, members] of foe) {
          let cx = 0, cy = 0, dx = 0, dy = 0;
          for (const u of members) {
            cx += u.x; cy += u.y; dx += u.tx - u.x; dy += u.ty - u.y;
          }
          cx /= members.length; cy /= members.length;
          const l = Math.hypot(dx, dy);
          if (l < 0.01) continue;
          dx /= l; dy /= l;
          // short tick in the movement direction — direction, not destination
          const tickW = 0.045; // world units
          const ex = cx + dx * tickW, ey = cy + dy * tickW;
          c.save();
          c.strokeStyle = "rgba(248,113,113,0.9)";
          c.lineWidth = 3;
          c.lineCap = "round";
          c.beginPath(); c.moveTo(X(cx), Y(cy)); c.lineTo(X(ex), Y(ey)); c.stroke();
          // arrowhead
          const ah = 0.016;
          const px = -dy, py = dx;
          c.fillStyle = "rgba(248,113,113,0.9)";
          c.beginPath();
          c.moveTo(X(ex + dx * ah), Y(ey + dy * ah));
          c.lineTo(X(ex + px * ah * 0.7), Y(ey + py * ah * 0.7));
          c.lineTo(X(ex - px * ah * 0.7), Y(ey - py * ah * 0.7));
          c.closePath(); c.fill();
          c.restore();
        }
      }

      // --- siege aim targeter (owner 2026-10-11) ---------------------------
      // The draggable blast circle: amber ring = clear, RED ring + warning
      // label = own units inside the 20m falloff — shells don't discriminate.
      {
        const aim = ui.siegeAim;
        if (aim) {
          const ax = X(aim.x);
          const ay = Y(aim.y);
          const rpx = SIEGE_SPLASH_R * W();
          let friendliesInBlast = 0;
          for (const u of unitsRef.current) {
            if (u.side !== "attacker" || u.state === "dead" || u.state === "staging") continue;
            if (Math.hypot(u.x - aim.x, u.y - aim.y) < SIEGE_SPLASH_R) friendliesInBlast++;
          }
          const warn = friendliesInBlast > 0;
          const col = warn ? "248,113,113" : "251,191,36";
          const pulse = 0.55 + 0.15 * Math.sin(performance.now() / 300);
          c.save();
          c.beginPath();
          c.arc(ax, ay, rpx, 0, Math.PI * 2);
          c.fillStyle = `rgba(${col},0.07)`;
          c.fill();
          c.lineWidth = 2.5;
          c.setLineDash([12, 7]);
          c.strokeStyle = `rgba(${col},${pulse + 0.25})`;
          c.beginPath();
          c.arc(ax, ay, rpx, 0, Math.PI * 2);
          c.stroke();
          c.setLineDash([]);
          // Explosion icon at the aim point — the grab handle.
          c.font = "600 15px system-ui";
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillText("💥", ax, ay);
          if (warn) {
            c.font = "700 10px system-ui";
            c.fillStyle = `rgba(248,113,113,${pulse + 0.25})`;
            c.fillText("⚠ FRIENDLIES IN BLAST", ax, ay - rpx - 12);
          }
          c.restore();
        }
      }

      // --- Longeye movement report: highlight + direction arrow -------------
      // The reported squad pulses amber; the arrow is a fixed-length
      // direction vector — the moving squad + its direction, never a perfect
      // destination readout.
      {
        const t = simTRef.current;
        const hl = highlightRef.current;
        if (hl && t < hl.until) {
          const pulse = 1 + 0.2 * Math.sin(Date.now() / 180);
          c.save();
          c.strokeStyle = "rgba(251,191,36,0.95)";
          c.lineWidth = 2.5;
          for (const u of hl.units) {
            if (u.state === "dead") continue;
            const hr = Math.max(12, s * 0.026) * pulse;
            c.beginPath(); c.arc(X(u.x), Y(u.y), hr, 0, Math.PI * 2); c.stroke();
          }
          c.restore();
        }
        const ar = arrowRef.current;
        if (ar && t < ar.until) {
          const ax = X(ar.x);
          const ay = Y(ar.y);
          const bx = X(ar.x + ar.dx);
          const by = Y(ar.y + ar.dy);
          c.save();
          c.strokeStyle = "rgba(251,191,36,0.95)";
          c.fillStyle = "rgba(251,191,36,0.95)";
          c.lineWidth = 3;
          c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
          const ang = Math.atan2(by - ay, bx - ax);
          const hl2 = 12;
          c.beginPath();
          c.moveTo(bx, by);
          c.lineTo(bx - hl2 * Math.cos(ang - 0.4), by - hl2 * Math.sin(ang - 0.4));
          c.lineTo(bx - hl2 * Math.cos(ang + 0.4), by - hl2 * Math.sin(ang + 0.4));
          c.closePath(); c.fill();
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
      // Slice 12: labels are Z4 command UI — the Z3 overview stays clean
      // (spec §5: command UI fades in only at Z4).
      if (ui.labelsOn && !overviewShapes) {
        c.save();
        c.font = "700 9px system-ui, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        // Zoom-aware label density (owner 2026-10-06): declutter when zoomed
        // out (every 6th unit), thin the middle (every 3rd), full labels when
        // zoomed in — a big battle stays readable on a narrow phone. Engaged
        // units and the selected squad always label: the fight is the point.
        const fitZ = WORLD_FIT_ZOOM * (ground ? 3.2 : 1);
        const stride = cam.zoom < fitZ * 1.15 ? 6 : cam.zoom < fitZ * 1.9 ? 3 : 1;
        let li = 0;
        for (const u of unitsRef.current) {
          if (!ui.vectorsOn[u.vector]) continue;
          if (u.side === "defender" && scoutRef.current !== "revealed") continue;
          const idx = li++;
          const selSquad = ui.selectedSquadId === u.squadId;
          if (stride > 1 && idx % stride !== 0 && u.state !== "engaged" && !selSquad) continue;
          // Camera-origin frame (slice 7): identical math, one transform source.
          const { sx, sy } = worldToScreen(rigCamera(cam), w, h, u.x, u.y);
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
        const vtext = clockFailRef.current
          ? "⏱ THE DEFENSE HELD — RAID FAILED"
          : `${vname.toUpperCase()} HOLDS THE FIELD`;
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
  /** Siege targeter drag (owner 2026-10-11): pointer id while dragging the aim targeter. */
  const siegeDragRef = useRef<number | null>(null);

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
      const halfW = WORLD_W / 2 / ez;
      const halfH = WORLD_H / 2 / (ez * cam.ysq);
      cam.uax = clampAnchor(cam.uax - dxCss / (ez * w), halfW, WORLD_W, WORLD_CX);
      cam.uay = clampAnchor(cam.uay - dyCss / (ez * cam.ysq * h), halfH, WORLD_H, WORLD_CY);
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
      const newEz = newUz; // tactical modeZoom = WORLD_FIT_ZOOM
      const halfW = WORLD_W / 2 / newEz;
      const halfH = WORLD_H / 2 / (newEz * cam.ysq);
      cam.uax = clampAnchor(wxx - (fxCss - w / 2) / (newEz * w), halfW, WORLD_W, WORLD_CX);
      cam.uay = clampAnchor(wyy - (fyCss - h * cam.fy) / (newEz * cam.ysq * h), halfH, WORLD_H, WORLD_CY);
      cam.ax = cam.uax;
      cam.ay = cam.uay;
    }
  };

  /** Post a field report: a comms bubble AND a log entry — no alert is ever
   *  lost. The bubble persists until the commander taps it (confirmed read).
   *  Critical alerts pulse and carry the alert ping; routine comms get a
   *  softer blip. Both respect mute (the sfx live-gate). */
  const postComms = (kind: CommsEventKind, detail: string) => {
    const spec = commsFor(kind, detail);
    const id = commsIdRef.current++;
    const bubble = { id, source: spec.source, message: spec.message, critical: spec.critical, atS: simTRef.current };
    setComms((prev) => pushBubble(prev, bubble));
    commsRef.current = [...commsRef.current, bubble].slice(-40);
    logOrder({ squadName: spec.source, dest: "—", verdict: "accepted", reason: spec.message, kind: "comms" });
    if (spec.critical) battleSfx.ping();
    else battleSfx.blip();
  };

  /** Issue a click-to-command move order: judge it against the doctrine,
   *  then move the squad or refuse with the reason — never silent. */
  const issueOrder = (squadId: string, dx: number, dy: number) => {
    const squadUnits = unitsRef.current.filter((u) => u.squadId === squadId && u.state !== "dead");
    const squad = buildSquads(unitsRef.current).find((s) => s.id === squadId);
    const name = squad ? squad.name : squadId;
    // Unbounded map (slice 7): the commander's tap may land past the old
    // hard walls — the soft clamp lets the order stand instead of snapping back.
    const dest = { x: softClampX(dx), y: softClampY(dy) };
    // HOT DROP COMMIT (owner 2026-10-06): an on-call reserve still in
    // staging isn't ordered — it's COMMITTED. Tap the reserve squad, tap
    // the map, and it falls on the picked spot, loud. Only while driving
    // manually and only once the dropships are down (touchdown+).
    const stagingOnCall = squadUnits.filter((u) => u.state === "staging" && u.onCall);
    if (stagingOnCall.length > 0 && ui.manual) {
      const phase = scenePhaseAt(simTRef.current);
      if (phase === "approach") {
        toastRef.current = { text: "Dropships aren't down yet — wait for touchdown.", born: performance.now() };
        battleSfx.orderRejected();
        return;
      }
      const t = simTRef.current;
      for (const u of stagingOnCall) {
        u.state = "descending";
        u.tx = softClampX(dest.x + (Math.random() - 0.5) * 0.05);
        u.ty = softClampY(dest.y + (Math.random() - 0.5) * 0.05);
        u.dropAtS = t;
      }
      battleSfx.dropship(); // engines spool — the reserve is inbound
      logOrder({ squadName: name, dest: destLabel(dest.x, dest.y), verdict: "accepted", kind: "hotdrop" });
      postComms("reserve", "Reserve inbound — hot drop, brace for a loud landing");
      orderPingRef.current = { x: dest.x, y: dest.y, fx: dest.x, fy: dest.y, born: t, atS: t };
      return;
    }
    // REAR ENTRY IS JUMP-SHIP ONLY (owner 2026-10-11): a tap behind the
    // enemy line never becomes a ground move — not around the edges, not
    // through gaps. With Warden escort it becomes a combat drop (the jump
    // ship flies the squad in); without escort it's refused, with the reason.
    if (isBehindLines(dest, unitsRef.current, "attacker")) {
      const jd = judgeJumpDrop(squadUnits);
      logOrder({
        squadName: name,
        dest: destLabel(dest.x, dest.y),
        verdict: jd.ok ? "accepted" : "rejected",
        reason: jd.ok ? undefined : jd.reason,
        kind: "jumpdrop",
      });
      if (!jd.ok) {
        toastRef.current = { text: jd.reason, born: performance.now() };
        battleSfx.orderRejected();
        return;
      }
      const t = simTRef.current;
      for (const u of squadUnits) {
        if (u.state !== "holding" && u.state !== "advancing") continue;
        u.state = "descending"; // airborne — jump ships fly OVER the line
        u.tx = softClampX(dest.x + (Math.random() - 0.5) * 0.05);
        u.ty = softClampY(dest.y + (Math.random() - 0.5) * 0.05);
        u.dropAtS = t;
        u.moveAtS = undefined;
      }
      battleSfx.dropship(); // engines spool — the jump ship is inbound
      postComms("reserve", "Jump ship inbound — combat drop behind their lines");
      orderPingRef.current = { x: dest.x, y: dest.y, fx: dest.x, fy: dest.y, born: t, atS: t };
      return;
    }
    // HOLD POSITION (owner 2026-10-11): the squad stays put even if ordered —
    // toggle MOVE to reposition it. Siege batteries hold by default
    // (deployed); jump drops bypass — that's an airlift, not a ground move.
    const squadHasThunders = squadUnits.some((u) => u.kind === "thunder" && u.state !== "dead");
    if (squadStanceOf(sceneUISnapshot(), squadId, squadHasThunders).holdPosition) {
      const reason = "Holding position — toggle MOVE to reposition.";
      logOrder({ squadName: name, dest: destLabel(dest.x, dest.y), verdict: "rejected", reason });
      toastRef.current = { text: reason, born: performance.now() };
      battleSfx.orderRejected();
      return;
    }
    const verdict = judgeMoveOrder(squadUnits, dest, unitsRef.current);
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
    // Accepted: the squad acknowledges, plots for ORDER_DELAY_S sim-seconds,
    // then steps off — the order READS as "acknowledged/plotting" → "moving".
    // Symmetric with AI moves (the engine waits the same delay).
    let cx = 0;
    let cy = 0;
    for (const u of squadUnits) { cx += u.x; cy += u.y; }
    cx /= squadUnits.length;
    cy /= squadUnits.length;
    for (const u of squadUnits) {
      stampOrder(u, softClampX(dest.x + (u.x - cx)), softClampY(dest.y + (u.y - cy)), simTRef.current);
    }
    orderPingRef.current = { x: dest.x, y: dest.y, fx: cx, fy: cy, born: simTRef.current, atS: simTRef.current + ORDER_DELAY_S };
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
    // Invert via the camera-origin frame (slice 7): screen → world.
    const { x: tx, y: ty } = screenToWorld(rigCamera(cam), w, h, px * w, py * h);
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
      setTurretMode(best.id, "gunner"); // hands on the weapon ⇒ manual mode
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
    // SIEGE AIM MODE (owner 2026-10-11): with a thunder squad selected and
    // aim armed, the tap drops the draggable targeter — the guns walk fire
    // to it. Not a move order.
    if (ui.siegeAimArmed && ui.selectedSquadId) {
      const hasTh = unitsRef.current.some(
        (u) => u.squadId === ui.selectedSquadId && u.kind === "thunder" && u.state !== "dead",
      );
      if (hasTh) {
        setSiegeAim({ x: softClampX(tx), y: softClampY(ty) });
        setSiegeAimArmed(false);
        battleSfx.orderAccepted();
        postComms("siege", "Siege aim updated — walking fire to the new target");
        return;
      }
      setSiegeAimArmed(false);
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
      // SIEGE TARGETER DRAG (owner 2026-10-11): grabbing the aim targeter
      // repositions it directly — no tap needed.
      const uiSnap = sceneUISnapshot();
      if (uiSnap.siegeAim) {
        const r = e.currentTarget.getBoundingClientRect();
        const { sx, sy } = worldToScreen(
          rigCamera(camRef.current), r.width, r.height,
          uiSnap.siegeAim.x, uiSnap.siegeAim.y,
        );
        if (Math.hypot(e.clientX - r.left - sx, e.clientY - r.top - sy) < 32) {
          siegeDragRef.current = e.pointerId;
          downRef.current = null; // it's a drag, not a tap
        }
      }
    } else if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      downRef.current = null; // two fingers: no tap
      siegeDragRef.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pts = pointersRef.current;
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId)!;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Siege targeter drag: walk the aim point under the finger.
    if (siegeDragRef.current === e.pointerId && pts.size === 1) {
      const r = e.currentTarget.getBoundingClientRect();
      const { x, y } = screenToWorld(
        rigCamera(camRef.current), r.width, r.height,
        e.clientX - r.left, e.clientY - r.top,
      );
      setSiegeAim({ x: softClampX(x), y: softClampY(y) });
      return;
    }
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
    // Siege targeter drop: the drag is done — the guns walk fire to the spot.
    if (siegeDragRef.current === e.pointerId) {
      siegeDragRef.current = null;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinchRef.current = null;
      if (!cancelled) battleSfx.orderAccepted();
      return;
    }
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

  /**
   * End-of-battle actions (owner 2026-10-11):
   *  retry — restart this exact battle: same forces, same map, same seed.
   *  re-challenge — a fresh challenge: same forces, NEW seed (new field).
   *  (For PvP, re-challenge issues the rematch against the same opponent.)
   */
  const retryBattle = () => {
    battleSfx.uiClick();
    setBattleRunId((n) => n + 1);
  };
  const rechallengeBattle = () => {
    battleSfx.uiClick();
    setActiveScene({
      ...sceneProp,
      id: `${sceneProp.id}-rc${Date.now().toString(36)}`,
      seed: (Math.random() * 1e9) | 0,
      t0: Date.now(),
    });
    setBattleRunId((n) => n + 1);
  };
  /** Save Replay — keep a pending capture (duels auto-save). */
  const saveReplay = () => {
    if (!replayId || replaySaved) return;
    if (markReplaySaved(replayId)) {
      setReplaySaved(true);
      battleSfx.uiClick();
    }
  };

  /**
   * Save formation (owner 2026-10-11): captures the battle's own squads,
   * composition, and starting positions under the commander's name —
   * personal war room or alliance doctrine. Optional replay attachment:
   * the tape travels with the formation so the war room can show proof.
   */
  const confirmSaveFormation = () => {
    const nm = saveName.trim();
    if (!nm) return;
    const snap = formationSnapshotRef.current;
    const draft = formationFromBattle(snap.squads, snap.units);
    let rid: string | undefined;
    if (saveWithReplay && replayId) {
      if (markReplaySaved(replayId)) setReplaySaved(true);
      rid = replayId;
    }
    if (saveDest === "doctrine" && onSaveDoctrine) {
      const rp = replayId ? getReplay(replayId) : null;
      onSaveDoctrine({
        name: nm,
        playId: "custom",
        loads: draft.loads,
        slotMeta: draft.slotMeta,
        replay: rp ? compactReplay(rp) : undefined,
        battleName: scene.name,
        victor: resolvedSide,
        durationS: Math.round(simTRef.current),
        killsAttacker: sceneUISnapshot().kills.attacker,
        killsDefender: sceneUISnapshot().kills.defender,
      });
    } else if (onSaveFormation) {
      onSaveFormation({
        name: nm,
        playId: "custom",
        loads: draft.loads,
        slotMeta: draft.slotMeta,
        replayId: rid,
      });
    }
    battleSfx.uiClick();
    setSavedInWarRoom(true);
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
      {/* Grade intel is scout-gated: until the flyby reveals the disposition
          the enemy reads only as "Chorus Garrison". */}
      <span className="text-rose-400">{revealed ? scene.defenderName : "Chorus Garrison"}</span>
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
        onClick={() => setTurretMode(gunner.id, "auto")}
        data-testid="gunner-close-hud"
        className="absolute right-3 top-3 rounded-lg border border-cyan-300/40 bg-black/70 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-black/90"
      >
        Close turret ✕
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
              <SceneHeader name={scene.name} tier={scene.tier} sub={sceneSub} clock={false} band="Z4" />
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

        {/* on-field command layer (owner 2026-10-06): turret toggle,
            reserve/squad strips, pace, comms — tap-and-move on the field;
            the Controls glass is setup-only and stays closed mid-fight. */}
        <BattleHud
          comms={comms}
          onDismissComms={(id) => setComms((prev) => dismissBubble(prev, id))}
          variant="fullscreen"
        />

        {/* battle result sheet — the canvas draws the victor banner; this
            DOM sheet carries the commander's end-of-battle actions (owner
            2026-10-11): retry, re-challenge, report, save/watch replay, and
            save formation — personal war room or alliance doctrine. */}
        {resolvedSide && (
          <div
            className="absolute inset-x-0 bottom-0 z-30 flex justify-center px-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 4.5rem)" }}
          >
            <div
              className="w-full max-w-[420px] rounded-2xl border border-white/15 bg-black/80 p-4 shadow-2xl backdrop-blur-md"
              data-testid="battle-result-sheet"
            >
              <p
                className="text-center text-sm font-extrabold tracking-wide"
                style={{ color: resolvedSide === "attacker" ? "#34d399" : "#f87171" }}
              >
                {resolvedSide === "attacker"
                  ? `${scene.attackerName.toUpperCase()} HOLDS THE FIELD`
                  : "THE DEFENSE HELD — RAID FAILED"}
              </p>

              {resultView === "actions" && (
                <div className="mt-3 grid grid-cols-3 gap-1.5" data-testid="battle-actions">
                  <button
                    type="button"
                    onClick={retryBattle}
                    data-testid="battle-retry"
                    className="rounded-lg border border-white/15 bg-black/60 px-2 py-2.5 text-[11px] font-bold text-zinc-200 active:scale-[0.97]"
                  >
                    🔁<br />Retry
                  </button>
                  <button
                    type="button"
                    onClick={rechallengeBattle}
                    data-testid="battle-rechallenge"
                    aria-label="Re-challenge — same forces, new field"
                    className="rounded-lg border border-white/15 bg-black/60 px-2 py-2.5 text-[11px] font-bold text-zinc-200 active:scale-[0.97]"
                  >
                    ⚔️<br />Re-challenge
                  </button>
                  <button
                    type="button"
                    onClick={() => { battleSfx.uiClick(); setResultView("report"); }}
                    data-testid="battle-report"
                    className="rounded-lg border border-white/15 bg-black/60 px-2 py-2.5 text-[11px] font-bold text-zinc-200 active:scale-[0.97]"
                  >
                    📋<br />Report
                  </button>
                  {!replaySaved ? (
                    <button
                      type="button"
                      onClick={saveReplay}
                      data-testid="battle-save-replay"
                      disabled={!replayId}
                      className="rounded-lg border border-white/15 bg-black/60 px-2 py-2.5 text-[11px] font-bold text-zinc-200 active:scale-[0.97] disabled:opacity-40"
                    >
                      💾<br />Save replay
                    </button>
                  ) : (
                    <span className="rounded-lg border border-emerald-400/30 bg-emerald-950/40 px-2 py-2.5 text-center text-[11px] font-bold text-emerald-200">
                      ✓<br />{scene.pvp ? "Auto-saved" : "Saved"}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => { battleSfx.uiClick(); setWatchingReplay(true); }}
                    data-testid="battle-watch-replay"
                    disabled={!replayId}
                    className="rounded-lg border border-white/15 bg-black/60 px-2 py-2.5 text-[11px] font-bold text-zinc-200 active:scale-[0.97] disabled:opacity-40"
                  >
                    🎬<br />Watch replay
                  </button>
                  {(onSaveFormation || onSaveDoctrine) && !savedInWarRoom ? (
                    <button
                      type="button"
                      onClick={() => {
                        battleSfx.uiClick();
                        setSaveName((cur) => cur || defaultBattleName(scene.name));
                        setResultView("save");
                      }}
                      data-testid="battle-save-formation"
                      className="rounded-lg border border-amber-300/40 bg-amber-950/50 px-2 py-2.5 text-[11px] font-bold text-amber-200 active:scale-[0.97]"
                    >
                      📚<br />Save formation
                    </button>
                  ) : savedInWarRoom ? (
                    <span className="rounded-lg border border-emerald-400/30 bg-emerald-950/40 px-2 py-2.5 text-center text-[11px] font-bold text-emerald-200">
                      ✓<br />Saved
                    </span>
                  ) : (
                    <span className="rounded-lg border border-white/10 bg-black/40 px-2 py-2.5 text-center text-[11px] text-zinc-500">
                      📚<br />Save N/A
                    </span>
                  )}
                </div>
              )}

              {resultView === "report" && (
                <div className="mt-3" data-testid="battle-report-view">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                      After-action report
                    </p>
                    <button
                      type="button"
                      onClick={() => setResultView("actions")}
                      className="text-[11px] font-semibold text-zinc-400 underline"
                    >
                      ← Actions
                    </button>
                  </div>
                  {/* per-squad casualties — the numbers Hans watched tick up */}
                  <div className="space-y-1">
                    {[...ui.squads]
                      .sort((a, b) => b.total - b.alive - (a.total - a.alive))
                      .map((s) => {
                        const dead = Math.max(0, s.total - s.alive);
                        const frac = s.total > 0 ? dead / s.total : 0;
                        return (
                          <div key={s.id} className="flex items-center gap-2 text-[11px]">
                            <span className="w-20 flex-none truncate font-semibold text-zinc-200">{s.name}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-full rounded-full bg-red-500/80"
                                style={{ width: `${Math.round(frac * 100)}%` }}
                              />
                            </div>
                            <span className="w-16 flex-none text-right tabular-nums text-zinc-400">
                              <span className="text-emerald-300">{s.alive}</span>/{s.total}
                              {dead > 0 && <span className="ml-1 font-bold text-red-400">−{dead}</span>}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-400">
                    Confirmed down: <span className="font-bold text-amber-300">{ui.kills.attacker}✕</span> theirs ·{" "}
                    <span className="font-bold text-red-400">{ui.kills.defender}✕</span> yours ·{" "}
                    {fmtClock(simTRef.current)} of battle.
                  </p>
                  {/* key moments */}
                  {commsRef.current.filter((c) => c.critical).length > 0 && (
                    <div className="mt-2">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                        Key moments
                      </p>
                      <ul className="max-h-24 space-y-0.5 overflow-y-auto">
                        {commsRef.current
                          .filter((c) => c.critical)
                          .map((c) => (
                            <li key={c.id} className="text-[11px] text-zinc-300">
                              <span className="tabular-nums text-zinc-500">{fmtClock(c.atS)}</span> — {c.message}
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                  {/* order timeline */}
                  {ui.orderLog.length > 0 && (
                    <div className="mt-2">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                        Orders
                      </p>
                      <ul className="max-h-24 space-y-0.5 overflow-y-auto">
                        {ui.orderLog.slice(0, 12).map((o) => (
                          <li key={o.id} className="text-[11px] text-zinc-400">
                            {orderReceipt(o).text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {resultView === "save" && !savedInWarRoom && (
                <div className="mt-3" data-testid="battle-save-view">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                      Save formation
                    </p>
                    <button
                      type="button"
                      onClick={() => setResultView("actions")}
                      className="text-[11px] font-semibold text-zinc-400 underline"
                    >
                      ← Actions
                    </button>
                  </div>
                  <p className="mb-2 text-[11px] text-zinc-400">
                    Captures this battle's squads, composition, and starting positions — every saved
                    formation needs a name so it's findable later.
                  </p>
                  <label
                    htmlFor="battle-save-name"
                    className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400"
                  >
                    Formation name
                  </label>
                  <input
                    id="battle-save-name"
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder={defaultBattleName(scene.name)}
                    maxLength={40}
                    data-testid="battle-save-name"
                    className="w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
                  />
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-zinc-200">
                    <input
                      type="checkbox"
                      checked={saveWithReplay}
                      onChange={(e) => setSaveWithReplay(e.target.checked)}
                      data-testid="battle-save-with-replay"
                      className="h-4 w-4 accent-amber-500"
                    />
                    🎬 Save replay with this formation
                  </label>
                  {onSaveDoctrine && (
                    <div className="mt-2 flex gap-1.5" data-testid="battle-save-dest">
                      <button
                        type="button"
                        onClick={() => setSaveDest("personal")}
                        aria-pressed={saveDest === "personal"}
                        className={`flex-1 rounded-lg border px-2 py-2 text-[11px] font-bold ${
                          saveDest === "personal"
                            ? "border-amber-300/50 bg-amber-950/50 text-amber-200"
                            : "border-white/15 bg-black/50 text-zinc-400"
                        }`}
                      >
                        📚 My war room
                      </button>
                      <button
                        type="button"
                        onClick={() => setSaveDest("doctrine")}
                        aria-pressed={saveDest === "doctrine"}
                        className={`flex-1 rounded-lg border px-2 py-2 text-[11px] font-bold ${
                          saveDest === "doctrine"
                            ? "border-amber-300/50 bg-amber-950/50 text-amber-200"
                            : "border-white/15 bg-black/50 text-zinc-400"
                        }`}
                      >
                        📜 Alliance doctrine
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={confirmSaveFormation}
                    disabled={!saveName.trim()}
                    data-testid="battle-save-confirm"
                    className="mt-2 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-black disabled:opacity-40"
                  >
                    {saveDest === "doctrine" ? "📜 Save as doctrine" : "📚 Save formation"}
                  </button>
                  {!saveName.trim() && (
                    <p className="mt-1 text-center text-[11px] text-zinc-500">
                      Name it — no unnamed formations.
                    </p>
                  )}
                </div>
              )}
              {savedInWarRoom && (
                <p className="mt-3 text-center text-xs font-semibold text-emerald-300" data-testid="warroom-saved-flag">
                  ✓ {saveDest === "doctrine" ? "Saved to the alliance doctrine library." : "Saved in the war room — locked down and ready to deploy."}
                </p>
              )}
            </div>
          </div>
        )}
        {watchingReplay && replayId && (() => {
          const rp = getReplay(replayId);
          return rp ? (
            <BattleReplayViewer
              replay={rp}
              title={rp.name}
              onClose={() => setWatchingReplay(false)}
            />
          ) : null;
        })()}
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
          band="Z4"
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
        {/* on-field command layer (owner 2026-10-06): comms bubbles +
            turret toggle + reserve/squad strips + pace — tap-and-move on
            the field; the deck below is setup, checked once at start. */}
        <BattleHud
          comms={comms}
          onDismissComms={(id) => setComms((prev) => dismissBubble(prev, id))}
          variant="embedded"
        />
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
              ? "Manual: held turrets stay silent; auto turrets and the gun you sit in fire. Take a gun from the turret toggle on the field."
              : "Auto: every turret engages on its own. Flip to manual to drive."}
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
