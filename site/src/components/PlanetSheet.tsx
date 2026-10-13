// PlanetSheet — the planet detail sheet of the SOLAR SYSTEM layer
// (Hans, Oct 6 2026). Tapping a planet in the zoomed-out system view opens
// this: the planet large, what little is public (name, race, description),
// and — only if a scout probe has been there — what the probe learned.
// Fog-of-war is the law: no report, no colony numbers. Ever.
//
// The probe flow lives here: "Send scout probe" spends one ready probe
// (engine re-validates server-side), the flight shows as en-route with an
// ETA, and a returned probe is collected into its report right in the
// sheet. The home world gets "Enter" instead — it zooms back into its
// globe; no other world can be entered.
import { useState } from "react";
import type { GameState } from "../game/types";
import { fmtEtaMs, probeGate, type PlanetDef } from "../game/system-view";
import { useT } from "./i18n/I18n";
import { sound } from "../game/sound";
import { Bdi } from "./ui/Bdi";

export default function PlanetSheet({
  planet,
  homeWorldId,
  state,
  now,
  onClose,
  onLaunchProbe,
  onCollectProbe,
  onEnterHome,
}: {
  planet: PlanetDef;
  /** WORLD_CONFIG.worldId of this deployment — the enterable world. */
  homeWorldId: string;
  state: GameState;
  now: number;
  onClose: () => void;
  onLaunchProbe?: (serverId: string) => void;
  onCollectProbe?: (probeId: string) => void;
  /** Home only: ease the globe back in and close the sheet. */
  onEnterHome?: () => void;
}) {
  const t = useT();
  const [hint, setHint] = useState<string | null>(null);
  const wm = state.worldMap;
  const gateForPlanet = probeGate(wm, planet.id, homeWorldId, now);
  const pal = planet.palette;

  return (
    <div
      role="dialog"
      aria-label={planet.name}
      className="fixed inset-x-0 bottom-0 z-40 mx-auto max-h-[72dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t bg-[#0a0d18]/95 backdrop-blur-md"
      style={{ borderTopColor: `${pal.rim}66`, boxShadow: `0 -12px 48px ${pal.rim}30` }}
    >
      <div className="flex justify-center pt-2">
        <div className="h-1 w-10 rounded-full bg-white/25" />
      </div>
      <button
        type="button"
        onClick={() => { sound.click(); onClose(); }}
        aria-label={t("worldglobe.close", "Close")}
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/5 text-base text-white"
      >
        ✕
      </button>

      <div className="flex gap-3 px-4 pb-2 pt-1">
        {/* The planet, large — a shaded sphere in its race's colors. */}
        <div
          aria-hidden
          className="h-[84px] w-[84px] shrink-0 rounded-full"
          style={{
            background: `radial-gradient(circle at 32% 30%, ${pal.core} 0%, ${pal.mid} 52%, ${pal.dark} 100%)`,
            boxShadow: `0 0 26px ${pal.rim}55, inset -10px -12px 24px rgba(0,0,0,0.55), inset 4px 5px 12px rgba(255,255,255,0.25)`,
          }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: pal.rim }}>
            {planet.isHome
              ? t("planetsheet.homeWorld", "Home world")
              : t("planetsheet.planet", "Planet")}
          </p>
          <h3 className="mt-0.5 text-[17px] font-bold leading-tight text-white">{planet.name}</h3>
          <p className="mt-0.5 text-[12px] text-gray-300">
            {planet.raceName}
            {" · "}
            {planet.status === "live" ? (
              <span className="text-emerald-300">{t("planetsheet.live", "Live")}</span>
            ) : (
              <span className="text-gray-500">{t("planetsheet.soon", "Coming soon")}</span>
            )}
          </p>
          <p className="mt-1 text-[12px] leading-snug text-gray-400">{planet.description}</p>
        </div>
      </div>

      {/* The last block's bottom edge must clear the fixed bottom nav (+ the
          chat dock when it stands, + the home-indicator inset) or the primary
          action button ("Send scout probe" / "Enter") slides under the nav
          and can't be tapped. Same clearance formula as .shell-body /
          win-frame (app.css): nav + dock + safe inset + the 1.25rem (old
          pb-5) breathing room. Padding on this inner wrapper — not the
          scroll container — so every browser counts it in the scroll height. */}
      <div className="px-4 pb-[calc(var(--spacing-nav)+var(--dock-h,0px)+env(safe-area-inset-bottom)+1.25rem)]">
        {planet.isHome ? (
          <div>
            <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] leading-relaxed text-gray-300">
              {t("planetsheet.homeBlurb", "This is your world. Your colony, your colonies-to-be, your war. Zoom back in and drive it.")}
            </p>
            <button
              type="button"
              onClick={() => { sound.click(); onEnterHome?.(); }}
              className="mt-2 w-full rounded-xl border border-amber-300/40 bg-amber-400/15 px-3 py-2.5 text-sm font-bold text-amber-100 hover:bg-amber-400/25"
            >
              ⌂ {t("planetsheet.enter", "Enter {world}", { world: planet.name })}
            </button>
          </div>
        ) : (
          <ProbeSection
            planet={planet}
            gate={gateForPlanet}
            now={now}
            onLaunchProbe={onLaunchProbe}
            onCollectProbe={onCollectProbe}
            hint={hint}
            setHint={setHint}
          />
        )}
        {hint && (
          <p role="status" className="mt-2 rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-100">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

function ProbeSection({
  planet,
  gate,
  now,
  onLaunchProbe,
  onCollectProbe,
  hint,
  setHint,
}: {
  planet: PlanetDef;
  gate: ReturnType<typeof probeGate>;
  now: number;
  onLaunchProbe?: (serverId: string) => void;
  onCollectProbe?: (probeId: string) => void;
  hint: string | null;
  setHint: (h: string | null) => void;
}) {
  const t = useT();

  if (gate.kind === "home") return null;

  if (gate.kind === "needs-research") {
    return (
      <div>
        <p className="text-[12px] font-semibold text-gray-200">🔭 {t("planetsheet.scoutTitle", "Scout this world")}</p>
        <p className="mt-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] leading-relaxed text-gray-400">
          {t(
            "planetsheet.needsResearch",
            "Unscouted — and it stays that way until the Lab finishes Scout Probe research. Then probes built on this page can fly here and tell you what waits.",
          )}
        </p>
      </div>
    );
  }

  if (gate.kind === "enroute") {
    const msLeft = Math.max(0, gate.probe.returnsAt - now);
    return (
      <div>
        <p className="text-[12px] font-semibold text-gray-200">🔭 {t("planetsheet.scoutTitle", "Scout this world")}</p>
        <div className="mt-1 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2">
          {gate.ready ? (
            <>
              <p className="text-[12px] font-semibold text-emerald-200">
                {t("planetsheet.probeBack", "Your probe is back — its report is ready.")}
              </p>
              <button
                type="button"
                onClick={() => { sound.click(); onCollectProbe?.(gate.probe.id); }}
                className="mt-2 w-full rounded-xl border border-emerald-400/40 bg-emerald-400/15 px-3 py-2 text-sm font-bold text-emerald-100 hover:bg-emerald-400/25"
              >
                {t("planetsheet.collect", "Collect scout report")}
              </button>
            </>
          ) : (
            <p className="text-[12px] text-cyan-100">
              {t("planetsheet.enroute", "Probe en route — returns in")}{" "}
              <Bdi dir="ltr"><b>{fmtEtaMs(msLeft)}</b></Bdi>
              {". "}
              {t("planetsheet.enrouteNote", "Watch it cross the system on the map.")}
            </p>
          )}
        </div>
      </div>
    );
  }

  // gate.kind === "launch"
  const report = gate.report;
  return (
    <div>
      <p className="text-[12px] font-semibold text-gray-200">🔭 {t("planetsheet.scoutTitle", "Scout this world")}</p>
      {report ? (
        <div className="mt-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <p className="text-[12px] leading-relaxed text-gray-200">
            {t("rviews.reportLine", "{players} players, {colonies} colonies ({abandoned} abandoned)", {
              players: report.playerCount,
              colonies: report.colonyCount,
              abandoned: report.abandonedCount,
            })}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            {t("planetsheet.reportWhen", "Last probe's word — intel stales, and a probe never says whether loot remains. Odds, not promises.")}
          </p>
        </div>
      ) : (
        <p className="mt-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] leading-relaxed text-gray-400">
          {t(
            "planetsheet.unscouted",
            "Unscouted — no probe has charted this world yet. All anyone knows is what's written above. Send a probe to learn more.",
          )}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          sound.click();
          if (!onLaunchProbe) {
            setHint(t("planetsheet.unwired", "Probe launches aren't wired to this page yet — the Lab card still flies them."));
          } else if (gate.probesReady < 1) {
            setHint(
              t(
                "planetsheet.noProbes",
                "No probes ready. Build one in the Scout Probes station on this page (500 supplies) — then send it from here.",
              ),
            );
          } else {
            setHint(null);
            onLaunchProbe(planet.id);
          }
        }}
        className="mt-2 w-full rounded-xl border border-cyan-400/40 bg-cyan-400/15 px-3 py-2.5 text-sm font-bold text-cyan-100 hover:bg-cyan-400/25"
      >
        🔭 {report
          ? t("planetsheet.sendAnother", "Send another scout probe")
          : t("planetsheet.send", "Send scout probe")}
        {gate.probesReady > 0 && (
          <span className="ml-1 text-[11px] font-semibold text-cyan-300">({gate.probesReady} {t("planetsheet.ready", "ready")})</span>
        )}
      </button>
      {hint === null && gate.probesReady < 1 && (
        <p className="mt-1 text-[10px] text-gray-500">
          {t("planetsheet.noneReady", "No probes ready — build one below, in the Scout Probes station.")}
        </p>
      )}
    </div>
  );
}
