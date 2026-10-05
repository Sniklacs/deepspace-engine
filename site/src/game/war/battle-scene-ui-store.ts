// battle-scene-ui-store.ts — shared UI state for the 2D battle scene
// (owner 2026-10-05).
//
// The scene canvas (BattleScene) and the floating glass control window
// (BattleControlsBody, an EVE-style window) both read and write this store,
// so the player can drive the toggles, the doctrine clock, and the gunner
// cam from the floating window while the canvas runs full screen underneath.
// Follows the window-store pattern: plain subscribe/getSnapshot, no provider.

import type { ManeuverVector } from "./war-types";

export type DayNightMode = "auto" | "day" | "night";

/** Battle scene camera: the overhead tactical map, or down in the dirt. */
export type CameraMode = "tactical" | "ground";

export interface SceneUIState {
  vectorsOn: Record<ManeuverVector, boolean>;
  turretsOn: boolean;
  logisticsFx: boolean;
  manual: boolean;
  dayNight: DayNightMode;
  /** "ground" drops the camera low with the friendly advance (owner 2026-10-05). */
  cameraMode: CameraMode;
  gunnerId: string | null;
  gunTarget: string | null;
  /** battle-clock seconds — the scene loop writes this ~4x/sec */
  tS: number;
  kills: { attacker: number; defender: number };
  /** attacker turrets, for the gunner-cam picker in the control window */
  turrets: { id: string; idx: number }[];
}

const INITIAL: SceneUIState = {
  vectorsOn: { MAIN: true, FLANK_LEFT: true, FLANK_RIGHT: true, REAR: true, RESERVE: true },
  turretsOn: true,
  logisticsFx: true,
  manual: false,
  dayNight: "auto",
  cameraMode: "tactical",
  gunnerId: null,
  gunTarget: null,
  tS: 0,
  kills: { attacker: 0, defender: 0 },
  turrets: [],
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

/** Fresh scene identity: drop per-scene UI (clock, kills, gunner, turrets). */
export function resetSceneUI(): void {
  set({
    tS: 0,
    kills: { attacker: 0, defender: 0 },
    gunnerId: null,
    gunTarget: null,
    turrets: [],
  });
}

/** Test/utility: reset the whole store. */
export function resetSceneUIStore(): void {
  state = INITIAL;
  emit();
}
