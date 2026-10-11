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

/** Per-turret control (owner 2026-10-06: the turret gets its OWN toggle on
 *  the battle HUD — open/close without ever opening the Controls glass):
 *    "held"   — the turret holds fire (hands off).
 *    "auto"   — the turret free-fires at the nearest enemy in range.
 *    "gunner" — the commander IS this turret: gunner cam, click-to-target.
 *  In AUTO command mode every turret free-fires regardless of this map;
 *  the modes govern what a turret does while driving manually. */
export type TurretMode = "held" | "auto" | "gunner";

/** The held/auto half of a turret's mode (gunner derives from gunnerId). */
export type TurretFireMode = "held" | "auto";

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
  /** living thunders in this squad — it has siege controls (aim, hold-fire) */
  hasThunders?: boolean;
}

/** What one log entry IS (QA 2026-10-06: a hot-drop must not read like a
 *  plain move — the receipt drives its own wording per kind):
 *    "move"    — a judged move order (accepted/rejected by the doctrine).
 *    "hotdrop" — an on-call reserve was COMMITTED: it fell on the tap.
 *    "jumpdrop" — a combat drop behind enemy lines (jump-ship only, Warden
 *                 escort required) — the only legal rear entry.
 *    "comms"   — a field report (the ORDERS log's other half: the report feed). */
export type OrderKind = "move" | "hotdrop" | "jumpdrop" | "comms";

/** One judged order for the ORDERS log — the command log seed. */
export interface OrderLogEntry {
  id: number;
  squadName: string;
  dest: string;
  verdict: "accepted" | "rejected";
  reason?: string;
  /** Receipt kind; missing = a plain move (older writers). */
  kind?: OrderKind;
}

/**
 * Render-ready receipt for one log entry (pure, unit-tested): the banner and
 * both HUD variants read from here so a hot-drop can never fall back to the
 * generic "→ MAIN — accepted" wording, and comms entries keep the em-dash
 * report form. Returns the display text plus a tone the HUD maps to color.
 */
export function orderReceipt(entry: OrderLogEntry): { text: string; tone: "ok" | "bad" | "note" } {
  if (entry.kind === "hotdrop") {
    return { text: `${entry.squadName} hot-dropped → ${entry.dest}`, tone: "ok" };
  }
  if (entry.kind === "jumpdrop") {
    return entry.verdict === "accepted"
      ? { text: `✈ ${entry.squadName} combat-dropped → ${entry.dest}`, tone: "ok" }
      : { text: `${entry.squadName} — ${entry.reason ?? "jump drop refused"}`, tone: "bad" };
  }
  if (entry.kind === "comms") {
    return { text: entry.reason ? `${entry.squadName} — ${entry.reason}` : entry.squadName, tone: "note" };
  }
  const ok = entry.verdict === "accepted";
  return {
    text: `${entry.squadName} → ${entry.dest} — ${ok ? "accepted" : "rejected"}${entry.reason ? ` · ${entry.reason}` : ""}`,
    tone: ok ? "ok" : "bad",
  };
}

/** The chip label (pure, unit-tested): the on-call state leads the chip —
 *  the 🪂 must be the first thing the commander sees, ahead of the name and
 *  strength. The eye glyph (positional Longeye coverage) follows it. */
export function squadChipLabel(sq: SquadSummary): string {
  return `${sq.onCallReserve ? "🪂 " : ""}${sq.eyes ? "👁 " : ""}${sq.name} ${sq.alive}/${sq.total}`;
}

/** The selection-banner copy (pure, unit-tested): an on-call reserve is not
 *  "ordered" — the map tap commits a hot drop and the banner says so. */
export function selectionBannerText(sq: SquadSummary): string {
  return sq.onCallReserve
    ? `${sq.name} selected — tap the map to hot-drop it 🪂`
    : `${sq.name} selected — tap the map to order it`;
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
  /** per-turret held/auto fire modes — gunner derives from gunnerId */
  turretModes: Record<string, TurretFireMode>;
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
  /**
   * Siege aim point, world coords (owner 2026-10-11): the draggable
   * targeter. Thunder guns walk their fire to it. Null = not placed —
   * thunders fall back to nearest-enemy fire.
   */
  siegeAim: { x: number; y: number } | null;
  /** Aim mode armed — the next map tap with a thunder squad selected places the targeter. */
  siegeAimArmed: boolean;
  /**
   * Per-squad stance (owner 2026-10-11):
   *   weaponsHold — the squad's direct-fire weapons stay silent, even in range.
   *   holdPosition — the squad stays put; ground move orders are refused.
   * Defaults: weapons live; thunder squads hold position (deployed siege),
   * everyone else moves. Missing entry = defaults.
   */
  squadStance: Record<string, { weaponsHold?: boolean; holdPosition?: boolean }>;
  /**
   * Siege master hold-fire (owner 2026-10-11): the panic button — every
   * thunder holds its shells while this is on. Per-unit siegeHold also exists
   * for future per-gun control; either one silences the gun.
   */
  siegeHoldAll: boolean;
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
  turretModes: {},
  tS: 0,
  kills: { attacker: 0, defender: 0 },
  turrets: [],
  roster: [],
  squads: [],
  selectedSquadId: null,
  orderLog: [],
  zoomLevel: 1,
  mapNonce: 0,
  siegeAim: null,
  siegeAimArmed: false,
  squadStance: {},
  siegeHoldAll: false,
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

/** Effective mode of one turret (pure — the battle HUD and the firing loop
 *  both read this, so what the toggle shows is what the gun does). A turret
 *  the commander is sitting in is "gunner"; otherwise the held/auto map,
 *  defaulting to "auto" (guns free unless told to hold). */
export function turretModeOf(s: SceneUIState, turretId: string): TurretMode {
  if (s.gunnerId === turretId) return "gunner";
  return s.turretModes[turretId] === "held" ? "held" : "auto";
}

/** Does this turret shoot this tick? (pure) AUTO command: all guns free.
 *  Manual: held turrets stay silent; auto + the gunner turret fire. */
export function turretFires(s: SceneUIState, turretId: string): boolean {
  if (!s.manual) return true;
  return turretModeOf(s, turretId) !== "held";
}

/** One tap on the HUD turret toggle (owner 2026-10-06): open the turret
 *  (take the gun — gunner cam, and hands on the weapon means manual mode),
 *  or close it (back to auto fire, lock cleared). Never touches Controls. */
export function setTurretMode(id: string, mode: TurretMode): void {
  if (mode === "gunner") {
    if (state.gunnerId === id && state.manual) return;
    set({ gunnerId: id, manual: true, turretModes: { ...state.turretModes, [id]: "auto" } });
    return;
  }
  const clearGunner = state.gunnerId === id;
  if (state.turretModes[id] === mode && !clearGunner) return;
  set({
    turretModes: { ...state.turretModes, [id]: mode },
    ...(clearGunner ? { gunnerId: null, gunTarget: null } : {}),
  });
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

/** Log a judged order — newest first, capped. The command log seed. Entries
 *  without a kind are plain moves; the kind is normalized on write so the
 *  receipt renderer never has to guess. */
export function logOrder(entry: Omit<OrderLogEntry, "id">): void {
  orderSeq += 1;
  set({
    orderLog: [{ ...entry, kind: entry.kind ?? "move", id: orderSeq }, ...state.orderLog].slice(0, MAX_ORDER_LOG),
  });
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
    turretModes: {},
    turrets: [],
    roster: [],
    squads: [],
    selectedSquadId: null,
    orderLog: [],
    siegeAim: null,
    siegeAimArmed: false,
    squadStance: {},
    siegeHoldAll: false,
  });
}

/** Stance accessors with defaults (pure): weapons live; thunder squads hold. */
export function squadStanceOf(
  ui: { squadStance: Record<string, { weaponsHold?: boolean; holdPosition?: boolean }> },
  id: string,
  hasThunders: boolean,
): { weaponsHold: boolean; holdPosition: boolean } {
  const s = ui.squadStance[id];
  return {
    weaponsHold: s?.weaponsHold ?? false,
    holdPosition: s?.holdPosition ?? hasThunders,
  };
}

/** Toggle a squad's weapons hold. */
export function setSquadWeaponsHold(id: string, hold: boolean): void {
  const cur = state.squadStance[id] ?? {};
  if ((cur.weaponsHold ?? false) === hold) return;
  set({ squadStance: { ...state.squadStance, [id]: { ...cur, weaponsHold: hold } } });
}

/** Toggle a squad's hold-position. */
export function setSquadHoldPosition(id: string, hold: boolean): void {
  const cur = state.squadStance[id] ?? {};
  if ((cur.holdPosition ?? false) === hold) return;
  set({ squadStance: { ...state.squadStance, [id]: { ...cur, holdPosition: hold } } });
}

/** Siege master hold-fire — the panic button. */
export function setSiegeHoldAll(hold: boolean): void {
  if (state.siegeHoldAll === hold) return;
  set({ siegeHoldAll: hold });
}

/** Siege: place/move the aim targeter (world coords). */
export function setSiegeAim(p: { x: number; y: number } | null): void {
  set({ siegeAim: p });
}

/** Siege: arm/disarm aim mode — the next map tap places the targeter. */
export function setSiegeAimArmed(armed: boolean): void {
  if (state.siegeAimArmed === armed) return;
  set({ siegeAimArmed: armed });
}

/** Test/utility: reset the whole store. */
export function resetSceneUIStore(): void {
  state = INITIAL;
  emit();
}
