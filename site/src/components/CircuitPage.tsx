// ============================================================================
// CIRCUIT PAGE — the full-screen THE CIRCUIT view
// (design/circuit-fullscreen-page.md · the authoritative spec).
//
// Rendered by play.tsx when tab === "circuit" (route stays inside play.tsx —
// the auth/session/polling context lives there; §0). Occupies 100dvh and
// shares no chrome with the other tabs: a slim 56px circuit chrome replaces
// the Shell header + TabBar. Global overlays (ledger, reports, help,
// feedback, games, toasts) stay mounted by play.tsx as siblings.
//
// Map stage = the existing map.ts generator (30-node shattered circuit-web:
// 11 authored anchors + 19 V9 foothold sites, seeded row permutations per
// world), rendered with §2 fit / pan / zoom: viewBox coordinates never become
// pixels, the hit-floor cap keeps the invisible r26 tap circle ≥ 44px CSS
// diameter, native pan (overflow scroll) + pinch (touch-action), +/− ×1.25
// zoom clamped 0.5–3×, ⇱ reset, zoom-tier label gates. Layer order per §2.4 —
// hit circles are always topmost for pointer events; colony-marker layer
// reserved (§6.2).
//
// Legend: desktop ≥1024 = 300px always-visible right rail; <1024 = 40px
// compact rail + full-legend Sheet. Copy VERBATIM from §4.1/§4.2.
// ============================================================================
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useT, useLang } from "./i18n/I18n";
import type { GameState, RaceId } from "../game/types";
import { generateAtlas, nodeById } from "../game/map";
import type { AtlasNode, AtlasGraph } from "../game/map";
import { WORLD_CONFIG_PUBLIC } from "../game/world-config";
import { getRace, raceText } from "../game/races";
import { getZone, zoneFlavor, zoneName } from "../game/zones";
import { getContributionFn } from "../game/api";
import type { ContributionView, ContributionRow } from "../game/api";
import { sound } from "../game/sound";
import { openWindow } from "../game/windows/window-store";
import { SegmentedControl } from "./SegmentedControl";
import PageBanner from "./PageBanner";
import { LedgerButton } from "./LedgerButton";
import { Sheet, SheetHeader } from "./Sheet";
import { Icon } from "./icons";
import { Tooltip } from "./Tooltip";
import {
  coveredNodeIds,
  satelliteStage,
  satelliteIntelFor,
  satelliteTechFor,
  satelliteTechId,
} from "../game/satellites";
import { fmtDuration } from "../game/i18n/format";
import { leaderName } from "../game/research";
import {
  resolveLabels,
  DISPLAY_NAMES,
  LABEL_DY,
} from "../game/circuit-labels";
import {
  TIER_COLORS,
  KIND_COLORS,
  TRACE_COLORS,
  LABEL_COLORS,
  RING_COLORS,
  HIT_RADIUS,
  HIT_FLOOR_PX,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  SIGIL_COLORS,
  RIM_FALLBACK_FILL,
  WAR_SWATCH_COLORS,
  SATELLITE_COLORS,
} from "../game/circuit-tokens";
import {
  ISLAND_W,
  ISLAND_H,
  ISLAND_IMAGE,
  islandPos,
  SEAM_BANDS,
  ISLAND_SAT_RING,
  ISLAND_RIM_FILL_OPACITY,
  ISLAND_RIM_RING,
  ISLAND_TRACE,
  ISLAND_NODE_RADIUS,
} from "../game/circuit-island-map";

export interface CircuitPageProps {
  state: GameState;
  token: string;
  /** ◀ Return — play.tsx switches back to the Cradle tab (and restores focus
   *  to the Circuit tab button in the Shell nav). */
  onClose: () => void;
  muted: boolean;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  onLedger: () => void;
  unread: number;
  onReports: () => void;
  /** ORBITAL WATCH: open the Lab (Research) tab so the player can appoint a
   *  Leader to a satellite climb. play.tsx wires this to setTab("lab"). */
  onOpenLab?: () => void;
  /** ORBITAL WATCH: upgrade a satellite straight from the node sheet pop-up —
   *  no detour through the Lab or the research window. */
  now?: number;
  onBeginResearch?: (techId: string, leaderId: string) => void;
}

type Seg = "map" | "world";

export function CircuitPage({
  state,
  token,
  onClose,
  muted,
  onToggleMute,
  onToggleFullscreen,
  isFullscreen,
  onLedger,
  unread,
  onReports,
  onOpenLab,
  now,
  onBeginResearch,
}: CircuitPageProps) {
  const t = useT();
  const circuit: AtlasGraph = useMemo(
    () => generateAtlas({ worldId: WORLD_CONFIG_PUBLIC.worldId, raceId: WORLD_CONFIG_PUBLIC.raceLock }),
    [],
  );
  const race = getRace(state.race!);
  // ORBITAL WATCH (design/satellites.md §0.1): the covered set is geography —
  // rim + heart nodes carry dishes; Near ring / Cradle are sanctioned land.
  const satCovered = useMemo(() => new Set(coveredNodeIds(WORLD_CONFIG_PUBLIC.worldId)), []);
  // The satellite ring: the same covered set, in atlas order, for the orbit
  // ring drawn around the map (one marker per bird, state-colored).
  const satRingIds = useMemo(() => coveredNodeIds(WORLD_CONFIG_PUBLIC.worldId), []);

  // Rung 1a §E — Contribution is the Circuit's "World" segment. §6.4: a
  // third Battles option joins only in war phases — the SegmentedControl
  // options array already supports it; nothing changes here.
  const SEG_OPTIONS = [
    { id: "map", label: t("circuit.segMap", "Map") },
    { id: "world", label: t("circuit.segWorld", "World") },
  ];
  const [seg, setSeg] = useState<Seg>("map");
  const [sel, setSel] = useState<string | null>(null);
  const selNode = sel ? nodeById(circuit, sel) : undefined;
  const [isDesktop, setIsDesktop] = useState(false);
  const [legendSheetOpen, setLegendSheetOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /* ---- map stage geometry: THE ISLAND — the owner's map is the whole stage.
     Fixed 1120×2240 aspect, deliberately NOT aspect-stretched the way the old
     circuit-web was: every marker is pinned to its terrain feature, so the
     x-scale stays 1 and the canvas never changes shape (fit = contain). ---- */
  const canvas = { w: ISLAND_W, h: ISLAND_H, kx: 1 };
  const [fit, setFit] = useState(0);
  const [zoom, setZoom] = useState(1); // multiplier over the fit-capped base
  const stageRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<{ x: number; y: number } | null>(null);
  const pendingReset = useRef(false);
  const lastInner = useRef<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      // The island is fixed-aspect: fit = contain, so the whole island is
      // visible at zoom 1 and pan/zoom take over from there. The LAYOUT box
      // (offsetWidth/offsetHeight) is the stable measurement source — it does
      // not move when scrollbars appear, so no measure/commit feedback loop.
      const stageW = stage.offsetWidth || stage.clientWidth;
      const stageH = stage.offsetHeight || stage.clientHeight;
      if (stageW <= 0 || stageH <= 0) return;
      setFit(Math.min(stageW / ISLAND_W, stageH / ISLAND_H));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // The 44px tap floor, kept at EVERY zoom: the whole island is visible at
  // zoom 1 (fit = contain — no forced overscale on phones), and the invisible
  // hit circles size themselves as max(HIT_RADIUS, 22/scale) so they never
  // render below a 22px CSS radius no matter the zoom. Tapping stays easy;
  // the map stays whole.
  const baseScale = fit;
  const scale = baseScale * zoom;

  const zoomBy = (dir: 1 | -1) => {
    const stage = stageRef.current;
    const inner = innerRef.current;
    if (stage && inner) {
      // Keep the content point under the viewport center anchored on zoom.
      anchorRef.current = {
        x: (stage.scrollLeft + stage.clientWidth / 2) / (inner.clientWidth || 1),
        y: (stage.scrollTop + stage.clientHeight / 2) / (inner.clientHeight || 1),
      };
    }
    setZoom((z) =>
      Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * (dir === 1 ? ZOOM_STEP : 1 / ZOOM_STEP))),
    );
  };

  const resetView = () => {
    pendingReset.current = true;
    setZoom(1);
  };

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const inner = innerRef.current;
    if (!stage || !inner) return;
    const prev = lastInner.current;
    lastInner.current = { w: inner.clientWidth, h: inner.clientHeight };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (pendingReset.current) {
      pendingReset.current = false;
      const tx = Math.max(0, (inner.clientWidth - stage.clientWidth) / 2);
      const ty = Math.max(0, (inner.clientHeight - stage.clientHeight) / 2);
      stage.scrollTo({ left: tx, top: ty, behavior: reduced ? "auto" : "smooth" });
      return;
    }
    if (prev && anchorRef.current) {
      const a = anchorRef.current;
      anchorRef.current = null;
      stage.scrollLeft = Math.max(0, a.x * inner.clientWidth - stage.clientWidth / 2);
      stage.scrollTop = Math.max(0, a.y * inner.clientHeight - stage.clientHeight / 2);
    }
  }, [scale]);

  // §1.4 label zoom tiers — on the island, names are ALWAYS on: the tier
  // never drops to "low" (which hides labels), and the type size keeps the
  // 11px CSS floor at any zoom (fontUnits = 11/scale). Hans's rule: every
  // site gets its name on the map for quick reference — no tap needed.
  const tier = scale >= 1 ? "full" : "mid";
  const fontUnits = tier === "full" ? 11 : 11 / Math.max(scale, 1e-6);
  // §2.1 — the deterministic collision ladder (full → compact → hidden). The
  // ladder's geometry helper (canvasX) maps authored x as x + 280 at kx 1, so
  // island positions are shifted by −280 on the way in; the returned
  // placements land back in island space. y is untouched either way. Pure
  // geometry, memoised on tier + selection only.
  const labelNodes = useMemo(
    () =>
      circuit.nodes.map((n) => ({
        id: n.id,
        x: islandPos(n.id).x - 280,
        y: islandPos(n.id).y,
        kind: n.kind,
        importance: n.importance ? { tier: n.importance.tier } : null,
        // the ladder's circle-box test must measure the circles we render
        r: ISLAND_NODE_RADIUS[n.kind],
      })),
    [circuit],
  );
  const labels = useMemo(
    () =>
      resolveLabels(labelNodes, {
        tier,
        fontUnits,
        canvasW: ISLAND_W,
        kx: 1,
        selectedId: sel,
      }),
    [labelNodes, tier, fontUnits, sel],
  );

  // Focus the map container on entry (§7); Return restores focus to the
  // Shell nav button via play.tsx's onClose.
  const mapFocusedRef = useRef(false);
  useEffect(() => {
    if (!mapFocusedRef.current) {
      mapFocusedRef.current = true;
      stageRef.current?.focus();
    }
  }, []);

  const tierPip = (tt: ReturnType<typeof useT>, tier: number) => tt(`circuit.tierPip${tier}`, tier === 1 ? "T1" : tier === 2 ? "T2" : "T3");

  return (
    <div className="flex h-screen flex-col bg-surf-0 text-gray-200" style={{ height: "100dvh" }}>
      {/* §1.4 circuit chrome — 56px, surf-1, sticky */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surf-1 px-2 md:px-3">
        <button
          onClick={seg === "world" && !isDesktop ? () => { setSeg("map"); sound.tab(); } : onClose}
          aria-label={seg === "world" && !isDesktop ? t("circuit.backToMap", "Back to Map") : t("circuit.returnToCradle", "Return to the Cradle")}
          title={seg === "world" && !isDesktop ? t("circuit.backToMap", "Back to Map") : t("circuit.returnToCradle", "Return to the Cradle")}
          className="flex h-11 min-w-11 flex-none items-center justify-center gap-1.5 rounded-lg px-2 text-text-2 hover:bg-white/10"
        >
          <span aria-hidden="true">◀</span>
          <span className="hidden text-sm font-medium md:inline">
            {seg === "world" && !isDesktop ? t("circuit.backToMap", "Back to Map") : t("circuit.returnToCradleShort", "Return to Cradle")}
          </span>
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold leading-tight text-text-1">{t("circuit.title", "THE CIRCUIT")}</h1>
            <span
              className="chip flex-none border"
              style={{
                borderColor: "rgba(255,255,255,0.15)",
                background: `var(--race-${race.id}-tint)`,
                color: `var(--race-${race.id}-text)`,
              }}
            >
              {raceText(t, race, "name", race.name)}
            </span>
            {isDesktop && WORLD_CONFIG_PUBLIC.debugWorld && (
              <span className="chip flex-none border border-purple-400/30 bg-purple-400/15 font-semibold uppercase tracking-wider text-purple-200">
                {t("circuit.betaWorld", "Beta Test World")}
              </span>
            )}
          </div>
          {isDesktop && <p className="truncate text-sm leading-tight text-text-3">{t("circuit.subtitle", "the shattered circuit-web of the old world")}</p>}
        </div>
        <div className="ms-auto flex flex-none items-center gap-1.5">
          {isDesktop && (
            <SegmentedControl
              ariaLabel={t("circuit.segAria", "Circuit view — map or world")}
              options={SEG_OPTIONS}
              value={seg}
              onChange={(id) => { setSeg(id as Seg); sound.tab(); }}
              className="me-1"
            />
          )}
          <Tooltip content={t("circuit.reportsHint", "Reports — what came home while you watched.")}>
            <button
              onClick={onReports}
              aria-label={unread > 0 ? t("circuit.reportsAriaNew", "Reports — {n} new", { n: unread }) : t("circuit.reportsAriaIdle", "Reports — nothing new")}
              title={unread > 0 ? t("circuit.reportsTitleNew", "{n} new reports", { n: unread }) : t("circuit.reportsTitle", "Reports")}
              className={`relative flex h-11 min-w-11 items-center justify-center rounded-lg border px-2.5 ${
                unread > 0
                  ? "report-blink border-ember/80 bg-ember/10 text-ember-soft"
                  : "border-line text-text-2 hover:bg-white/10"
              }`}
            >
              <Icon name="bell" size={15} aria-hidden="true" />
              {unread > 0 && (
                <span className="num absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-ember px-1 text-[11px] font-bold leading-none text-black">
                  {unread}
                </span>
              )}
            </button>
          </Tooltip>
          <Tooltip content={muted ? t("circuit.unmute", "Unmute") : t("circuit.mute", "Mute")}>
            <button
              onClick={onToggleMute}
              title={muted ? t("circuit.unmute", "Unmute") : t("circuit.mute", "Mute")}
              aria-label={muted ? t("circuit.unmuteAudio", "Unmute audio") : t("circuit.muteAudio", "Mute audio")}
              className="flex h-11 min-w-11 items-center justify-center rounded-lg border border-line text-text-2 hover:bg-white/10"
            >
              {muted ? "🔇" : "🔊"}
            </button>
          </Tooltip>
          <Tooltip content={isFullscreen ? t("circuit.exitFullscreen", "Exit full screen") : t("circuit.fullscreen", "Full screen")}>
            <button
              onClick={onToggleFullscreen}
              title={isFullscreen ? t("circuit.exitFullscreen", "Exit full screen") : t("circuit.fullscreen", "Full screen")}
              aria-label={isFullscreen ? t("circuit.exitFullscreen", "Exit full screen") : t("circuit.fullscreen", "Full screen")}
              className="flex h-11 min-w-11 items-center justify-center rounded-lg border border-line text-text-2 hover:bg-white/10 md:block"
            >
              {isFullscreen ? "🗗" : "⛶"}
            </button>
          </Tooltip>
          <LedgerButton scrip={state.currency.scrip} votives={state.currency.votives} onClick={onLedger} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* -------- left: map stage / world scroll (flex-1 min-w-0) -------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!isDesktop && seg === "map" && <CompactLegendRail />}
          {seg === "world" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* §6.3 — mobile: Who's-Here card renders at the top of World
                  (desktop keeps its rail card; nothing else changes). */}
              {!isDesktop && (
                <div className="px-4 pt-4">
                  <WhosHereCard />
                </div>
              )}
              <ContributionTab state={state} token={token} />
            </div>
          ) : (
            <div
              ref={stageRef}
              tabIndex={-1}
              aria-label={t("circuit.mapAria", "The Circuit — world map")}
              className="circuit-stage relative min-h-0 flex-1 overflow-auto bg-surf-0 outline-none"
            >
              <div className="flex h-full min-h-full w-full min-w-full">
                <div
                  ref={innerRef}
                  className="circuit-map-inner relative m-auto flex-none"
                  // THE ISLAND — the owner's survey art is the whole map. No
                  // veil: the terrain reads at full strength and the halo'd
                  // labels carry the contrast. Markers are pinned to the
                  // island-space coordinates in game/circuit-island-map.ts.
                  style={{
                    width: canvas.w * scale,
                    height: canvas.h * scale,
                  }}
                >
                  <svg
                    viewBox={`0 0 ${ISLAND_W} ${ISLAND_H}`}
                    className={`circuit-zoom-${tier} block h-full w-full select-none`}
                    role="img"
                    aria-label={t("circuit.mapSvgAria", "The Circuit — world map: territories, traces, and the Chorus-held heart")}
                  >
                    {/* LAYER 0 — the island itself: the owner's land-survey art,
                        full-bleed. Everything else sits in this same space. */}
                    <image
                      href={ISLAND_IMAGE}
                      x={0} y={0} width={ISLAND_W} height={ISLAND_H}
                      preserveAspectRatio="xMidYMid slice"
                      aria-hidden="true"
                    />
                    {/* Region seam banners — HTML overlays, NOT SVG text: they track the
                        island by percentage but keep a constant readable size
                        at any zoom (SVG text would scale with the viewBox and
                        blow up when zoomed). Decorative, non-interactive. */}
                    {SEAM_BANDS.map((sb) => (
                      <div
                        key={sb.label}
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: `${sb.yPct * 100}%`,
                          transform: "translate(-50%, -50%)",
                          pointerEvents: "none",
                          whiteSpace: "nowrap",
                          fontSize: 13,
                          fontWeight: 700,
                          letterSpacing: ".35em",
                          textIndent: ".35em",
                          color: "rgba(226,232,240,0.55)",
                          textShadow: "0 1px 10px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)",
                          zIndex: 2,
                        }}
                      >
                        {sb.label}
                      </div>
                    ))}
                    {/* LAYER 0b — the satellite ring, in the ocean around the
                        island. One marker per covered node (the constellation,
                        in atlas order), state-colored: hollow red = dormant,
                        filled green = awake. Shape + color, never color alone.
                        Decorative redundancy — the dish beside each node is the
                        information channel — so this group is aria-hidden and
                        the hit circles own every tap. */}
                    <g aria-hidden="true" style={{ pointerEvents: "none" }}>
                      <ellipse
                        cx={ISLAND_SAT_RING.cx} cy={ISLAND_SAT_RING.cy}
                        rx={ISLAND_SAT_RING.rx} ry={ISLAND_SAT_RING.ry}
                        fill="none"
                        stroke={TRACE_COLORS.road}
                        strokeOpacity={0.25}
                        strokeWidth={1}
                      />
                      {satRingIds.map((id, i) => {
                        const a = ((-90 + (i * 360) / satRingIds.length) * Math.PI) / 180;
                        const mx = ISLAND_SAT_RING.cx + ISLAND_SAT_RING.rx * Math.cos(a);
                        const my = ISLAND_SAT_RING.cy + ISLAND_SAT_RING.ry * Math.sin(a);
                        const awake = satelliteStage(state, id) > 0;
                        return awake ? (
                          <circle
                            key={id}
                            cx={mx} cy={my} r={ISLAND_SAT_RING.markerR}
                            fill={SATELLITE_COLORS.activeFill}
                            stroke={SATELLITE_COLORS.activeRing}
                            strokeWidth={1}
                          />
                        ) : (
                          <circle
                            key={id}
                            cx={mx} cy={my} r={ISLAND_SAT_RING.markerR}
                            fill="none"
                            stroke={SATELLITE_COLORS.dormantFill}
                            strokeWidth={1.5}
                          />
                        );
                      })}
                    </g>
                    {/* Traces — the old roads, drawn between island positions at a
                        whisper so the survey art reads first. */}
                    <g aria-hidden="true" style={{ pointerEvents: "none" }}>
                      {circuit.edges.map((e, i) => {
                        const a = islandPos(e.from);
                        const b = islandPos(e.to);
                        const selected = sel !== null && (e.from === sel || e.to === sel);
                        if (e.kind === "severed") {
                          const gx = b.x - a.x;
                          const gy = b.y - a.y;
                          const p1 = { x: a.x + gx * 0.42, y: a.y + gy * 0.42 };
                          const p2 = { x: b.x - gx * 0.42, y: b.y - gy * 0.42 };
                          return (
                            <g key={i}>
                              <line x1={a.x} y1={a.y} x2={p1.x} y2={p1.y} stroke={TRACE_COLORS.severed} strokeWidth="1.5" strokeOpacity={selected ? 0.9 : ISLAND_TRACE.severedOpacity} />
                              <line x1={p2.x} y1={p2.y} x2={b.x} y2={b.y} stroke={TRACE_COLORS.severed} strokeWidth="1.5" strokeOpacity={selected ? 0.9 : ISLAND_TRACE.severedOpacity} />
                            </g>
                          );
                        }
                        const nearEdge =
                          nodeById(circuit, e.from)?.kind === "near" || nodeById(circuit, e.to)?.kind === "near";
                        return (
                          <line
                            key={i}
                            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                            stroke={e.kind === "road" ? (nearEdge ? TRACE_COLORS.roadNear : TRACE_COLORS.road) : ISLAND_TRACE.ruinColor}
                            strokeWidth={selected ? 3 : e.kind === "road" ? ISLAND_TRACE.roadWidth : 2}
                            strokeOpacity={selected ? 0.95 : e.kind === "road" ? (nearEdge ? ISLAND_TRACE.roadOpacity * 0.8 : ISLAND_TRACE.roadOpacity) : ISLAND_TRACE.ruinOpacity}
                            strokeDasharray={e.kind === "ruinPass" ? "5 5" : undefined}
                          />
                        );
                      })}
                    </g>
                    {/* LAYER 2–6 — per-node visuals (fills, rings, sigils, labels).
                        pointer-events: none so the hit circles (layer 8) own every tap. */}
                    <g aria-hidden="true" style={{ pointerEvents: "none" }}>
                      {circuit.nodes.map((n) => {
                        const r = nodeRadius(n);
                        const ip = islandPos(n.id);
                        const nx = ip.x;
                        const ny = ip.y;
                        const place = labels.get(n.id);
                        // §1.4 — names, sub-label and pips are all TEXT: they share
                        // the 11px floor (fontUnits × scale ≥ 11) and the halo.
                        const halo = {
                          paintOrder: "stroke" as const,
                          stroke: LABEL_COLORS.halo,
                          strokeWidth: 3,
                          strokeLinejoin: "round" as const,
                        };
                        return (
                          <g key={n.id}>
                            {/* zone fill — tier wash over terrain (denser than
                                the old 22%-over-surf-0 recipe, which vanishes
                                over ice and farmland) */}
                            <circle
                              cx={nx} cy={ny} r={r}
                              fill={nodeFill(n)}
                              fillOpacity={n.kind === "rim" ? ISLAND_RIM_FILL_OPACITY : 1}
                              stroke={sel === n.id ? "rgba(255,255,255,0.95)" : n.kind === "rim" ? ISLAND_RIM_RING : nodeRing(n)}
                              strokeWidth={sel === n.id ? 3 : n.kind === "rim" ? 2 : n.kind === "heart" ? 3 : 1.5}
                              className={n.kind === "heart" ? "animate-pulse" : undefined}
                            />
                            {/* sigils (layer 5) — symbols, not text: authored sizes */}
                            {n.kind === "heart" && <text x={nx} y={ny + 7} textAnchor="middle" fontSize="22">🔥</text>}
                            {n.kind === "cradle" && <text x={nx} y={ny + 6} textAnchor="middle" fontSize="19">🔰</text>}
                            {n.kind === "rim" && n.importance && (
                              <text className="cl-pip" x={nx + r * 0.8} y={ny - r * 0.8} textAnchor="middle" fontSize={fontUnits} fontWeight="bold" fill={TIER_COLORS[n.importance.tier]} {...halo}>
                                {tierPip(t, n.importance.tier)}
                              </text>
                            )}
                            {n.kind === "rim" && n.id === "shattered-academies" && (
                              <text x={nx} y={ny - r - 6} textAnchor="middle" fontSize="13" fill={SIGIL_COLORS.heartZoneStar}>★</text>
                            )}
                            {/* ORBITAL WATCH dishes (design/satellites.md §0.5) —
                                status + stage numeral, never color alone. Red =
                                dormant, green + numeral = awake at that stage.
                                Lives in this pointer-events:none group — the hit
                                circles own every tap; the NodeSheet is the
                                research surface. Upper-left so it never meets
                                the tier pips (upper-right). */}
                            {satCovered.has(n.id) && (() => {
                              const stage = satelliteStage(state, n.id);
                              const awake = stage > 0;
                              return (
                                <g key={`sat-${n.id}`} transform={`translate(${nx - r - 14},${ny - r - 10})`}>
                                  <circle
                                    r={9}
                                    fill={awake ? SATELLITE_COLORS.activeFill : SATELLITE_COLORS.dormantFill}
                                    stroke={awake ? SATELLITE_COLORS.activeRing : SATELLITE_COLORS.dormantRing}
                                    strokeWidth={1.5}
                                  />
                                  {awake && (
                                    <text textAnchor="middle" dy="3.8" fontSize="11" fontWeight="bold" fill={SATELLITE_COLORS.activeInk}>
                                      {stage}
                                    </text>
                                  )}
                                </g>
                              );
                            })()}
                            {/* labels (layer 6, §2.1 ladder) — every site is named:
                                the ladder places without overlap, and a node it
                                can't place falls back to its compact name below
                                the marker. Nothing below 11px, ever. */}
                            {(() => {
                              // Every site gets its name on the map — the ladder
                              // places 29 of 30 without overlap; a node it hides
                              // falls back to its compact name at the default
                              // drop, so nothing is ever nameless.
                              const names = DISPLAY_NAMES[n.id];
                              const lx = place ? place.cx : nx;
                              const ly = place ? place.cy : ny + LABEL_DY[n.kind] - 0.375 * fontUnits;
                              const ltext = place ? place.text : names?.compact;
                              if (!ltext) return null;
                              return (
                                <text
                                  className="cl-full"
                                  x={lx} y={ly} textAnchor="middle" fontSize={fontUnits}
                                  fill={n.kind === "heart" ? LABEL_COLORS.heart : n.kind === "cradle" ? LABEL_COLORS.cradle : LABEL_COLORS.node}
                                  fontWeight={500} fontFamily="'Segoe UI',system-ui,sans-serif"
                                  {...halo}
                                >
                                  {ltext}
                                </text>
                              );
                            })()}
                            {/* the heart's "THE PRIZE · THE THREAT" line now lives
                                on the 3.2% seam band above — no duplicate. */}
                          </g>
                        );
                      })}
                    </g>
                    {/* LAYER 8 — invisible hit circles: ALWAYS topmost for pointer
                        events. The 44px tap floor holds at every zoom: radius
                        is max(HIT_RADIUS, 22/scale) viewBox units, so the
                        circle never renders below a 22px CSS radius. */}
                    <g>
                      {circuit.nodes.map((n) => {
                        const ip = islandPos(n.id);
                        const title = nodeTitle(t, n);
                        const hitR = Math.max(HIT_RADIUS, scale > 0 ? HIT_FLOOR_PX / scale : HIT_RADIUS);
                        return (
                          <g
                            key={n.id}
                            className="circuit-node"
                            role="button"
                            tabIndex={0}
                            aria-pressed={sel === n.id}
                            aria-label={title}
                            onClick={() => { setSel(n.id === sel ? null : n.id); sound.tab(); }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSel(n.id === sel ? null : n.id);
                                sound.tab();
                              }
                            }}
                            style={{ opacity: n.kind === "near" ? 0.6 : 1 }}
                          >
                            <circle cx={ip.x} cy={ip.y} r={hitR} fill="transparent" />
                            <title>{title}</title>
                          </g>
                        );
                      })}
                    </g>
                    {/* LAYER 4 (reserved): colony-marker dots — 10px race-accent
                        ring-dot at the node ring (r + 14), non-interactive; ships
                        with server presence (§6.2). Not built — no data yet. */}
                  </svg>
                </div>
              </div>
              {/* floating controls — desktop only (§1.3); mobile lives in the DOCK */}
              {isDesktop && <FloatingControls onLegend={focusLegend} onReset={resetView} onZoomIn={() => zoomBy(1)} onZoomOut={() => zoomBy(-1)} />}
            </div>
          )}
          {/* mobile dock — never on desktop (§1.2/§6.4 reserves FOBs slot) */}
          {!isDesktop && (
            <div className="flex h-14 shrink-0 items-center gap-2 border-t border-line bg-surf-1 px-2">
              <SegmentedControl
                ariaLabel={t("circuit.segAria", "Circuit view — map or world")}
                options={SEG_OPTIONS}
                value={seg}
                onChange={(id) => { setSeg(id as Seg); sound.tab(); }}
              />
              {/* §6.4 reserved: [FOBs ▾] + live score chip land here, left of Legend ▸,
                  when the war overlay ships. No placeholder ghosts today. */}
              <div className="ms-auto flex flex-none items-center gap-1">
                <button
                  onClick={() => { setLegendSheetOpen(true); sound.click(); }}
                  aria-label={t("circuit.openLegend", "Open the full Circuit legend")}
                  title={t("circuit.legendShort", "Legend")}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-text-2 hover:bg-white/10"
                >
                  <span aria-hidden="true">▾</span>
                </button>
                <button
                  onClick={resetView}
                  aria-label={t("circuit.resetMapView", "Reset the map view")}
                  title={t("circuit.resetView", "Reset view")}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-text-2 hover:bg-white/10"
                >
                  <span aria-hidden="true">⇱</span>
                </button>
                <button
                  onClick={() => zoomBy(-1)}
                  aria-label={t("circuit.zoomOut", "Zoom out")}
                  title={t("circuit.zoomOut", "Zoom out")}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-text-2 hover:bg-white/10"
                >
                  <span aria-hidden="true">−</span>
                </button>
                <button
                  onClick={() => zoomBy(1)}
                  aria-label={t("circuit.zoomIn", "Zoom in")}
                  title={t("circuit.zoomIn", "Zoom in")}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-text-2 hover:bg-white/10"
                >
                  <span aria-hidden="true">+</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* -------- right: desktop legend rail 300px (§1.3) -------- */}
        {isDesktop && (
          <aside
            id="circuit-legend"
            tabIndex={-1}
            className="hidden w-[300px] shrink-0 flex-col overflow-y-auto border-s border-line bg-surf-1 outline-none md:flex"
          >
            <CircuitLegend />
            <div className="mt-auto px-4 pb-4">
              <WhosHereCard />
              <p className="mt-3 text-xs leading-relaxed text-text-3">
                {t("circuit.legendNote", "The Circuit shows the world as it is — no one holds these grounds yet. When the frontier burns, this web becomes the war board.")}
              </p>
              <p className="mt-1.5 text-xs text-text-3">{t("circuit.earnOnly", "Earn-only ground — nothing here is for sale.")}</p>
            </div>
          </aside>
        )}
      </div>

      {/* mobile / tablet: full legend in the Sheet primitive (§4.3) */}
      <Sheet open={legendSheetOpen} onClose={() => { setLegendSheetOpen(false); sound.click(); }} labelledBy="circuit-legend-sheet-title" title={t("circuit.readingTitle", "Reading the Circuit")}>
        <SheetHeader id="circuit-legend-sheet-title" title={t("circuit.readingTitle", "Reading the Circuit")} subtitle={t("circuit.subtitle", "the shattered circuit-web of the old world")} onClose={() => { setLegendSheetOpen(false); sound.click(); }} />
        <div className="sheet-body pb-6"><CircuitLegend /></div>
      </Sheet>

      {/* node Sheet — the territory's story + published ground data (no war state) */}
      <NodeSheet node={selNode} state={state} now={now} satCovered={satCovered} onOpenLab={onOpenLab} onBeginResearch={onBeginResearch} onClose={() => { setSel(null); }} />
    </div>
  );

  function focusLegend() {
    const el = document.getElementById("circuit-legend");
    if (el) {
      el.scrollIntoView({ block: "nearest" });
      el.focus({ preventScroll: true });
    }
  }
}

/* ---------------- map node helpers ---------------- */
function nodeRadius(n: AtlasNode): number {
  return ISLAND_NODE_RADIUS[n.kind]; // island-space markers (circuit-island-map.ts)
}
function nodeFill(n: AtlasNode): string {
  if (n.kind === "heart") return KIND_COLORS.heart;
  if (n.kind === "near") return KIND_COLORS.near;
  if (n.kind === "cradle") return KIND_COLORS.cradle;
  return n.importance ? TIER_COLORS[n.importance.tier] : RIM_FALLBACK_FILL;
}
function nodeRing(n: AtlasNode): string {
  return RING_COLORS[n.kind === "rim" ? "rim" : n.kind];
}
function nodeTitle(t: ReturnType<typeof useT>, n: AtlasNode): string {
  const zone = n.zoneId ? getZone(n.zoneId) : null;
  const zname = zone ? zoneName(t, zone) : n.name;
  if (n.kind === "heart") return t("circuit.nodeHeart", "The Chorus-held heart — the deepest scientific site. The prize and the threat.");
  if (n.kind === "cradle") return t("circuit.nodeCradle", "The Cradle — your capital and the home edge.");
  if (n.kind === "near") return t("circuit.nodeNear", "{name} — home-protected ground, never contestable.", { name: zname });
  return n.importance
    ? t("circuit.nodeRimTier", "{name} — Burning-Rim territory, Tier {tier} (score {score}).", { name: zname, tier: n.importance.tier, score: n.importance.score.toFixed(2) })
    : t("circuit.nodeRim", "{name} — Burning-Rim territory.", { name: zname });
}
/** §2.3 (amended) — the zoom tier sets TYPE SIZE and VISIBILITY only; the NAME
 *  STRING comes from the display-name table + collision ladder in
 *  game/circuit-labels.ts (never from splitting the published name: 20 of the
 *  30 published names begin "The", so a split renders the article).
 *  `aria-label` always carries the full sentence. The old labelText() — the
 *  root cause of the "The" labels — is deleted entirely. */

/* ---------------- chrome pieces ---------------- */
function FloatingControls({ onLegend, onReset, onZoomIn, onZoomOut }: { onLegend: () => void; onReset: () => void; onZoomIn: () => void; onZoomOut: () => void }) {
  const t = useT();
  return (
    <div className="absolute bottom-3 start-3 z-10 flex items-center gap-1">
      <button onClick={onLegend} aria-label={t("circuit.jumpToLegend", "Jump to the legend")} title={t("circuit.legendShort", "Legend")} className="flex h-11 items-center gap-1 rounded-lg border border-line bg-surf-1 px-2.5 text-sm text-text-2 shadow-lg hover:bg-white/10">
        {t("circuit.legendShort", "Legend")} <span aria-hidden="true">▸</span>
      </button>
      <button onClick={onReset} aria-label={t("circuit.resetMapView", "Reset the map view")} title={t("circuit.resetView", "Reset view")} className="flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surf-1 text-text-2 shadow-lg hover:bg-white/10">
        <span aria-hidden="true">⇱</span>
      </button>
      <button onClick={onZoomOut} aria-label={t("circuit.zoomOut", "Zoom out")} title={t("circuit.zoomOut", "Zoom out")} className="flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surf-1 text-text-2 shadow-lg hover:bg-white/10">
        <span aria-hidden="true">−</span>
      </button>
      <button onClick={onZoomIn} aria-label={t("circuit.zoomIn", "Zoom in")} title={t("circuit.zoomIn", "Zoom in")} className="flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surf-1 text-text-2 shadow-lg hover:bg-white/10">
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

/* ---------------- Who's-Here (reserved real estate — §6.3) ----------------
 * Renders the empty state until server presence ships; the `CircuitPresence`
 * contract already exists in circuit-tokens.ts so this card never reflows. */
function WhosHereCard() {
  const t = useT();
  return (
    <section aria-label={t("circuit.whosHere", "Who's here")} className="min-h-[168px] rounded-s border border-line bg-surf-2 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-text-3">{t("circuit.whosHere", "Who's here")}</h3>
      <p className="mt-2 text-xs leading-relaxed text-text-3">
        {t("circuit.whosHereNote", "The frontier is quiet — no colonies hold ground here yet. When the war comes, holders and top colonies appear in this space.")}
      </p>
    </section>
  );
}

/* ---------------- Contribution ("World" segment — verbatim) ---------------- */
function raceEmoji(id: RaceId | null): string {
  return id === "grays" ? "👽" : id === "nephilim" ? "🗿" : id === "draconians" ? "🐉" : id === "anunnaki" ? "🏛️" : id === "ashtar" ? "⭐" : "📖";
}

function ContributionTab({ state, token }: { state: GameState; token: string }) {
  const t = useT();
  const [view, setView] = useState<ContributionView | null>(null);
  const [failed, setFailed] = useState(false);
  // The colony whose record the member sheet shows (a snapshot taken at tap
  // time, so the 4s re-fetch never swaps the sheet's contents under the user).
  const [selected, setSelected] = useState<ContributionRow | null>(null);
  // Re-fetch whenever the parent's 4s state refresh lands, so score and rank stay
  // live without a second timer. The server computes everything from the SAME
  // contributionScore() the Unbound gate uses — this panel only renders it.
  useEffect(() => {
    let dead = false;
    getContributionFn({ data: { token } })
      .then((r) => {
        if (dead) return;
        if (r && r.signedOut) { setFailed(true); return; }
        if (r && r.ok) { setView({ me: r.me ?? null, leaders: r.leaders ?? [], total: r.total ?? 0 }); setFailed(false); }
      })
      .catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; };
  }, [state, token]);

  const me = view?.me ?? null;
  const rows = view?.leaders ?? [];
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* shattered-world vista behind the page header (owner 2026-10-01: every
          page gets a background picture) */}
      <PageBanner
        image="/art/pages/exploration-banner.webp"
        title={t("circuit.worldContribution", "World Contribution")}
        sub={t("circuit.worldSub", "World notice follows the dent you make — measured objectively, never by spend or votes.")}
        focal="center 60%"
      />
      <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-5">
        {failed && !me ? (
          <p className="text-sm text-gray-400">{t("circuit.ledgerQuietRetry", "The world's ledger is quiet right now — look again in a moment.")}</p>
        ) : !me ? (
          <p className="text-sm text-gray-400">{t("circuit.ledgerReading", "Reading the world's ledger…")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-text-3">{t("circuit.yourRank", "Your rank")}</div>
              <div className="text-3xl font-bold text-amber-300"><bdi dir="ltr" className="num">{t("circuit.rankLine", "#{rank} / {total} {unit}", { rank: me.rank, total: me.total, unit: me.total === 1 ? t("circuit.colonyUnit", "colony") : t("circuit.coloniesUnit", "colonies") })}</bdi></div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-text-3">{t("circuit.contributionScore", "Contribution score")}</div>
              <div className="text-3xl font-bold text-white">{me.score.toLocaleString()}</div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-relaxed text-gray-400">
                {t("circuit.earnedNote", "Earned by completed explorations, deeds, Codices recovered, and research — the dent your colony has left on this world so far.")}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Top-10 leaderboard */}
      <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-5">
        <h3 className="font-semibold text-white">{t("circuit.worldsNotice", "The World's Notice")} <span className="text-xs font-normal text-text-3">{t("circuit.top10", "— top 10 colonies")}</span></h3>
        <p className="mt-1 text-[11px] text-text-3">{t("circuit.tapHint", "Tap a colony to see its record.")}</p>
        {failed && rows.length === 0 ? (
          <p className="mt-3 text-sm text-text-3">{t("circuit.ledgerQuiet", "The ledger is quiet right now.")}</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-text-3">{t("circuit.noDentYet", "No colony has left a dent yet — the first dent will be the loudest.")}</p>
        ) : (
          <ol className="mt-3 divide-y divide-white/5">
            {rows.map((row) => {
              const isMe = me !== null && row.rank === me.rank;
              return (
                <li key={row.rank} className={isMe ? "text-amber-200" : ""}>
                  <button
                    type="button"
                    onClick={() => setSelected(row)}
                    aria-label={t("circuit.memberOpenLabel", "See {name}'s colony record", { name: row.colonyName })}
                    className="flex min-h-[44px] w-full items-center gap-3 py-2 text-start transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-amber-300"
                  >
                    <span className={`w-9 shrink-0 text-center font-bold ${row.rank === 1 ? "text-amber-300" : row.rank <= 3 ? "text-white" : "text-text-3"}`}>{row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : t("circuit.rankShort", "#{rank}", { rank: row.rank })}</span>
                    <span className="shrink-0" aria-hidden="true">{raceEmoji(row.race)}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      {row.colonyName}
                      {isMe ? <span className="ms-2 rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-amber-200">{t("circuit.youBadge", "You")}</span> : null}
                    </span>
                    <span className="shrink-0 text-sm text-gray-400">{t("circuit.scoreLine", "{score} score", { score: row.score.toLocaleString() })}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <ColonySheet row={selected} total={view?.total ?? 0} onClose={() => setSelected(null)} />
    </main>
  );
}

/* ---------------- colony member sheet (the public record — never private state) ---------------- */
const LOCALE_FOR_LANG: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  "pt-BR": "pt-BR",
  ru: "ru-RU",
  fa: "fa-IR",
};

function ColonySheet({ row, total, onClose }: { row: ContributionRow | null; total: number; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const race = row?.race ? getRace(row.race) : null;
  const raceName = race ? raceText(t, race, "name", race.name) : "";
  const founded = row && row.foundedAt > 0
    ? new Date(row.foundedAt).toLocaleDateString(LOCALE_FOR_LANG[lang] ?? "en-US", { year: "numeric", month: "short", day: "numeric" })
    : "";
  return (
    <Sheet open={!!row} onClose={onClose} labelledBy="circuit-colony-sheet-title" title={row?.colonyName ?? t("circuit.memberTitle", "Colony record")}>
      <SheetHeader id="circuit-colony-sheet-title" title={row?.colonyName ?? ""} onClose={onClose} />
      <div className="sheet-body px-4 py-3 md:px-5">
        {row && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden="true">{raceEmoji(row.race)}</span>
              <div className="min-w-0">
                <div className="truncate text-lg font-bold text-white">{row.colonyName}</div>
                {raceName ? <div className="text-xs text-text-3">{raceName}</div> : null}
              </div>
              <span className="ms-auto shrink-0 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-sm font-bold text-amber-200">
                {t("circuit.memberRankLine", "#{rank} of {total}", { rank: row.rank, total })}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <dt className="text-[11px] uppercase tracking-wider text-text-3">{t("circuit.contributionScore", "Contribution score")}</dt>
                <dd className="mt-1 text-xl font-bold text-white"><bdi dir="ltr" className="num">{row.score.toLocaleString()}</bdi></dd>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <dt className="text-[11px] uppercase tracking-wider text-text-3">{t("circuit.memberCradleLevel", "Cradle level")}</dt>
                <dd className="mt-1 text-xl font-bold text-white"><bdi dir="ltr" className="num">{row.cradleLevel.toLocaleString()}</bdi></dd>
              </div>
              {founded ? (
                <div className="col-span-2 rounded-xl border border-white/10 bg-black/30 p-3">
                  <dt className="text-[11px] uppercase tracking-wider text-text-3">{t("circuit.memberFounded", "Founded")}</dt>
                  <dd className="mt-1 font-semibold text-white">{founded}</dd>
                </div>
              ) : null}
            </dl>

            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-text-3">{t("circuit.memberBreakdown", "How the score was earned")}</h4>
              <ul className="mt-2 space-y-1.5 text-sm">
                <li className="flex items-center justify-between"><span className="text-gray-300">{t("circuit.memberExpeditions", "Explorations completed")}</span><bdi dir="ltr" className="num font-semibold text-white">{row.expeditions.toLocaleString()}</bdi></li>
                <li className="flex items-center justify-between"><span className="text-gray-300">{t("circuit.memberDeeds", "Deeds completed")}</span><bdi dir="ltr" className="num font-semibold text-white">{row.deeds.toLocaleString()}</bdi></li>
                <li className="flex items-center justify-between"><span className="text-gray-300">{t("circuit.memberCodices", "Codices recovered")}</span><bdi dir="ltr" className="num font-semibold text-white">{row.codices.toLocaleString()}</bdi></li>
                <li className="flex items-center justify-between"><span className="text-gray-300">{t("circuit.memberTechs", "Research completed")}</span><bdi dir="ltr" className="num font-semibold text-white">{row.techs.toLocaleString()}</bdi></li>
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-text-3">{t("circuit.memberFormula", "Score = explorations × 2 + deeds × 10 + codices + research × 5 — measured objectively, never by spend or votes.")}</p>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ---------------- node Sheet (the territory's story — no war state) ---------------- */
function NodeSheet({ node, state, now, satCovered, onOpenLab, onBeginResearch, onClose }: {
  node?: AtlasNode;
  state: GameState;
  now?: number;
  satCovered: Set<string>;
  onOpenLab?: () => void;
  onBeginResearch?: (techId: string, leaderId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Sheet open={!!node} onClose={onClose} labelledBy="circuit-node-sheet-title" title={node?.name ?? t("circuit.titleFallback", "The Circuit")}>
      <SheetHeader id="circuit-node-sheet-title" title={node?.name ?? ""} onClose={onClose} />
      <div className="sheet-body px-4 py-3 md:px-5">
        {node && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {node.heart && <span className="chip border border-orange-500/40 bg-orange-500/10 font-semibold text-orange-300">{t("circuit.chipChorusHeart", "🔥 CHORUS-HELD HEART")}</span>}
              {node.kind === "cradle" && <span className="chip border border-amber-400/40 bg-amber-400/10 font-semibold text-amber-200">{t("circuit.chipCradle", "THE CRADLE · HOME EDGE")}</span>}
              {node.kind === "near" && <span className="chip border border-line bg-surf-2 text-text-2">{t("circuit.chipNear", "HOME-PROTECTED")}</span>}
              {node.kind === "rim" && node.importance && (
                <span className="chip border border-line bg-surf-2 font-semibold" style={{ color: TIER_COLORS[node.importance.tier] }}>
                  {t("circuit.chipRim", "BURNING RIM · TIER {tier} — {word}", { tier: node.importance.tier, word: tierWord(t, node.importance.tier) })}
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-gray-400">
              {node.kind === "heart" ? t("circuit.nodeDescHeart", "The deep-most scientific site — the web's core.") :
                node.kind === "cradle" ? t("circuit.nodeDescCradle", "Your capital. The world persists around it.") :
                node.kind === "near" ? t("circuit.nodeDescNear", "Near Ring — the Cradle's buffer and starter economy. Never contestable.") :
                t("circuit.nodeDescRim", "Burning Rim — the frontier. Contestable ground when war comes.")}
            </p>
            {node.zoneId && (
              <p className="text-xs leading-relaxed text-gray-300">
                {zoneFlavor(t, getZone(node.zoneId))}
                {node.heart && (
                  <span className="mt-1 block text-orange-300/90">{t("circuit.heartNote", "The Chorus holds this ground. The war's arc reads inward — footholds, then the chain, then this: the closer you get, the harder it hunts.")}</span>
                )}
              </p>
            )}
            {node.importance && (
              <div className="space-y-1 rounded-xl border border-white/10 bg-black/30 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-amber-200">{t("circuit.tierLine", "Tier {tier} — {word}", { tier: node.importance.tier, word: tierWord(t, node.importance.tier) })}</span>
                  <span className="text-gray-400">{t("circuit.scoreShort", "score {v}", { v: node.importance.score.toFixed(2) })}</span>
                </div>
                <p className="text-gray-300">
                  <b className="text-white">{t("circuit.because", "Because:")}</b>{" "}
                  <b className="text-cyan-300">{t("circuit.richnessStat", "Richness {v}", { v: node.importance.richness.toFixed(2) })}</b>{" · "}
                  <b className="text-fuchsia-300">{t("circuit.positionStat", "Position {v}", { v: node.importance.position.toFixed(2) })}</b>{" · "}
                  <b className="text-orange-300">{t("circuit.chorusStat", "Chorus {v}", { v: node.importance.chorus.toFixed(2) })}</b>
                </p>
                {node.profile && (
                  <p className="text-gray-300">
                    <b className="text-white">{t("circuit.yieldsLabel", "The ground yields (per day):")}</b>{" "}
                    {t("circuit.yieldsEmbers", "🔥 embers {min}–{max}", { min: node.profile.embersPerDay[0], max: node.profile.embersPerDay[1] })} ·{" "}
                    {t("circuit.yieldsChipsets", "🧠 chipsets ≈{v}", { v: node.profile.chipsetsPerDay.toFixed(2) })} ·{" "}
                    {node.profile.plasmaPerDay ? <>{t("circuit.yieldsPlasma", "⚡ plasma {min}–{max}", { min: node.profile.plasmaPerDay[0], max: node.profile.plasmaPerDay[1] })} · </> : null}
                    {node.profile.mat ? t("circuit.yieldsMat", "📦 war-captured territory mat") : t("circuit.noMat", "📦 no mat")}
                  </p>
                )}
              </div>
            )}
            {node.kind === "near" && (
              <p className="text-xs text-text-3">{t("circuit.nearNote", "Home-protected ground — explorations run here as today; the frontier cut never touches it.")}</p>
            )}
            {node.kind === "cradle" && (
              <p className="text-xs text-text-3">{t("circuit.cradleNote", "The supply lanes run Cradle → Near Ring → Rim along the traces you see here.")}</p>
            )}
            {/* ORBITAL WATCH (design/satellites.md) — the research surface entry
                point: dish status, what this ground's sky reveals today, and the
                next climb. Sanctioned land carries no watch. */}
            {node && (satCovered.has(node.id)
              ? <SatelliteSheetSection state={state} now={now} nodeId={node.id} onOpenLab={onOpenLab} onBeginResearch={onBeginResearch} />
              : <p className="text-xs text-text-3">{t("circuit.satSanctioned", "Sanctioned land — no satellite watch. The sky does not need to look here.")}</p>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ============================================================================
   ORBITAL WATCH — the NodeSheet's satellite section (design/satellites.md).
   The dish on the map is the marker; THIS is the research surface's front
   door: dish status, what the sky over this ground reveals today, and the
   next climb. The Lab (onOpenLab) holds the actual research line.
   ========================================================================== */
function SatelliteSheetSection({ state, now, nodeId, onOpenLab, onBeginResearch }: {
  state: GameState;
  now?: number;
  nodeId: string;
  onOpenLab?: () => void;
  onBeginResearch?: (techId: string, leaderId: string) => void;
}) {
  const t = useT();
  const stage = satelliteStage(state, nodeId);
  const intel = satelliteIntelFor(state, nodeId);
  const next = stage < 3 ? satelliteTechFor(nodeId, (stage + 1) as 1 | 2 | 3) : null;
  const techId = next ? satelliteTechId(nodeId, (stage + 1) as 1 | 2 | 3) : null;
  const job = techId ? state.researchJobs.find((j) => j.techId === techId && j.status === "researching") ?? null : null;
  const leaderOnIt = job ? state.leaders.find((l) => l.id === job.leaderId) ?? null : null;
  const freeLeaders = state.leaders.filter((l) => l.status === "active" && !l.assignment);
  // The upgrade happens HERE in the pop-up — no detour through the Lab or the
  // research window. Needs the live clock and the research handler from play.
  const canUpgradeHere = !!next && !!onBeginResearch && now !== undefined;
  return (
    <div className="space-y-1.5 rounded-xl border border-white/10 bg-black/30 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-text-1">{t("circuit.satTitle", "🛰️ Orbital watch")}</span>
        {stage === 0 ? (
          <span className="chip border border-red-500/40 bg-red-500/10 font-semibold text-red-300">
            {t("circuit.satDormantChip", "DORMANT")}
          </span>
        ) : (
          <span
            className="chip inline-flex items-center gap-1 border font-semibold"
            style={{ borderColor: SATELLITE_COLORS.activeRing, background: SATELLITE_COLORS.activeFill, color: SATELLITE_COLORS.activeInk }}
          >
            {t("circuit.satStageChip", "AWAKE · STAGE {stage}", { stage })}
          </span>
        )}
      </div>
      <p className="leading-relaxed text-gray-300">
        <b className="text-white">{t("circuit.satRevealsNow", "The sky reveals:")}</b>{" "}
        {intel === "none"
          ? t("circuit.satRevealNone", "nothing — arrivals are fully invisible: no alarm, no ping.")
          : intel === "presence"
            ? t("circuit.satRevealPresence", "an alarm when someone arrives here — but not who.")
            : intel === "identity"
              ? t("circuit.satRevealIdentity", "an alarm that names who arrived, and roughly how many — but not what they bring.")
              : t("circuit.satRevealFull", "the full picture: amounts and troop types on every arrival.")}
      </p>
      {next && (
        <p className="leading-relaxed text-gray-400">
          <b className="text-white">{t("circuit.satNext", "Next climb — stage {stage}:", { stage: stage + 1 })}</b>{" "}
          {t("circuit.satNextCost", "{codices} 📜 Codices, research time alone — no token can hasten the sky.", { codices: next.codicesCost })}
        </p>
      )}
      {canUpgradeHere && job && (
        <>
          <div className="mt-1 flex items-center justify-between text-[11px] text-gray-300">
            <span>🫂 {leaderOnIt ? leaderName(t, leaderOnIt) : t("circuit.satLeaderEnRoute", "Leader en route")}</span>
            <span><span dir="ltr">{fmtDuration(t, Math.max(0, job.startedAt + job.durationMs - now!))}</span> {t("circuit.satTimeLeft", "left")}</span>
          </div>
          <div className="mt-1 h-1 rounded bg-white/10"><div className="h-1 rounded bg-cyan-400" style={{ width: `${Math.min(100, ((now! - job.startedAt) / job.durationMs) * 100)}%` }} /></div>
        </>
      )}
      {canUpgradeHere && !job && (
        <div className="mt-1">
          {state.codices < next!.codicesCost ? (
            <div className="text-[11px] text-text-3">{t("circuit.satNeedCodices", "Need {n} 📜", { n: next!.codicesCost })}</div>
          ) : freeLeaders.length === 0 ? (
            <div className="text-[11px] text-text-3">{t("circuit.satNoFreeLeader", "No free Leader")}</div>
          ) : (
            <button
              onClick={() => { sound.click(); onBeginResearch!(techId!, freeLeaders[0].id); }}
              className="w-full rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20"
            >
              {stage === 0
                ? t("circuit.satUpgradeBring", "🛰️ Appoint {name} — bring it online ({cost} 📜)", { name: freeLeaders[0].name, cost: next!.codicesCost })
                : t("circuit.satUpgradeClimb", "🛰️ Appoint {name} — upgrade to stage {stage} ({cost} 📜)", { name: freeLeaders[0].name, stage: stage + 1, cost: next!.codicesCost })}
            </button>
          )}
        </div>
      )}
      {!canUpgradeHere && next && onOpenLab && (
        <button
          onClick={() => { sound.click(); openWindow("satellite-research", { key: nodeId, props: { nodeId } }); }}
          className="mt-1 w-full rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20"
        >
          {t("circuit.satOpenLab", "🛰️ Research this satellite — opens right here")}
        </button>
      )}
      {stage >= 3 && (
        <div className="mt-1 text-[11px] text-text-3">{t("circuit.satMaxed", "Stage 3 — fully awake. The sky sees everything here.")}</div>
      )}
    </div>
  );
}

function tierWord(t: ReturnType<typeof useT>, tier: number): string {
  return tier === 1
    ? t("circuit.tierWord1", "foothold")
    : tier === 2
      ? t("circuit.tierWord2", "strong ground")
      : t("circuit.tierWord3", "crown jewel");
}

/* ============================================================================
   LEGEND — VERBATIM copy from circuit-fullscreen-page.md §4.1 (full) / §4.2
   (compact rail). Swatches are the canon §5 recipes; never color alone.
   ========================================================================== */
type SwatchKind = "t1" | "t2" | "t3" | "heart" | "rim" | "near" | "cradle" | "road" | "ruin" | "severed" | "corrupted" | "contested" | "purified" | "satDormant" | "satActive" | "satRing";

function Swatch({ kind }: { kind: SwatchKind }) {
  const base = "inline-block h-4 w-4 flex-none rounded-sm border border-line-strong";
  if (kind === "t1" || kind === "t2" || kind === "t3") {
    return <span className={base} style={{ background: TIER_COLORS[kind === "t1" ? 1 : kind === "t2" ? 2 : 3] }} />;
  }
  if (kind === "heart") return <span className={base} style={{ background: KIND_COLORS.heart, boxShadow: `inset 0 0 0 2px ${RING_COLORS.heart}` }} />;
  if (kind === "rim") return <span className={base} style={{ background: `${TIER_COLORS[2]}38`, boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.5)" }} />;
  if (kind === "near") return <span className={`${base} border-white/10`} style={{ background: KIND_COLORS.near, opacity: 0.6 }} />;
  if (kind === "cradle") return <span className={base} style={{ background: KIND_COLORS.cradle, boxShadow: `inset 0 0 0 1.5px ${RING_COLORS.cradle}` }} />;
  if (kind === "road") return <span className={`${base} flex items-center justify-center`}><span className="h-[2px] w-3 rounded" style={{ background: TRACE_COLORS.road, opacity: 0.55 }} /></span>;
  if (kind === "ruin") return <span className={`${base} flex items-center justify-center`}><span className="w-3 border-t-2" style={{ borderColor: TRACE_COLORS.ruin, borderStyle: "dashed" }} /></span>;
  if (kind === "severed") return (
    <span className={`${base} flex items-center justify-center gap-[3px]`}>
      <span className="h-[2px] w-1.5 rounded" style={{ background: TRACE_COLORS.severed, opacity: 0.8 }} />
      <span className="h-[2px] w-1.5 rounded" style={{ background: TRACE_COLORS.severed, opacity: 0.8 }} />
    </span>
  );
  if (kind === "corrupted") return <span className={base} style={{ background: WAR_SWATCH_COLORS.corruptedFill, boxShadow: `inset 0 0 0 1px ${WAR_SWATCH_COLORS.corruptedRing}` }} />;
  if (kind === "contested") return <span className={base} style={{ background: WAR_SWATCH_COLORS.contestedFill, boxShadow: `inset 0 0 0 1.5px ${WAR_SWATCH_COLORS.contestedRing}` }} />;
  if (kind === "purified") return <span className={`${base} flex items-center justify-center text-[10px] leading-none`} style={{ background: WAR_SWATCH_COLORS.purified, color: WAR_SWATCH_COLORS.purifiedInk }}>★</span>;
  if (kind === "satDormant") return <span className={`${base} flex items-center justify-center`} style={{ background: SATELLITE_COLORS.dormantFill, boxShadow: `inset 0 0 0 1.5px ${SATELLITE_COLORS.dormantRing}`, borderRadius: "9999px" }} />;
  if (kind === "satActive") return <span className={`${base} flex items-center justify-center text-[10px] font-bold leading-none`} style={{ background: SATELLITE_COLORS.activeFill, boxShadow: `inset 0 0 0 1.5px ${SATELLITE_COLORS.activeRing}`, color: SATELLITE_COLORS.activeInk, borderRadius: "9999px" }}>2</span>;
  if (kind === "satRing") return (
    <span className={base} style={{ borderRadius: "9999px", borderColor: TRACE_COLORS.road, background: "transparent" }} />
  );
  return <span className={base} />;
}

function LegendEntry({ kind, title, caption }: { kind: SwatchKind; title: string; caption: string }) {
  return (
    <li role="listitem" className="flex min-h-7 items-start gap-2 py-1">
      <span className="mt-1"><Swatch kind={kind} /></span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-snug text-text-2">{title}</span>
        <span className="block text-xs leading-snug text-text-3">{caption}</span>
      </span>
    </li>
  );
}

function LegendSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-text-3">{title}</h3>
      <ul role="list" className="space-y-0.5">{children}</ul>
    </section>
  );
}

function CircuitLegend() {
  const t = useT();
  return (
    <div className="px-4 py-4 md:px-5">
      <h2 id="circuit-legend-title" className="text-xs font-semibold uppercase tracking-[0.08em] text-text-3">
        {t("circuit.readingTitle", "Reading the Circuit")}
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-text-3">
        {t("circuit.legendIntro", "Contestable ground carries a depth tier: how deep it lies, how rich it is, how hard it hunts.")}
      </p>

      <LegendSection title={t("circuit.legendSecTiers", "Depth tiers — contestable ground only")}>
        <LegendEntry kind="t1" title={t("circuit.legendT1", "T1 · OUTER RIM")} caption={t("circuit.legendT1Cap", "Footholds at the landing edge. Embers flow; the risk is low.")} />
        <LegendEntry kind="t2" title={t("circuit.legendT2", "T2 · MID-DEPTH")} caption={t("circuit.legendT2Cap", "Strong ground — balanced embers and chipsets, a real fight to hold.")} />
        <LegendEntry kind="t3" title={t("circuit.legendT3", "T3 · DEEP")} caption={t("circuit.legendT3Cap", "The crown jewels. Chipsets and plasma — and the Chorus hunts hardest here.")} />
      </LegendSection>
      <p className="mt-2 text-xs text-text-3">
        {t("circuit.legendTierRule", "Tier = published importance score: T1 < 0.40 · T2 0.40–0.70 · T3 > 0.70 — never hidden math.")}
      </p>

      <LegendSection title={t("circuit.legendSecKinds", "Ground kinds")}>
        <LegendEntry kind="heart" title={t("circuit.legendHeart", "THE CHORUS-HELD HEART")} caption={t("circuit.legendHeartCap", "The deepest scientific site at the web's core. The prize and the threat — never a neutral prize.")} />
        <LegendEntry kind="rim" title={t("circuit.legendRim", "CONTESTABLE RIM")} caption={t("circuit.legendRimCap", "The frontier — where the war will burn. Carries a depth tier above.")} />
        <LegendEntry kind="near" title={t("circuit.legendNear", "HOME-PROTECTED")} caption={t("circuit.legendNearCap", "Near Ring — the Cradle's buffer and starter economy. Never contestable.")} />
        <LegendEntry kind="cradle" title={t("circuit.legendCradle", "THE CRADLE")} caption={t("circuit.legendCradleCap", "Your capital — the home edge. Supply lanes run from here to the frontier.")} />
      </LegendSection>

      <LegendSection title={t("circuit.legendSecTraces", "Traces — how ground connects")}>
        <LegendEntry kind="road" title={t("circuit.legendRoad", "CONDUCTOR LANE")} caption={t("circuit.legendRoadCap", "Fast marches and supply.")} />
        <LegendEntry kind="ruin" title={t("circuit.legendRuin", "BURNT PASS")} caption={t("circuit.legendRuinCap", "Slow and risky — but passable.")} />
        <LegendEntry kind="severed" title={t("circuit.legendSevered", "SEVERED TRACE")} caption={t("circuit.legendSeveredCap", "Impassable. The Chorus broke the circuit here.")} />
      </LegendSection>

      <LegendSection title={t("circuit.legendSecWar", "War-phase states")}>
        <LegendEntry kind="corrupted" title={t("circuit.legendCorrupted", "CORRUPTED")} caption={t("circuit.legendCorruptedCap", "No holder. Open extraction at a small yield.")} />
        <LegendEntry kind="contested" title={t("circuit.legendContested", "CONTESTED")} caption={t("circuit.legendContestedCap", "A side holds it; score ticks to them. Flag = the holder's world.")} />
        <LegendEntry kind="purified" title={t("circuit.legendPurified", "PURIFIED")} caption={t("circuit.legendPurifiedCap", "Oracle-cleaned ground. The brightest node on the map — and the rarest.")} />
      </LegendSection>

      <LegendSection title={t("circuit.legendSecSat", "Orbital watch — the sky over contestable ground")}>
        <LegendEntry kind="satDormant" title={t("circuit.legendSatDormant", "SATELLITE DORMANT")} caption={t("circuit.legendSatDormantCap", "Asleep — no coverage. Blind-spot arrivals are fully invisible: no alarm, no ping.")} />
        <LegendEntry kind="satActive" title={t("circuit.legendSatActive", "SATELLITE AWAKE · STAGE 1–3")} caption={t("circuit.legendSatActiveCap", "Online = an alarm on arrival. Tracking = who, roughly how many. Full picture = amounts and troop types. Restoration is a Lab research line — never accelerable.")} />
        <LegendEntry kind="satRing" title={t("circuit.legendSatRing", "THE SATELLITE RING")} caption={t("circuit.legendSatRingCap", "The constellation at a glance — one marker per bird: hollow red sleeps, filled green is awake.")} />
      </LegendSection>
      <p className="mt-2 text-xs text-text-3">
        {t("circuit.legendSatRule", "Every season the constellation resets to ~50% functional, randomized per world — last season's coverage map is worthless. The Near Ring and the Cradle are sanctioned land: no satellites there.")}
      </p>

      <p className="mt-4 text-xs italic leading-relaxed text-text-3">
        {t("circuit.legendClosing", "Every state is also a shape or a label — rings, chips, stars, sigils. If a color alone is doing the talking, that is a bug.")}
      </p>
    </div>
  );
}

/* ---- §4.2 compact rail (mobile/tablet, 40px, always visible, scrollable) ---- */
const RAIL: Array<{ kind: SwatchKind; key: string; en: string }> = [
  { kind: "heart", key: "circuit.railHeart", en: "Heart" },
  { kind: "rim", key: "circuit.railRim", en: "Rim" },
  { kind: "near", key: "circuit.railNear", en: "Near" },
  { kind: "cradle", key: "circuit.railCradle", en: "Cradle" },
  { kind: "t1", key: "circuit.railT1Outer", en: "T1 Outer" },
  { kind: "t2", key: "circuit.railT2Mid", en: "T2 Mid" },
  { kind: "t3", key: "circuit.railT3Deep", en: "T3 Deep" },
  { kind: "road", key: "circuit.railRoad", en: "lane" },
  { kind: "ruin", key: "circuit.railRuin", en: "burnt" },
  { kind: "severed", key: "circuit.railSevered", en: "severed" },
];

function CompactLegendRail() {
  const t = useT();
  return (
    <div role="list" aria-label={t("circuit.railAria", "Circuit legend — compact")} className="h-10 shrink-0 overflow-x-auto border-t border-line bg-surf-1">
      <ul className="flex h-10 w-max items-center gap-1.5 px-2">
        {RAIL.map((r) => (
          <li key={r.key} role="listitem">
            <span className="chip h-6 gap-1.5 border border-line bg-surf-2 ps-1.5 pe-2 text-[11px] font-medium text-text-2" style={{ maxWidth: "112px" }}>
              <Swatch kind={r.kind} />
              <span className="truncate">{t(r.key, r.en)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}