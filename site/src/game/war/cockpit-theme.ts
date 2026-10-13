// cockpit-theme — cockpit/UI color theming (owner 2026-10-12).
//
// Hans: the default look is Halo-style green glow (cockpit green) — text
// accents, glows, UI highlights all start green. BUT everything is
// changeable by the player, including the cockpit lighting color itself.
// Race-themed presets: red for Draconians, blue for Palladians/Ashtar, etc.
//
// This system drives the command windows now and will carry into the
// cockpit visual phase later — one theme variable, whole UI follows.

import type { CSSProperties } from "react";

export interface CockpitTheme {
  id: string;
  label: string;
  /** main glow color — accents, header highlights, active states */
  accent: string;
  /** dim wash for active button backgrounds */
  accentDim: string;
  /** soft glow color for text-shadow */
  glow: string;
}

export const COCKPIT_THEMES: CockpitTheme[] = [
  {
    id: "halo-green",
    label: "Halo Green",
    accent: "#3dff73",
    accentDim: "#0f2a18",
    glow: "rgba(61,255,115,0.35)",
  },
  {
    id: "draconian-red",
    label: "Draconian Red",
    accent: "#ff3b30",
    accentDim: "#2a0f0d",
    glow: "rgba(255,59,48,0.35)",
  },
  {
    id: "palladian-blue",
    label: "Palladian Blue",
    accent: "#38c8f0",
    accentDim: "#0d2230",
    glow: "rgba(56,200,240,0.35)",
  },
  {
    id: "watcher-gold",
    label: "Watcher Gold",
    accent: "#f2b23e",
    accentDim: "#2a2113",
    glow: "rgba(242,178,62,0.35)",
  },
  {
    id: "gray-silver",
    label: "Gray Silver",
    accent: "#b8c4d0",
    accentDim: "#1c2129",
    glow: "rgba(184,196,208,0.35)",
  },
  {
    id: "annunaki-obsidian",
    label: "Annunaki Obsidian",
    accent: "#c9962e",
    accentDim: "#241b0c",
    glow: "rgba(201,150,46,0.35)",
  },
  {
    id: "nephilim-ember",
    label: "Nephilim Ember",
    accent: "#ff7a1a",
    accentDim: "#2a150a",
    glow: "rgba(255,122,26,0.35)",
  },
  {
    id: "unbound-radiant",
    label: "Unbound Radiant",
    accent: "#aef3ff",
    accentDim: "#12262c",
    glow: "rgba(174,243,255,0.35)",
  },
];

export const DEFAULT_COCKPIT_THEME_ID = "halo-green";

/** Race → suggested cockpit theme. The player can always change it. */
export const RACE_COCKPIT_THEME: Record<string, string> = {
  draconians: "draconian-red",
  palladians: "palladian-blue",
  astar: "palladian-blue",
  watchers: "watcher-gold",
  grigori: "watcher-gold",
  grays: "gray-silver",
  annunaki: "annunaki-obsidian",
  nephilim: "nephilim-ember",
  unbound: "unbound-radiant",
};

export function cockpitThemeById(id: string): CockpitTheme {
  return (
    COCKPIT_THEMES.find((t) => t.id === id) ??
    COCKPIT_THEMES.find((t) => t.id === DEFAULT_COCKPIT_THEME_ID)!
  );
}

export function cockpitThemeForRace(raceId: string): CockpitTheme {
  return cockpitThemeById(RACE_COCKPIT_THEME[raceId] ?? DEFAULT_COCKPIT_THEME_ID);
}

/**
 * Inline style setting the accent CSS variables. Spread onto the window
 * root alongside CMD_THEME — every command surface inherits the glow.
 */
export function cockpitAccentStyle(theme: CockpitTheme): CSSProperties {
  return {
    "--cmd-accent": theme.accent,
    "--cmd-accent-dim": theme.accentDim,
    "--cmd-accent-glow": `0 0 12px ${theme.glow}`,
  } as CSSProperties;
}

const STORAGE_KEY = "unbound-cockpit-theme";

export function loadCockpitThemeId(): string {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && COCKPIT_THEMES.some((t) => t.id === v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_COCKPIT_THEME_ID;
}

export function saveCockpitThemeId(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
