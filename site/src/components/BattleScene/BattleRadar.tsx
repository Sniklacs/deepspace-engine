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
  onTapSquad,
  selectedSquadId = null,
  size = 148,
}: {
  interactive?: boolean;
  onTapWorld?: (x: number, y: number) => void;
  /** Blip tap (owner 2026-10-13): when no move is being aimed, tapping one
   *  of your squads' blips selects that squad — the radar commands, it
   *  doesn't just show. */
  onTapSquad?: (squadId: string) => void;
  /** The selected squad's blips are ringed so the commander can see which
   *  part of the line the next order will move. */
  selectedSquadId?: string | null;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const CSS = size;
  const selectedRef = useRef<string | null>(selectedSquadId);
  selectedRef.current = selectedSquadId;

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
          // The selected squad reads as a ringed cluster — the commander
          // sees exactly which stretch of the line the next tap moves.
          if (d.squadId && d.squadId === selectedRef.current) {
            ctx.globalAlpha = 0.95;
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.arc(x, y, 4.1, 0, Math.PI * 2);
            ctx.stroke();
          }
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

  // Tap → world coords → the commander's destination. The mapping is the
  // exact inverse of the draw transform (same PAD/field box), and it is
  // view-independent: the radar always spans the whole world, in MAP and
  // POV alike, so a radar order lands where the blips say it lands.
  const tapWorld = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const fw = CSS - PAD * 2;
    const fh = CSS - PAD * 2 - 14;
    const wx = ((px * CSS - PAD) / fw) * WORLD_W;
    const wy = ((py * CSS - PAD) / fh) * WORLD_H;
    if (wx < 0 || wy < 0 || wx > WORLD_W || wy > WORLD_H) return null;
    return { x: wx, y: wy };
  };

  const handleTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const w = tapWorld(e);
    if (!w) return;
    if (interactive && onTapWorld) {
      onTapWorld(w.x, w.y);
      return;
    }
    // No move being aimed: a tap on (or near) one of your squads' blips
    // selects that squad. Fat-finger radius — squads are clusters, so the
    // nearest friendly unit dot within the radius names the squad.
    if (onTapSquad) {
      let best: string | null = null;
      let bd = 0.09; // world units — ~20px on the expanded radar
      for (const d of radarFeed.dots) {
        if (d.side !== "attacker" || d.kind !== "unit" || !d.alive || !d.squadId) continue;
        const dist = Math.hypot(d.x - w.x, d.y - w.y);
        if (dist < bd) { bd = dist; best = d.squadId; }
      }
      if (best) onTapSquad(best);
    }
  };

  const tappable = interactive || !!onTapSquad;

  return (
    <canvas
      ref={canvasRef}
      style={{ width: CSS, height: CSS }}
      onPointerDown={tappable ? handleTap : undefined}
      className={`block ${tappable ? "cursor-crosshair touch-manipulation" : "pointer-events-none"}`}
      data-testid="battle-radar"
      data-interactive={interactive ? "true" : undefined}
      aria-label={
        interactive
          ? "Battle radar: tap to set the squad's destination"
          : onTapSquad
            ? "Battle radar: tap one of your squads to select it"
            : "Battle radar: whole-field minimap"
      }
    />
  );
}
