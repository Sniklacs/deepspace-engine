// CockpitFrame — the command-ship cockpit (owner 2026-10-12).
//
// Hans's battle-view redesign: the battle is watched FIRST-PERSON from the
// hovering command ship. This frame is the ship: a canopy brow and hull
// pillars around the viewport, an instrument deck along the bottom lit in
// the player's cockpit theme color (--cmd-accent), and the bridge crew —
// the appointed ADJUTANT standing at the commander's side (any hero can be
// appointed; tap the station to change who stands there) and the other
// officers at their stations. Heroes not aboard fall back to the squad
// leads standing the watch.
//
// The frame is chrome, not controls: it never eats the field. Slim rails,
// a low deck, everything else pointer-transparent — only the deck's own
// buttons take taps. All text 9px EVE-dense per the command-console rule;
// the GRAPHICS (glow strips, medallion rims) carry the brass.

import { useState, useSyncExternalStore } from "react";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
  adjutantOf,
  setAdjutantId,
  setCameraMode,
  setCockpitOn,
  cycleBattleSpeed,
  type CrewMember,
} from "../../game/war/battle-scene-ui-store";
import {
  cockpitThemeById,
  cockpitAccentStyle,
} from "../../game/war/cockpit-theme";
import { CMD_THEME } from "./command-console";
import { battleSfx } from "../../game/war/battle-sfx";

function fmtClock(tS: number): string {
  const m = Math.floor(Math.max(0, tS) / 60);
  const s = Math.floor(Math.max(0, tS) % 60);
  return `T+${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Head-and-shoulders silhouette — the officer's presence at their station. */
function Silhouette({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <circle cx="12" cy="8" r="3.7" />
      <path d="M4.2 20.4c.9-4.3 4-6.4 7.8-6.4s6.9 2.1 7.8 6.4z" />
    </svg>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A crew medallion: rim-lit silhouette disc. The adjutant's rim burns in
 *  the theme accent; officers sit dimmer at their stations. */
function Medallion({
  name,
  size,
  adjutant = false,
}: {
  name: string;
  size: number;
  adjutant?: boolean;
}) {
  return (
    <div
      className="relative flex flex-none items-center justify-center overflow-hidden rounded-full border"
      style={{
        width: size,
        height: size,
        borderColor: adjutant ? "var(--cmd-accent)" : "rgba(255,255,255,0.22)",
        background:
          "radial-gradient(circle at 50% 30%, #232c3d 0%, #11161f 55%, #070a10 100%)",
        boxShadow: adjutant
          ? "0 0 10px var(--cmd-accent), inset 0 0 6px rgba(0,0,0,0.7)"
          : "inset 0 0 5px rgba(0,0,0,0.75)",
      }}
      aria-hidden="true"
    >
      <Silhouette
        className={adjutant ? "text-[#39465c]" : "text-[#2a3446]"}
      />
      <span
        className="absolute inset-x-0 bottom-[3px] text-center font-bold leading-none"
        style={{
          fontSize: size >= 38 ? 8 : 6.5,
          color: adjutant ? "var(--cmd-accent)" : "var(--cmd-dim)",
          textShadow: adjutant ? "var(--cmd-accent-glow)" : undefined,
        }}
      >
        {initials(name)}
      </span>
    </div>
  );
}

export function CockpitFrame({
  variant,
  commanderName,
}: {
  /** embedded: rides the canvas wrap; fullscreen: rides the viewport */
  variant: "embedded" | "fullscreen";
  /** force name for the no-heroes fallback (the commander stands alone) */
  commanderName: string;
}) {
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fs = variant === "fullscreen";
  const theme = cockpitThemeById(ui.cockpitThemeId);
  const adjutant = adjutantOf(ui);
  const officers: CrewMember[] = adjutant
    ? ui.crew.filter((c) => c.id !== adjutant.id)
    : [];
  const camLabel =
    ui.cameraMode === "command"
      ? "COMMAND SHIP — HOVER 50 FT"
      : ui.cameraMode === "ground"
        ? "GROUND CAM"
        : "HOLOMAP — TACTICAL";

  // Cockpit folded away: one small tab brings the ship back.
  if (!ui.cockpitOn) {
    return (
      <button
        type="button"
        onClick={() => {
          battleSfx.uiClick();
          setCockpitOn(true);
        }}
        data-testid="cockpit-restore"
        aria-label="Bring the cockpit frame back"
        className={`pointer-events-auto absolute right-2 z-20 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-200 backdrop-blur-md active:scale-[0.97] ${CMD_THEME}`}
        style={{
          bottom: fs ? "calc(env(safe-area-inset-bottom) + 3.9rem)" : "0.5rem",
          ...cockpitAccentStyle(theme),
        }}
      >
        🛸 Cockpit
      </button>
    );
  }

  const segBtn = (active: boolean) =>
    `pointer-events-auto min-h-[26px] touch-manipulation rounded-sm border px-2 text-[9px] font-bold uppercase tracking-[0.14em] transition active:scale-[0.96] ${
      active
        ? "border-[var(--cmd-accent)] bg-[var(--cmd-accent-dim)] text-[var(--cmd-accent)] [text-shadow:var(--cmd-accent-glow)]"
        : "border-[var(--cmd-line)] bg-[var(--cmd-panel)] text-[var(--cmd-dim)]"
    }`;

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-20 ${CMD_THEME}`}
      style={cockpitAccentStyle(theme)}
      data-testid="cockpit-frame"
      data-camera={ui.cameraMode}
    >
      {/* ---- canopy: brow, pillars, corner wedges — the ship around you -- */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="ck-hull-top" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d1119" />
            <stop offset="100%" stopColor="#05070b" />
          </linearGradient>
          <linearGradient id="ck-hull-side" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#05070b" />
            <stop offset="100%" stopColor="#0d1119" />
          </linearGradient>
        </defs>
        {/* brow — thick at the corners, dipping thin over the center glass */}
        <path
          d="M0,0 H1000 V20 L886,40 L668,54 L332,54 L114,40 L0,20 Z"
          fill="url(#ck-hull-top)"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth="1"
        />
        {/* pillars — tapered hull struts at the viewport edges */}
        <path d="M0,0 L58,0 L34,1000 L0,1000 Z" fill="url(#ck-hull-side)" stroke="rgba(255,255,255,0.08)" />
        <path d="M1000,0 L942,0 L966,1000 L1000,1000 Z" fill="url(#ck-hull-side)" stroke="rgba(255,255,255,0.08)" />
        {/* bottom corner wedges — the deck's hull shoulders */}
        <path d="M0,1000 V946 L150,922 L196,1000 Z" fill="#05070b" stroke="rgba(255,255,255,0.08)" />
        <path d="M1000,1000 V946 L850,922 L804,1000 Z" fill="#05070b" stroke="rgba(255,255,255,0.08)" />
        {/* accent light strips — the cockpit lighting, in the theme color */}
        <polyline
          points="0,22 114,42 332,56 668,56 886,42 1000,22"
          fill="none"
          stroke="var(--cmd-accent)"
          strokeWidth="2.5"
          opacity="0.85"
          style={{ filter: "drop-shadow(0 0 5px var(--cmd-accent))" }}
        />
        <polyline
          points="0,948 150,924"
          fill="none"
          stroke="var(--cmd-accent)"
          strokeWidth="2"
          opacity="0.6"
          style={{ filter: "drop-shadow(0 0 4px var(--cmd-accent))" }}
        />
        <polyline
          points="850,924 1000,948"
          fill="none"
          stroke="var(--cmd-accent)"
          strokeWidth="2"
          opacity="0.6"
          style={{ filter: "drop-shadow(0 0 4px var(--cmd-accent))" }}
        />
        {/* panel seams + rivets — hull texture, kept whisper-quiet */}
        <g stroke="rgba(255,255,255,0.05)" strokeWidth="1">
          <line x1="180" y1="0" x2="238" y2="50" />
          <line x1="820" y1="0" x2="762" y2="50" />
          <line x1="30" y1="300" x2="44" y2="302" />
          <line x1="970" y1="300" x2="956" y2="302" />
          <line x1="26" y1="620" x2="40" y2="622" />
          <line x1="974" y1="620" x2="960" y2="622" />
        </g>
        <g fill="rgba(255,255,255,0.16)">
          <circle cx="20" cy="180" r="2" />
          <circle cx="16" cy="470" r="2" />
          <circle cx="13" cy="760" r="2" />
          <circle cx="980" cy="180" r="2" />
          <circle cx="984" cy="470" r="2" />
          <circle cx="987" cy="760" r="2" />
        </g>
      </svg>

      {/* glass: a breath of reflection + edge vignette for depth */}
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "linear-gradient(115deg, rgba(255,255,255,0.045) 0%, transparent 26%)," +
            "radial-gradient(ellipse 120% 90% at 50% 42%, transparent 58%, rgba(0,0,0,0.40) 100%)",
        }}
      />

      {/* brow readout — what ship, what view (tiny, centered on the brow) */}
      <div className="absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
        <p
          className="mt-[3px] text-[8px] font-bold uppercase tracking-[0.3em] text-[var(--cmd-faint)]"
          data-testid="cockpit-cam-label"
        >
          <span className="text-[var(--cmd-accent)] [text-shadow:var(--cmd-accent-glow)]">●</span>{" "}
          {camLabel}
        </p>
      </div>

      {/* ---- instrument deck --------------------------------------------- */}
      <div
        className="absolute inset-x-0 bottom-0 border-t border-[var(--cmd-line)] bg-[#05070b]/90 backdrop-blur-[2px]"
        style={{ paddingBottom: fs ? "env(safe-area-inset-bottom)" : undefined }}
        data-testid="cockpit-deck"
      >
        <div className="flex items-stretch gap-2 px-2 py-1.5">
          {/* ADJUTANT station — tap to appoint who stands at your side */}
          <div className="relative flex-none" data-testid="cockpit-adjutant">
            <button
              type="button"
              onClick={() => {
                battleSfx.uiClick();
                setPickerOpen((o) => !o);
              }}
              aria-expanded={pickerOpen}
              aria-label={
                adjutant
                  ? `Adjutant ${adjutant.name} — tap to appoint a different hero`
                  : "Adjutant station — no heroes aboard"
              }
              className="pointer-events-auto flex touch-manipulation items-center gap-1.5 rounded border border-transparent px-1 py-0.5 text-left transition active:scale-[0.97]"
            >
              <Medallion name={adjutant?.name ?? commanderName} size={38} adjutant />
              <span className="min-w-0">
                <span className="block max-w-[86px] truncate text-[9px] font-bold leading-tight text-[var(--cmd-text)]">
                  {adjutant?.name ?? commanderName}
                </span>
                <span className="block text-[8px] font-bold uppercase tracking-[0.18em] leading-tight text-[var(--cmd-accent)] [text-shadow:var(--cmd-accent-glow)]">
                  {adjutant ? "Adjutant" : "Commander"}
                </span>
                {adjutant?.role && (
                  <span className="block max-w-[86px] truncate text-[8px] leading-tight text-[var(--cmd-faint)]">
                    {adjutant.role}
                  </span>
                )}
              </span>
              <span
                className="ml-0.5 h-1.5 w-1.5 flex-none rounded-full bg-emerald-400"
                style={{ boxShadow: "0 0 5px rgba(52,255,140,0.8)" }}
                aria-hidden="true"
              />
            </button>

            {/* appoint picker — rises off the deck */}
            {pickerOpen && (
              <div
                className="pointer-events-auto absolute bottom-full left-0 z-30 mb-1 w-44 rounded-md border border-[var(--cmd-line)] bg-[var(--cmd-bg)] p-1.5 shadow-2xl"
                data-testid="cockpit-adjutant-picker"
              >
                <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--cmd-accent)] [text-shadow:var(--cmd-accent-glow)]">
                  Appoint adjutant
                </p>
                {ui.crew.length === 0 && (
                  <p className="text-[9px] leading-snug text-[var(--cmd-dim)]">
                    No heroes aboard — the squad leads stand the watch until a hero rides with you.
                  </p>
                )}
                {ui.crew.map((c) => {
                  const active = adjutant?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        battleSfx.uiClick();
                        setAdjutantId(c.id);
                        setPickerOpen(false);
                      }}
                      aria-pressed={active}
                      className={`mt-0.5 flex min-h-[26px] w-full touch-manipulation items-center justify-between rounded border px-1.5 text-[9px] font-semibold transition active:scale-[0.98] ${
                        active
                          ? "border-[var(--cmd-accent)] bg-[var(--cmd-accent-dim)] text-[var(--cmd-accent)]"
                          : "border-[var(--cmd-line)] bg-[var(--cmd-panel)] text-[var(--cmd-text)]"
                      }`}
                    >
                      <span className="truncate">
                        {c.name}
                        {c.role ? <span className="text-[var(--cmd-faint)]"> · {c.role}</span> : null}
                      </span>
                      {active && <span aria-hidden="true">●</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="w-px flex-none bg-[var(--cmd-line)]" aria-hidden="true" />

          {/* OFFICERS — the rest of the bridge, present at their stations.
              No heroes aboard: the squad leads stand in, with strength. */}
          <div
            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
            data-testid="cockpit-officers"
          >
            {officers.slice(0, 4).map((o) => (
              <div key={o.id} className="flex flex-none flex-col items-center gap-0.5" title={o.name}>
                <Medallion name={o.name} size={26} />
                {fs && (
                  <span className="max-w-[44px] truncate text-[8px] leading-none text-[var(--cmd-faint)]">
                    {o.name}
                  </span>
                )}
              </div>
            ))}
            {ui.crew.length === 0 &&
              ui.squads.slice(0, 5).map((s) => (
                <div key={s.id} className="flex flex-none flex-col items-center gap-0.5" title={s.name}>
                  <Medallion name={s.name} size={26} />
                  {fs && (
                    <span className="max-w-[44px] truncate text-[8px] tabular-nums leading-none text-[var(--cmd-faint)]">
                      {s.name} {s.alive}/{s.total}
                    </span>
                  )}
                </div>
              ))}
            {ui.crew.length === 0 && ui.squads.length === 0 && (
              <p className="text-[8px] uppercase tracking-[0.18em] text-[var(--cmd-faint)]">
                Bridge quiet
              </p>
            )}
          </div>

          <div className="w-px flex-none bg-[var(--cmd-line)]" aria-hidden="true" />

          {/* INSTRUMENTS — camera, pace, and the ship's readouts */}
          <div className="flex flex-none items-center gap-1.5" data-testid="cockpit-instruments">
            <div className="flex flex-col gap-1">
              <div className="flex gap-1" role="group" aria-label="Camera: command ship POV or holomap">
                <button
                  type="button"
                  onClick={() => {
                    battleSfx.uiClick();
                    setCameraMode("command");
                  }}
                  data-testid="cockpit-cam-pov"
                  aria-pressed={ui.cameraMode === "command"}
                  className={segBtn(ui.cameraMode === "command")}
                >
                  🛸 POV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    battleSfx.uiClick();
                    setCameraMode("tactical");
                  }}
                  data-testid="cockpit-cam-map"
                  aria-pressed={ui.cameraMode === "tactical"}
                  className={segBtn(ui.cameraMode === "tactical")}
                >
                  🗺 Map
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  battleSfx.uiClick();
                  cycleBattleSpeed();
                }}
                data-testid="cockpit-pace"
                aria-label="Cycle battle pace"
                className={segBtn(false)}
              >
                ⏱ {ui.battleSpeed === "slow" ? "Slow" : "1×"}
              </button>
            </div>
            {fs && (
              <div className="hidden flex-col gap-0.5 text-right min-[420px]:flex" aria-hidden="true">
                <span className="text-[9px] font-bold tabular-nums leading-none text-[var(--cmd-text)]">
                  {fmtClock(ui.tS)}
                </span>
                <span className="text-[8px] tabular-nums leading-none text-[var(--cmd-faint)]">
                  <span className="text-emerald-300/90">{ui.kills.attacker}✕</span>
                  {" · "}
                  <span className="text-rose-300/90">{ui.kills.defender}✕</span>
                  {" · "}
                  {Math.round(ui.zoomLevel * 100)}%
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                battleSfx.uiClick();
                setPickerOpen(false);
                setCockpitOn(false);
              }}
              data-testid="cockpit-fold"
              aria-label="Fold the cockpit frame away"
              className="pointer-events-auto flex h-[26px] w-[26px] touch-manipulation items-center justify-center self-start rounded-sm border border-[var(--cmd-line)] bg-[var(--cmd-panel)] text-[10px] text-[var(--cmd-dim)] transition active:scale-[0.94]"
            >
              ▾
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
