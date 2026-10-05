import { useCallback, useEffect, useRef, useState } from "react";
import { KNOWN_SERVERS, type KnownServer } from "../game/servers";
import { getRace } from "../game/races";
import { useT } from "./i18n/I18n";
import {
  playClick,
  playHover,
  playSelect,
  playDeselect,
  playConfirm,
  playDenied,
  playWhoosh,
  playEntrance,
} from "../game/audio/ui-sounds";
import { startMusic, stopMusic } from "../game/audio/starmap-music";
import { sound } from "../game/sound";

type ServerHealth = "checking" | "up" | "down";

interface PlanetDatum {
  server: KnownServer;
  health: ServerHealth;
  playerCount?: number;
  reverb?: number;
  angle: number;
  orbitRadius: number; // base orbit radius in world units
  size: number; // planet radius in world units
  visual: PlanetVisual;
  orbitSpeed: number; // radians per second
  texture: HTMLCanvasElement | null; // pre-rendered surface
  lights: HTMLCanvasElement | null; // pre-rendered night-side city lights
  texAngle: number; // surface rotation
  texSpin: number; // surface rotation speed
}

const HERO_PORTRAIT: Record<string, string> = {
  draconians: "/art/heroes/hero-kaaroth.webp",
  watchers: "/art/heroes/hero-seraphel.webp",
  grays: "/art/heroes/hero-ilyra-voss.webp",
  ashtar: "/art/heroes/hero-mira-solenne.webp",
  anunnaki: "/art/heroes/hero-ensharra.webp",
  nephilim: "/art/heroes/hero-garruk-stonebrow.webp",
};

type PlanetStyle = "volcanic" | "ethereal" | "frozen" | "luminous" | "gilded" | "rocky";

interface PlanetRings {
  inner: number; // multiple of planet radius
  outer: number;
  tilt: number; // radians
  color: string;
  alpha: number;
}

interface PlanetVisual {
  style: PlanetStyle;
  base: string;
  dark: string;
  light: string;
  accent: string; // lava, ice veins, gold veins…
  atmosphere: string; // halo color
  glow: string; // outer glow tint
  bands: boolean; // horizontal cloud bands
  rings?: PlanetRings;
}

/** Each race's world, rendered majestic. */
const PLANET_VISUAL: Record<string, PlanetVisual> = {
  draconians: {
    style: "volcanic", base: "#5a1a10", dark: "#160604", light: "#ff7a3a",
    accent: "#ffb347", atmosphere: "#ff5a2a", glow: "#ff4a1a", bands: false,
  },
  watchers: {
    style: "ethereal", base: "#cfc0f0", dark: "#4a3a7a", light: "#ffffff",
    accent: "#ffd700", atmosphere: "#c9a4ff", glow: "#b48cff", bands: true,
  },
  grays: {
    style: "frozen", base: "#6aa8cc", dark: "#16283e", light: "#eaf6ff",
    accent: "#ffffff", atmosphere: "#9ad7e6", glow: "#5aa8e6", bands: false,
    rings: { inner: 1.35, outer: 2.1, tilt: -0.35, color: "#bfe8ff", alpha: 0.35 },
  },
  ashtar: {
    style: "luminous", base: "#e8b84a", dark: "#6a4212", light: "#fff6da",
    accent: "#ffffff", atmosphere: "#ffd166", glow: "#ffcc44", bands: true,
  },
  anunnaki: {
    style: "gilded", base: "#b8944e", dark: "#4a2e12", light: "#f6e6ba",
    accent: "#ffe4a0", atmosphere: "#e8d9b2", glow: "#d4a84a", bands: false,
    rings: { inner: 1.3, outer: 1.9, tilt: 0.42, color: "#f4d88a", alpha: 0.5 },
  },
  nephilim: {
    style: "rocky", base: "#7a4e32", dark: "#2e1c12", light: "#d4a878",
    accent: "#ff8a4a", atmosphere: "#c96f3f", glow: "#a85a2a", bands: false,
  },
};

const HEALTH_TIMEOUT_MS = 5000;
const STATUS_COLOR: Record<ServerHealth, string> = {
  checking: "#9ca3af",
  up: "#4ade80",
  down: "#f87171",
};

async function checkHealth(server: KnownServer): Promise<{ health: ServerHealth; playerCount?: number; reverb?: number }> {
  if (server.status === "soon" || !server.url) return { health: "down" };
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${server.url}/api/health`, { signal: ctrl.signal });
    if (!res.ok) return { health: "down" };
    const data = await res.json();
    if (data.status !== "up") return { health: "down" };
    return {
      health: "up",
      playerCount: typeof data.playerCount === "number" ? data.playerCount : undefined,
      reverb: typeof data.reverb === "number" ? data.reverb : undefined,
    };
  } catch {
    return { health: "down" };
  } finally {
    clearTimeout(timeout);
  }
}

interface Star {
  x: number; // 0..1 normalized
  y: number;
  r: number;
  tw: number; // twinkle phase
  ts: number; // twinkle speed
  color: string;
}

const STAR_COLORS = ["#cfe4ff", "#ffffff", "#ffe4c4", "#c4d8ff", "#ffc4c4"];

function makeStars(n: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < n; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      r: 0.4 + Math.random() * 1.6,
      tw: Math.random() * Math.PI * 2,
      ts: 0.5 + Math.random() * 2,
      color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
    });
  }
  return stars;
}

/** Draw a planet's ring system — back half (behind planet) or front half. */
function drawRings(
  g: CanvasRenderingContext2D,
  px: number, py: number, pr: number,
  rings: PlanetRings,
  front: boolean,
): void {
  const [rr, rg, rb] = hexToRgb(rings.color);
  g.save();
  g.translate(px, py);
  g.rotate(rings.tilt);
  // elliptical rings: draw several concentric strokes
  const steps = 7;
  for (let i = 0; i < steps; i++) {
    const rr_ = pr * (rings.inner + ((rings.outer - rings.inner) * i) / (steps - 1));
    const alpha = rings.alpha * (0.35 + 0.65 * (i / (steps - 1)));
    g.strokeStyle = `rgba(${rr},${rg},${rb},${alpha})`;
    g.lineWidth = Math.max(1, pr * 0.045);
    g.beginPath();
    // front half = lower arc, back half = upper arc
    g.ellipse(0, 0, rr_, rr_ * 0.32, 0, front ? 0.08 : Math.PI + 0.08, front ? Math.PI - 0.08 : Math.PI * 2 - 0.08);
    g.stroke();
  }
  g.restore();
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

const TEX = 256;

/**
 * Pre-render a planet's surface once (offscreen) — noise, cracks, craters,
 * clouds, bands. Drawn every frame as a cheap drawImage with a lighting
 * overlay, so per-frame cost stays tiny.
 */
function makePlanetTexture(v: PlanetVisual): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TEX;
  c.height = TEX;
  const g = c.getContext("2d");
  if (!g) return c;
  const S = TEX;
  const R = S / 2;

  // base sphere
  const base = g.createRadialGradient(S * 0.38, S * 0.34, S * 0.04, S * 0.5, S * 0.5, S * 0.62);
  base.addColorStop(0, v.light);
  base.addColorStop(0.45, v.base);
  base.addColorStop(1, v.dark);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);

  g.save();
  g.beginPath();
  g.arc(R, R, R, 0, Math.PI * 2);
  g.clip();

  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

  // --- generic mottling ---
  for (let i = 0; i < 90; i++) {
    const x = rnd(0, S), y = rnd(0, S), r = rnd(4, 26);
    g.fillStyle = Math.random() < 0.5 ? rgba(v.dark, rnd(0.08, 0.22)) : rgba(v.light, rnd(0.05, 0.14));
    g.beginPath();
    g.ellipse(x, y, r, r * rnd(0.5, 1), rnd(0, Math.PI), 0, Math.PI * 2);
    g.fill();
  }

  // --- cloud bands ---
  if (v.bands) {
    for (let i = 0; i < 6; i++) {
      const y = (S / 6) * i + rnd(-8, 8);
      const grd = g.createLinearGradient(0, y - 14, 0, y + 14);
      grd.addColorStop(0, rgba(v.light, 0));
      grd.addColorStop(0.5, rgba(v.light, rnd(0.18, 0.32)));
      grd.addColorStop(1, rgba(v.light, 0));
      g.fillStyle = grd;
      // wavy band
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i * 2) * 7);
      for (let x = S; x >= 0; x -= 16) g.lineTo(x, y + 16 + Math.sin(x * 0.05 + i * 2) * 7);
      g.closePath();
      g.fill();
    }
  }

  // --- style-specific surface ---
  if (v.style === "volcanic") {
    // basalt plates
    for (let i = 0; i < 26; i++) {
      g.fillStyle = rgba("#0a0302", rnd(0.25, 0.5));
      g.beginPath();
      g.ellipse(rnd(0, S), rnd(0, S), rnd(10, 34), rnd(8, 24), rnd(0, Math.PI), 0, Math.PI * 2);
      g.fill();
    }
    // glowing lava cracks — jagged random walks
    for (let i = 0; i < 14; i++) {
      let x = rnd(0, S), y = rnd(0, S);
      g.strokeStyle = rgba(v.accent, rnd(0.5, 0.9));
      g.lineWidth = rnd(1.5, 3.5);
      g.shadowColor = v.accent;
      g.shadowBlur = 12;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 9; s++) {
        x += rnd(-26, 26); y += rnd(-26, 26);
        g.lineTo(x, y);
      }
      g.stroke();
      g.shadowBlur = 0;
    }
    // embers
    for (let i = 0; i < 40; i++) {
      g.fillStyle = rgba(v.accent, rnd(0.4, 0.95));
      g.beginPath();
      g.arc(rnd(0, S), rnd(0, S), rnd(1, 3), 0, Math.PI * 2);
      g.fill();
    }
  } else if (v.style === "ethereal") {
    // radiant wisps
    for (let i = 0; i < 22; i++) {
      const x = rnd(0, S), y = rnd(0, S), r = rnd(18, 46);
      const wg = g.createRadialGradient(x, y, 0, x, y, r);
      wg.addColorStop(0, rgba("#ffffff", rnd(0.2, 0.4)));
      wg.addColorStop(1, rgba("#ffffff", 0));
      g.fillStyle = wg;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // gold sparkles
    for (let i = 0; i < 36; i++) {
      g.fillStyle = rgba(v.accent, rnd(0.5, 1));
      const x = rnd(0, S), y = rnd(0, S), r = rnd(0.8, 2.2);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  } else if (v.style === "frozen") {
    // polar caps
    const cap = g.createLinearGradient(0, 0, 0, S * 0.3);
    cap.addColorStop(0, rgba("#ffffff", 0.85));
    cap.addColorStop(1, rgba("#ffffff", 0));
    g.fillStyle = cap;
    g.fillRect(0, 0, S, S * 0.3);
    const cap2 = g.createLinearGradient(0, S, 0, S * 0.7);
    cap2.addColorStop(0, rgba("#ffffff", 0.7));
    cap2.addColorStop(1, rgba("#ffffff", 0));
    g.fillStyle = cap2;
    g.fillRect(0, S * 0.7, S, S * 0.3);
    // ice cracks
    for (let i = 0; i < 18; i++) {
      let x = rnd(0, S), y = rnd(0, S);
      g.strokeStyle = rgba("#ffffff", rnd(0.3, 0.6));
      g.lineWidth = rnd(0.8, 1.6);
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += rnd(-20, 20); y += rnd(-20, 20);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // ice floes
    for (let i = 0; i < 24; i++) {
      g.fillStyle = rgba("#eaf6ff", rnd(0.2, 0.45));
      g.beginPath();
      g.ellipse(rnd(0, S), rnd(0, S), rnd(6, 20), rnd(4, 12), rnd(0, Math.PI), 0, Math.PI * 2);
      g.fill();
    }
  } else if (v.style === "luminous") {
    // bright storm swirls
    for (let i = 0; i < 16; i++) {
      const x = rnd(0, S), y = rnd(0, S), r = rnd(14, 36);
      const sg = g.createRadialGradient(x, y, 0, x, y, r);
      sg.addColorStop(0, rgba("#ffffff", rnd(0.3, 0.55)));
      sg.addColorStop(0.6, rgba(v.light, 0.2));
      sg.addColorStop(1, rgba(v.light, 0));
      g.fillStyle = sg;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  } else if (v.style === "gilded") {
    // ancient geometric arcs
    for (let i = 0; i < 12; i++) {
      g.strokeStyle = rgba(v.accent, rnd(0.25, 0.5));
      g.lineWidth = rnd(1, 2.5);
      g.beginPath();
      g.arc(rnd(0, S), rnd(0, S), rnd(20, 70), rnd(0, Math.PI * 2), rnd(0, Math.PI * 2) + rnd(0.5, 2));
      g.stroke();
    }
    // gold veins
    for (let i = 0; i < 16; i++) {
      let x = rnd(0, S), y = rnd(0, S);
      g.strokeStyle = rgba("#fff2c8", rnd(0.4, 0.75));
      g.lineWidth = rnd(1, 2);
      g.shadowColor = "#ffe4a0";
      g.shadowBlur = 6;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 7; s++) {
        x += rnd(-22, 22); y += rnd(-22, 22);
        g.lineTo(x, y);
      }
      g.stroke();
      g.shadowBlur = 0;
    }
  } else if (v.style === "rocky") {
    // craters
    for (let i = 0; i < 30; i++) {
      const x = rnd(0, S), y = rnd(0, S), r = rnd(4, 18);
      g.fillStyle = rgba(v.dark, rnd(0.35, 0.6));
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = rgba(v.light, 0.4);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    }
    // ridges
    for (let i = 0; i < 14; i++) {
      let x = rnd(0, S), y = rnd(0, S);
      g.strokeStyle = rgba(v.dark, rnd(0.3, 0.55));
      g.lineWidth = rnd(2, 4);
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 5; s++) {
        x += rnd(-30, 30); y += rnd(-14, 14);
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  g.restore();

  // limb darkening — round the texture into a sphere edge
  const limb = g.createRadialGradient(R, R, R * 0.72, R, R, R);
  limb.addColorStop(0, "rgba(0,0,0,0)");
  limb.addColorStop(1, "rgba(0,0,0,0.38)");
  g.fillStyle = limb;
  g.beginPath();
  g.arc(R, R, R, 0, Math.PI * 2);
  g.fill();

  return c;
}

/** Pre-render night-side city lights — warm clusters that glow on the dark limb. */
function makeCityLights(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TEX;
  c.height = TEX;
  const g = c.getContext("2d");
  if (!g) return c;
  const S = TEX;
  const R = S / 2;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath();
  g.arc(R, R, R, 0, Math.PI * 2);
  g.clip();

  // clustered settlements — brighter near "temperate" bands
  const clusters = 14 + Math.floor(Math.random() * 8);
  for (let i = 0; i < clusters; i++) {
    const cx = rnd(S * 0.15, S * 0.85);
    // bias toward middle latitudes
    const cy = R + rnd(-1, 1) * rnd(0, S * 0.32);
    const n = Math.floor(rnd(12, 42));
    const spread = rnd(8, 30);
    for (let j = 0; j < n; j++) {
      const x = cx + rnd(-spread, spread);
      const y = cy + rnd(-spread * 0.7, spread * 0.7);
      const r = rnd(0.7, 2.1);
      const warm = Math.random() < 0.75;
      g.fillStyle = warm ? `rgba(255,${Math.floor(rnd(170, 210))},110,${rnd(0.5, 0.95)})`
                         : `rgba(170,220,255,${rnd(0.4, 0.8)})`;
      g.shadowColor = warm ? "#ffbe5a" : "#9ad7e6";
      g.shadowBlur = 4;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.shadowBlur = 0;

  // connective threads — trade routes glowing faintly
  for (let i = 0; i < 8; i++) {
    g.strokeStyle = `rgba(255,190,120,${rnd(0.12, 0.3)})`;
    g.lineWidth = rnd(0.8, 1.6);
    g.shadowColor = "#ffbe5a";
    g.shadowBlur = 3;
    let x = rnd(0, S), y = rnd(S * 0.2, S * 0.8);
    g.beginPath();
    g.moveTo(x, y);
    for (let sgm = 0; sgm < 5; sgm++) {
      x += rnd(-40, 40); y += rnd(-24, 24);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.shadowBlur = 0;
  g.restore();
  return c;
}

/** Pre-render nebula wisps + vignette to an offscreen canvas (redrawn on resize). */
function makeBackground(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const g = c.getContext("2d");
  if (!g) return c;

  g.fillStyle = "#030509";
  g.fillRect(0, 0, w, h);

  // nebula wisps — deep, vast, subtle
  const nebulae: Array<[number, number, number, string, number]> = [
    [0.22, 0.3, 0.42, "#3a1a5e", 0.5],   // violet
    [0.78, 0.62, 0.48, "#1a2a5e", 0.45],  // deep blue
    [0.6, 0.18, 0.36, "#5e1a2a", 0.35],   // ember red
    [0.15, 0.82, 0.4, "#0e3a4a", 0.4],    // teal
    [0.88, 0.28, 0.3, "#2a1a4e", 0.4],    // indigo
  ];
  for (const [nx, ny, nr, color, alpha] of nebulae) {
    const x = nx * w, y = ny * h, r = nr * Math.max(w, h);
    // layered blobs for wispiness
    for (let i = 0; i < 5; i++) {
      const ox = x + (Math.random() - 0.5) * r * 0.7;
      const oy = y + (Math.random() - 0.5) * r * 0.7;
      const or_ = r * (0.4 + Math.random() * 0.5);
      const ng = g.createRadialGradient(ox, oy, 0, ox, oy, or_);
      ng.addColorStop(0, rgba(color, alpha * 0.5));
      ng.addColorStop(1, rgba(color, 0));
      g.fillStyle = ng;
      g.beginPath();
      g.arc(ox, oy, or_, 0, Math.PI * 2);
      g.fill();
    }
  }

  // faint static star dust
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(200,220,255,${0.04 + Math.random() * 0.1})`;
    g.beginPath();
    g.arc(Math.random() * w, Math.random() * h, Math.random() * 1.1, 0, Math.PI * 2);
    g.fill();
  }

  // vignette — vast darkness at the edges
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);

  return c;
}

/**
 * Interactive star map — the server/race select. A sealed star system with
 * six worlds orbiting a central star. Drag to spin, scroll/pinch to zoom,
 * tap a planet to inspect its world and claim a colony there.
 *
 * Canvas 2D for mobile-friendliness. All SFX synthesized via Web Audio.
 */
export default function StarMap({ onSelect }: { onSelect: (server: KnownServer) => void }) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [planets, setPlanets] = useState<PlanetDatum[]>(() =>
    KNOWN_SERVERS.map((server, i) => ({
      server,
      health: "checking" as ServerHealth,
      angle: (i / KNOWN_SERVERS.length) * Math.PI * 2,
      orbitRadius: 170 + i * 52,
      size: 20 + ((i * 7) % 11),
      visual: PLANET_VISUAL[server.raceId] ?? PLANET_VISUAL.watchers,
      orbitSpeed: 0.045 - i * 0.005,
      texture: null,
      lights: null,
      texAngle: Math.random() * Math.PI * 2,
      texSpin: 0.02 + Math.random() * 0.03,
    })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [muted, setMuted] = useState(sound.muted);
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Mutable render state (not React state — updated every frame)
  const view = useRef({ rotation: 0, scale: 1, targetScale: 1, cx: 0, cy: 0, tScale: 1 });
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; moved: boolean; lastT: number; vel: number } | null>(null);
  const planetsRef = useRef(planets);
  planetsRef.current = planets;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const hoverRef = useRef(hoverId);
  hoverRef.current = hoverId;
  const starsRef = useRef<Star[]>([]);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const meteorsRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; life: number; maxLife: number }>>([]);
  const reducedMotion = useRef(false);
  const pinch = useRef<{ d: number } | null>(null);

  if (starsRef.current.length === 0) starsRef.current = makeStars(260);

  // Health checks on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        KNOWN_SERVERS.map(async (server) => {
          const { health, playerCount, reverb } = await checkHealth(server);
          return { server, health, playerCount, reverb };
        }),
      );
      if (cancelled) return;
      setPlanets((prev) =>
        prev.map((p) => {
          const r = results.find((x) => x.server.id === p.server.id);
          return r ? { ...p, health: r.health, playerCount: r.playerCount, reverb: r.reverb } : p;
        }),
      );
    })();
    return () => { cancelled = true; };
  }, []);

  // Music + grand entrance: start on mount (a user gesture — signup — already
  // happened), stop on unmount
  useEffect(() => {
    reducedMotion.current =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    startMusic();
    // "You have arrived." — delayed a beat so the map is visible first
    const entrance = setTimeout(() => playEntrance(), 600);
    return () => {
      clearTimeout(entrance);
      stopMusic();
    };
  }, []);

  // Pre-render planet surface textures + city lights once
  useEffect(() => {
    setPlanets((prev) =>
      prev.map((p) =>
        p.texture
          ? p
          : { ...p, texture: makePlanetTexture(p.visual), lights: makeCityLights() },
      ),
    );
  }, []);

  const toggleMute = useCallback(() => {
    const m = sound.toggleMute();
    setMuted(m);
    if (m) stopMusic();
    else startMusic();
  }, []);

  // ---- Canvas render loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const g = canvas.getContext("2d");
    if (!g) return;

    let raf = 0;
    let last = performance.now();
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      // pre-render the nebula background at device resolution
      bgRef.current = makeBackground(canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Planet screen positions from the last frame (for hit-testing)
    const screenPos = new Map<string, { x: number; y: number; r: number }>();
    // smoothed display radius per planet (selection zoom)
    const dispR = new Map<string, number>();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      const W = canvas.width;
      const H = canvas.height;
      const v = view.current;

      // smooth zoom
      v.scale += (v.targetScale - v.scale) * Math.min(1, dt * 8);

      // Orbit the planets (unless reduced motion)
      if (!reducedMotion.current) {
        for (const p of planetsRef.current) {
          if (p.server.status !== "soon") p.angle += p.orbitSpeed * dt;
        }
        // slow ambient rotation
        if (!drag.current) v.rotation += dt * 0.02;
      }

      const cx = W / 2 + v.cx;
      const cy = H / 2 + v.cy;
      const base = Math.min(W, H) / 900; // world-units → px
      const s = base * v.scale;

      // --- background: pre-rendered nebula blit + living starfield ---
      const bg = bgRef.current;
      if (bg) {
        g.drawImage(bg, 0, 0, W, H);
      } else {
        g.fillStyle = "#030509";
        g.fillRect(0, 0, W, H);
      }

      // living starfield — color-varied, twinkling
      const time = now / 1000;
      for (const st of starsRef.current) {
        const tw = reducedMotion.current ? 1 : 0.5 + 0.5 * Math.sin(time * st.ts + st.tw);
        g.globalAlpha = 0.2 + 0.6 * tw;
        g.fillStyle = st.color;
        g.beginPath();
        g.arc(st.x * W, st.y * H, st.r * dpr, 0, Math.PI * 2);
        g.fill();
        // cross sparkle on the brightest
        if (st.r > 1.5) {
          g.globalAlpha = 0.25 * tw;
          g.strokeStyle = st.color;
          g.lineWidth = 1 * dpr;
          const cr = st.r * 3.2 * dpr;
          g.beginPath();
          g.moveTo(st.x * W - cr, st.y * H); g.lineTo(st.x * W + cr, st.y * H);
          g.moveTo(st.x * W, st.y * H - cr); g.lineTo(st.x * W, st.y * H + cr);
          g.stroke();
        }
      }
      g.globalAlpha = 1;

      // shooting stars — occasional meteors streaking across the void
      if (!reducedMotion.current && Math.random() < 0.008 && meteorsRef.current.length < 3) {
        const ang = Math.random() * Math.PI * 2;
        const sp = (0.35 + Math.random() * 0.5) * Math.min(W, H);
        meteorsRef.current.push({
          x: Math.random() * W,
          y: Math.random() * H * 0.7,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp * 0.6 + sp * 0.2,
          life: 0,
          maxLife: 0.9 + Math.random() * 0.6,
        });
      }
      const meteors = meteorsRef.current;
      for (let i = meteors.length - 1; i >= 0; i--) {
        const mt = meteors[i];
        mt.life += dt;
        mt.x += mt.vx * dt;
        mt.y += mt.vy * dt;
        if (mt.life >= mt.maxLife) {
          meteors.splice(i, 1);
          continue;
        }
        const fade = Math.sin((mt.life / mt.maxLife) * Math.PI);
        const tail = 0.09 * Math.min(W, H);
        const mg = g.createLinearGradient(mt.x, mt.y, mt.x - mt.vx * 0.12, mt.y - mt.vy * 0.12);
        mg.addColorStop(0, `rgba(255,255,255,${0.85 * fade})`);
        mg.addColorStop(0.25, `rgba(180,220,255,${0.5 * fade})`);
        mg.addColorStop(1, "rgba(180,220,255,0)");
        g.strokeStyle = mg;
        g.lineWidth = 2 * dpr;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(mt.x, mt.y);
        g.lineTo(mt.x - (mt.vx * tail) / Math.hypot(mt.vx, mt.vy), mt.y - (mt.vy * tail) / Math.hypot(mt.vx, mt.vy));
        g.stroke();
      }

      // --- orbit rings ---
      g.strokeStyle = "rgba(150,180,230,0.14)";
      g.lineWidth = 1 * dpr;
      for (const p of planetsRef.current) {
        g.beginPath();
        g.ellipse(cx, cy, p.orbitRadius * s, p.orbitRadius * s * 0.92, v.rotation * 0.15, 0, Math.PI * 2);
        g.stroke();
      }

      // --- CENTRAL STAR — the heart of the sealed system ---
      const starR = 52 * s;
      const pulse = reducedMotion.current ? 1 : 1 + 0.045 * Math.sin(time * 1.3) + 0.02 * Math.sin(time * 4.7);

      // outer corona — vast, breathing
      const corona = g.createRadialGradient(cx, cy, starR * 0.8, cx, cy, starR * 5.2 * pulse);
      corona.addColorStop(0, "rgba(255,220,150,0.5)");
      corona.addColorStop(0.3, "rgba(255,170,90,0.22)");
      corona.addColorStop(0.65, "rgba(255,130,60,0.08)");
      corona.addColorStop(1, "rgba(255,120,50,0)");
      g.fillStyle = corona;
      g.beginPath();
      g.arc(cx, cy, starR * 5.2 * pulse, 0, Math.PI * 2);
      g.fill();

      // rotating flare rays
      if (!reducedMotion.current) {
        g.save();
        g.translate(cx, cy);
        g.rotate(time * 0.05);
        for (let i = 0; i < 12; i++) {
          const ang = (i / 12) * Math.PI * 2;
          const len = starR * (2.6 + 0.9 * Math.sin(time * 1.8 + i * 2.3));
          const rayG = g.createLinearGradient(0, 0, Math.cos(ang) * len, Math.sin(ang) * len);
          rayG.addColorStop(0, "rgba(255,230,170,0.35)");
          rayG.addColorStop(1, "rgba(255,180,100,0)");
          g.strokeStyle = rayG;
          g.lineWidth = (2.2 + 1.4 * Math.sin(time * 2.2 + i)) * dpr * Math.min(1.5, s);
          g.beginPath();
          g.moveTo(Math.cos(ang) * starR * 1.1, Math.sin(ang) * starR * 1.1);
          g.lineTo(Math.cos(ang) * len, Math.sin(ang) * len);
          g.stroke();
        }
        g.restore();
      }

      // mid glow
      const mid = g.createRadialGradient(cx, cy, 0, cx, cy, starR * 2.1 * pulse);
      mid.addColorStop(0, "rgba(255,250,235,0.95)");
      mid.addColorStop(0.45, "rgba(255,214,140,0.75)");
      mid.addColorStop(1, "rgba(255,160,80,0)");
      g.fillStyle = mid;
      g.beginPath();
      g.arc(cx, cy, starR * 2.1 * pulse, 0, Math.PI * 2);
      g.fill();

      // core — blinding white-gold
      const core = g.createRadialGradient(cx - starR * 0.15, cy - starR * 0.15, 0, cx, cy, starR * pulse);
      core.addColorStop(0, "#ffffff");
      core.addColorStop(0.55, "#fff3d0");
      core.addColorStop(0.85, "#ffcf7a");
      core.addColorStop(1, "#ff9d4d");
      g.fillStyle = core;
      g.beginPath();
      g.arc(cx, cy, starR * pulse, 0, Math.PI * 2);
      g.fill();

      // prominences — plasma arcs licking off the limb
      if (!reducedMotion.current) {
        g.strokeStyle = "rgba(255,190,110,0.55)";
        g.lineWidth = 2 * dpr * Math.min(1.4, s);
        for (let i = 0; i < 7; i++) {
          const a0 = time * 0.35 + (i / 7) * Math.PI * 2;
          const h = starR * (0.28 + 0.16 * Math.sin(time * 2.4 + i * 1.7));
          const mx = cx + Math.cos(a0) * (starR * pulse + h * 0.5);
          const my = cy + Math.sin(a0) * (starR * pulse + h * 0.5);
          g.beginPath();
          g.moveTo(cx + Math.cos(a0 - 0.09) * starR * pulse, cy + Math.sin(a0 - 0.09) * starR * pulse);
          g.quadraticCurveTo(mx, my, cx + Math.cos(a0 + 0.09) * starR * pulse, cy + Math.sin(a0 + 0.09) * starR * pulse);
          g.stroke();
        }
      }

      // lens flare — anamorphic streak + ghosts
      const flareLen = Math.min(W, H) * 0.42;
      const streak = g.createLinearGradient(cx - flareLen, cy, cx + flareLen, cy);
      streak.addColorStop(0, "rgba(255,220,160,0)");
      streak.addColorStop(0.5, "rgba(255,226,170,0.28)");
      streak.addColorStop(1, "rgba(255,220,160,0)");
      g.fillStyle = streak;
      g.fillRect(cx - flareLen, cy - 1.1 * dpr, flareLen * 2, 2.2 * dpr);
      for (const [fx, fr, fa] of [[-0.42, 0.05, 0.16], [0.3, 0.028, 0.2], [0.62, 0.016, 0.24]] as const) {
        const gx = cx + fx * flareLen * 1.6;
        const gg2 = g.createRadialGradient(gx, cy, 0, gx, cy, Math.min(W, H) * fr);
        gg2.addColorStop(0, `rgba(180,220,255,${fa})`);
        gg2.addColorStop(1, "rgba(180,220,255,0)");
        g.fillStyle = gg2;
        g.beginPath();
        g.arc(gx, cy, Math.min(W, H) * fr, 0, Math.PI * 2);
        g.fill();
      }

      // --- PLANETS — majestic worlds ---
      screenPos.clear();
      const sorted = [...planetsRef.current].sort((a, b) => a.orbitRadius - b.orbitRadius);
      for (const p of sorted) {
        const a = p.angle + v.rotation;
        const px = cx + Math.cos(a) * p.orbitRadius * s;
        const py = cy + Math.sin(a) * p.orbitRadius * s * 0.92;
        const baseR = Math.max(10 * dpr, p.size * s);
        const isSel = selectedRef.current === p.server.id;
        const isHov = hoverRef.current === p.server.id;
        // smooth selection zoom
        const targetR = baseR * (isSel ? 1.22 : isHov ? 1.08 : 1);
        const prevR = dispR.get(p.server.id) ?? targetR;
        const pr = prevR + (targetR - prevR) * Math.min(1, dt * 7);
        dispR.set(p.server.id, pr);
        screenPos.set(p.server.id, { x: px, y: py, r: pr });

        const vis = p.visual;
        const dim = p.server.status === "soon";
        const [ar, ag, ab] = hexToRgb(vis.atmosphere);
        const [gr2, gg2, gb2] = hexToRgb(vis.glow);

        // vast atmospheric halo
        const haloR = pr * (isSel ? 3.1 : 2.4);
        const halo = g.createRadialGradient(px, py, pr * 0.85, px, py, haloR);
        halo.addColorStop(0, `rgba(${ar},${ag},${ab},${dim ? 0.1 : isSel || isHov ? 0.42 : 0.26})`);
        halo.addColorStop(0.55, `rgba(${gr2},${gg2},${gb2},${dim ? 0.05 : 0.12})`);
        halo.addColorStop(1, `rgba(${gr2},${gg2},${gb2},0)`);
        g.fillStyle = halo;
        g.beginPath();
        g.arc(px, py, haloR, 0, Math.PI * 2);
        g.fill();

        // status light — orbiting beacon dot
        const sc = STATUS_COLOR[p.health];
        const [sr, sg, sb] = hexToRgb(sc);
        const beaconA = reducedMotion.current ? 0 : time * 1.6 + p.orbitRadius;
        const bx = px + Math.cos(beaconA) * pr * 1.9;
        const by = py + Math.sin(beaconA) * pr * 1.9;
        const beaconG = g.createRadialGradient(bx, by, 0, bx, by, 7 * dpr);
        beaconG.addColorStop(0, `rgba(${sr},${sg},${sb},0.95)`);
        beaconG.addColorStop(1, `rgba(${sr},${sg},${sb},0)`);
        g.fillStyle = beaconG;
        g.beginPath();
        g.arc(bx, by, 7 * dpr, 0, Math.PI * 2);
        g.fill();

        // ring system — back half
        if (vis.rings) {
          drawRings(g, px, py, pr, vis.rings, false);
        }

        // planet body — pre-rendered majestic surface, slowly rotating
        if (p.texture) {
          // spin the surface (unless reduced motion)
          if (!reducedMotion.current) p.texAngle += p.texSpin * dt;

          g.save();
          g.globalAlpha = dim ? 0.45 : 1;
          g.beginPath();
          g.arc(px, py, pr, 0, Math.PI * 2);
          g.clip();
          g.translate(px, py);
          g.rotate(p.texAngle);
          g.drawImage(p.texture, -pr, -pr, pr * 2, pr * 2);
          g.restore();
          g.globalAlpha = 1;

          // directional lighting — bright toward the star, terminator shadow away
          const lx = cx - px, ly = cy - py;
          const llen = Math.max(1, Math.hypot(lx, ly));
          const nx = lx / llen, ny = ly / llen;
          g.save();
          g.beginPath();
          g.arc(px, py, pr, 0, Math.PI * 2);
          g.clip();
          const light = g.createLinearGradient(
            px - nx * pr, py - ny * pr,
            px + nx * pr, py + ny * pr,
          );
          light.addColorStop(0, "rgba(255,244,220,0.26)");
          light.addColorStop(0.45, "rgba(255,244,220,0)");
          light.addColorStop(0.72, "rgba(2,4,12,0.45)");
          light.addColorStop(1, "rgba(2,4,12,0.78)");
          g.fillStyle = light;
          g.fillRect(px - pr, py - pr, pr * 2, pr * 2);

          // night-side city lights — screen blend: pop on the dark limb,
          // wash out on the bright day side
          if (p.lights && !dim) {
            g.save();
            g.beginPath();
            g.arc(px, py, pr, 0, Math.PI * 2);
            g.clip();
            g.translate(px, py);
            g.rotate(p.texAngle);
            g.globalCompositeOperation = "screen";
            g.globalAlpha = 0.85;
            g.drawImage(p.lights, -pr, -pr, pr * 2, pr * 2);
            g.restore();
          }
          g.restore();
        } else {
          // fallback while texture renders
          g.fillStyle = vis.base;
          g.beginPath();
          g.arc(px, py, pr, 0, Math.PI * 2);
          g.fill();
        }

        // crisp atmosphere rim
        const rim = g.createRadialGradient(px, py, pr * 0.82, px, py, pr * 1.06);
        rim.addColorStop(0, `rgba(${ar},${ag},${ab},0)`);
        rim.addColorStop(0.82, `rgba(${ar},${ag},${ab},${dim ? 0.12 : 0.38})`);
        rim.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
        g.fillStyle = rim;
        g.beginPath();
        g.arc(px, py, pr * 1.06, 0, Math.PI * 2);
        g.fill();

        // ring system — front half
        if (vis.rings) {
          drawRings(g, px, py, pr, vis.rings, true);
        }

        // selection ring — grand rotating dashed halo
        if (isSel) {
          g.strokeStyle = "rgba(255,255,255,0.85)";
          g.lineWidth = 2 * dpr;
          g.setLineDash([10 * dpr, 7 * dpr]);
          g.lineDashOffset = -time * 30 * dpr;
          g.beginPath();
          g.arc(px, py, pr * 1.7, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
          const sg2 = g.createRadialGradient(px, py, pr * 1.5, px, py, pr * 2.1);
          sg2.addColorStop(0, "rgba(255,255,255,0.14)");
          sg2.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = sg2;
          g.beginPath();
          g.arc(px, py, pr * 2.1, 0, Math.PI * 2);
          g.fill();
        }

        // label — planet name with subtle glow
        const fs = Math.max(11, 13 * dpr * Math.min(1.5, v.scale));
        g.font = `600 ${fs}px system-ui, sans-serif`;
        g.textAlign = "center";
        const labelY = py + pr + 20 * dpr * Math.min(1.2, v.scale);
        g.shadowColor = "rgba(0,0,0,0.9)";
        g.shadowBlur = 6 * dpr;
        g.fillStyle = dim ? "rgba(200,210,230,0.45)" : isSel || isHov ? "#ffffff" : "rgba(226,234,248,0.9)";
        g.fillText(p.server.name, px, labelY);
        g.shadowBlur = 0;
        // race subtitle
        g.font = `${Math.max(9, 10.5 * dpr * Math.min(1.3, v.scale))}px system-ui, sans-serif`;
        g.fillStyle = dim ? "rgba(200,210,230,0.3)" : rgba(vis.atmosphere, 0.75);
        g.fillText(p.server.raceName, px, labelY + fs * 1.15);
      }

      // expose for hit testing
      (canvas as unknown as { __planets: typeof screenPos }).__planets = screenPos;
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // ---- Pointer interaction ----
  const hitTest = useCallback((clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pos = (canvas as unknown as { __planets?: Map<string, { x: number; y: number; r: number }> }).__planets;
    if (!pos) return null;
    for (const [id, p] of pos) {
      const dx = x * dpr - p.x;
      const dy = y * dpr - p.y;
      if (dx * dx + dy * dy <= (p.r * 1.5) * (p.r * 1.5)) return id;
    }
    return null;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, lastT: performance.now(), vel: 0 };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    // hover highlight (only when not dragging)
    if (!d) {
      const id = hitTest(e.clientX, e.clientY);
      setHoverId((prev) => {
        if (prev !== id && id) playHover();
        return id;
      });
      return;
    }
    const dx = e.clientX - d.x;
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 6) d.moved = true;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    // horizontal drag spins the system
    const dv = (dx / dt) * 16;
    view.current.rotation += (dx * 0.004) / Math.max(0.5, view.current.scale);
    d.vel = d.vel * 0.85 + dv * 0.15;
    d.x = e.clientX;
    d.y = e.clientY;
    d.lastT = now;
  }, [hitTest]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      // tap → select or deselect
      const id = hitTest(e.clientX, e.clientY);
      if (id) {
        const planet = planetsRef.current.find((p) => p.server.id === id);
        if (!planet) return;
        if (planet.server.status === "soon") {
          playDenied();
          setHint(t("servers.comingSoonHint", "{name} isn't deployed yet — check back soon.", { name: planet.server.name }));
          return;
        }
        if (planet.health === "checking") {
          playClick();
          setHint(t("servers.checkingHint", "Still checking {name} — one moment.", { name: planet.server.name }));
          return;
        }
        if (selectedRef.current === id) {
          playDeselect();
          setSelectedId(null);
        } else {
          playSelect();
          setSelectedId(id);
        }
        setHint(null);
      } else if (selectedRef.current) {
        playDeselect();
        setSelectedId(null);
      }
    } else {
      // fling → whoosh if fast
      if (Math.abs(d.vel) > 6) playWhoosh();
      // inertia
      const v0 = d.vel * 0.004;
      let v = v0;
      const tick = () => {
        if (drag.current) return;
        v *= 0.94;
        if (Math.abs(v) < 0.0002) return;
        view.current.rotation += v / Math.max(0.5, view.current.scale);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }, [hitTest, t]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const v = view.current;
    v.targetScale = Math.min(2.6, Math.max(0.55, v.targetScale * (e.deltaY < 0 ? 1.12 : 0.89)));
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch.current) {
        const v = view.current;
        v.targetScale = Math.min(2.6, Math.max(0.55, v.targetScale * (d / pinch.current.d)));
      }
      pinch.current = { d };
    }
  }, []);
  const onTouchEnd = useCallback(() => { pinch.current = null; }, []);

  // ---- selection detail ----
  const selected = planets.find((p) => p.server.id === selectedId) ?? null;

  const handleClaim = useCallback(() => {
    if (!selected) return;
    if (selected.health !== "up") {
      playDenied();
      setHint(t("servers.downHint", "{name} is offline right now — try another server.", { name: selected.server.name }));
      return;
    }
    playConfirm();
    setHint(null);
    onSelect(selected.server);
  }, [selected, onSelect, t]);

  const closeDetail = useCallback(() => {
    playDeselect();
    setSelectedId(null);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh", overflow: "hidden", background: "#04060d" }}>
      {/* header */}
      <div
        style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 5,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px", pointerEvents: "none",
        }}
      >
        <div style={{ pointerEvents: "auto" }}>
          <h2 style={{ margin: 0, fontSize: 20, color: "#fff" }}>
            {t("starmap.title", "The Sealed System")}
          </h2>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: "rgba(220,230,245,0.7)" }}>
            {t("starmap.subtitle", "Six worlds, one quarantine. Drag to spin — tap a world to inspect it, then claim your colony.")}
          </p>
        </div>
        <button
          onClick={() => { playClick(); toggleMute(); }}
          aria-label={muted ? t("starmap.unmute", "Unmute") : t("starmap.mute", "Mute")}
          style={{
            pointerEvents: "auto", width: 40, height: 40, borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)",
            color: "#fff", fontSize: 18, cursor: "pointer",
          }}
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      {/* canvas */}
      <div
        ref={wrapRef}
        style={{ position: "absolute", inset: 0, touchAction: "none", cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoverId(null)}
        onWheel={onWheel}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <canvas ref={canvasRef} style={{ display: "block" }} />
      </div>

      {/* hint toast */}
      {hint && (
        <p
          role="status"
          style={{
            position: "absolute", bottom: selected ? 300 : 24, left: 16, right: 16, zIndex: 6,
            margin: 0, padding: "10px 14px", borderRadius: 10, textAlign: "center",
            background: "rgba(20,16,8,0.92)", border: "1px solid rgba(251,191,36,0.4)",
            color: "#fbbf24", fontSize: 14,
          }}
        >
          {hint}
        </p>
      )}

      {/* detail panel */}
      {selected && (
        <DetailPanel
          planet={selected}
          onClaim={handleClaim}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

/** Bottom-sheet (mobile) / side-panel (desktop) detail for the selected world. */
function DetailPanel({
  planet,
  onClaim,
  onClose,
}: {
  planet: PlanetDatum;
  onClaim: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const race = getRace(planet.server.raceId);
  const portrait = HERO_PORTRAIT[planet.server.raceId];
  const statusColor = STATUS_COLOR[planet.health];

  return (
    <div
      style={{
        position: "absolute", zIndex: 7, left: 0, right: 0, bottom: 0,
        maxHeight: "62dvh", overflowY: "auto",
        background: "linear-gradient(180deg, rgba(10,12,22,0.96), rgba(6,8,16,0.98))",
        borderTop: `1px solid ${planet.visual.atmosphere}55`,
        borderTopLeftRadius: 18, borderTopRightRadius: 18,
        padding: "12px 18px 22px",
        boxShadow: `0 -12px 48px ${planet.visual.glow}44`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.25)" }} />
      </div>
      <button
        onClick={onClose}
        aria-label={t("starmap.close", "Close")}
        style={{
          position: "absolute", top: 10, right: 12, width: 32, height: 32,
          borderRadius: "50%", border: "1px solid rgba(255,255,255,0.2)",
          background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 16, cursor: "pointer",
        }}
      >
        ✕
      </button>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        {portrait && (
          <img
            src={portrait}
            alt={race.name}
            style={{
              width: 110, height: 164, objectFit: "cover", borderRadius: 10, flexShrink: 0,
              border: `1px solid ${planet.visual.atmosphere}66`, boxShadow: `0 0 24px ${planet.visual.glow}55`,
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: "0 0 2px", fontSize: 19, color: "#fff" }}>{race.name}</h3>
          <p style={{ margin: "0 0 6px", fontSize: 12, opacity: 0.7, fontStyle: "italic", color: "#dbe4f5" }}>
            {race.title}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "rgba(220,230,245,0.8)" }}>
            <span>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: statusColor, marginRight: 6, boxShadow: `0 0 6px ${statusColor}` }} />
              {planet.health === "up"
                ? t("servers.statusUp", "Online")
                : planet.health === "down"
                  ? t("servers.statusDown", "Offline")
                  : t("servers.statusChecking", "Checking…")}
            </span>
            {planet.playerCount !== undefined && (
              <span>{t("servers.inhabitants", "{count} inhabitants", { count: planet.playerCount.toLocaleString() })}</span>
            )}
            {planet.reverb !== undefined && (
              <span>{t("servers.reverb", "Reverb {score}", { score: planet.reverb.toLocaleString() })}</span>
            )}
          </div>
        </div>
      </div>

      <p style={{ margin: "12px 0", fontSize: 14, lineHeight: 1.55, color: "rgba(230,236,248,0.88)" }}>
        {race.lore}
      </p>

      {race.attributes && race.attributes.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {race.attributes.map((attr, i) => (
            <div key={i} style={{ fontSize: 13, marginBottom: 4, color: "rgba(220,230,245,0.85)" }}>
              <span style={{
                color: attr.kind === "strength" ? "#4ade80" : attr.kind === "weakness" ? "#f87171" : "#fbbf24",
                marginRight: 6,
              }}>
                {attr.kind === "strength" ? "▲" : attr.kind === "weakness" ? "▼" : "◆"}
              </span>
              {attr.label}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onClaim}
        style={{
          width: "100%", padding: 14, borderRadius: 10, border: "none",
          background: planet.health === "up" ? "#7c3aed" : "rgba(255,255,255,0.1)",
          color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer",
          boxShadow: planet.health === "up" ? "0 4px 24px rgba(124,58,237,0.45)" : "none",
        }}
      >
        {t("servers.claimHere", "Claim Colony Here")}
      </button>
      {planet.health !== "up" && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "#fbbf24", textAlign: "center" }}>
          {t("servers.downHint", "{name} is offline right now — try another server.", { name: planet.server.name })}
        </p>
      )}
    </div>
  );
}
