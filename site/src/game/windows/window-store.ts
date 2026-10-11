// window-store.ts — THE EVE-STYLE WINDOW MANAGER (owner 2026-10-01).
//
// "EVE's framework was all about windows that you could open up and they would
// stay open until you close them." This is that: a module-level registry of
// open windows with stacking, minimize, and focus. It follows the chat-store
// pattern (plain subscribe/getSnapshot, `useSyncExternalStore`, no provider).
//
// THE CONTRACTS:
//   • One instance per kind+key. Opening an already-open window focuses it
//     (un-minimizes, brings to front) instead of duplicating it.
//   • Windows NEVER auto-close. No backdrop-tap close, no swipe-down close, no
//     Esc close, no navigation close. Only an explicit close (or minimize)
//     dismisses a window. The store survives route changes — a window closed
//     by unmount is not closed at all; it re-renders when its host remounts.
//   • Minimized windows are NOT closed: they park in the tray and restore
//     exactly where they were.
//   • Chat is a first-class window ("chat"). Its minimize collapses to the
//     ChatDock bar (the dock IS chat's minimized state); other kinds minimize
//     to the window tray.
//   • Windows are resizable (owner 2026-10-01): the player drags the corner
//     grip to scale a window bigger or smaller, EVE-style. Sizes are
//     remembered per kind (in memory + localStorage) and restored on reopen;
//     double-clicking the grip resets to the default size.
//
// This store owns chrome state ONLY (open/minimized/z-order/size). Window
// CONTENT data (chat messages, research state) stays in its own store.

export type WindowKind = "chat" | "satellite-research" | "battle-controls" | "battle-squads";

export interface WindowProps {
  /** satellite-research: the covered node id, e.g. "rim-3" */
  nodeId?: string;
}

export interface WindowInstance {
  /** stable identity: `${kind}::${key}` */
  id: string;
  kind: WindowKind;
  /** dedupe key within kind: "chat" for chat, the nodeId for satellites */
  key: string;
  /** i18n key for the title bar */
  titleKey: string;
  /** English fallback when the catalogue lacks the key */
  titleFallback: string;
  props: WindowProps;
  minimized: boolean;
  /** stacking order — higher renders above */
  z: number;
  /** player-chosen size (EVE-style resize); null = default CSS sizing */
  size: { w: number; h: number } | null;
  /** player-dragged position (EVE-style float); null = default CSS placement */
  pos: { x: number; y: number } | null;
  /** player-chosen translucency (Hans 2026-10-11); null = fully opaque */
  opacity: number | null;
}

/** Minimum window size — below this the content is unusable. */
export const WIN_MIN_W = 300;
export const WIN_MIN_H = 240;

interface WindowState {
  windows: WindowInstance[];
  /** monotonic counter backing z-order */
  seq: number;
}

const initialState: WindowState = { windows: [], seq: 0 };

let state: WindowState = initialState;
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

export function subscribeWindows(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The live snapshot. Stable between changes (useSyncExternalStore requires it). */
export function windowSnapshot(): WindowState {
  return state;
}

/** What the server render sees: no windows. */
const SERVER_STATE: WindowState = initialState;
export function windowServerSnapshot(): WindowState {
  return SERVER_STATE;
}

/** Per-kind remembered sizes — EVE remembers your window sizes. In-memory is
 *  the source of truth (testable); localStorage mirrors it when available so
 *  sizes survive a reload. */
const rememberedSizes = new Map<WindowKind, { w: number; h: number }>();

function sizeStorageKey(kind: WindowKind): string {
  return `unbound:win-size:${kind}`;
}

function posStorageKey(kind: WindowKind): string {
  return `unbound:win-pos:${kind}`;
}

function loadRememberedPos(kind: WindowKind): { x: number; y: number } | null {
  const mem = rememberedPositions.get(kind);
  if (mem) return { ...mem };
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(posStorageKey(kind));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{ x: number; y: number }>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const pos = {
      x: Math.round(Math.min(Math.max(parsed.x, -vw + 96), vw - 96)),
      y: Math.round(Math.min(Math.max(parsed.y, 0), vh - 96)),
    };
    rememberedPositions.set(kind, pos);
    return { ...pos };
  } catch {
    return null;
  }
}

function rememberPos(kind: WindowKind, pos: { x: number; y: number }, persist: boolean): void {
  rememberedPositions.set(kind, { ...pos });
  if (!persist) return;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(posStorageKey(kind), JSON.stringify(pos));
    }
  } catch {
    /* private mode etc. — the in-memory position still works for the session */
  }
}

/** Per-kind remembered drag positions — EVE remembers where you left them. */
const rememberedPositions = new Map<WindowKind, { x: number; y: number }>();

function loadRememberedSize(kind: WindowKind): { w: number; h: number } | null {
  const mem = rememberedSizes.get(kind);
  if (mem) return { ...mem };
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(sizeStorageKey(kind));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{ w: number; h: number }>;
    if (typeof parsed.w !== "number" || typeof parsed.h !== "number") return null;
    const size = {
      w: Math.max(WIN_MIN_W, Math.round(parsed.w)),
      h: Math.max(WIN_MIN_H, Math.round(parsed.h)),
    };
    rememberedSizes.set(kind, size);
    return { ...size };
  } catch {
    return null;
  }
}

function rememberSize(kind: WindowKind, size: { w: number; h: number }, persist: boolean): void {
  rememberedSizes.set(kind, { ...size });
  if (!persist) return;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(sizeStorageKey(kind), JSON.stringify(size));
    }
  } catch {
    /* private mode etc. — the in-memory size still works for the session */
  }
}

/** Per-window opacity (Hans 2026-10-11): 0.3–1, remembered per kind like
 *  size/position. In-memory is the source of truth; localStorage mirrors. */
export const WIN_MIN_OPACITY = 0.3;
const rememberedOpacities = new Map<WindowKind, number>();

function opacityStorageKey(kind: WindowKind): string {
  return `unbound:win-opacity:${kind}`;
}

export function clampWindowOpacity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(WIN_MIN_OPACITY, v));
}

function loadRememberedOpacity(kind: WindowKind): number | null {
  const mem = rememberedOpacities.get(kind);
  if (mem !== undefined) return mem;
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(opacityStorageKey(kind));
    if (!raw) return null;
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return null;
    const o = clampWindowOpacity(parsed);
    rememberedOpacities.set(kind, o);
    return o;
  } catch {
    return null;
  }
}

function rememberOpacity(kind: WindowKind, opacity: number): void {
  rememberedOpacities.set(kind, opacity);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(opacityStorageKey(kind), String(opacity));
    }
  } catch {
    /* private mode — the in-memory opacity still works for the session */
  }
}

/** Set a window's translucency (Hans 2026-10-11). Clamped 0.3–1, remembered
 *  per kind and restored when the window reopens. */
export function setWindowOpacity(id: string, opacity: number): void {
  const win = state.windows.find((x) => x.id === id);
  if (!win) return;
  const o = clampWindowOpacity(opacity);
  rememberOpacity(win.kind, o);
  if (win.opacity === o) return;
  state = {
    ...state,
    windows: state.windows.map((x) => (x.id === id ? { ...x, opacity: o } : x)),
  };
  emit();
}

/** Forget a window kind's custom opacity (resets to fully opaque). */
export function resetWindowOpacity(id: string): void {
  const win = state.windows.find((x) => x.id === id);
  if (!win || win.opacity == null) return;
  rememberedOpacities.delete(win.kind);
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(opacityStorageKey(win.kind));
  } catch {
    /* ignore */
  }
  state = {
    ...state,
    windows: state.windows.map((x) => (x.id === id ? { ...x, opacity: null } : x)),
  };
  emit();
}

function windowId(kind: WindowKind, key: string): string {
  return `${kind}::${key}`;
}

function defaultTitle(kind: WindowKind): { titleKey: string; titleFallback: string } {
  switch (kind) {
    case "chat":
      return { titleKey: "windows.chatTitle", titleFallback: "Chat" };
    case "satellite-research":
      return { titleKey: "windows.satResearchTitle", titleFallback: "Satellite research" };
    case "battle-controls":
      return { titleKey: "windows.battleControlsTitle", titleFallback: "Battle controls" };
    case "battle-squads":
      return { titleKey: "windows.battleSquadsTitle", titleFallback: "Squads" };
  }
}

export interface OpenWindowOpts {
  /** dedupe key within kind — defaults to the kind itself */
  key?: string;
  titleKey?: string;
  titleFallback?: string;
  props?: WindowProps;
}

/**
 * Open a window, or focus it if it is already open (un-minimize + front).
 * Returns the window id.
 */
export function openWindow(kind: WindowKind, opts: OpenWindowOpts = {}): string {
  const key = opts.key ?? kind;
  const id = windowId(kind, key);
  const existing = state.windows.find((w) => w.id === id);
  const seq = state.seq + 1;
  if (existing) {
    state = {
      seq,
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, minimized: false, z: seq } : w,
      ),
    };
  } else {
    const title = defaultTitle(kind);
    state = {
      seq,
      windows: [
        ...state.windows,
        {
          id,
          kind,
          key,
          titleKey: opts.titleKey ?? title.titleKey,
          titleFallback: opts.titleFallback ?? title.titleFallback,
          props: opts.props ?? {},
          minimized: false,
          z: seq,
          // EVE remembers: reopen at the player's last size for this kind.
          size: loadRememberedSize(kind),
          // EVE remembers: reopen where the player left it.
          pos: loadRememberedPos(kind),
          // EVE remembers: reopen at the player's last translucency.
          opacity: loadRememberedOpacity(kind),
        },
      ],
    };
  }
  emit();
  return id;
}

/** Close a window by id. No-op when it is not open. */
export function closeWindow(id: string): void {
  if (!state.windows.some((w) => w.id === id)) return;
  state = { ...state, windows: state.windows.filter((w) => w.id !== id) };
  emit();
}

/** Close every window of a kind. No-op when none are open. */
export function closeWindowsOfKind(kind: WindowKind): void {
  if (!state.windows.some((w) => w.kind === kind)) return;
  state = { ...state, windows: state.windows.filter((w) => w.kind !== kind) };
  emit();
}

/** Park a window in the tray. The window is NOT closed. */
export function minimizeWindow(id: string): void {
  const w = state.windows.find((x) => x.id === id);
  if (!w || w.minimized) return;
  state = {
    ...state,
    windows: state.windows.map((x) => (x.id === id ? { ...x, minimized: true } : x)),
  };
  emit();
}

/** Restore a minimized window: un-minimize and bring to front. */
export function restoreWindow(id: string): void {
  const w = state.windows.find((x) => x.id === id);
  if (!w || !w.minimized) return;
  const seq = state.seq + 1;
  state = {
    seq,
    windows: state.windows.map((x) => (x.id === id ? { ...x, minimized: false, z: seq } : x)),
  };
  emit();
}

/** Bring a window to the front without changing anything else. */
export function focusWindow(id: string): void {
  const w = state.windows.find((x) => x.id === id);
  if (!w) return;
  const seq = state.seq + 1;
  state = {
    seq,
    windows: state.windows.map((x) => (x.id === id ? { ...x, z: seq } : x)),
  };
  emit();
}

/**
 * Resize a window (EVE-style: the player scales it). The size is remembered
 * per kind and restored when the window reopens. Pass persist=false while a
 * drag is in flight — the frame re-calls with persist=true on pointer-up so
 * localStorage isn't hammered mid-drag.
 */
export function resizeWindow(id: string, w: number, h: number, persist = true): void {
  const win = state.windows.find((x) => x.id === id);
  if (!win) return;
  const size = {
    w: Math.max(WIN_MIN_W, Math.round(w)),
    h: Math.max(WIN_MIN_H, Math.round(h)),
  };
  const changed = !win.size || win.size.w !== size.w || win.size.h !== size.h;
  rememberSize(win.kind, size, persist);
  if (!changed) return;
  state = {
    ...state,
    windows: state.windows.map((x) => (x.id === id ? { ...x, size } : x)),
  };
  emit();
}

/** Forget a window's custom size (double-click the resize grip). */
export function resetWindowSize(id: string): void {  const win = state.windows.find((x) => x.id === id);
  if (!win || !win.size) return;
  rememberedSizes.delete(win.kind);
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(sizeStorageKey(win.kind));
  } catch {
    /* ignore */
  }
  state = {
    ...state,
    windows: state.windows.map((x) => (x.id === id ? { ...x, size: null } : x)),
  };
  emit();
}

/**
 * Drag a window (EVE-style float: the player moves it by the title bar).
 * The position is remembered per kind and restored when the window reopens.
 * Pass persist=false while a drag is in flight — the frame re-calls with
 * persist=true on pointer-up so localStorage isn't hammered mid-drag.
 */
/** Drag snap grid (Hans 2026-10-11): windows settle magnetically onto a 20px
 *  grid — once snapped, a window sits at clean coordinates. */
export const WIN_SNAP_GRID = 20;

export function moveWindow(id: string, x: number, y: number, persist = true): void {
  const win = state.windows.find((w) => w.id === id);
  if (!win) return;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  // Snap to the grid first (magnetic), then keep a grab-handle's worth of
  // the window on screen.
  const sx = Math.round(x / WIN_SNAP_GRID) * WIN_SNAP_GRID;
  const sy = Math.round(y / WIN_SNAP_GRID) * WIN_SNAP_GRID;
  const pos = {
    x: Math.round(Math.min(Math.max(sx, -vw + 96), vw - 96)),
    y: Math.round(Math.min(Math.max(sy, 0), vh - 96)),
  };
  rememberPos(win.kind, pos, persist);
  state = {
    ...state,
    windows: state.windows.map((w) => (w.id === id ? { ...w, pos } : w)),
  };
  emit();
}

/** Forget a window's dragged position (double-click the title bar). */
export function resetWindowPos(id: string): void {
  const win = state.windows.find((w) => w.id === id);
  if (!win || !win.pos) return;
  rememberedPositions.delete(win.kind);
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(posStorageKey(win.kind));
  } catch {
    /* ignore */
  }
  state = {
    ...state,
    windows: state.windows.map((w) => (w.id === id ? { ...w, pos: null } : w)),
  };
  emit();
}

/**
 * Patch a window's chrome fields (title, props). Used when content wants the
 * title bar to follow live state (e.g. chat naming its surface).
 */
export function patchWindow(
  id: string,
  patch: Partial<Pick<WindowInstance, "titleKey" | "titleFallback" | "props">>,
): void {
  const w = state.windows.find((x) => x.id === id);
  if (!w) return;
  if (
    (patch.titleKey === undefined || patch.titleKey === w.titleKey) &&
    (patch.titleFallback === undefined || patch.titleFallback === w.titleFallback) &&
    (patch.props === undefined || patch.props === w.props)
  ) {
    return;
  }
  state = {
    ...state,
    windows: state.windows.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  };
  emit();
}

/** Is there a visible (open, not minimized) window of this kind/key? */
export function isWindowOpen(kind: WindowKind, key?: string): boolean {
  const id = windowId(kind, key ?? kind);
  const w = state.windows.find((x) => x.id === id);
  return !!w && !w.minimized;
}

/** Visible windows, back-to-front. */
export function visibleWindows(): WindowInstance[] {
  return state.windows.filter((w) => !w.minimized).sort((a, b) => a.z - b.z);
}

/** Minimized windows, most-recently-touched first. */
export function minimizedWindows(): WindowInstance[] {
  return state.windows.filter((w) => w.minimized).sort((a, b) => b.z - a.z);
}

/** Test/utility: reset the registry (used by tests and sign-out). */
export function resetWindows(): void {
  state = initialState;
  rememberedSizes.clear();
  rememberedPositions.clear();
  rememberedOpacities.clear();
  emit();
}
