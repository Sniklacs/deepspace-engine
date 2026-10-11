// colony-skins.ts — LOD SETTLEMENT ART for the seamless world map
// (Hans, Oct 11 2026).
//
// The world map is the foundation; colonies are the first skin layer on top.
// When the camera leaves the globe (morphT) and the icon markers fade, these
// illustrated settlements fade in — far → near → ground — so zooming into a
// colony feels like the place coming alive in stages, not icons popping.
//
// All sprites are pre-baked to offscreen canvases once per
// (race, status, lod, home) combo and blitted by the frame loop — phone-safe.
// Pure canvas 2D, no DOM, no Date.now() inside the bake functions.

import type { RaceId } from "../types";

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

/** LOD bands for colony skins, keyed to the zoom continuum. */
export type ColonySkinLOD = "far" | "near" | "ground";
/** Settlement condition. */
export type ColonySkinStatus = "active" | "abandoned" | "husk";

export interface ColonySkinSpec {
  race: RaceId | "unknown";
  status: ColonySkinStatus;
  /** The player's own colony — gold trim, brighter lights. */
  isHome: boolean;
  lod: ColonySkinLOD;
}

/** Which skin LOD a zoom scale wants, or null when the globe icons suffice. */
export function colonySkinLODForScale(scale: number): ColonySkinLOD | null {
  if (!Number.isFinite(scale) || scale < 2) return null; // Z1 orbit: icons
  if (scale < 6) return "far"; // Z2 high altitude
  if (scale < 14) return "near"; // Z3 low altitude
  return "ground"; // Z4 ground
}

/** World size of a colony skin, in degrees — constant so it scales with zoom. */
export const COLONY_SKIN_DEGREES = 3;

// ---------------------------------------------------------------------------
// Palettes — race architecture reads at a glance (2D Plus: rich, not flat)
// ---------------------------------------------------------------------------

interface RacePalette {
  wall: string;
  wallDark: string;
  stone: string;
  stoneDark: string;
  roof: string;
  roofDark: string;
  accent: string;
  wood: string;
}

const RACE_PALETTES: Record<string, RacePalette> = {
  // Draconians: dark stone, crimson — predatory, angular.
  draconians: {
    wall: "#4a2e2e", wallDark: "#2e1c1c", stone: "#5a3a3a", stoneDark: "#3a2424",
    roof: "#991b1b", roofDark: "#5f1212", accent: "#ef4444", wood: "#3f2a1e",
  },
  // Annunaki: sandstone + gold, ancient and gilded.
  anunnaki: {
    wall: "#6b5a45", wallDark: "#453a2c", stone: "#7a6a52", stoneDark: "#524538",
    roof: "#b8860b", roofDark: "#7a5c08", accent: "#fbbf24", wood: "#4a3a28",
  },
  // Ashtar: pale aqua, smooth domes — peacekeepers.
  ashtar: {
    wall: "#7a9a9a", wallDark: "#4e6565", stone: "#8ab0b0", stoneDark: "#5c7878",
    roof: "#67e8f9", roofDark: "#0e7490", accent: "#22d3ee", wood: "#3a4a48",
  },
  // Watchers: white marble + gold, radiant spires.
  watchers: {
    wall: "#c8c8ce", wallDark: "#8a8a92", stone: "#dcdce2", stoneDark: "#a2a2aa",
    roof: "#fbbf24", roofDark: "#b45309", accent: "#fde68a", wood: "#6a5a48",
  },
  // Grays: gunmetal tech-blocks (theme TBD — minimal tech for now).
  grays: {
    wall: "#4a4a52", wallDark: "#2e2e34", stone: "#55555e", stoneDark: "#38383f",
    roof: "#6b7280", roofDark: "#434a54", accent: "#9ca3af", wood: "#2e2e34",
  },
  // Nephilim: monumental bronze-age stone (theme TBD — heavy for now).
  nephilim: {
    wall: "#6b5a45", wallDark: "#453a2c", stone: "#7d6c55", stoneDark: "#544832",
    roof: "#92400e", roofDark: "#5f2a09", accent: "#d97706", wood: "#4a3a28",
  },
  unknown: {
    wall: "#5a5a5a", wallDark: "#383838", stone: "#656565", stoneDark: "#424242",
    roof: "#787878", roofDark: "#4e4e4e", accent: "#a0a0a0", wood: "#3a322a",
  },
};

function paletteFor(race: string): RacePalette {
  return RACE_PALETTES[race] ?? RACE_PALETTES.unknown;
}

// ---------------------------------------------------------------------------
// Small deterministic hash — per-sprite variation without extra bakes
// ---------------------------------------------------------------------------

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// ---------------------------------------------------------------------------
// Bake helpers
// ---------------------------------------------------------------------------

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.lineJoin = "round";
  g.lineCap = "round";
  return [c, g];
}

/** Soft ground shadow so the settlement sits ON the terrain. */
function groundShadow(g: CanvasRenderingContext2D, s: number, r: number): void {
  const sh = g.createRadialGradient(0, 0, r * 0.4, 0, 0, r);
  sh.addColorStop(0, "rgba(2,6,14,0.42)");
  sh.addColorStop(1, "rgba(2,6,14,0)");
  g.fillStyle = sh;
  g.save();
  g.scale(1, 0.62);
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
  void s;
}

/** A warm light dot with glow — the "alive" read. */
function lightDot(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  dim = false,
): void {
  const glow = g.createRadialGradient(x, y, 0, x, y, r * 3.2);
  const core = dim ? "rgba(251,191,36,0.35)" : "#fde68a";
  glow.addColorStop(0, core);
  glow.addColorStop(0.35, dim ? "rgba(251,191,36,0.18)" : "rgba(251,191,36,0.55)");
  glow.addColorStop(1, "rgba(251,191,36,0)");
  g.fillStyle = glow;
  g.beginPath();
  g.arc(x, y, r * 3.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = core;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** Pitched-roof house: stone body + roof with top-light gradient. */
function house(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  p: RacePalette,
  opts: { roofH?: number; lit?: boolean; dim?: boolean } = {},
): void {
  const roofH = opts.roofH ?? h * 0.55;
  // body
  const bg = g.createLinearGradient(x, y - h, x, y);
  bg.addColorStop(0, p.stone);
  bg.addColorStop(1, p.stoneDark);
  g.fillStyle = bg;
  g.fillRect(x - w / 2, y - h, w, h);
  // roof
  const rg = g.createLinearGradient(x - w / 2, y - h - roofH, x + w / 2, y - h);
  rg.addColorStop(0, p.roof);
  rg.addColorStop(1, p.roofDark);
  g.fillStyle = rg;
  g.beginPath();
  g.moveTo(x - w / 2 - w * 0.08, y - h);
  g.lineTo(x, y - h - roofH);
  g.lineTo(x + w / 2 + w * 0.08, y - h);
  g.closePath();
  g.fill();
  // lit window
  if (opts.lit !== false) {
    lightDot(g, x, y - h * 0.45, Math.max(1.2, w * 0.09), opts.dim);
  }
}

/** Round dome (ashtar / watchers flavor). */
function dome(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  p: RacePalette,
  dim = false,
): void {
  const dg = g.createRadialGradient(x - r * 0.3, y - r * 0.5, r * 0.1, x, y, r);
  dg.addColorStop(0, p.roof);
  dg.addColorStop(1, p.roofDark);
  g.fillStyle = dg;
  g.beginPath();
  g.arc(x, y, r, Math.PI, 0);
  g.fill();
  g.fillStyle = p.stoneDark;
  g.fillRect(x - r, y - r * 0.12, r * 2, r * 0.12);
  lightDot(g, x, y - r * 0.35, r * 0.14, dim);
}

// ---------------------------------------------------------------------------
// FAR — the settlement glyph (readable at 30px)
// ---------------------------------------------------------------------------

function bakeFar(spec: ColonySkinSpec, p: RacePalette, seed: string): HTMLCanvasElement {
  const S = 96;
  const [c, g] = makeCanvas(S);
  g.translate(S / 2, S / 2);
  const u = S / 96;
  const dim = spec.status === "abandoned";
  const ruined = spec.status === "husk";

  groundShadow(g, S, 40 * u);

  if (ruined) {
    // Broken ring + rubble — no lights, the place is dead.
    g.strokeStyle = p.wallDark;
    g.lineWidth = 7 * u;
    for (const [a0, a1] of [[0.2, 1.4], [1.8, 3.0], [3.6, 5.2]] as Array<[number, number]>) {
      g.beginPath();
      g.arc(0, 0, 30 * u, a0, a1);
      g.stroke();
    }
    g.fillStyle = p.stoneDark;
    for (let i = 0; i < 5; i++) {
      const a = hash01(seed + i) * Math.PI * 2;
      const r = 8 + hash01(seed + "r" + i) * 16;
      g.save();
      g.translate(Math.cos(a) * r * u, Math.sin(a) * r * u * 0.7);
      g.rotate(a);
      g.fillRect(-6 * u, -4 * u, 12 * u, 8 * u);
      g.restore();
    }
  } else {
    // Wall ring
    g.strokeStyle = p.wall;
    g.lineWidth = 7 * u;
    g.beginPath();
    g.arc(0, 0, 30 * u, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = p.wallDark;
    g.lineWidth = 2 * u;
    g.beginPath();
    g.arc(0, 0, 30 * u, 0, Math.PI * 2);
    g.stroke();
    // Buildings
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash01(seed) * 0.6;
      const bx = Math.cos(a) * 15 * u;
      const by = Math.sin(a) * 11 * u;
      house(g, bx, by + 4 * u, 13 * u, 12 * u, p, { dim });
    }
    // Central keep
    g.fillStyle = p.stoneDark;
    g.fillRect(-7 * u, -26 * u, 14 * u, 26 * u);
    g.fillStyle = p.roof;
    g.beginPath();
    g.moveTo(-9 * u, -26 * u);
    g.lineTo(0, -36 * u);
    g.lineTo(9 * u, -26 * u);
    g.closePath();
    g.fill();
    // Accent banner
    g.fillStyle = p.accent;
    g.fillRect(-1.5 * u, -34 * u, 3 * u, 10 * u);
    // Lights
    for (let i = 0; i < 5; i++) {
      const a = hash01(seed + "l" + i) * Math.PI * 2;
      lightDot(g, Math.cos(a) * 24 * u, Math.sin(a) * 18 * u, 2.2 * u, dim);
    }
    if (!dim) lightDot(g, 0, -30 * u, 2.6 * u);
  }

  // Home: gold trim ring.
  if (spec.isHome && !ruined) {
    g.strokeStyle = "rgba(251,191,36,0.9)";
    g.lineWidth = 2.5 * u;
    g.beginPath();
    g.arc(0, 0, 36 * u, 0, Math.PI * 2);
    g.stroke();
  }
  return c;
}

// ---------------------------------------------------------------------------
// NEAR — the walled town (readable at 60–150px)
// ---------------------------------------------------------------------------

function bakeNear(spec: ColonySkinSpec, p: RacePalette, seed: string): HTMLCanvasElement {
  const S = 192;
  const [c, g] = makeCanvas(S);
  g.translate(S / 2, S / 2);
  const u = S / 192;
  const dim = spec.status === "abandoned";
  const ruined = spec.status === "husk";

  groundShadow(g, S, 78 * u);

  // Outskirts: fields + tents
  if (!ruined) {
    g.fillStyle = "rgba(74,124,60,0.5)";
    for (let i = 0; i < 3; i++) {
      const a = 2.4 + i * 0.5 + hash01(seed + "f" + i) * 0.3;
      g.save();
      g.translate(Math.cos(a) * 82 * u, Math.sin(a) * 58 * u);
      g.rotate(a + 0.4);
      g.fillRect(-14 * u, -9 * u, 28 * u, 18 * u);
      g.restore();
    }
  }

  if (ruined) {
    // Ruined town: broken wall stubs, rubble, no lights.
    g.strokeStyle = p.wallDark;
    g.lineWidth = 10 * u;
    const sides = 8;
    for (let i = 0; i < sides; i++) {
      if (hash01(seed + "w" + i) < 0.45) continue; // gap
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 0.7) / sides) * Math.PI * 2;
      g.beginPath();
      g.ellipse(0, 0, 62 * u, 46 * u, 0, a0, a1);
      g.stroke();
    }
    g.fillStyle = p.stoneDark;
    for (let i = 0; i < 9; i++) {
      const a = hash01(seed + "r" + i) * Math.PI * 2;
      const rr = 10 + hash01(seed + "rr" + i) * 34;
      g.save();
      g.translate(Math.cos(a) * rr * u, Math.sin(a) * rr * u * 0.7);
      g.rotate(a * 2);
      const s = (6 + hash01(seed + "s" + i) * 8) * u;
      g.fillRect(-s / 2, -s / 3, s, s * 0.66);
      g.restore();
    }
  } else {
    // Octagonal wall with corner towers
    g.strokeStyle = p.wall;
    g.lineWidth = 10 * u;
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * 62 * u;
      const y = Math.sin(a) * 46 * u;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.stroke();
    // Towers
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const tx = Math.cos(a) * 58 * u;
      const ty = Math.sin(a) * 43 * u;
      g.fillStyle = p.wallDark;
      g.fillRect(tx - 7 * u, ty - 12 * u, 14 * u, 18 * u);
      g.fillStyle = p.roofDark;
      g.beginPath();
      g.moveTo(tx - 8 * u, ty - 12 * u);
      g.lineTo(tx, ty - 20 * u);
      g.lineTo(tx + 8 * u, ty - 12 * u);
      g.closePath();
      g.fill();
      if (!dim) lightDot(g, tx, ty - 4 * u, 2 * u, dim);
    }
    // Gate (south)
    g.fillStyle = "#0a0d18";
    g.fillRect(-9 * u, 38 * u, 18 * u, 12 * u);
    // Streets
    g.strokeStyle = "rgba(120,100,80,0.6)";
    g.lineWidth = 3 * u;
    g.beginPath();
    g.moveTo(0, 44 * u);
    g.lineTo(0, 0);
    g.moveTo(-50 * u, 0);
    g.lineTo(50 * u, 0);
    g.stroke();
    // Buildings ring
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + hash01(seed + "b") * 0.5;
      const bx = Math.cos(a) * 34 * u;
      const by = Math.sin(a) * 25 * u;
      const bw = (14 + hash01(seed + "bw" + i) * 8) * u;
      const bh = (12 + hash01(seed + "bh" + i) * 8) * u;
      if (spec.race === "ashtar" && i % 3 === 0) {
        dome(g, bx, by + bh * 0.4, bw * 0.55, p, dim);
      } else {
        house(g, bx, by + bh * 0.3, bw, bh, p, { dim });
      }
    }
    // Central citadel — race architecture
    citadel(g, 0, 6 * u, 34 * u, p, spec.race, dim);
    // Wall lights
    if (!dim) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        lightDot(g, Math.cos(a) * 62 * u, Math.sin(a) * 46 * u, 2 * u);
      }
    }
  }

  if (spec.isHome && !ruined) {
    g.strokeStyle = "rgba(251,191,36,0.85)";
    g.lineWidth = 3 * u;
    g.beginPath();
    g.ellipse(0, 0, 74 * u, 56 * u, 0, 0, Math.PI * 2);
    g.stroke();
  }
  return c;
}

/** The race-distinct centerpiece. x,y = base center, s = width. */
function citadel(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  p: RacePalette,
  race: string,
  dim: boolean,
): void {
  const u = s / 34;
  if (race === "anunnaki") {
    // Stepped ziggurat
    for (let i = 0; i < 3; i++) {
      const w = (30 - i * 8) * u;
      const h = 9 * u;
      const yy = y - i * h;
      const bg = g.createLinearGradient(x, yy - h, x, yy);
      bg.addColorStop(0, p.stone);
      bg.addColorStop(1, p.stoneDark);
      g.fillStyle = bg;
      g.fillRect(x - w / 2, yy - h, w, h);
    }
    g.fillStyle = p.accent;
    g.fillRect(x - 3 * u, y - 33 * u, 6 * u, 8 * u);
    lightDot(g, x, y - 36 * u, 2.4 * u, dim);
  } else if (race === "ashtar") {
    // Great dome
    dome(g, x, y, 16 * u, p, dim);
    g.fillStyle = p.accent;
    g.fillRect(x - 1.5 * u, y - 32 * u, 3 * u, 16 * u);
    lightDot(g, x, y - 33 * u, 2.4 * u, dim);
  } else if (race === "watchers") {
    // Radiant spire
    const sg = g.createLinearGradient(x, y - 40 * u, x, y);
    sg.addColorStop(0, "#ffffff");
    sg.addColorStop(1, p.stoneDark);
    g.fillStyle = sg;
    g.beginPath();
    g.moveTo(x - 8 * u, y);
    g.lineTo(x, y - 40 * u);
    g.lineTo(x + 8 * u, y);
    g.closePath();
    g.fill();
    g.fillStyle = p.accent;
    g.beginPath();
    g.arc(x, y - 40 * u, 3.5 * u, 0, Math.PI * 2);
    g.fill();
    if (!dim) {
      const halo = g.createRadialGradient(x, y - 40 * u, 0, x, y - 40 * u, 14 * u);
      halo.addColorStop(0, "rgba(253,230,138,0.7)");
      halo.addColorStop(1, "rgba(253,230,138,0)");
      g.fillStyle = halo;
      g.beginPath();
      g.arc(x, y - 40 * u, 14 * u, 0, Math.PI * 2);
      g.fill();
    }
  } else if (race === "draconians") {
    // Dark keep with war-spikes
    g.fillStyle = p.stoneDark;
    g.fillRect(x - 10 * u, y - 30 * u, 20 * u, 30 * u);
    g.fillStyle = p.roofDark;
    for (const sx of [-8, 0, 8]) {
      g.beginPath();
      g.moveTo(x + sx * u - 4 * u, y - 30 * u);
      g.lineTo(x + sx * u, y - 42 * u);
      g.lineTo(x + sx * u + 4 * u, y - 30 * u);
      g.closePath();
      g.fill();
    }
    g.fillStyle = p.accent;
    g.fillRect(x - 2 * u, y - 40 * u, 4 * u, 12 * u);
    lightDot(g, x, y - 14 * u, 2.6 * u, dim);
  } else {
    // Stout tower keep (grays / nephilim / unknown)
    const bg = g.createLinearGradient(x, y - 34 * u, x, y);
    bg.addColorStop(0, p.stone);
    bg.addColorStop(1, p.stoneDark);
    g.fillStyle = bg;
    g.fillRect(x - 11 * u, y - 34 * u, 22 * u, 34 * u);
    // Crenellations
    g.fillStyle = p.stoneDark;
    for (let i = 0; i < 4; i++) {
      g.fillRect(x - 11 * u + i * 6 * u, y - 39 * u, 4 * u, 5 * u);
    }
    g.fillStyle = p.roof;
    g.beginPath();
    g.moveTo(x - 12 * u, y - 34 * u);
    g.lineTo(x, y - 44 * u);
    g.lineTo(x + 12 * u, y - 34 * u);
    g.closePath();
    g.fill();
    lightDot(g, x, y - 16 * u, 2.6 * u, dim);
  }
}

// ---------------------------------------------------------------------------
// GROUND — the living town (readable at 150px+)
// ---------------------------------------------------------------------------

function bakeGround(spec: ColonySkinSpec, p: RacePalette, seed: string): HTMLCanvasElement {
  const S = 384;
  const [c, g] = makeCanvas(S);
  g.translate(S / 2, S / 2);
  const u = S / 384;
  const dim = spec.status === "abandoned";
  const ruined = spec.status === "husk";

  groundShadow(g, S, 150 * u);

  // Far outskirts: farms, trees, tents, roads
  if (!ruined) {
    // Farm plots
    for (let i = 0; i < 6; i++) {
      const a = hash01(seed + "farm" + i) * Math.PI * 2;
      const rr = 130 + hash01(seed + "fr" + i) * 40;
      g.save();
      g.translate(Math.cos(a) * rr * u, Math.sin(a) * rr * u * 0.72);
      g.rotate(a);
      g.fillStyle = i % 2 ? "rgba(74,124,60,0.55)" : "rgba(120,140,70,0.5)";
      g.fillRect(-22 * u, -14 * u, 44 * u, 28 * u);
      g.strokeStyle = "rgba(60,80,40,0.6)";
      g.lineWidth = 1.5 * u;
      for (let r = -2; r <= 2; r++) {
        g.beginPath();
        g.moveTo(-22 * u, r * 5.5 * u);
        g.lineTo(22 * u, r * 5.5 * u);
        g.stroke();
      }
      g.restore();
    }
    // Trees
    for (let i = 0; i < 10; i++) {
      const a = hash01(seed + "tree" + i) * Math.PI * 2;
      const rr = 115 + hash01(seed + "tr" + i) * 55;
      const tx = Math.cos(a) * rr * u;
      const ty = Math.sin(a) * rr * u * 0.72;
      g.fillStyle = "#2d4a24";
      g.beginPath();
      g.arc(tx, ty - 6 * u, 7 * u, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#3d6a34";
      g.beginPath();
      g.arc(tx - 2 * u, ty - 8 * u, 4.5 * u, 0, Math.PI * 2);
      g.fill();
    }
    // Roads leading out
    g.strokeStyle = "rgba(140,120,95,0.55)";
    g.lineWidth = 5 * u;
    for (const a of [0.5, 2.6, 4.4]) {
      g.beginPath();
      g.moveTo(Math.cos(a) * 95 * u, Math.sin(a) * 68 * u);
      g.quadraticCurveTo(
        Math.cos(a + 0.2) * 140 * u, Math.sin(a + 0.2) * 100 * u,
        Math.cos(a + 0.1) * 185 * u, Math.sin(a + 0.1) * 130 * u,
      );
      g.stroke();
    }
  }

  if (ruined) {
    // Rubble field with broken wall ring
    g.strokeStyle = p.wallDark;
    g.lineWidth = 14 * u;
    for (let i = 0; i < 10; i++) {
      if (hash01(seed + "rw" + i) < 0.5) continue;
      const a0 = (i / 10) * Math.PI * 2;
      const a1 = ((i + 0.65) / 10) * Math.PI * 2;
      g.beginPath();
      g.ellipse(0, 0, 110 * u, 82 * u, 0, a0, a1);
      g.stroke();
    }
    g.fillStyle = p.stoneDark;
    for (let i = 0; i < 16; i++) {
      const a = hash01(seed + "rr" + i) * Math.PI * 2;
      const rr = 15 + hash01(seed + "rrr" + i) * 80;
      g.save();
      g.translate(Math.cos(a) * rr * u, Math.sin(a) * rr * u * 0.72);
      g.rotate(a * 3);
      const s = (10 + hash01(seed + "rs" + i) * 16) * u;
      g.globalAlpha = 0.85;
      g.fillRect(-s / 2, -s / 3, s, s * 0.66);
      g.globalAlpha = 1;
      g.restore();
    }
  } else {
    // City wall — crenellated ring
    g.strokeStyle = p.wall;
    g.lineWidth = 13 * u;
    g.beginPath();
    g.ellipse(0, 0, 108 * u, 80 * u, 0, 0, Math.PI * 2);
    g.stroke();
    // Crenellations
    g.fillStyle = p.wallDark;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      g.save();
      g.translate(Math.cos(a) * 108 * u, Math.sin(a) * 80 * u);
      g.rotate(a);
      g.fillRect(-3 * u, -11 * u, 6 * u, 7 * u);
      g.restore();
    }
    // Gate towers (south)
    for (const gx of [-16, 16]) {
      g.fillStyle = p.wallDark;
      g.fillRect((gx - 8) * u, 66 * u, 16 * u, 26 * u);
      g.fillStyle = p.roofDark;
      g.beginPath();
      g.moveTo((gx - 9) * u, 66 * u);
      g.lineTo(gx * u, 54 * u);
      g.lineTo((gx + 9) * u, 66 * u);
      g.closePath();
      g.fill();
    }
    g.fillStyle = "#0a0d18";
    g.fillRect(-9 * u, 70 * u, 18 * u, 16 * u);

    // Winding streets
    g.strokeStyle = "rgba(130,110,88,0.65)";
    g.lineWidth = 4 * u;
    g.beginPath();
    g.moveTo(0, 78 * u);
    g.quadraticCurveTo(12 * u, 30 * u, -6 * u, 0);
    g.quadraticCurveTo(-18 * u, -24 * u, 0, -10 * u);
    g.stroke();
    g.beginPath();
    g.moveTo(-88 * u, 6 * u);
    g.quadraticCurveTo(-30 * u, 12 * u, 0, 2 * u);
    g.quadraticCurveTo(40 * u, -8 * u, 88 * u, 2 * u);
    g.stroke();

    // Building blocks — two rings
    const blocks: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + hash01(seed + "gb") * 0.4;
      blocks.push([
        Math.cos(a) * (58 + hash01(seed + "gd" + i) * 14) * u,
        Math.sin(a) * (42 + hash01(seed + "ge" + i) * 10) * u,
        (20 + hash01(seed + "gw" + i) * 12) * u,
        (16 + hash01(seed + "gh" + i) * 10) * u,
      ]);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.5 + hash01(seed + "gi") * 0.4;
      blocks.push([
        Math.cos(a) * 30 * u,
        Math.sin(a) * 22 * u,
        (16 + hash01(seed + "gj" + i) * 8) * u,
        (14 + hash01(seed + "gk" + i) * 8) * u,
      ]);
    }
    for (const [bx, by, bw, bh] of blocks) {
      if (Math.hypot(bx, by) < 26 * u) continue; // keep the plaza clear
      if (spec.race === "ashtar" && hash01(seed + bx + "," + by) < 0.3) {
        dome(g, bx, by + bh * 0.3, bw * 0.5, p, dim);
      } else {
        house(g, bx, by + bh * 0.25, bw, bh, p, { dim });
      }
      // Chimney smoke
      if (!dim && hash01(seed + "sm" + bx) < 0.4) {
        g.strokeStyle = "rgba(200,200,200,0.35)";
        g.lineWidth = 2.5 * u;
        g.beginPath();
        g.moveTo(bx + bw * 0.2, by - bh * 0.7);
        g.quadraticCurveTo(
          bx + bw * 0.2 + 6 * u, by - bh * 0.7 - 12 * u,
          bx + bw * 0.2 - 2 * u, by - bh * 0.7 - 22 * u,
        );
        g.stroke();
      }
    }

    // Central plaza + citadel
    g.fillStyle = "rgba(150,130,105,0.5)";
    g.beginPath();
    g.ellipse(0, 2 * u, 34 * u, 24 * u, 0, 0, Math.PI * 2);
    g.fill();
    citadel(g, 0, 8 * u, 52 * u, p, spec.race, dim);

    // Lantern posts along streets
    if (!dim) {
      for (let i = 0; i < 8; i++) {
        const t = i / 8;
        const lx = -80 * u + t * 160 * u;
        const ly = 4 * u + Math.sin(t * 5) * 8 * u;
        g.strokeStyle = p.wood;
        g.lineWidth = 2 * u;
        g.beginPath();
        g.moveTo(lx, ly);
        g.lineTo(lx, ly - 10 * u);
        g.stroke();
        lightDot(g, lx, ly - 12 * u, 2.2 * u);
      }
    }
  }

  if (spec.isHome && !ruined) {
    g.strokeStyle = "rgba(251,191,36,0.8)";
    g.lineWidth = 4 * u;
    g.beginPath();
    g.ellipse(0, 0, 128 * u, 96 * u, 0, 0, Math.PI * 2);
    g.stroke();
  }
  return c;
}

// ---------------------------------------------------------------------------
// Cache + entry
// ---------------------------------------------------------------------------

const LOD_SIZE: Record<ColonySkinLOD, number> = { far: 96, near: 192, ground: 384 };

const skinCache = new Map<string, HTMLCanvasElement>();

function skinKey(spec: ColonySkinSpec): string {
  return `${spec.race}|${spec.status}|${spec.isHome ? "home" : "away"}|${spec.lod}`;
}

/** Pre-baked colony skin sprite. Cached — the frame loop just blits. */
export function colonySkinSprite(spec: ColonySkinSpec): HTMLCanvasElement {
  const key = skinKey(spec);
  let c = skinCache.get(key);
  if (!c) {
    const p = paletteFor(spec.race);
    const seed = key;
    c =
      spec.lod === "far"
        ? bakeFar(spec, p, seed)
        : spec.lod === "near"
          ? bakeNear(spec, p, seed)
          : bakeGround(spec, p, seed);
    skinCache.set(key, c);
  }
  return c;
}

/** Bake size for a LOD (square canvas). */
export function colonySkinSize(lod: ColonySkinLOD): number {
  return LOD_SIZE[lod];
}

/** Clear the sprite cache (tests). */
export function clearColonySkinCache(): void {
  skinCache.clear();
}
