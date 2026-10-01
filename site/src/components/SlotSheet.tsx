// SlotSheet — the domain/building detail sheet (moved out of CradleScreen
// 2026-10-01 so the Cradle plate can carry it to the Exploration page).
// Shared by the plate and the Cradle page's advance bar.
import type { ReactNode } from "react";
import { Sheet, SheetHeader } from "./Sheet";
import { ActionButton } from "./ui/ActionButton";
import { Bdi } from "./ui/Bdi";
import { engineHelpers } from "../game/client-utils";
import { CRADLE_SLOT_BY_ID } from "../game/cradle-slots";
import type { CradleSlotId } from "../game/cradle-slots";
import { DOMAIN_BY_ID, MAX_DOMAIN_LEVEL } from "../game/zones";
import { domainDescription, slotLabel } from "../game/i18n";
import { tipField, DOMAIN_TIPS } from "../game/tooltips";
import { useT } from "./i18n/I18n";
import type { GameState, DomainId } from "../game/types";

function RecordRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <li className="flex min-h-tap items-center justify-between gap-3 rounded-xl border border-line bg-surf-3/50 px-3 py-2">
      <span className="text-[12px] text-text-3">{label}</span>
      <b className="text-[13px] text-text-1">{value}</b>
    </li>
  );
}

export default function SlotSheet({
  state,
  slot,
  onClose,
  onDeploy,
}: {
  state: GameState;
  slot: CradleSlotId | null;
  onClose: () => void;
  onDeploy: (d: DomainId) => void;
}) {
  const t = useT();
  if (!slot) return null;
  const def = CRADLE_SLOT_BY_ID[slot];
  return (
    <Sheet
      open
      onClose={onClose}
      labelledBy="cradle-slot-title"
      title={slotLabel(t, def)}
    >
      <SheetHeader
        id="cradle-slot-title"
        title={slotLabel(t, def)}
        subtitle={t("cradle.levelN", { n: def.level(state) })}
        onClose={onClose}
      />
      <div className="sheet-body space-y-3 px-4 py-3 md:px-5">
          {(() => {
            const domain = slot as DomainId;
            const info = DOMAIN_BY_ID[domain];
            const level = state.deployedDomains[domain];
            const atMax = engineHelpers.domainAtMax(state, domain);
            const cost = engineHelpers.deployCost(state, domain);
            const affordable = engineHelpers.domainAffordable(state, domain);
            const domainTip = DOMAIN_TIPS[domain];
            return (
              <>
                <p className="text-[13px] text-text-2">{domainDescription(t, domain, info.description)}</p>
                <ul className="space-y-1.5">
                  <RecordRow label={t("cradle.level")} value={<Bdi dir="ltr" className="num">{level}</Bdi>} />
                  {/* a SENTENCE (the engine's own prose): no Bdi, on purpose */}
                  <RecordRow label={t("cradle.sheet.effectNow", "Effect now")} value={engineHelpers.domainEffectT(t, state, domain)} />
                  {!atMax && <RecordRow label={t("cradle.sheet.nextAdvanceCosts", "Next advance costs")} value={t("cradle.advanceSub", "{embers} Embers · {insight} insight", { embers: cost.embers.toLocaleString(), insight: cost.insight.toLocaleString() })} />}
                </ul>
                <p className="text-[11px] leading-tight text-text-3">{tipField(t, "domain", domain, "what", domainTip.what)}</p>
                {atMax ? (
                  <ActionButton
                    full
                    size="md"
                    icon="gear"
                    label={t("cradle.domainMax", { cap: MAX_DOMAIN_LEVEL })}
                    locked
                    reason={t("cradle.domainMaxReason")}
                    onClick={() => onDeploy(domain)}
                  />
                ) : (
                <ActionButton
                  full
                  size="md"
                  icon="gear"
                  label={t("cradle.slotDeploy", { n: level + 1 })}
                  sub={t("cradle.advanceSub", {
                    embers: cost.embers.toLocaleString(),
                    insight: cost.insight.toLocaleString(),
                  })}
                  locked={!affordable}
                  reason={t("cradle.slotDeployLocked", {
                    embers: cost.embers.toLocaleString(),
                    insight: cost.insight.toLocaleString(),
                  })}
                  onClick={() => onDeploy(domain)}
                />
                )}
              </>
            );
          })()}
      </div>
    </Sheet>
  );
}
