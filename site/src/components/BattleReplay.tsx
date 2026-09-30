// BattleReplay — the 2.5D plan-driven battle viewer (prototype).
//
// A layered canvas (sky → ridges → field → formations → effects →
// foreground) driven by REAL battle data: entry vectors and timing from the
// locked battle plan, surprise windows, posted screens, decisions, and
// casualty thinning. It deliberately does NOT simulate the battle to its
// outcome — attributes decide that. It shows the KEY PARTS in real time
// while the fight is on: troops coming in, surprise maneuvers landing,
// pickets going up, and forces falling back.
//
// Data chain (first hit wins): the locked plan (pre-loaded for your own
// rally battles — the "already have-loaded" animation) →
// battle.internal.planState (demo / full data) → battle.replayIntel (the
// replay-safe public slice: entered vectors + screens only, never the
// unentered plan) → battle.maneuverIntel → a generic two-force fallback.
import { useEffect, useMemo, useRef, useState } from "react";
import { battleEndAt } from "../game/war/battle-engine";
import { maneuverWeight, type BattlePlan } from "../game/war/maneuvers";
import type { Battle, BattleSide, ManeuverVector } from "../game/war/war-types";

const W = 960;
const H = 540;
const MIN = 60_000;

const C = {
  attacker: "#ff8a4c",
  attackerDim: "#a34a24",
  defender: "#8fb8ff",
  defenderDim: "#3d5a96",
  surprise: "#ffd166",
  screen: "#9fd8ff",
  text: "#e8e2d8",
  textDim: "#9a917f",
};

const VECTOR_LABEL: Record<ManeuverVector, string> = {
  MAIN: "MAIN",
  FLANK_LEFT: "FLANK LEFT",
  FLANK_RIGHT: "FLANK RIGHT",
  REAR: "REAR",
  RESERVE: "RESERVE",
};

interface VEntry {
  vector: ManeuverVector;
  weight: number;
  /** Minutes from battle start (null when the plan is hidden). */
  enterAtMin: number | null;
  /** Epoch ms the maneuver entered (null = not yet). */
  enteredAt: number | null;
  surpriseUntil: number | null;
  screened: boolean;
}

interface ReplayData {
  entries: VEntry[];
  /** Unentered maneuvers whose vector/timing is hidden (count only). */
  unentered: number;
  screens: Partial<Record<ManeuverVector, { at: number }>>;
  planSide: BattleSide;
  fullPlan: boolean;
}

function resolveReplayData(battle: Battle, plan: BattlePlan | null): ReplayData {
  const t0 = battle.startedAt;
  // 1. Full plan state (demo battles, or the owner's pre-loaded plan).
  const ps = battle.internal?.planState;
  if (ps) {
    const data: ReplayData = {
      entries: ps.entries.map((e) => ({
        vector: e.vector,
        weight: Math.max(1, Math.round(e.weight ?? 0) || 0),
        enterAtMin: e.enterAtMin,
        enteredAt: e.entered ? (e.enteredAt ?? t0 + e.enterAtMin * MIN) : null,
        surpriseUntil: e.surpriseUntil ?? null,
        screened: !!e.screenedAtEntry,
      })),
      unentered: 0,
      screens: { ...ps.screens },
      planSide: ps.side,
      fullPlan: true,
    };
    return data;
  }
  // 2. Pre-loaded rally plan (your own locked plan, before/during the fight).
  if (plan) {
    const intel = battle.maneuverIntel;
    const byVector = new Map((intel?.entered ?? []).map((e) => [e.vector, e.enteredAt] as const));
    return {
      entries: plan.maneuvers.map((m) => ({
        vector: m.vector,
        weight: Math.max(1, maneuverWeight(m)),
        enterAtMin: m.enterAtMin,
        enteredAt: byVector.get(m.vector) ?? null,
        surpriseUntil: null,
        screened: false,
      })),
      unentered: 0,
      screens: {},
      planSide: "attacker",
      fullPlan: true,
    };
  }
  // 3. Replay-safe public slice.
  const ri = battle.replayIntel;
  if (ri) {
    return {
      entries: ri.entries.map((e) => ({
        vector: e.vector,
        weight: Math.max(1, Math.round(e.weight ?? 0) || 0),
        enterAtMin: null,
        enteredAt: e.entered ? (e.enteredAt ?? t0) : null,
        surpriseUntil: e.surpriseUntil ?? null,
        screened: !!e.screenedAtEntry,
      })),
      unentered: ri.unentered,
      screens: { ...ri.screens },
      planSide: ri.side,
      fullPlan: false,
    };
  }
  // 4. Maneuver intel only.
  const mi = battle.maneuverIntel;
  if (mi) {
    return {
      entries: mi.entered.map((e) => ({
        vector: e.vector,
        weight: Math.max(1, e.troops),
        enterAtMin: null,
        enteredAt: e.enteredAt,
        surpriseUntil: null,
        screened: false,
      })),
      unentered: mi.unentered,
      screens: {},
      planSide: mi.side,
      fullPlan: false,
    };
  }
  // 5. No plan at all — the main bodies, clashing.
  return { entries: [], unentered: 0, screens: {}, planSide: "attacker", fullPlan: false };
}

// ---------------------------------------------------------------------------
// Geometry — where each vector stages, marches, and fights (logical 960x540).
// ---------------------------------------------------------------------------
interface Vec2 { x: number; y: number }
const STAGING: Record<ManeuverVector, Vec2> = {
  MAIN: { x: 480, y: 512 },
  FLANK_LEFT: { x: -70, y: 360 },
  FLANK_RIGHT: { x: 1030, y: 360 },
  REAR: { x: 480, y: 30 },
  RESERVE: { x: 660, y: 508 },
};
const TARGET: Record<ManeuverVector, Vec2> = {
  MAIN: { x: 480, y: 318 },
  FLANK_LEFT: { x: 300, y: 308 },
  FLANK_RIGHT: { x: 660, y: 308 },
  REAR: { x: 480, y: 198 },
  RESERVE: { x: 660, y: 508 },
};
const DEF_LINE = { x: 480, y: 252 };
/** March-in animation length, in battle-minutes. */
const ENTER_MIN = 3;

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const srand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

function entryPos(e: VEntry, btMin: number): { p: Vec2; prog: number } {
  const s = STAGING[e.vector];
  const t = TARGET[e.vector];
  if (e.vector === "RESERVE") return { p: { ...t }, prog: 1 };
  const start = e.enterAtMin ?? 0;
  const prog = clamp01((btMin - start) / ENTER_MIN);
  const pe = easeOut(prog);
  return { p: { x: lerp(s.x, t.x, pe), y: lerp(s.y, t.y, pe) }, prog };
}

function fmtT(ms: number): string {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
  return (neg ? "-" : "") + body;
}

// ---------------------------------------------------------------------------
// Chapters — the key moments on the timeline.
// ---------------------------------------------------------------------------
interface Chapter { t: number; label: string; kind: "entry" | "surprise" | "screen" | "decision" | "launch" }
function buildChapters(battle: Battle, data: ReplayData): Chapter[] {
  const t0 = battle.startedAt;
  const out: Chapter[] = [{ t: t0, label: "Launch", kind: "launch" }];
  for (const e of data.entries) {
    const at = e.enteredAt ?? (e.enterAtMin != null ? t0 + e.enterAtMin * MIN : null);
    if (at != null) out.push({ t: at, label: `${VECTOR_LABEL[e.vector]} enters`, kind: "entry" });
    if (e.surpriseUntil != null && !e.screened && e.enteredAt != null) {
      out.push({ t: e.enteredAt, label: `${VECTOR_LABEL[e.vector]} — surprise!`, kind: "surprise" });
    }
  }
  for (const [v, s] of Object.entries(data.screens)) {
    if (s) out.push({ t: s.at, label: `Pickets up — ${VECTOR_LABEL[v as ManeuverVector]}`, kind: "screen" });
  }
  for (const d of battle.decisions ?? []) {
    const label = d.action === "withdrawal" ? `${d.side} falls back` : d.action === "retreat" ? `${d.side} retreats` : `${d.side}: ${d.action}`;
    out.push({ t: d.issuedAt, label, kind: "decision" });
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// The component.
// ---------------------------------------------------------------------------
const SPEEDS = [
  { label: "60×", v: 60 },
  { label: "240×", v: 240 },
  { label: "960×", v: 960 },
];

export default function BattleReplay({ battle, plan = null }: { battle: Battle; plan?: BattlePlan | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t0 = battle.startedAt;
  const t1 = battleEndAt(battle);
  const data = useMemo(() => resolveReplayData(battle, plan), [battle, plan]);
  const chapters = useMemo(() => buildChapters(battle, data), [battle, data]);

  const viewRef = useRef<number>(Math.max(t0, Math.min(Date.now(), t1)));
  const [uiNow, setUiNow] = useState(viewRef.current);
  const [playing, setPlaying] = useState(true);
  const [live, setLive] = useState(battle.status === "active" && Date.now() >= t0);
  const [speed, setSpeed] = useState(240);
  const particles = useRef<{ x: number; y: number; vx: number; vy: number; life: number; max: number; col: string }[]>([]);
  const stateRef = useRef({ playing, live, speed });
  stateRef.current = { playing, live, speed };

  const goLive = () => { setLive(true); setPlaying(true); };
  const jump = (t: number) => {
    viewRef.current = Math.max(t0, Math.min(t, t1));
    setUiNow(viewRef.current);
    setLive(false);
  };

  // ---- main loop: advance the clock, draw the frame ----
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (wall: number) => {
      const dt = Math.min(100, wall - last);
      last = wall;
      const st = stateRef.current;
      if (st.live && battle.status === "active") {
        viewRef.current = Math.max(t0, Math.min(Date.now(), t1));
      } else if (st.playing) {
        const nv = viewRef.current + dt * st.speed;
        viewRef.current = Math.min(nv, t1);
        if (nv >= t1) stateRef.current.playing = false;
      }
      drawFrame(canvasRef.current, battle, data, viewRef.current, wall, particles.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [battle, data, t0, t1]);

  // ---- slow UI sync for the scrubber + readouts ----
  useEffect(() => {
    const id = setInterval(() => {
      setUiNow(viewRef.current);
      if (!stateRef.current.playing && playing) setPlaying(false);
      if (stateRef.current.playing && !playing) setPlaying(true);
    }, 200);
    return () => clearInterval(id);
  }, [playing]);

  const staging = uiNow < t0;
  const btMin = (uiNow - t0) / MIN;
  const elapsedFrac = Math.max(0, Math.min(1, (uiNow - t0) / Math.max(1, t1 - t0)));

  return (
    <div className="overflow-hidden rounded-xl border border-surf-3 bg-ink-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
        <div>
          <h3 className="text-sm font-semibold text-text-1">{battle.zoneName || "The field"}</h3>
          <p className="text-xs text-text-3">
            {battle.attacker.colonyName} vs {battle.defender.colonyName}
            {battle.internal?.allianceName ? ` · ${battle.internal.allianceName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {live && battle.status === "active" && !staging && (
            <span className="rounded-full border border-ember/50 bg-ember/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-ember-soft">
              ● Live
            </span>
          )}
          {data.fullPlan && <span className="text-[11px] uppercase tracking-wider text-text-3">plan locked</span>}
        </div>
      </div>

      <div className="relative px-3 pt-2">
        <canvas ref={canvasRef} width={W} height={H} className="aspect-video w-full rounded-lg" />
      </div>

      {/* timeline */}
      <div className="px-3 pt-2">
        <div className="relative">
          <input
            type="range"
            min={t0}
            max={t1}
            step={1000}
            value={Math.round(uiNow)}
            onChange={(e) => jump(Number(e.target.value))}
            className="w-full accent-ember"
            aria-label="Battle timeline"
          />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0">
            {chapters.map((c, i) => {
              const p = ((c.t - t0) / Math.max(1, t1 - t0)) * 100;
              const col = c.kind === "surprise" ? C.surprise : c.kind === "screen" ? C.screen : c.kind === "decision" ? "#c084fc" : c.kind === "entry" ? C.attacker : "#8a8272";
              return (
                <span key={i} title={`${c.label} — T+${fmtT(c.t - t0)}`} className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${p}%`, background: col }} />
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between text-[11px] text-text-3">
          <span>T+{fmtT(uiNow - t0)}</span>
          <span>{staging ? `launch in ${fmtT(t0 - uiNow)}` : `${fmtT(t1 - uiNow)} to the horn`}</span>
        </div>
      </div>

      {/* transport */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button onClick={() => jump(t0)} className="rounded-md border border-surf-3 px-2 py-1 text-xs text-text-2 hover:text-text-1" title="Back to launch">⏮</button>
        <button
          onClick={() => { if (live) setLive(false); setPlaying(!stateRef.current.playing); }}
          className="rounded-md border border-surf-3 px-3 py-1 text-xs font-semibold text-text-1 hover:border-ember"
        >
          {stateRef.current.playing ? "⏸ Pause" : "▶ Play"}
        </button>
        {SPEEDS.map((s) => (
          <button
            key={s.label}
            onClick={() => setSpeed(s.v)}
            className={`rounded-md border px-2 py-1 text-xs ${speed === s.v ? "border-ember text-ember-soft" : "border-surf-3 text-text-3"}`}
          >
            {s.label}
          </button>
        ))}
        {battle.status === "active" && !staging && (
          <button onClick={goLive} className={`rounded-md border px-2 py-1 text-xs ${live ? "border-ember text-ember-soft" : "border-surf-3 text-text-3"}`}>
            ● Live
          </button>
        )}
        <span className="ml-auto text-[11px] text-text-3">{Math.round(elapsedFrac * 100)}% of the battle</span>
      </div>

      {/* chapters — the key moments, jumpable */}
      {chapters.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-3">
          {chapters.map((c, i) => (
            <button
              key={i}
              onClick={() => jump(c.t)}
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${uiNow >= c.t ? "border-surf-3 text-text-2" : "border-dashed border-surf-3 text-text-3"}`}
              title={`Jump to T+${fmtT(c.t - t0)}`}
            >
              {c.kind === "surprise" ? "⚡ " : c.kind === "screen" ? "🛡 " : c.kind === "decision" ? "🏳 " : c.kind === "entry" ? "➤ " : "· "}
              {c.label}
            </button>
          ))}
        </div>
      )}
      <p className="sr-only">Battle viewer: {btMin < 0 ? "staging" : `T+${fmtT(uiNow - t0)}`}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canvas rendering.
// ---------------------------------------------------------------------------
function drawFrame(
  canvas: HTMLCanvasElement | null,
  battle: Battle,
  data: ReplayData,
  viewNow: number,
  wall: number,
  particles: { x: number; y: number; vx: number; vy: number; life: number; max: number; col: string }[],
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const t0 = battle.startedAt;
  const t1 = battleEndAt(battle);
  const btMin = (viewNow - t0) / MIN;
  const elapsedFrac = Math.max(0, Math.min(1, (viewNow - t0) / Math.max(1, t1 - t0)));
  const staging = viewNow < t0;

  // Camera drift — the 2.5D breathe.
  const cx = Math.sin(wall * 0.00004) * 10;
  const cy = Math.cos(wall * 0.000031) * 4;

  // -- sky --
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.48);
  sky.addColorStop(0, "#070a18");
  sky.addColorStop(0.55, "#241426");
  sky.addColorStop(1, "#5c2a1e");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.48);

  // -- sun --
  const sunX = 700 - cx * 0.05, sunY = 150 - cy * 0.05;
  const glow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 90);
  glow.addColorStop(0, "rgba(255,190,120,0.55)");
  glow.addColorStop(1, "rgba(255,190,120,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(sunX - 90, sunY - 90, 180, 180);
  ctx.fillStyle = "rgba(255,214,150,0.85)";
  ctx.beginPath(); ctx.arc(sunX, sunY, 22, 0, Math.PI * 2); ctx.fill();

  // -- ridges (parallax silhouettes) --
  ridge(ctx, 0.12, cx, 205, "#1b1430", 7);
  ridge(ctx, 0.25, cx, 245, "#120d22", 11);

  // -- the field --
  const g = ctx.createLinearGradient(0, 258, 0, H);
  g.addColorStop(0, "#221722");
  g.addColorStop(0.4, "#161018");
  g.addColorStop(1, "#0b080e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 258, W, H - 258);
  // perspective contour arcs
  ctx.strokeStyle = "rgba(255,138,76,0.07)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    const y = 300 + i * 52 - cy * (0.4 + i * 0.15);
    ctx.beginPath();
    ctx.ellipse(480 - cx * (0.4 + i * 0.15), y + 160, 620 - i * 60, 46, 0, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
  }
  // ember motes on the field
  for (let i = 0; i < 40; i++) {
    const mx = srand(i * 3.7) * W;
    const my = 280 + srand(i * 9.1) * 240;
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(wall * 0.001 + i));
    ctx.fillStyle = `rgba(255,140,80,${0.10 * tw})`;
    ctx.fillRect(mx, my, 2, 2);
  }

  // -- withdrawals / retreats: who is falling back at viewNow? --
  const fallback = new Map<BattleSide, number>();
  for (const d of battle.decisions ?? []) {
    if ((d.action === "withdrawal" || d.action === "retreat") && viewNow >= d.issuedAt) {
      fallback.set(d.side, Math.min(1, (viewNow - d.issuedAt) / (20 * MIN)));
    }
  }

  // -- casualty fractions (attributes decide the outcome; we just thin) --
  const casFrac = (side: BattleSide) => {
    const troops = Math.max(1, Math.trunc(battle[side].troops) || 1);
    return Math.min(1, (battle.casualties[side] / troops) * Math.pow(elapsedFrac, 1.1));
  };
  const aFrac = staging ? 0 : casFrac("attacker");
  const dFrac = staging ? 0 : casFrac("defender");

  // -- defender line --
  drawDefender(ctx, battle, dFrac, fallback.get("defender") ?? 0, wall, cx);

  // -- attacker vectors --
  const planSideAttacker = data.planSide === "attacker";
  for (let i = 0; i < data.entries.length; i++) {
    const e = data.entries[i];
    const { p, prog } = entryPos(e, btMin);
    const entered = e.enteredAt != null && viewNow >= e.enteredAt;
    const known = data.fullPlan || entered; // hidden vectors stay hidden
    if (!known) continue;
    const ghost = !entered;
    if (staging && ghost) continue; // staging overlay lists the pre-loaded vectors as text; no art under it
    const surprise = !ghost && e.surpriseUntil != null && !e.screened && viewNow < e.surpriseUntil;
    drawFormation(ctx, {
      x: p.x - cx * 0.6, y: p.y - cy * 0.6,
      weight: e.weight, side: planSideAttacker ? "attacker" : "defender",
      frac: aFrac, ghost, seed: i * 131 + 7,
      fallback: fallback.get(planSideAttacker ? "attacker" : "defender") ?? 0,
      label: VECTOR_LABEL[e.vector],
      surprise: !!surprise,
      prog,
    });
    if (!ghost) {
      // clash sparks where the vector meets the line
      const hot = Math.abs(p.y - (DEF_LINE.y + 10)) < 90 && p.y < DEF_LINE.y + 60;
      if (hot && !staging) spawnSparks(particles, p.x - cx * 0.6, Math.min(p.y, DEF_LINE.y + 26), planSideAttacker ? C.attacker : C.defender, 2);
      if (surprise) drawSurprise(ctx, p.x - cx * 0.6, p.y - cy * 0.6, wall);
    } else if (data.fullPlan) {
      // inbound tag for pre-loaded plans
      const tIn = e.enterAtMin != null ? Math.max(0, e.enterAtMin * MIN - (viewNow - t0)) : null;
      ctx.fillStyle = "rgba(232,226,216,0.55)";
      ctx.font = "10px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(tIn != null ? `in ${fmtT(tIn)}` : "awaiting orders", p.x - cx * 0.6, p.y - cy * 0.6 + 34);
    }
  }

  // -- unentered, vector-hidden: "movement in the dust" ghosts --
  if (data.unentered > 0 && !staging) {
    ctx.fillStyle = "rgba(232,226,216,0.5)";
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(`⁇ ${data.unentered} maneuver${data.unentered === 1 ? "" : "s"} still hidden`, 480, 470);
  }

  // -- posted screens: pickets on the field --
  for (const [v, s] of Object.entries(data.screens)) {
    if (!s || viewNow < s.at) continue;
    drawPickets(ctx, v as ManeuverVector, cx, cy, wall);
  }

  // -- particles --
  stepParticles(ctx, particles, W, H);

  // -- foreground tufts (near-camera 2.5D) --
  ctx.fillStyle = "rgba(5,4,8,0.9)";
  for (const fx of [40, 900]) {
    const sway = Math.sin(wall * 0.0006 + fx) * 6;
    for (let i = 0; i < 7; i++) {
      const bx = fx + (srand(fx + i) - 0.5) * 90 - cx * 1.5;
      const hgt = 26 + srand(fx * 2 + i) * 44;
      ctx.beginPath();
      ctx.moveTo(bx - 5, H);
      ctx.quadraticCurveTo(bx + sway, H - hgt, bx + sway * 1.6, H - hgt - 8);
      ctx.quadraticCurveTo(bx + sway * 0.6, H - hgt * 0.5, bx + 5, H);
      ctx.fill();
    }
  }

  // -- vignette --
  const vg = ctx.createRadialGradient(480, 270, 240, 480, 270, 620);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // -- staging overlay: the pre-loaded plan --
  if (staging) {
    ctx.fillStyle = "rgba(4,3,8,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = C.text;
    ctx.font = "600 26px system-ui";
    ctx.fillText("PLAN LOCKED", 480, 340);
    if (battle.internal?.allianceName) {
      ctx.fillStyle = C.textDim;
      ctx.font = "14px system-ui";
      ctx.fillText(battle.internal.allianceName, 480, 366);
    }
    ctx.fillStyle = C.surprise;
    ctx.font = "600 20px system-ui";
    ctx.fillText(`LAUNCH IN ${fmtT(t0 - viewNow)}`, 480, 404);
    ctx.fillStyle = "rgba(232,226,216,0.6)";
    ctx.font = "12px system-ui";
    const items = data.entries.map((e) => `${VECTOR_LABEL[e.vector]} — T+${e.enterAtMin ?? "?"} min`).join("   ·   ");
    ctx.fillText(items || "no plan attached", 480, 432);
  }

  // -- fallback banner --
  for (const [side, fp] of fallback) {
    if (fp <= 0) continue;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(192,132,252,0.9)";
    ctx.font = "600 15px system-ui";
    ctx.fillText(side === "attacker" ? "⚑ THE ATTACKERS FALL BACK" : "⚑ THE DEFENDERS FALL BACK", 480, side === "attacker" ? 500 : 120);
  }
}

function ridge(ctx: CanvasRenderingContext2D, par: number, cx: number, baseY: number, col: string, seed: number) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(-20, baseY + 40);
  const x0 = -cx * par;
  for (let x = -20; x <= W + 20; x += 48) {
    const peak = baseY - srand(seed + x * 0.13) * 46;
    ctx.lineTo(x + x0 * 0.2, peak);
    ctx.lineTo(x + 24 + x0 * 0.2, baseY - srand(seed + x * 0.29 + 5) * 22);
  }
  ctx.lineTo(W + 20, baseY + 40);
  ctx.closePath();
  ctx.fill();
}

function drawDefender(
  ctx: CanvasRenderingContext2D,
  battle: Battle,
  frac: number,
  fallback: number,
  wall: number,
  cx: number,
) {
  const x = DEF_LINE.x - cx * 0.5;
  const y = DEF_LINE.y - fallback * 70 + Math.sin(wall * 0.0011) * 1.5;
  const alpha = 1 - fallback * 0.45;
  ctx.save();
  ctx.globalAlpha = Math.max(0.15, alpha);
  // shield wall
  ctx.fillStyle = C.defenderDim;
  const wHalf = 175 * (1 - frac * 0.25);
  roundRect(ctx, x - wHalf, y - 8, wHalf * 2, 16, 7);
  ctx.fill();
  ctx.fillStyle = "rgba(143,184,255,0.25)";
  roundRect(ctx, x - wHalf, y - 8, wHalf * 2, 5, 3);
  ctx.fill();
  // the line's bodies — two ranks, thinning as casualties mount
  const n = Math.max(6, Math.round(34 * (1 - 0.8 * frac)));
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    const dx = (t - 0.5) * wHalf * 2;
    const rank = i % 2;
    const jx = (srand(i * 7.3) - 0.5) * 8;
    const jy = (srand(i * 3.1) - 0.5) * 5;
    ctx.fillStyle = rank === 0 ? C.defender : C.defenderDim;
    ctx.beginPath();
    ctx.arc(x + dx + jx, y - 16 - rank * 9 + jy, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(232,226,216,0.75)";
  ctx.font = "10px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(battle.defender.colonyName.toUpperCase(), x, y + 26);
  ctx.restore();
}

interface FormationOpts {
  x: number; y: number; weight: number; side: BattleSide; frac: number;
  ghost: boolean; seed: number; fallback: number; label: string;
  surprise: boolean; prog: number;
}

function drawFormation(ctx: CanvasRenderingContext2D, o: FormationOpts) {
  const base = Math.max(6, Math.min(44, Math.round(6 + Math.sqrt(o.weight) / 2.2)));
  const n = o.ghost ? Math.round(base * 0.7) : Math.max(3, Math.round(base * (1 - 0.85 * o.frac)));
  const cols = Math.ceil(Math.sqrt(n * 1.7));
  const col = o.side === "attacker" ? C.attacker : C.defender;
  const dim = o.side === "attacker" ? C.attackerDim : C.defenderDim;
  const scale = 0.75 + (o.y / H) * 0.65; // perspective: nearer = bigger
  const alpha = o.ghost ? 0.35 : Math.max(0.2, 1 - o.fallback * 0.5);
  const yy = o.y + o.fallback * (o.side === "attacker" ? 60 : -60);

  ctx.save();
  ctx.globalAlpha = alpha;
  if (o.ghost) ctx.setLineDash([5, 5]);
  // wedge ground-shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(o.x, yy + 14 * scale, cols * 4.6 * scale, 7 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  if (o.ghost) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(o.x, yy, cols * 4.6 * scale, 26 * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // bodies — seeded so they don't shimmer between frames
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const jx = (srand(o.seed + i * 1.7) - 0.5) * 9 * scale;
    const jy = (srand(o.seed + i * 4.3) - 0.5) * 8 * scale;
    const px = o.x + (c - (cols - 1) / 2) * 8.5 * scale + jx;
    const py = yy + (r - 1.2) * 8 * scale + jy - r * 2;
    const rad = (2 + (py / H) * 2.2) * (o.surprise ? 1.25 : 1);
    ctx.fillStyle = o.surprise ? "#ffe9c4" : (i % 3 === 0 ? dim : col);
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.setLineDash([]);
  // label below the art, never in it
  ctx.fillStyle = o.ghost ? "rgba(232,226,216,0.5)" : "rgba(232,226,216,0.8)";
  ctx.font = `${o.ghost ? "" : "600 "}10px system-ui`;
  ctx.textAlign = "center";
  ctx.fillText(o.label, o.x, yy + 30 * scale);
  ctx.restore();
}

function drawSurprise(ctx: CanvasRenderingContext2D, x: number, y: number, wall: number) {
  const p = (wall * 0.0012) % 1;
  ctx.save();
  ctx.strokeStyle = `rgba(255,209,102,${0.8 * (1 - p)})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, y, 30 + p * 70, 14 + p * 30, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffd166";
  ctx.font = "600 12px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("⚡ SURPRISE", x, y - 34);
  ctx.restore();
}

function drawPickets(ctx: CanvasRenderingContext2D, v: ManeuverVector, cx: number, cy: number, wall: number) {
  // Posted pickets on the vector's approach — the screen that kills surprise.
  const spots: Record<ManeuverVector, Vec2[]> = {
    MAIN: [{ x: 430, y: 360 }, { x: 480, y: 372 }, { x: 530, y: 360 }],
    FLANK_LEFT: [{ x: 180, y: 330 }, { x: 230, y: 322 }],
    FLANK_RIGHT: [{ x: 780, y: 330 }, { x: 730, y: 322 }],
    REAR: [{ x: 430, y: 150 }, { x: 530, y: 150 }],
    RESERVE: [],
  };
  ctx.save();
  for (const s of spots[v] ?? []) {
    const x = s.x - cx * 0.55, y = s.y - cy * 0.55;
    const bob = Math.sin(wall * 0.002 + x) * 1.5;
    ctx.strokeStyle = C.screen;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 6 + bob);
    ctx.lineTo(x, y - 6 + bob);
    ctx.lineTo(x + 6, y + 6 + bob);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(159,216,255,0.7)";
  ctx.font = "10px system-ui";
  ctx.textAlign = "center";
  const first = (spots[v] ?? [])[0];
  if (first) ctx.fillText("SCREENED", first.x - cx * 0.55, first.y - cy * 0.55 - 14);
  ctx.restore();
}

function spawnSparks(
  particles: { x: number; y: number; vx: number; vy: number; life: number; max: number; col: string }[],
  x: number, y: number, col: string, n: number,
) {
  if (particles.length > 420) return;
  for (let i = 0; i < n; i++) {
    particles.push({
      x: x + (Math.random() - 0.5) * 60,
      y: y + (Math.random() - 0.5) * 10,
      vx: (Math.random() - 0.5) * 90,
      vy: -Math.random() * 70 - 10,
      life: 0,
      max: 0.5 + Math.random() * 0.5,
      col,
    });
  }
}

function stepParticles(
  ctx: CanvasRenderingContext2D,
  particles: { x: number; y: number; vx: number; vy: number; life: number; max: number; col: string }[],
  w: number, h: number,
) {
  const dt = 1 / 60;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.max || p.y > h + 20 || p.x < -20 || p.x > w + 20) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 160 * dt;
    const a = 1 - p.life / p.max;
    ctx.fillStyle = p.col;
    ctx.globalAlpha = a * 0.9;
    ctx.fillRect(p.x, p.y, 2.2, 2.2);
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
