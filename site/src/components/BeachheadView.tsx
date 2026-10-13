// BEACHHEAD VIEW — THE WIDE PICTURE (design/beachhead.md §1, owner
// Oct 13 2026). The big scroll-over battlefield screen: the commander
// pans a miles-long front, reads both lines' weak spots at a glance, and
// commands FROM the wide view — garrison, assault, relieve — through the
// same server-judged order surface the model owns (war/beachheads.ts).
//
// EQUAL ACCESS (§1, locked): every player gets the whole-beachhead view.
// Nothing here gates by rank, role, or alliance — the map is ground truth
// and it renders identically for everyone who can see this state.
//
// Bunker states read at a glance (§2/§4A): HELD (filled = its owner's
// color), EMPTY (hollow — an open door), CONVERTING (owner color with a
// progress ring — taken, not yet solid), CONTESTED (split colors — the
// defender is back inside and the conversion clock is paused).
//
// The canvas speaks the battle layer's normalized-coordinate contract
// (x along the front 0..1, y depth 0..1, shore at the bottom) — the same
// selection model the battle radar uses, grown to the wide screen.
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "../game/types";
import type { GameResult } from "../game/api";
import { beachheadOrderFn } from "../game/api";
import {
  beachheadSummary,
  bunkerViewState,
  conversionProgress,
  forceCount,
  forceCounts,
  sameController,
  type Beachhead,
  type Bunker,
  type ControllerRef,
} from "../game/war/beachheads";
import { TROOP_TYPES, rosterByType, type TroopType } from "../game/war/troops";
import { useT } from "./i18n/I18n";
import { Icon } from "./icons";

type Act = (fn: () => Promise<GameResult>, label: string) => void;
type Verb = "garrison" | "assault" | "relieve";

const COLOR = {
  mine: "#34d399",
  chorus: "#fb7185",
  other: "#fbbf24",
  empty: "#3f3f46",
  convertingRing: "#e4e4e7",
};

function ownerColor(b: Bunker, viewer: ControllerRef): string {
  const owner = b.conversion?.by ?? b.garrison?.owner ?? b.controller;
  if (!owner) return COLOR.empty;
  if (sameController(owner, viewer)) return COLOR.mine;
  if (owner.colonyId === "chorus") return COLOR.chorus;
  return COLOR.other;
}

function troopLine(b: Bunker): string {
  const f = b.conversion ? b.conversion.crew : b.garrison;
  if (!f) return "";
  const counts = forceCounts(f);
  return TROOP_TYPES.filter((t) => counts[t] > 0)
    .map((t) => `${counts[t]} ${t}`)
    .join(" · ");
}

export default function BeachheadView({
  state,
  now,
  token,
  onAction,
}: {
  state: GameState;
  now: number;
  token?: string;
  onAction?: Act;
}) {
  const t = useT();
  const beachheads = state.beachheads ?? [];
  const [bhId, setBhId] = useState<string | null>(null);
  const bh: Beachhead | undefined = beachheads.find((b) => b.id === bhId) ?? beachheads[0];
  const viewer: ControllerRef = useMemo(
    () => ({
      colonyId: state.gameId ?? "",
      colonyName: state.playerName ?? "Commander",
      worldId: state.gameId ?? "home",
    }),
    [state.gameId, state.playerName],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected: Bunker | null = bh?.bunkers.find((b) => b.id === selectedId) ?? null;
  const [counts, setCounts] = useState<Record<TroopType, number>>({
    bulwark: 0, reaver: 0, longeye: 0, thunder: 0, warden: 0,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef({ cx: 0.5, cy: 0.5, scale: 0 }); // scale: px per 1.0 of world-x; 0 = fit
  const dragRef = useRef<{ pointers: Map<number, { x: number; y: number }>; moved: boolean; pinchD: number }>({
    pointers: new Map(),
    moved: false,
    pinchD: 0,
  });

  const summary = bh ? beachheadSummary(bh, viewer) : null;
  const available = state.troops ? rosterByType(state.troops.home.roster) : null;

  // ---- canvas paint ------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bh) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cam = camRef.current;
    if (cam.scale === 0) cam.scale = W * 0.98;
    // The front is miles wide and shallow: depth is SQUASHED relative to
    // the frontage so the whole strip (shore → rear) fits the frame at
    // fit-width zoom. One squash factor per canvas size, used by paint,
    // picking, pan and zoom alike — the coordinate contract stays exact.
    const ySquash = (H / Math.max(1, W)) * 0.86;
    const toPx = (wx: number, wy: number): [number, number] => [
      (wx - cam.cx) * cam.scale + W / 2,
      H / 2 - (wy - cam.cy) * cam.scale * ySquash,
    ];

    // Ground: deep inland → shore → water.
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#181a24");
    grad.addColorStop(0.72, "#23202a");
    grad.addColorStop(0.86, "#3a3230");
    grad.addColorStop(0.93, "#1d3a4a");
    grad.addColorStop(1, "#12303f");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Sector bands + labels (the weak-spot reading unit).
    const nSec = bh.sectors.length;
    ctx.font = "11px system-ui, sans-serif";
    for (const s of bh.sectors) {
      const [x0] = toPx(s.index / nSec, 0);
      const [x1] = toPx((s.index + 1) / nSec, 0);
      if (x1 < 0 || x0 > W) continue;
      if (s.index % 2 === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.025)";
        ctx.fillRect(x0, 0, x1 - x0, H);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0, H);
      ctx.stroke();
      ctx.fillStyle = "rgba(228,228,231,0.5)";
      ctx.fillText(s.label.toUpperCase(), x0 + 6, 16);
    }
    const [, shoreY] = toPx(0, 0.02);
    ctx.fillStyle = "rgba(228,228,231,0.35)";
    ctx.textAlign = "right";
    ctx.fillText(t("beachhead.shore", "THE SHORE — LANDING STRIP"), W - 8, Math.min(H - 8, shoreY + 14));
    ctx.textAlign = "start";

    // Bunkers.
    const size = Math.min(30, Math.max(6, cam.scale * 0.011));
    for (const b of bh.bunkers) {
      const [px, py] = toPx(b.x, b.y);
      if (px < -40 || px > W + 40 || py < -40 || py > H + 40) continue;
      const vState = bunkerViewState(b);
      const color = ownerColor(b, viewer);
      const half = size / 2;
      ctx.beginPath();
      ctx.roundRect(px - half, py - half, size, size, Math.min(5, size / 3));
      if (vState === "empty") {
        ctx.strokeStyle = "rgba(228,228,231,0.4)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = vState === "held" ? 0.9 : 0.65;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (vState === "contested") {
        // Split fill: the defender is back inside the taker's conversion.
        ctx.beginPath();
        ctx.roundRect(px - half, py - half, half, size, 2);
        ctx.fillStyle = COLOR.chorus;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (vState === "converting" || vState === "contested") {
        const p = conversionProgress(bh, b, now);
        ctx.beginPath();
        ctx.arc(px, py, half + 4, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        ctx.strokeStyle = COLOR.convertingRing;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (selectedId === b.id) {
        ctx.beginPath();
        ctx.arc(px, py, half + 8, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // Strength dot-count at high zoom: garrison headcount under the glyph.
      if (size >= 16 && vState !== "empty") {
        const f = b.conversion ? b.conversion.crew : b.garrison;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "bold 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(forceCount(f)), px, py + half + 12);
        ctx.textAlign = "start";
      }
    }
  });

  if (!bh || !summary) return null;

  // ---- camera + picking --------------------------------------------------
  const ySquashOf = (canvas: HTMLCanvasElement) =>
    (canvas.clientHeight / Math.max(1, canvas.clientWidth)) * 0.86;

  const zoomBy = (factor: number, px?: number, py?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cam = camRef.current;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const ys = ySquashOf(canvas);
    const ax = px ?? W / 2;
    const ay = py ?? H / 2;
    const wx = (ax - W / 2) / cam.scale + cam.cx;
    const wy = cam.cy - (ay - H / 2) / (cam.scale * ys);
    cam.scale = Math.min(W * 14, Math.max(W * 0.5, cam.scale * factor));
    cam.cx = wx - (ax - W / 2) / cam.scale;
    cam.cy = wy + (ay - H / 2) / (cam.scale * ys);
    forceRepaint();
  };

  const [, setPaintTick] = useState(0);
  const forceRepaint = () => setPaintTick((n) => n + 1);

  const pickBunker = (px: number, py: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !bh) return;
    const cam = camRef.current;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const ys = ySquashOf(canvas);
    let best: Bunker | null = null;
    let bestD = 26; // px pick radius
    for (const b of bh.bunkers) {
      const bx = (b.x - cam.cx) * cam.scale + W / 2;
      const by = H / 2 - (b.y - cam.cy) * cam.scale * ys;
      const d = Math.hypot(bx - px, by - py);
      if (d < bestD) { bestD = d; best = b; }
    }
    setSelectedId(best?.id ?? null);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current.pointers.set(e.pointerId, { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
    dragRef.current.moved = false;
    if (dragRef.current.pointers.size === 2) {
      const [a, b] = [...dragRef.current.pointers.values()];
      dragRef.current.pinchD = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const prev = drag.pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
    drag.pointers.set(e.pointerId, cur);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cam = camRef.current;
    if (drag.pointers.size === 1) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      if (drag.moved) {
        cam.cx -= dx / cam.scale;
        cam.cy += dy / (cam.scale * ySquashOf(canvas));
        forceRepaint();
      }
    } else if (drag.pointers.size === 2) {
      const [a, b] = [...drag.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (drag.pinchD > 0 && d > 0) {
        cam.scale = Math.min(canvas.clientWidth * 14, Math.max(canvas.clientWidth * 0.5, cam.scale * (d / drag.pinchD)));
        drag.moved = true;
        forceRepaint();
      }
      drag.pinchD = d;
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const wasMoved = drag.moved;
    drag.pointers.delete(e.pointerId);
    if (!wasMoved && drag.pointers.size === 0) {
      pickBunker(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    }
    if (drag.pointers.size === 0) drag.moved = false;
  };

  // ---- orders --------------------------------------------------------------
  const totalPicked = TROOP_TYPES.reduce((n, ty) => n + (counts[ty] || 0), 0);
  const issue = (verb: Verb, label: string) => {
    if (!bh || !selected || !token || !onAction) return;
    onAction(
      () => beachheadOrderFn({ data: { token, beachheadId: bh.id, bunkerId: selected.id, verb, troops: counts } }),
      label,
    );
  };

  const verbs: { verb: Verb; label: string; show: boolean }[] = selected
    ? (() => {
        const vState = bunkerViewState(selected);
        const mine = (f: ControllerRef | null | undefined) => !!f && sameController(f, viewer);
        const out: { verb: Verb; label: string; show: boolean }[] = [];
        if (vState === "empty") {
          out.push({ verb: "garrison", label: t("beachhead.garrison", "🏰 Garrison — move in and hold"), show: true });
        } else if (vState === "held") {
          if (mine(selected.garrison?.owner)) {
            out.push({ verb: "garrison", label: t("beachhead.reinforce", "➕ Reinforce garrison"), show: true });
            out.push({ verb: "relieve", label: t("beachhead.relieve", "🔄 Relieve — fresh force takes over"), show: true });
          } else {
            out.push({ verb: "assault", label: t("beachhead.assault", "⚔️ Assault — beat the garrison, start conversion"), show: true });
          }
        } else {
          // converting / contested
          const conv = selected.conversion!;
          if (mine(conv.by)) {
            out.push({ verb: "garrison", label: t("beachhead.reinforceCrew", "➕ Reinforce the conversion crew"), show: true });
            if (conv.defenderForce) {
              out.push({ verb: "assault", label: t("beachhead.clearReentry", "⚔️ Clear the re-entry — resume the clock"), show: true });
            }
          } else if (mine(conv.defender)) {
            out.push({ verb: "garrison", label: t("beachhead.reenter", "🛡️ Re-enter — move back in, pause their clock"), show: true });
            out.push({ verb: "assault", label: t("beachhead.retake", "⚔️ Retake — destroy the conversion crew"), show: true });
          }
        }
        return out;
      })()
    : [];

  const convertingList = bh.bunkers.filter((b) => b.conversion);

  return (
    <div className="rounded-xl border border-line bg-surf-2/40 p-4" data-testid="beachhead-view">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-1">
            <Icon name="emblem" size={16} /> {bh.name} — {t("beachhead.wideTitle", "The Wide Picture")}
          </h3>
          <p className="mt-0.5 max-w-2xl text-xs text-text-3">
            {t(
              "beachhead.intro",
              "Miles of front, read at a glance. Filled bunkers hold; empty ones are open doors — for you and for them. Taking a held bunker starts a conversion: it isn't yours until the work is done and it goes solid.",
            )}
          </p>
        </div>
        {beachheads.length > 1 && (
          <select
            className="rounded-md border border-line bg-surf-3 px-2 py-1 text-xs text-text-1"
            value={bh.id}
            onChange={(e) => { setBhId(e.target.value); setSelectedId(null); camRef.current.scale = 0; }}
            aria-label={t("beachhead.pick", "Choose beachhead")}
          >
            {beachheads.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-emerald-200">
          {t("beachhead.sumMine", "Held by you: {n}", { n: summary.heldByViewer })}
        </span>
        <span className="rounded-full border border-rose-400/40 bg-rose-400/10 px-2 py-0.5 text-rose-200">
          {t("beachhead.sumOthers", "Held by others: {n}", { n: summary.heldByOthers })}
        </span>
        <span className="rounded-full border border-line bg-surf-3 px-2 py-0.5 text-zinc-300">
          {t("beachhead.sumEmpty", "Empty doors: {n}", { n: summary.empty })}
        </span>
        <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-amber-200">
          {t("beachhead.sumConverting", "Converting: {n}", { n: summary.converting + summary.contested })}
        </span>
        <span className="rounded-full border border-line bg-surf-3 px-2 py-0.5 text-zinc-300">
          {t("beachhead.sumTotal", "{n} bunkers · {s} sectors", { n: summary.total, s: bh.sectors.length })}
        </span>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-line">
        <canvas
          ref={canvasRef}
          className="block h-[440px] w-full touch-none cursor-grab active:cursor-grabbing"
          role="application"
          aria-label={t("beachhead.mapLabel", "Beachhead wide-picture map — drag to pan, scroll or pinch to zoom, tap a bunker to select it")}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.nativeEvent.offsetX, e.nativeEvent.offsetY)}
          onKeyDown={(e) => {
            const cam = camRef.current;
            const step = 0.06;
            if (e.key === "ArrowLeft") { cam.cx -= step; forceRepaint(); }
            else if (e.key === "ArrowRight") { cam.cx += step; forceRepaint(); }
            else if (e.key === "ArrowUp") { cam.cy += step; forceRepaint(); }
            else if (e.key === "ArrowDown") { cam.cy -= step; forceRepaint(); }
            else if (e.key === "+" || e.key === "=") zoomBy(1.2);
            else if (e.key === "-") zoomBy(1 / 1.2);
            else return;
            e.preventDefault();
          }}
        />
        <div className="absolute right-2 top-2 flex gap-1">
          <button type="button" aria-label={t("beachhead.zoomIn", "Zoom in")} className="min-h-[44px] min-w-[44px] rounded-md border border-white/20 bg-black/60 text-lg text-white" onClick={() => zoomBy(1.35)}>+</button>
          <button type="button" aria-label={t("beachhead.zoomOut", "Zoom out")} className="min-h-[44px] min-w-[44px] rounded-md border border-white/20 bg-black/60 text-lg text-white" onClick={() => zoomBy(1 / 1.35)}>−</button>
          <button type="button" aria-label={t("beachhead.resetView", "Reset view")} className="min-h-[44px] min-w-[44px] rounded-md border border-white/20 bg-black/60 text-sm text-white" onClick={() => { camRef.current = { cx: 0.5, cy: 0.5, scale: 0 }; forceRepaint(); }}>⤢</button>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-3">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" />{t("beachhead.legendMine", "Yours")}</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-rose-400" />{t("beachhead.legendChorus", "Chorus")}</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />{t("beachhead.legendOther", "Another world")}</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-zinc-400" />{t("beachhead.legendEmpty", "Empty")}</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border-2 border-zinc-200" />{t("beachhead.legendConverting", "Converting (ring = progress)")}</span>
      </div>

      {convertingList.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {convertingList.map((b) => {
            const p = conversionProgress(bh, b, now);
            const conv = b.conversion!;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedId(b.id)}
                className="block w-full rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-left"
              >
                <span className="flex items-center justify-between text-xs">
                  <span className="font-medium text-amber-100">
                    {b.id.replace(`bk-${bh.id}-`, "Bunker ")} — {conv.by.colonyName}
                    {conv.defenderForce
                      ? t("beachhead.convContested", " converting · CONTESTED — defender back inside, clock paused")
                      : t("beachhead.convRunning", " converting")}
                  </span>
                  <span className="text-amber-200">{Math.floor(p * 100)}%</span>
                </span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-black/50">
                  <span className="block h-full bg-amber-300" style={{ width: `${Math.round(p * 100)}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected ? (
        <div className="mt-3 rounded-lg border border-line bg-surf-3/60 p-3" data-testid="beachhead-bunker-panel">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-text-1">
                {selected.id.replace(`bk-${bh.id}-`, "Bunker ")} · {bh.sectors.find((s) => s.id === selected.sectorId)?.label} · {selected.depth}
              </p>
              <p className="mt-0.5 text-xs text-text-2">
                {bunkerViewState(selected) === "empty" &&
                  (selected.controller
                    ? t("beachhead.stClaimedEmpty", "Claimed by {name} — but nobody's home. An open door.", { name: selected.controller.colonyName })
                    : t("beachhead.stEmpty", "Empty. Whoever moves troops in, holds it."))}
                {bunkerViewState(selected) === "held" &&
                  t("beachhead.stHeld", "Held by {name} ({world}) — {troops}", {
                    name: selected.garrison?.owner.colonyName ?? "",
                    world: selected.garrison?.owner.worldId ?? "",
                    troops: troopLine(selected),
                  })}
                {selected.conversion &&
                  t("beachhead.stConverting", "{by} is converting this position (taken from {def}). Until it goes solid, {def} may re-enter and restock.", {
                    by: selected.conversion.by.colonyName,
                    def: selected.conversion.defender.colonyName,
                  })}
              </p>
              {selected.conversion?.defenderForce && (
                <p className="mt-0.5 text-xs text-rose-200">
                  {t("beachhead.stDefInside", "Defenders back inside: {troops} — the conversion clock is paused.", {
                    troops: TROOP_TYPES.filter((ty) => forceCounts(selected.conversion!.defenderForce)[ty] > 0)
                      .map((ty) => `${forceCounts(selected.conversion!.defenderForce)[ty]} ${ty}`)
                      .join(" · "),
                  })}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label={t("beachhead.closePanel", "Close bunker panel")}
              className="min-h-[44px] min-w-[44px] rounded-md border border-line bg-surf-2 text-text-2"
            >
              ✕
            </button>
          </div>

          {token && onAction ? (
            <div className="mt-3">
              <div className="flex flex-wrap gap-2">
                {TROOP_TYPES.map((ty) => (
                  <label key={ty} className="flex items-center gap-1.5 rounded-md border border-line bg-surf-2 px-2 py-1 text-xs text-text-2">
                    <span className="capitalize">{ty}</span>
                    <input
                      type="number"
                      min={0}
                      max={available?.[ty] ?? 0}
                      value={counts[ty]}
                      onChange={(e) => setCounts((c) => ({ ...c, [ty]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) }))}
                      className="w-16 rounded border border-line bg-black/40 px-1.5 py-1 text-right text-text-1"
                      aria-label={`${ty} count`}
                    />
                    <span className="text-text-3">/ {available?.[ty] ?? 0}</span>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {verbs.map(({ verb, label }) => (
                  <button
                    key={verb + label}
                    type="button"
                    disabled={totalPicked <= 0}
                    onClick={() => issue(verb, label)}
                    className="min-h-[44px] rounded-lg border border-amber-400/40 bg-black/60 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-amber-200 hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {label}
                  </button>
                ))}
                {totalPicked <= 0 && (
                  <span className="self-center text-xs text-text-3">{t("beachhead.pickTroops", "Set troop counts from your home garrison to issue an order.")}</span>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-text-3">{t("beachhead.readOnly", "Viewing only — sign in to issue orders on this front.")}</p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-text-3">{t("beachhead.tapHint", "Tap a bunker on the map to read it and give orders. Drag to pan the front; scroll or pinch to zoom.")}</p>
      )}
    </div>
  );
}
