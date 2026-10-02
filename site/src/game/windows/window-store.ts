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
//
// This store owns chrome state ONLY (open/minimized/z-order). Window CONTENT
// data (chat messages, research state) stays in its own store.

export type WindowKind = "chat" | "satellite-research";

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
}

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

function windowId(kind: WindowKind, key: string): string {
  return `${kind}::${key}`;
}

function defaultTitle(kind: WindowKind): { titleKey: string; titleFallback: string } {
  switch (kind) {
    case "chat":
      return { titleKey: "windows.chatTitle", titleFallback: "Chat" };
    case "satellite-research":
      return { titleKey: "windows.satResearchTitle", titleFallback: "Satellite research" };
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
  emit();
}
