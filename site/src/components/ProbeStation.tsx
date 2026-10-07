// ProbeStation — the scout-probe home on the WORLD page (Hans, Oct 6
// 2026: "move the scout probes over to the world page"). The Lab still owns
// the RESEARCH; this station owns the probes themselves: how many are
// ready, build more (500 supplies, engine-validated), what's in flight and
// when it lands. LAUNCHING happens from the solar system layer — zoom out
// (−) past the globe, tap a planet, send the probe from its sheet — so
// there is deliberately no launch box here (and no second probe economy:
// same worldmap state, same server fns as the Lab card, which keeps
// working unchanged).
import { useState } from "react";
import type { GameState } from "../game/types";
import { SCOUT_PROBE_COST_SUPPLIES, SCOUT_TECH_ID } from "../game/worldmap";
import { fmtEtaMs, planetDefById } from "../game/system-view";
import { WORLD_CONFIG_PUBLIC } from "../game/world-config";
import { useT } from "./i18n/I18n";
import { sound } from "../game/sound";
import { Bdi } from "./ui/Bdi";

export default function ProbeStation({
  state,
  now,
  onBuildProbe,
  onCollectProbe,
}: {
  state: GameState;
  now: number;
  onBuildProbe?: () => void;
  onCollectProbe?: (probeId: string) => void;
}) {
  const t = useT();
  const [hint, setHint] = useState<string | null>(null);
  const wm = state.worldMap;
  const researched = wm?.scoutTechResearched ?? false;
  const job =
    state.researchJobs.find((j) => j.techId === SCOUT_TECH_ID && j.status === "researching") ??
    null;

  if (!researched) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[12px] font-semibold text-gray-200">🔭 {t("probestation.title", "Scout Probes")}</h3>
          <span className="text-[10px] text-gray-500">{t("probestation.locked", "Locked")}</span>
        </div>
        {job ? (
          <>
            <p className="mt-1 text-[11px] text-cyan-200">
              {t("probestation.researching", "The Lab is researching scout probes —")}
              {" "}
              <Bdi dir="ltr">{fmtEtaMs(Math.max(0, job.startedAt + job.durationMs - now))}</Bdi>
              {" "}
              {t("probestation.left", "left")}
            </p>
            <div className="mt-1.5 h-1 rounded bg-white/10">
              <div
                className="h-1 rounded bg-cyan-400"
                style={{ width: `${Math.min(100, ((now - job.startedAt) / job.durationMs) * 100)}%` }}
              />
            </div>
          </>
        ) : (
          <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
            {t(
              "probestation.lockedHint",
              "Research Scout Probes in the Lab, and this page becomes the probe home: build probes here, then zoom out to the solar system and send them at other worlds.",
            )}
          </p>
        )}
      </div>
    );
  }

  const probes = wm?.probes ?? 0;
  const inflight = wm?.inflight ?? [];
  const supplies = Math.floor(state.resources.supplies);
  const canBuild = supplies >= SCOUT_PROBE_COST_SUPPLIES;
  const charted = wm ? Object.keys(wm.reports).length : 0;

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-gray-200">🔭 {t("probestation.title", "Scout Probes")}</h3>
        <span className="text-[10px] text-emerald-300">{t("rviews.researched", "Researched")}</span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-400">
          {t("rviews.probesHave", "Probes ready:")} <b className="text-white">{probes}</b>
          {charted > 0 && (
            <span className="text-gray-500">
              {" · "}
              {t("probestation.charted", "{n} worlds charted", { n: charted })}
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={() => {
            sound.click();
            if (!onBuildProbe) setHint("unwired");
            else if (!canBuild) setHint("supplies");
            else {
              setHint(null);
              onBuildProbe();
            }
          }}
          className="shrink-0 rounded-lg border border-cyan-400/30 bg-cyan-400/15 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-400/25"
        >
          {t("rviews.buildProbe", "Build probe (500 supplies)")}
        </button>
      </div>
      {hint === "supplies" && (
        <p role="status" className="mt-1 text-[10px] text-amber-200">
          {t("rviews.needSupplies", "Needs 500 supplies. You have {n}.", { n: supplies })}
        </p>
      )}
      {hint === "unwired" && (
        <p role="status" className="mt-1 text-[10px] text-amber-200">
          {t("probestation.unwired", "Probe building isn't wired to this page yet — the Lab card still builds them.")}
        </p>
      )}

      {inflight.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-gray-300">
            {t("rviews.inflight", "In flight ({n})", { n: inflight.length })}
          </p>
          <div className="mt-1 space-y-1">
            {inflight.map((p) => {
              const ready = p.status === "returned" || now >= p.returnsAt;
              const target =
                planetDefById(p.targetServerId, WORLD_CONFIG_PUBLIC.worldId)?.name ??
                p.targetServerId;
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded bg-white/5 px-2 py-1">
                  <span className="text-[11px] text-gray-300">
                    🔭 {target}
                    {" · "}
                    {ready ? (
                      <span className="text-emerald-300">{t("rviews.probeReady", "Ready")}</span>
                    ) : (
                      <Bdi dir="ltr">{fmtEtaMs(Math.max(0, p.returnsAt - now))}</Bdi>
                    )}
                  </span>
                  {ready && p.status === "inflight" && (
                    <button
                      type="button"
                      onClick={() => { sound.click(); onCollectProbe?.(p.id); }}
                      className="shrink-0 rounded border border-emerald-400/30 bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-400/25"
                    >
                      {t("rviews.collect", "Collect")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
        {t(
          "probestation.launchHint",
          "To launch: pinch out — or tap − — until the globe backs out into the solar system, then tap a planet and send its probe from there.",
        )}
      </p>
    </div>
  );
}
