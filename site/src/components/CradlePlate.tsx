// CradlePlate — the colony name plate + the six domain tiles.
// Owner 2026-10-01: this lived at the top of the Cradle page; it now lives at
// the top of the Exploration page. The plate owns its slot sheet, so its tiles
// stay fully functional wherever it renders.
import { useState } from "react";
import { Panel } from "./ui/Panel";
import { BuildingTile } from "./ui/BuildingTile";
import { Tooltip } from "./Tooltip";
import { Bdi } from "./ui/Bdi";
import SlotSheet from "./SlotSheet";
import { engineHelpers } from "../game/client-utils";
import { CRADLE_SLOTS } from "../game/cradle-slots";
import type { CradleSlotId } from "../game/cradle-slots";
import { getRace } from "../game/races";
import { formatDate } from "../game/i18n/format";
import { tipT, LAB_TIPS } from "../game/tooltips";
import { useT } from "./i18n/I18n";
import type { GameState, DomainId } from "../game/types";

export default function CradlePlate({
  state,
  onDeploy,
}: {
  state: GameState;
  onDeploy: (d: DomainId) => void;
}) {
  const t = useT();
  const [slot, setSlot] = useState<CradleSlotId | null>(null);
  const race = getRace(state.race!);
  const spm = engineHelpers.suppliesPerMinute(state);
  return (
    <>
      <Panel
        variant="hero"
        className="plate-ground"
        accent={race.accent}
        labelledBy="cradle-plate-title"
        testid="cradle-plate"
      >
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="eyebrow">{t("cradle.plate")}</p>
            <h1 id="cradle-plate-title" className="truncate text-lg font-bold text-text-1">
              {state.playerName}
            </h1>
            <p className="mt-0.5 truncate text-[11px] text-text-3">
              {t("cradle.plateMeta", {
                race: race.name,
                region: race.homeRegion,
                date: formatDate(t.lang ?? "en", state.createdAt),
              })}
            </p>
          </div>
          <Tooltip className="flex-none" content={tipT(t, "lab", "fieldSlots", LAB_TIPS.fieldSlots)}>
            <span className="pill border border-line bg-surf-2 text-text-2">
              <Bdi dir="ltr" className="num text-ember-soft">{`+${spm.toFixed(1)}`}</Bdi>
              <span className="text-[11px]">{t("cradle.perMin")}</span>
            </span>
          </Tooltip>
        </header>
        <div className="relative mt-3 grid grid-cols-3 gap-2 plate-map">
          {CRADLE_SLOTS.map((s) => (
            <BuildingTile key={s.id} slot={s} state={state} onOpen={(id) => setSlot(id)} />
          ))}
        </div>
      </Panel>
      <SlotSheet
        state={state}
        slot={slot}
        onClose={() => setSlot(null)}
        onDeploy={(d) => { setSlot(null); onDeploy(d); }}
      />
    </>
  );
}
