// WorldIntelPanel — WORLD INTEL (owner 2026-10-04, WS D).
//
// The world depth panel: planet flavor (not telemetry), live colony counts,
// top alliances (tap → the globe snaps to their turf), and the Chorus reverb
// ladder surfaced without opening a sheet.
//
// What the client actually has:
//   • colonies — LIVE from state.worldMap.known (real data).
//   • alliances — LIVE from state.alliances (real data).
//   • players / players online — NOT wired. No presence feed exists in the
//     client or server build (see game/api.ts), so those rows are omitted
//     rather than invented; the panel says so in one muted line.
//   • planet size / temperature — world FLAVOR, deterministic per worldId
//     (hash-derived, stable), explicitly labeled as flavor, never telemetry.
import { useMemo } from "react";
import type { GameState } from "../game/types";
import { WORLD_CONFIG_PUBLIC } from "../game/world-config";
import {
  allianceTurf,
  colonyCounts,
  topAlliances,
  worldFlavor,
} from "../game/world-intel";
import { recommendedReverbForGrade } from "../game/chorus-intel";
import type { ChorusGradeId } from "../game/war/chorus-sites";
import { useT } from "./i18n/I18n";
import { sound } from "../game/sound";

const GRADES: ChorusGradeId[] = [1, 2, 3, 4, 5];
const ROMAN: Record<ChorusGradeId, string> = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };

/** Chorus reverb ladder: the recommended loadout reverb per grade (== the
 *  grade's strength by construction — chorus-intel.ts). One compact line. */
function ReverbLadder({ t }: { t: (k: string, f: string) => string }) {
  const line = GRADES.map(
    (g) => `${ROMAN[g]} ~${recommendedReverbForGrade(g).toLocaleString()}`,
  ).join(" · ");
  return (
    <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
      <span className="font-semibold text-amber-200/90">
        {t("worldintel.reverbLadder", "Chorus reverb ladder")}:
      </span>{" "}
      {line}
      <span className="mt-0.5 block text-[10px] text-gray-500">
        {t(
          "worldintel.reverbHint",
          "Recommended loadout reverb per Chorus grade — reverb ≥ the grade means you should survive it, per the loadout reverb gauge.",
        )}
      </span>
    </p>
  );
}

export default function WorldIntelPanel({
  state,
  onSnap,
}: {
  state: GameState;
  /** Snap the globe to a turf position (WS5 globeFocus mechanism). */
  onSnap: (lat: number, lon: number) => void;
}) {
  const t = useT();

  const flavor = useMemo(
    () => worldFlavor(WORLD_CONFIG_PUBLIC.worldId),
    [],
  );
  const counts = useMemo(
    () => colonyCounts(state.worldMap?.known),
    [state.worldMap?.known],
  );
  const top = useMemo(
    () => topAlliances(state.alliances, 3),
    [state.alliances],
  );
  // Sanity: world identity for the flavor header never changes mid-render.

  return (
    <section
      aria-label={t("worldintel.title", "World intel")}
      className="rounded-xl border border-white/10 bg-black/30 p-3"
    >
      {/* PLANET FLAVOR — explicitly not telemetry. */}
      <h3 className="text-[12px] font-semibold text-gray-200">
        🛰️ {t("worldintel.title", "World intel")}
      </h3>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
        <span className="font-semibold text-gray-200">
          {WORLD_CONFIG_PUBLIC.worldName}
        </span>{" "}
        · ⌀ {flavor.diameterKm.toLocaleString()} km · {flavor.meanTempC}°C{" "}
        {t("worldintel.meanTemp", "mean surface temp")}
      </p>
      <p className="text-[10px] text-gray-500">
        {t("worldintel.flavorNote", "World flavor — not telemetry.")}
      </p>

      {/* LIVE COUNTS — real data only. */}
      <div className="mt-2 border-t border-white/10 pt-2">
        <p className="text-[11px] leading-relaxed text-gray-300">
          <span className="font-semibold text-gray-100">
            {t("worldintel.colonies", "Colonies")}: {counts.total}
          </span>{" "}
          <span className="text-gray-500">
            ({counts.active} {t("worldintel.active", "active")} · {counts.abandoned}{" "}
            {t("worldintel.abandoned", "abandoned")} · {counts.husk}{" "}
            {t("worldintel.husks", "husks")}
            {counts.settingUp > 0 &&
              ` · ${counts.settingUp} ${t("worldintel.settingUp", "rising")}`}
            )
          </span>
          <span className="ml-1 rounded bg-emerald-400/15 px-1 py-px text-[9px] font-semibold text-emerald-300">
            {t("worldintel.live", "LIVE")}
          </span>
        </p>
        {/* Players / online: unwired — no presence feed on the client.
            Hans's rule: say so inline instead of showing a dead row. */}
        <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">
          {t(
            "worldintel.presenceNote",
            "Players online: not counted yet — the client has no presence feed, and I'd rather show nothing than invent a number. This row wires up when presence ships.",
          )}
        </p>
      </div>

      {/* TOP ALLIANCES — tap a row, the globe snaps to their turf. */}
      <div className="mt-2 border-t border-white/10 pt-2">
        <p className="text-[11px] font-semibold text-gray-300">
          {t("worldintel.topAlliances", "Top alliances")}
          <span className="ml-1 font-normal text-gray-500">
            {t("worldintel.tapToSnap", "— tap to snap the globe to their turf")}
          </span>
        </p>
        {top.length === 0 ? (
          <p className="mt-1 text-[11px] text-gray-500">
            {t(
              "worldintel.noAlliances",
              "No alliances on this world yet — found one and take the sky.",
            )}
          </p>
        ) : (
          <div className="mt-1 flex flex-col gap-1">
            {top.map((a) => {
              const turf = allianceTurf(a, state.worldMap?.known, state.gameId);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    sound.click();
                    onSnap(turf.lat, turf.lon);
                  }}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-left hover:border-amber-300/40"
                >
                  <span aria-hidden className="text-[14px]">
                    {a.banner || "🏳️"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-gray-100">
                    {a.name}
                  </span>
                  <span className="text-[11px] text-gray-400">
                    {a.members.length}{" "}
                    {t("worldintel.members", "members")}
                  </span>
                  {turf.estimated ? (
                    <span className="rounded bg-amber-400/15 px-1 py-px text-[9px] font-semibold text-amber-200">
                      {t("worldintel.turfApprox", "turf approx")}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-500">◎</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* REVERB SURFACE — no sheet required. */}
      <div className="border-t border-white/10 pt-1">
        <ReverbLadder t={t} />
      </div>
    </section>
  );
}
