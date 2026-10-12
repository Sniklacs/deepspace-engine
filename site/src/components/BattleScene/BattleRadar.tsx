// BattleRadar — the tactical minimap (owner 2026-10-11).
//
// The whole 1.5×1.5 field in one glance: friendly dots vs enemy dots,
// turret diamonds, and event pings that flash where things are happening
// (kills, shell impacts, hot-drop landings). Dark and bordered so it reads
// over the battle; a scale bar gives the distance read.
//
// Reads the shared radar feed (game/war/battle-radar-feed.ts) on its own
// ~10Hz tick — the scene loop writes at ~4Hz and never waits on this.

import { useEffect, useRef } from "react";
import {
  radarFeed,
  RADAR_PING_TTL_MS,
} from "../../game/war/battle-radar-feed";
import { WORLD_W, WORLD_H } from "../../game/war/battle-scene-model";

const PAD = 10; // panel padding around the field

const FRIEND = "#34d399";
const FOE = "#f87171";

/**
 * Hans 2026-10-12: the radar is a command surface, not just a picture.
 * Pass `interactive` + `onTapWorld` to let taps direct troop movements
 * (e.g. when a squad's MOVE is armed). `size` scales the canvas.
 */
export function BattleRadar({
  interactive = false,
  onTapWorld,
  size = 148,
}: {
  interactive?: boolean;
  onTapWorld?: (x: number, y: number) => void;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const CSS = size;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = CSS * dpr;
    canvas.height = CSS * dpr;
    let raf = 0;
    let last = 0;

    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      if (nowMs - last < 100) return; // ~10Hz — dots don't need 60fps
      last = nowMs;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, CSS, CSS);

      // panel — dark and opaque so it reads over the fighting
      ctx.fillStyle = "rgba(4,7,13,0.86)";
      ctx.beginPath();
      ctx.roundRect(0, 0, CSS, CSS, 10);
      ctx.fill();
      // the visible border — the whole map scene inside it
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(1, 1, CSS - 2, CSS - 2, 9);
      ctx.stroke();

      const fw = CSS - PAD * 2;
      const fh = CSS - PAD * 2 - 14; // room for the scale bar
      const sx = (x: number) => PAD + (x / WORLD_W) * fw;
      const sy = (y: number) => PAD + (y / WORLD_H) * fh;

      // field edge
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD, PAD, fw, fh);

      // dots
      for (const d of radarFeed.dots) {
        const x = sx(d.x), y = sy(d.y);
        const c = d.side === "attacker" ? FRIEND : FOE;
        if (d.kind === "turret") {
          ctx.fillStyle = c;
          ctx.globalAlpha = 0.95;
          const r = 3.2;
          ctx.beginPath();
          ctx.moveTo(x, y - r); ctx.lineTo(x + r, y);
          ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
          ctx.closePath(); ctx.fill();
        } else {
          ctx.fillStyle = c;
          ctx.globalAlpha = d.alive ? 0.9 : 0.25;
          ctx.beginPath();
          ctx.arc(x, y, d.alive ? 2.1 : 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // event pings — expanding rings where things just happened
      const now = Date.now();
      for (const p of radarFeed.pings) {
        const age = now - p.atMs;
        if (age >= RADAR_PING_TTL_MS) continue;
        const k = age / RADAR_PING_TTL_MS; // 0 → 1
        const x = sx(p.x), y = sy(p.y);
        const col =
          p.kind === "shell" ? "255,170,60" :
          p.kind === "blast" ? "255,120,80" : "255,255,255";
        ctx.strokeStyle = `rgba(${col},${(1 - k) * 0.95})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 3 + k * 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(${col},${(1 - k) * 0.9})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // scale bar — 0.5 world units, so distances read at a glance
      const barUnits = 0.5;
      const barPx = (barUnits / WORLD_W) * fw;
      const by = PAD + fh + 8;
      ctx.strokeStyle = "rgba(255,255,255,0.65)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(PAD, by); ctx.lineTo(PAD + barPx, by);
      ctx.moveTo(PAD, by - 3); ctx.lineTo(PAD, by + 3);
      ctx.moveTo(PAD + barPx, by - 3); ctx.lineTo(PAD + barPx, by + 3);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.font = "600 9px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("0.5", PAD + barPx + 5, by);

      // tag
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "700 8px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText("RADAR", CSS - PAD, by);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [CSS]);

  // Tap → world coords → the commander's destination.
  const handleTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive || !onTapWorld) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const fw = CSS - PAD * 2;
    const fh = CSS - PAD * 2 - 14;
    const wx = ((px * CSS - PAD) / fw) * WORLD_W;
    const wy = ((py * CSS - PAD) / fh) * WORLD_H;
    if (wx < 0 || wy < 0 || wx > WORLD_W || wy > WORLD_H) return;
    onTapWorld(wx, wy);
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ width: CSS, height: CSS }}
      onPointerDown={interactive ? handleTap : undefined}
      className={`block ${interactive ? "cursor-crosshair touch-manipulation" : "pointer-events-none"}`}
      data-testid="battle-radar"
      data-interactive={interactive ? "true" : undefined}
      aria-label={
        interactive
          ? "Battle radar: tap to set the armed squad's destination"
          : "Battle radar: whole-field minimap"
      }
    />
  );
}
