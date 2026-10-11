// BattleReplayViewer — play back a captured battle (owner 2026-10-11).
//
// Plays the 1Hz keyframes (full replays) or the downsampled teaching tape
// (compact replays embedded in doctrines): dots interpolate between frames,
// kills/shells flash as event markers, and the scrubber jumps anywhere.
// This is the proof — the war room and the doctrine library both open it.

import { useEffect, useMemo, useRef, useState } from "react";
import type { BattleReplay, CompactReplay } from "../../game/war/battle-replays";

interface Dot {
  x: number;
  y: number;
  side: number; // 0 attacker, 1 defender
}

interface NormFrame {
  t: number;
  dots: Dot[];
}

interface NormEvent {
  t: number;
  kind: string;
  x?: number;
  y?: number;
}

function normalize(replay: BattleReplay | CompactReplay): { frames: NormFrame[]; events: NormEvent[]; durationS: number } {
  if ("frames" in replay && replay.frames.length > 0 && "units" in (replay.frames[0] as object)) {
    const r = replay as BattleReplay;
    return {
      frames: r.frames.map((f) => ({
        t: f.t,
        dots: f.units.map((u) => ({ x: u.x, y: u.y, side: u.s === "attacker" ? 0 : 1 })),
      })),
      events: r.events.map((e) => ({ t: e.t, kind: e.kind, x: e.x, y: e.y })),
      durationS: r.durationS,
    };
  }
  const r = replay as CompactReplay;
  return {
    frames: r.frames.map((f) => {
      const dots: Dot[] = [];
      for (let i = 0; i + 3 < f.u.length; i += 4) {
        dots.push({ x: f.u[i] / 100, y: f.u[i + 1] / 100, side: f.u[i + 2] });
      }
      return { t: f.t, dots };
    }),
    events: [],
    durationS: r.durationS,
  };
}

function fmtT(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function BattleReplayViewer({
  replay,
  title,
  onClose,
}: {
  replay: BattleReplay | CompactReplay;
  title: string;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const norm = useMemo(() => normalize(replay), [replay]);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const playRef = useRef(true);
  const speedRef = useRef(1);
  playRef.current = playing;
  speedRef.current = speed;

  const duration = Math.max(1, norm.durationS);

  // playback clock
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playRef.current) {
        tRef.current = Math.min(duration, tRef.current + dt * speedRef.current);
        setT(tRef.current);
        if (tRef.current >= duration) setPlaying(false);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration]);

  // render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c = canvas.getContext("2d");
    if (!c) return;
    const W = canvas.width;
    const H = canvas.height;
    c.fillStyle = "#0b0d13";
    c.fillRect(0, 0, W, H);
    // field border
    c.strokeStyle = "rgba(255,255,255,0.25)";
    c.lineWidth = 2;
    c.strokeRect(4, 4, W - 8, H - 8);

    const frames = norm.frames;
    if (frames.length === 0) return;
    // find bracketing frames + interpolate
    let i = 0;
    while (i < frames.length - 1 && frames[i + 1].t <= t) i++;
    const a = frames[i];
    const b = frames[Math.min(i + 1, frames.length - 1)];
    const span = Math.max(0.001, b.t - a.t);
    const f = Math.min(1, Math.max(0, (t - a.t) / span));
    const n = Math.max(a.dots.length, b.dots.length);
    for (let k = 0; k < n; k++) {
      const da = a.dots[k] ?? b.dots[k];
      const db = b.dots[k] ?? a.dots[k];
      if (!da || !db) continue;
      const x = (da.x + (db.x - da.x) * f) * W;
      const y = (db.y * f + da.y * (1 - f)) * H;
      c.fillStyle = da.side === 0 ? "#34d399" : "#ef4444";
      c.beginPath();
      c.arc(x, y, 3, 0, Math.PI * 2);
      c.fill();
    }
    // event flashes: kills/shells near the playhead
    for (const e of norm.events) {
      const age = t - e.t;
      if (age < 0 || age > 1.5 || e.x === undefined || e.y === undefined) continue;
      const alpha = 1 - age / 1.5;
      c.strokeStyle = e.kind === "shell" ? `rgba(251,191,36,${alpha})` : `rgba(248,113,113,${alpha})`;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(e.x * W, e.y * H, 4 + age * 14, 0, Math.PI * 2);
      c.stroke();
    }
    // attacker staging edge marker
    c.fillStyle = "rgba(52,211,153,0.5)";
    c.font = "10px system-ui";
    c.fillText("ATTACKER", 10, H - 10);
    c.fillStyle = "rgba(239,68,68,0.5)";
    c.fillText("DEFENDER", W - 70, 16);
  }, [t, norm]);

  const seek = (v: number) => {
    tRef.current = v;
    setT(v);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      data-testid="replay-viewer"
    >
      <div
        className="w-full max-w-[560px] rounded-2xl border border-white/15 bg-[#0b0d13] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="truncate text-sm font-bold text-white">🎬 {title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close replay"
            className="flex-none rounded-lg border border-white/15 px-2 py-1 text-xs text-zinc-300"
          >
            ✕
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width={520}
          height={340}
          className="w-full rounded-lg"
          data-testid="replay-canvas"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (tRef.current >= duration) {
                tRef.current = 0;
                setT(0);
              }
              setPlaying((p) => !p);
            }}
            aria-label={playing ? "Pause" : "Play"}
            className="flex-none rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white"
          >
            {playing ? "⏸" : "▶"}
          </button>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.5}
            value={t}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Replay position"
            className="min-w-0 flex-1 accent-amber-500"
            data-testid="replay-scrubber"
          />
          <span className="flex-none tabular-nums text-[11px] text-zinc-400">
            {fmtT(t)} / {fmtT(duration)}
          </span>
          <button
            type="button"
            onClick={() => setSpeed((s) => (s >= 4 ? 1 : s * 2))}
            aria-label={`Playback speed ${speed}x`}
            className="flex-none rounded-lg border border-white/15 px-2 py-1.5 text-[11px] text-zinc-300"
          >
            {speed}×
          </button>
        </div>
        <p className="mt-1 text-[10px] text-zinc-500">
          Green = attacker · red = defender · rings = kills/shells near the playhead
        </p>
      </div>
    </div>
  );
}

export default BattleReplayViewer;
