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
import { generateAtlas, nodeById, ATLAS_CONFIG } from "../game/map";
import type { AtlasNode, AtlasGraph } from "../game/map";
import { WORLD_CONFIG_PUBLIC } from "../game/world-config";
import { getRace, raceText } from "../game/races";
import { getZone, zoneFlavor, zoneName } from "../game/zones";
import { getContributionFn } from "../game/api";
import type { ContributionView, ContributionRow } from "../game/api";
import { sound } from "../game/sound";
import { SegmentedControl } from "./SegmentedControl";
import PageBanner from "./PageBanner";
import { LedgerButton } from "./LedgerButton";
import { Sheet, SheetHeader } from "./Sheet";
import { Icon } from "./icons";
import { Tooltip } from "./Tooltip";
import {
  DISPLAY_NAMES,
  LABEL_DY,
  LABEL_NODE_RADIUS,
  canvasFor,
  canvasX,
  labelTier,
  labelFontUnits,
  resolveLabels,
} from "../game/circuit-labels";
import {
  TIER_COLORS,
  KIND_COLORS,
  TRACE_COLORS,
  LABEL_COLORS,
  RING_COLORS,
  TIER_FILL_OPACITY,
  HIT_RADIUS,
  HIT_FLOOR_PX,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  SIGIL_COLORS,
  RIM_FALLBACK_FILL,
  WAR_SWATCH_COLORS,
} from "../game/circuit-tokens";

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
}: CircuitPageProps) {
  const t = useT();
  const circuit: AtlasGraph = useMemo(
    () => generateAtlas({ worldId: WORLD_CONFIG_PUBLIC.worldId, raceId: WORLD_CONFIG_PUBLIC.raceLock }),
    [],
  );
  const race = getRace(state.race!);

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

  /* ---- map stage geometry (§2.1 rule 3/8 + §3): aspect-aware render canvas,
     fit, hit-floor cap, zoom clamp ---- */
  const W = ATLAS_CONFIG.viewBox.w; // authored canvas — READ ONLY (map.ts)
  const H = ATLAS_CONFIG.viewBox.h;
  // The RENDER canvas: authored geography × one uniform x-scale (canvasX), so
  // a wide stage gets a wide web instead of 52% dead space (§3.2). `y`,
  // radii and font units stay authored — circles stay circles.
  const [canvas, setCanvas] = useState(() => canvasFor(W, H));
  const [fit, setFit] = useState(0);
  const [zoom, setZoom] = useState(1); // multiplier over the fit-capped base
  const stageRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<{ x: number; y: number } | null>(null);
  const pendingReset = useRef(false);
  const lastInner = useRef<{ w: number; h: number } | null>(null);
  const canvasRef = useRef(canvas);
  const lastCanvasW = useRef<number | null>(null);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      // §3.6 rule 1 — hysteresis PLUS a stable measurement source. The stage is
      // `overflow-auto`, so once the map exceeds a box the scrollbars shrink
      // clientWidth/clientHeight and a client-box measurement feeds back into
      // itself (commit a wider canvas → scrollbar → measure again → commit
      // again). The LAYOUT box (offsetWidth/offsetHeight) does not move when
      // scrollbars appear, so the canvas is derived from it and the loop cannot
      // run. clientWidth remains the fallback for a detached/hidden stage.
      const stageW = stage.offsetWidth || stage.clientWidth;
      const stageH = stage.offsetHeight || stage.clientHeight;
      if (stageW <= 0 || stageH <= 0) return;
      const next = canvasFor(stageW, stageH);
      const cur = canvasRef.current;
      // only commit a new canvas when the stage aspect actually moved by > 2%
      const committed = Math.abs(next.w - cur.w) > 0.02 * cur.w ? next : cur;
      canvasRef.current = committed;
      setFit(Math.min(stageW / committed.w, stageH / committed.h));
      setCanvas(committed); // same reference when uncommitted → React bails out
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
    // ResizeObserver re-arms anyway; fit recomputes from the live container.
  }, [W, H]);

  // §2.1 rule 4 — the 44px law: never render the r26 hit circle below a 22px
  // CSS radius, no matter how small the stage gets. The map then pans instead.
  const baseScale = fit > 0 ? Math.max(fit, HIT_FLOOR_PX / HIT_RADIUS) : 0;
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
    // §3.6 rule 2 — a canvas change is a new map: the old scroll offsets mean
    // nothing, so re-centre exactly like ⇱ does.
    const canvasChanged = lastCanvasW.current !== null && lastCanvasW.current !== canvas.w;
    lastCanvasW.current = canvas.w;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (pendingReset.current || canvasChanged) {
      pendingReset.current = false;
      const tx = Math.max(0, (inner.clientWidth - stage.clientWidth) / 2);
      const ty = Math.max(0, (inner.clientHeight - stage.clientHeight) / 2);
      stage.scrollTo({ left: tx, top: ty, behavior: reduced || canvasChanged ? "auto" : "smooth" });
      return;
    }
    if (prev && anchorRef.current) {
      const a = anchorRef.current;
      anchorRef.current = null;
      stage.scrollLeft = Math.max(0, a.x * inner.clientWidth - stage.clientWidth / 2);
      stage.scrollTop = Math.max(0, a.y * inner.clientHeight - stage.clientHeight / 2);
    }
  }, [scale, canvas.w]);

  // §1.4 label zoom tiers — the tier sets the TYPE SIZE and VISIBILITY; the
  // NAME STRING comes from the display-name table (§2.3 amendment). Nothing is
  // ever rendered below 11px: at mid the font is `11/scale` units (= 11px CSS),
  // and below scale 0.55 the tier is `low` and the labels HIDE.
  const tier = labelTier(scale);
  const fontUnits = labelFontUnits(tier, scale);
  // §2.1 — the deterministic collision ladder (full → compact → hidden). Pure
  // geometry, memoised on the canvas + tier + selection only.
  const labels = useMemo(
    () =>
      resolveLabels(circuit.nodes, {
        tier,
        fontUnits,
        canvasW: canvas.w,
        kx: canvas.kx,
        selectedId: sel,
      }),
    [circuit, tier, fontUnits, canvas.w, canvas.kx, sel],
  );
  const px = (x: number) => canvasX(x, canvas.w, canvas.kx);

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
                  className="circuit-map-inner m-auto flex-none"
                  style={{ width: canvas.w * scale, height: canvas.h * scale }}
                >
                  <svg
                    viewBox={`0 0 ${canvas.w} ${canvas.h}`}
                    className={`circuit-zoom-${tier} block h-full w-full select-none`}
                    role="img"
                    aria-label={t("circuit.mapSvgAria", "The Circuit — world map: territories, traces, and the Chorus-held heart")}
                  >
                    {/* LAYER 0+1 — severed-trace breaks, then road / ruin-pass traces.
                        x goes through the §3.2 canvas map; y, radii and stroke widths
                        stay authored. */}
                    <g aria-hidden="true" style={{ pointerEvents: "none" }}>
                      {circuit.edges.map((e, i) => {
                        const a = coordOf(circuit, e.from);
                        const b = coordOf(circuit, e.to);
                        const ax = px(a.x), bx = px(b.x);
                        const selected = sel !== null && (e.from === sel || e.to === sel);
                        if (e.kind === "severed") {
                          const gx = bx - ax;
                          const gy = b.y - a.y;
                          const p1 = { x: ax + gx * 0.42, y: a.y + gy * 0.42 };
                          const p2 = { x: bx - gx * 0.42, y: b.y - gy * 0.42 };
                          return (
                            <g key={i}>
                              <line x1={ax} y1={a.y} x2={p1.x} y2={p1.y} stroke={TRACE_COLORS.severed} strokeWidth="1.5" strokeOpacity="0.8" />
                              <line x1={p2.x} y1={p2.y} x2={bx} y2={b.y} stroke={TRACE_COLORS.severed} strokeWidth="1.5" strokeOpacity="0.8" />
                            </g>
                          );
                        }
                        const nearEdge =
                          nodeById(circuit, e.from)?.kind === "near" || nodeById(circuit, e.to)?.kind === "near";
                        return (
                          <line
                            key={i}
                            x1={ax} y1={a.y} x2={bx} y2={b.y}
                            stroke={e.kind === "road" ? (nearEdge ? TRACE_COLORS.roadNear : TRACE_COLORS.road) : TRACE_COLORS.ruin}
                            strokeWidth={selected ? 3 : e.kind === "road" ? (nearEdge ? 1.5 : 2) : 2}
                            strokeOpacity={selected ? 0.95 : e.kind === "road" ? 0.55 : 0.7}
                            strokeDasharray={e.kind === "ruinPass" ? "5 5" : undefined}
                          />
                        );
                      })}
                    </g>
                    {/* LAYER 2–6 — per-node visuals (fills, rings, sigils, labels).
                        pointer-events: none so the hit circles (layer 8) own every tap. */}
                    <g aria-hidden="true" style={{ pointerEvents: "none" }}>
                      {circuit.nodes.map((n) => {
                        const dim = n.kind === "near";
                        const r = nodeRadius(n);
                        const nx = px(n.x);
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
                          <g key={n.id} style={{ opacity: dim ? 0.6 : 1 }}>
                            {/* zone fill — tier @ 22% over surf-0 (§2.4 layer 2) */}
                            <circle
                              cx={nx} cy={n.y} r={r}
                              fill={nodeFill(n)}
                              fillOpacity={n.kind === "rim" ? TIER_FILL_OPACITY : 1}
                              stroke={sel === n.id ? "rgba(255,255,255,0.95)" : nodeRing(n)}
                              strokeWidth={sel === n.id ? 3 : n.kind === "heart" ? 3 : 1.5}
                              className={n.kind === "heart" ? "animate-pulse" : undefined}
                            />
                            {/* sigils (layer 5) — symbols, not text: authored sizes */}
                            {n.kind === "heart" && <text x={nx} y={n.y + 5} textAnchor="middle" fontSize="15">🔥</text>}
                            {n.kind === "cradle" && <text x={nx} y={n.y + 5} textAnchor="middle" fontSize="13">🔰</text>}
                            {n.kind === "rim" && n.importance && (
                              <text className="cl-pip" x={nx + 14 * canvas.kx} y={n.y - 12} textAnchor="middle" fontSize={fontUnits} fontWeight="bold" fill={TIER_COLORS[n.importance.tier]} {...halo}>
                                {tierPip(t, n.importance.tier)}
                              </text>
                            )}
                            {n.kind === "rim" && n.id === "shattered-academies" && (
                              <text x={nx} y={n.y - 14} textAnchor="middle" fontSize="11" fill={SIGIL_COLORS.heartZoneStar}>★</text>
                            )}
                            {/* labels (layer 6, §2.1 ladder) — a node with no room
                                keeps its circle, ring, pip and aria-label and simply
                                renders no name. Nothing below 11px, ever. */}
                            {place && (
                              <text
                                className="cl-full"
                                x={place.cx} y={place.cy} textAnchor="middle" fontSize={fontUnits}
                                fill={n.kind === "heart" ? LABEL_COLORS.heart : n.kind === "cradle" ? LABEL_COLORS.cradle : LABEL_COLORS.node}
                                fontWeight={500} fontFamily="'Segoe UI',system-ui,sans-serif"
                                {...halo}
                              >
                                {place.text}
                              </text>
                            )}
                            {n.kind === "heart" && (
                              <text className="cl-sub" x={nx} y={n.y - 38} textAnchor="middle" fontSize={fontUnits} fill={SIGIL_COLORS.heartSub} letterSpacing="1.5" {...halo}>
                                {t("circuit.heartSub", "THE PRIZE · THE THREAT")}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </g>
                    {/* LAYER 8 — invisible hit circles: ALWAYS topmost for pointer
                        events; the r26 circle is the 44px tap floor (§2.1 rule 4). */}
                    <g>
                      {circuit.nodes.map((n) => {
                        const title = nodeTitle(t, n);
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
                            <circle cx={px(n.x)} cy={n.y} r={HIT_RADIUS} fill="transparent" />
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
      <NodeSheet node={selNode} onClose={() => { setSel(null); }} />
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
function coordOf(g: AtlasGraph, id: string): { x: number; y: number } {
  const n = nodeById(g, id);
  return n ? { x: n.x, y: n.y } : { x: 180, y: 480 };
}
function nodeRadius(n: AtlasNode): number {
  return LABEL_NODE_RADIUS[n.kind]; // single source (circuit-labels.ts)
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
function NodeSheet({ node, onClose }: { node?: AtlasNode; onClose: () => void }) {
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
          </div>
        )}
      </div>
    </Sheet>
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
type SwatchKind = "t1" | "t2" | "t3" | "heart" | "rim" | "near" | "cradle" | "road" | "ruin" | "severed" | "corrupted" | "contested" | "purified";

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