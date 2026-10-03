// AllianceShipyard — the shared ship-factory readout.
//
// Rendered in the alliance home (Battles tab) AND in the Cradle page's
// alliance section, so both surfaces show the same build queue and fleet.
// Display-only: ordering / crewing ships happens through the engine actions;
// this file only reads `alliance.shipyard`.
import { useMemo } from "react";
import type { Alliance } from "../game/war/alliances";
import { ensureShipyard } from "../game/shipyard";
import { shipName } from "../game/worldmap";
import { useT } from "./i18n/I18n";
import { Icon } from "./icons";
import { Bdi } from "./ui/Bdi";

function fmtLeft(ms: number): string {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function AllianceShipyardSection({
  alliance,
  now,
}: {
  alliance: Alliance;
  now: number;
}) {
  const t = useT();
  const sy = useMemo(() => ensureShipyard(alliance), [alliance]);
  const queue = sy.queue ?? [];
  const ships = sy.ships ?? [];
  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-2">
        <Icon name="hammer" size={13} aria-hidden="true" />
        {t("shipyard.title", "Ship Factory")}{" "}
        <span className="font-normal normal-case">
          · {t("shipyard.level", "Factory Level {level}", { level: sy.level })}
        </span>
      </h4>
      {queue.length === 0 ? (
        <p className="text-xs text-text-2">{t("cradleAlliance.noBuilds", "No ships under construction.")}</p>
      ) : (
        <ul className="space-y-1.5">
          {queue.map((b) => {
            const total = Math.max(1, b.doneAt - b.startedAt);
            const pct = Math.max(0, Math.min(100, Math.round(((now - b.startedAt) / total) * 100)));
            return (
              <li key={b.id} className="rounded-lg border border-line bg-surf-1 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-text-1">{shipName(b.raceId, b.shipClass)}</span>
                  <span className="text-[11px] text-text-2">
                    <Bdi dir="ltr" className="num">{pct}%</Bdi> · {fmtLeft(b.doneAt - now)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surf-3">
                  <div className="h-full rounded-full bg-acc" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-text-2">
                  {t("shipyard.contributing", "{count} on crew", { count: b.contributors.length })}
                  {b.orderedByName ? ` · ${b.orderedByName}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <h5 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        {t("cradleAlliance.fleet", "Fleet")} <Bdi dir="ltr" className="num">({ships.length})</Bdi>
      </h5>
      {ships.length === 0 ? (
        <p className="text-xs text-text-2">{t("cradleAlliance.noShips", "No completed ships yet.")}</p>
      ) : (
        <ul className="space-y-1">
          {ships.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surf-1 px-3 py-1.5">
              <span className="text-sm text-text-1">{s.name}</span>
              <span className="text-[11px] text-text-2">
                {t(`shipyard.status.${s.status}`, s.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
