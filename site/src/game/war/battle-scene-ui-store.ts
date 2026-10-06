// battle-scene-ui-store.ts — shared UI state for the 2D battle scene
// (owner 2026-10-05).
//
// The scene canvas (BattleScene) and the floating glass control window
// (BattleControlsBody, an EVE-style window) both read and write this store,
// so the player can drive the toggles, the doctrine clock, and the gunner
// cam from the floating window while the canvas runs full screen underneath.
// Follows the window-store pattern: plain subscribe/getSnapshot, no provider.

import type { ManeuverVector } from "./war-types";
import type { SceneUnitKind } from "./battle-scene-model";

export type DayNightMode = "auto" | "day" | "night";

/** Battle scene camera: the overhead tactical map, or down in the dirt. */
export type CameraMode = "tactical" | "ground";

/**
 * Battle-sim speed (owner 2026-10-06): SLOW ↔ REALTIME, capped at 1x.
 * The battle can never run faster than real time — two players can't run
 * different timers, and command happens in real time at most. SLOW (0.5x)
 * is the default: the fight breathes, the commander gets time to think.
 * The sim clock, movement, tracers, and casualty ticks all scale with it;
 * at REALTIME sim-time equals wall-clock. (Future PvP: effective pace =
 * the slowest player's setting.)
 */
export type BattleSpeed = "slow" | "realtime";

export const BATTLE_SPEED_MUL: Record<BattleSpeed, number> = {
  slow: 0.5,
  realtime: 1,
};

export const BATTLE_SPEEDS: BattleSpeed[] = ["slow", "realtime"];

/** One row of the FIELD FORCE roster — what's actually on the field. */
export interface RosterEntry {
  side: "attacker" | "defender";
  kind: SceneUnitKind;
  count: number;
  /** Tier breakdown: index 0 = T1 count … index 3 = T4 count. */
  tiers: [number, number, number, number];
}

/** One drivable bus for the SQUADS panel — name + living strength. */
export interface SquadSummary {
  id: string;
  name: string;
  alive: number;
  total: number;
  /** living Longeyes in this squad — it watches its own sector */
  eyes?: boolean;
  /** on-call reserve still in staging — tap the squad, tap the map: hot drop */
  onCallReserve?: boolean;
}

/** One judged order for the ORDERS log — the command log seed. */
export interface OrderLogEntry {
  id: number;
  squadName: string;
  dest: string;
  verdict: "accepted" | "rejected";
  reason?: string;
}

const MAX_ORDER_LOG = 8;

export interface SceneUIState {
  vectorsOn: Record<ManeuverVector, boolean>;
  turretsOn: boolean;
  logisticsFx: boolean;
  manual: boolean;
  dayNight: DayNightMode;
  /** "ground" drops the camera low with the friendly advance (owner 2026-10-05). */
  cameraMode: CameraMode;
  /** Sim speed — the player's pacing preference, persists across scenes. */
  battleSpeed: BattleSpeed;
  /** On-canvas unit type tags (BULWARK, REAVER, …), default on. */
  labelsOn: boolean;
  gunnerId: string | null;
  gunTarget: string | null;
  /** battle-clock seconds — the scene loop writes this ~4x/sec */
  tS: number;
  kills: { attacker: number; defender: number };
  /** attacker turrets, for the gunner-cam picker in the control window */
  turrets: { id: string; idx: number }[];
  /** force roster for the FIELD FORCE panel — what's on the field by type */
  roster: RosterEntry[];
  /** command squads for the SQUADS panel — the five buses, living strength */
  squads: SquadSummary[];
  /** currently selected squad (click-to-command), null when none */
  selectedSquadId: string | null;
  /** judged orders, newest first — the ORDERS log */
  orderLog: OrderLogEntry[];
  /** player zoom level (× mode zoom); 1 = the full-field default framing */
  zoomLevel: number;
  /** recenter token — bump to reset pan + zoom */
  mapNonce: number;
}

const INITIAL: SceneUIState = {
  vectorsOn: { MAIN: true, FLANK_LEFT: true, FLANK_RIGHT: true, REAR: true, RESERVE: true },
  turretsOn: true,
  logisticsFx: true,
  manual: false,
  dayNight: "auto",
  cameraMode: "tactical",
  battleSpeed: "slow",
  labelsOn: true,
  gunnerId: null,
  gunTarget: null,
  tS: 0,
  kills: { attacker: 0, defender: 0 },
  turrets: [],
  roster: [],
  squads: [],
  selectedSquadId: null,
  orderLog: [],
  zoomLevel: 1,
  mapNonce: 0,
};

let state: SceneUIState = INITIAL;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* a subscriber that throws must not stop the others */
    }
  }
}

export function subscribeSceneUI(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The live snapshot. Stable between changes (useSyncExternalStore requires it). */
export function sceneUISnapshot(): SceneUIState {
  return state;
}

/** What the server render sees: the untouched initial UI. */
export function sceneUIServerSnapshot(): SceneUIState {
  return INITIAL;
}

function set(patch: Partial<SceneUIState>): void {
  state = { ...state, ...patch };
  emit();
}

export function setVectorOn(v: ManeuverVector, on: boolean): void {
  if (state.vectorsOn[v] === on) return;
  set({ vectorsOn: { ...state.vectorsOn, [v]: on } });
}

export function setTurretsOn(on: boolean): void {
  if (state.turretsOn === on) return;
  set({ turretsOn: on });
}

export function setLogisticsFx(on: boolean): void {
  if (state.logisticsFx === on) return;
  set({ logisticsFx: on });
}

export function setManual(on: boolean): void {
  if (state.manual === on) return;
  set({ manual: on });
}

export function setDayNight(mode: DayNightMode): void {
  if (state.dayNight === mode) return;
  set({ dayNight: mode });
}

/** Flip between the overhead tactical map and the ground-level camera. */
export function setCameraMode(mode: CameraMode): void {
  if (state.cameraMode === mode) return;
  set({ cameraMode: mode });
}

/** Battle-sim speed: slow / normal / fast. The sim clock, unit movement,
 *  tracers, and casualty ticks all scale with it (owner 2026-10-05). */
export function setBattleSpeed(speed: BattleSpeed): void {
  if (state.battleSpeed === speed) return;
  set({ battleSpeed: speed });
}

/** Player zoom level (pinch / wheel / +/- buttons), multiplied by the
 *  camera-mode zoom. Clamped [0.6, 4] — ground mode clamps tighter. */
export function setZoomLevel(z: number): void {
  const clamped = Math.max(0.6, Math.min(4, z));
  if (state.zoomLevel === clamped) return;
  set({ zoomLevel: clamped });
}

/** Recenter token — the canvas watches this and resets pan + zoom. */
export function recenterMap(): void {
  set({ mapNonce: state.mapNonce + 1 });
}

/** Cycle slow → realtime → slow. */
export function cycleBattleSpeed(): void {
  const i = BATTLE_SPEEDS.indexOf(state.battleSpeed);
  setBattleSpeed(BATTLE_SPEEDS[(i + 1) % BATTLE_SPEEDS.length]);
}

/** On-canvas unit type tags. */
export function setLabelsOn(on: boolean): void {
  if (state.labelsOn === on) return;
  set({ labelsOn: on });
}

/** Cycle the day/night skin: auto → night → day → auto. */
export function cycleDayNight(): void {
  setDayNight(state.dayNight === "auto" ? "night" : state.dayNight === "night" ? "day" : "auto");
}

export function setGunner(id: string | null): void {
  if (state.gunnerId === id) return;
  // Leaving the gunner view clears the lock.
  set({ gunnerId: id, gunTarget: id === null ? null : state.gunTarget });
}

export function setGunTarget(id: string | null): void {
  if (state.gunTarget === id) return;
  set({ gunTarget: id });
}

export function setClock(tS: number): void {
  if (state.tS === tS) return;
  set({ tS });
}

export function bumpKill(side: "attacker" | "defender"): void {
  set({ kills: { ...state.kills, [side]: state.kills[side] + 1 } });
}

export function registerTurrets(turrets: { id: string; idx: number }[]): void {
  set({ turrets });
}

/** Force roster for the FIELD FORCE panel — counts by side + unit kind. */
export function registerRoster(roster: RosterEntry[]): void {
  set({ roster });
}

/** Command squads for the SQUADS panel — the five buses, living strength. */
export function registerSquads(squads: SquadSummary[]): void {
  set({ squads });
}

/** Select a squad for click-to-command (null = deselect). */
export function setSelectedSquad(id: string | null): void {
  if (state.selectedSquadId === id) return;
  set({ selectedSquadId: id });
}

let orderSeq = 0;

/** Log a judged order — newest first, capped. The command log seed. */
export function logOrder(entry: Omit<OrderLogEntry, "id">): void {
  orderSeq += 1;
  set({ orderLog: [{ ...entry, id: orderSeq }, ...state.orderLog].slice(0, MAX_ORDER_LOG) });
}

/** Fresh scene identity: drop per-scene UI (clock, kills, gunner, turrets,
 *  roster, squads, selection, orders). The player's preferences (camera,
 *  speed, labels, layers, command) survive. */
export function resetSceneUI(): void {
  set({
    tS: 0,
    kills: { attacker: 0, defender: 0 },
    gunnerId: null,
    gunTarget: null,
    turrets: [],
    roster: [],
    squads: [],
    selectedSquadId: null,
    orderLog: [],
  });
}

/** Test/utility: reset the whole store. */
export function resetSceneUIStore(): void {
  state = INITIAL;
  emit();
}
