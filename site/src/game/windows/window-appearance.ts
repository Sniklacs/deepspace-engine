// window-appearance.ts — the player's window chrome: translucency + tint.
//
// Hans (2026-10-02): "I want the translucent look on those boxes that I can
// change and the opacity with colors that I can set to them so I can customize
// my screen."
//
// The EVE-style windows (.win-frame / .win-titlebar) read --win-bg and
// --win-titlebar-bg; this module owns those variables. Opacity 1 = the
// current solid look; lower = the game world shows through. Tint recolors the
// chrome. Persisted in localStorage, applied on boot.

export interface WindowAppearance {
  /** 0.35–1: window background opacity. 1 = solid (the shipped look). */
  opacity: number;
  /** Hex tint for the window chrome. */
  tint: string;
}

export const DEFAULT_APPEARANCE: WindowAppearance = {
  opacity: 1,
  tint: "#161d26", // = --surf-3, the shipped window background
};

/** Curated tints — the chrome stays readable, the game keeps its mood. */
export const TINT_PRESETS: { name: string; hex: string }[] = [
  { name: "Default", hex: "#161d26" },
  { name: "Abyss", hex: "#12202e" },
  { name: "Verdant", hex: "#12261c" },
  { name: "Amber", hex: "#2a2113" },
  { name: "Crimson", hex: "#2b1418" },
  { name: "Violet", hex: "#1f1830" },
];

const STORAGE_KEY = "dse-window-appearance-v1";
const MIN_OPACITY = 0.35;

function clampOpacity(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_APPEARANCE.opacity;
  return Math.min(1, Math.max(MIN_OPACITY, v));
}

function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** The titlebar sits a touch more solid than the body so titles stay readable. */
function titlebarAlpha(opacity: number): number {
  return Math.min(1, opacity + 0.12);
}

function applyToDocument(a: WindowAppearance): void {
  if (typeof document === "undefined") return;
  const [r, g, b] = hexToRgb(a.tint);
  const root = document.documentElement;
  root.style.setProperty("--win-bg", `rgba(${r}, ${g}, ${b}, ${a.opacity.toFixed(2)})`);
  root.style.setProperty(
    "--win-titlebar-bg",
    `rgba(${r}, ${g}, ${b}, ${titlebarAlpha(a.opacity).toFixed(2)})`,
  );
}

let current: WindowAppearance = { ...DEFAULT_APPEARANCE };
/** The snapshot React reads: the SAME reference until the look changes.
// useSyncExternalStore re-renders whenever getSnapshot's return is not
// Object.is-equal to the last one — a fresh `{ ...current }` on every read
// looks like a change on every render and React spirals into "Maximum update
// depth exceeded" (#185). This is only ever replaced, never mutated. */
let snapshot: WindowAppearance = { ...current };
const listeners = new Set<() => void>();

function readStored(): WindowAppearance {
  if (typeof localStorage === "undefined") return { ...DEFAULT_APPEARANCE };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    const p = JSON.parse(raw) as Partial<WindowAppearance>;
    return {
      opacity: clampOpacity(p.opacity ?? DEFAULT_APPEARANCE.opacity),
      tint: isHex(p.tint) ? p.tint : DEFAULT_APPEARANCE.tint,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/** Load the saved look (call once at boot) and paint it. */
export function initWindowAppearance(): WindowAppearance {
  current = readStored();
  snapshot = { ...current };
  applyToDocument(current);
  return { ...current };
}

export function getWindowAppearance(): WindowAppearance {
  // Stable reference: see the note on `snapshot` above.
  return snapshot;
}

export function setWindowAppearance(patch: Partial<WindowAppearance>): WindowAppearance {
  current = {
    opacity: clampOpacity(patch.opacity ?? current.opacity),
    tint: isHex(patch.tint) ? patch.tint : current.tint,
  };
  snapshot = { ...current };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* private mode: the look lasts the session */
  }
  applyToDocument(current);
  listeners.forEach((l) => l());
  return { ...current };
}

export function resetWindowAppearance(): WindowAppearance {
  return setWindowAppearance({ ...DEFAULT_APPEARANCE });
}

export function subscribeWindowAppearance(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
