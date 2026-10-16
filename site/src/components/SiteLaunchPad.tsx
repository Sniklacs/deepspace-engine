// SITE LAUNCH PAD — REDUNDANCY BY DESIGN (owner 2026-10-16): "if I'm
// going to click a site right there, I want to know if I can explore it
// or not… if they want to begin exploration right from right there, they
// have every right." ONE shared pad — eligibility + reason + the full
// bill + the commit — mounted at every surface where a site appears:
// the WorldGlobe site sheet, the Circuit map's node sheet, and anywhere
// else a site shows its face. The ExpeditionTab hangar flow is untouched
// and stays the other door; both doors run the same engine path (the
// page's launchFn) and deep zones detour through the same RiskModal.
import { useRef, useState } from "react";
import type { GameState, Zone } from "../game/types";
import { engineHelpers, type ExpeditionRefusal } from "../game/client-utils";
import { sound } from "../game/sound";
import { useT } from "./i18n/I18n";
import RiskModal from "./RiskModal";

function reasonLine(
  t: ReturnType<typeof useT>,
  reason: ExpeditionRefusal,
  need: number,
  have: number,
  active: number,
  max: number,
): string {
  switch (reason) {
    case "noRace":
      return t("pad.reason.noRace", "Choose a race first — no colony, no expeditions.");
    case "slots":
      return t("pad.reason.slots", "All field teams are out ({active}/{max} exploring). Deploy Logistics AI for more slots.", { active, max });
    case "supplies":
      return t("pad.reason.supplies", "Not enough supplies — this run needs {need} 📦, you hold {have} 📦.", { need: need.toLocaleString(), have: have.toLocaleString() });
    case "embers":
      return t("pad.reason.embers", "The ordnance this rung needs costs {need} 🧯 Embers — you hold {have} 🧯.", { need, have });
    case "energy":
      return t("pad.reason.energy", "Not enough energy — this run draws {need} ⚡ and the pool holds {have}. It refills daily.", { need, have });
    case "stepOut":
      return t("pad.reason.stepOut", "The Cradle hasn't stepped out yet — forge a Medical kit, a Mechanics kit and an Armor kit in the Workshop before any team leaves.");
    case "fuel":
      return t("pad.reason.fuel", "The convoy can't carry that run far enough with what's in the depot — pack more vehicle fuel ({have}/{need} ⛽).", { have, need });
    case "battery":
      return t("pad.reason.battery", "The engines won't run silent out there with what's charged — pack more battery packs ({have}/{need} 🔋).", { have, need });
    case "mechanics":
      return t("pad.reason.mechanics", "The machinery out there outranks your mechanics — forge Skilled Mechanics first ({have}/{need} 👷).", { have, need });
  }
}

export default function SiteLaunchPad({
  state,
  zone,
  onLaunch,
}: {
  state: GameState;
  zone: Zone;
  /** The EXISTING launch path (the page's launchFn through act()) —
   *  the pad adds no second way to spend supplies. */
  onLaunch: (zoneId: string, scientists: number) => void;
}) {
  const t = useT();
  const [scientists, setScientists] = useState(1);
  const [riskOpen, setRiskOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const lockRef = useRef(0);
  const elig = engineHelpers.eligibility(state, zone);
  const bill = elig.bill;
  const maxSci = Math.max(1, state.scientists);
  const sci = Math.min(scientists, maxSci);

  const commit = () => {
    // Click Law: an in-flight press never stacks a second launch.
    const nowMs = Date.now();
    if (nowMs - lockRef.current < 1200) return;
    lockRef.current = nowMs;
    if (!elig.ok) {
      sound.error();
      return;
    }
    if (elig.needsRiskConfirm) {
      sound.click();
      setRiskOpen(true);
      return;
    }
    sound.deploy();
    setNote(t("pad.launched", "Team dispatched to {zone} — watch the run from Exploration.", { zone: zone.name }));
    onLaunch(zone.id, sci);
  };

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-3" data-testid="site-launch-pad">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
          {t("pad.title", "Explore from here")}
        </p>
        <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-red-300">
          {t("play.zones.risk", "Risk {n}", { n: zone.risk })}
        </span>
      </div>

      {/* Eligibility — the answer, in place, before any commitment. */}
      {elig.ok ? (
        <p className="mt-2 text-[13px] font-medium text-emerald-300">
          {t("pad.ready", "✓ You can explore this site now.")}
        </p>
      ) : (
        elig.reason && (
          <p role="status" className="mt-2 text-[13px] leading-snug text-amber-200">
            {reasonLine(t, elig.reason, elig.need, elig.have, elig.activeCount, elig.maxSlots)}
          </p>
        )
      )}

      {/* THE BILL — the same itemized numbers the RiskModal and the
          hangar quote (one helper, every surface). */}
      <ul className="mt-2 space-y-1 text-[13px]">
        <li className="flex items-baseline justify-between gap-3">
          <span className="text-gray-400">{t("play.risk.billOps", "Operations — gear & crew")}</span>
          <span className="text-gray-200">{bill.operations.toLocaleString()} 📦</span>
        </li>
        <li className="flex items-baseline justify-between gap-3">
          <span className="text-gray-400">{t("play.risk.billDemand", "Rung demand")}</span>
          <span className="text-gray-200">{bill.demand.toLocaleString()} 📦</span>
        </li>
        {bill.ordnanceSupplies > 0 && (
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-gray-400">{t("play.risk.billOrdnance", "Ordnance")}</span>
            <span className="text-gray-200">{bill.ordnanceSupplies.toLocaleString()} 📦</span>
          </li>
        )}
        {bill.ordnanceEmbers > 0 && (
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-gray-400">{t("play.risk.billOrdEmbers", "Ordnance Embers")}</span>
            <span className="text-gray-200">{bill.ordnanceEmbers.toLocaleString()} 🧯</span>
          </li>
        )}
        <li className="flex items-baseline justify-between gap-3 border-t border-white/10 pt-1.5 font-semibold">
          <span className="text-gray-200">{t("play.risk.billTotal", "Total")}</span>
          <span className={bill.affordable ? "text-ember-soft" : "text-red-300"}>{bill.totalSupplies.toLocaleString()} 📦</span>
        </li>
      </ul>
      <p className={`mt-1 text-end text-[11px] ${bill.affordable ? "text-gray-500" : "text-red-300"}`}>
        {bill.affordable
          ? t("play.risk.billHold", "You hold {held} 📦 → {after} after launch", { held: bill.heldSupplies.toLocaleString(), after: bill.afterSupplies.toLocaleString() })
          : t("play.risk.billShort", "You hold {held} 📦 — short {short} 📦", { held: bill.heldSupplies.toLocaleString(), short: (bill.totalSupplies - bill.heldSupplies).toLocaleString() })}
      </p>

      {/* Team size + the commit, in place. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400">{t("exp.scientists")}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("pad.fewerScientists", "Fewer scientists")}
            onClick={() => { setScientists((s) => Math.max(1, s - 1)); sound.click(); }}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-lg text-white hover:bg-white/10"
          >
            −
          </button>
          <span className="w-8 text-center text-sm font-bold text-white">{sci}</span>
          <button
            type="button"
            aria-label={t("pad.moreScientists", "More scientists")}
            onClick={() => { setScientists((s) => Math.min(maxSci, s + 1)); sound.click(); }}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-lg text-white hover:bg-white/10"
          >
            +
          </button>
        </div>
        <button
          type="button"
          onClick={commit}
          disabled={!elig.ok}
          className="ms-auto min-h-[44px] rounded-lg bg-ember px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("play.exp.commitPrice", "Commit Supplies — {total} 📦", { total: bill.totalSupplies.toLocaleString() })}
        </button>
      </div>
      {note && (
        <p role="status" className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] text-gray-300">
          {note}
        </p>
      )}

      {/* Deep zones detour through the SAME pre-launch risk pop-up the
          hangar uses — bill included (owner: the pop-up governs deep runs). */}
      {riskOpen && (
        <RiskModal
          state={state}
          zone={zone}
          scientists={sci}
          onGo={() => {
            setRiskOpen(false);
            sound.deploy();
            setNote(t("pad.launched", "Team dispatched to {zone} — watch the run from Exploration.", { zone: zone.name }));
            onLaunch(zone.id, sci);
          }}
          onPrepare={() => {
            setRiskOpen(false);
            setNote(t("pad.prepareHint", "The Workshop builds what's missing — forge the gear, then Commit from here or the hangar."));
          }}
          onSafer={() => {
            setRiskOpen(false);
            setNote(t("pad.saferHint", "The deep can wait — pick a milder site and its pad will clear you in place."));
          }}
          onCancel={() => { setRiskOpen(false); sound.click(); }}
        />
      )}
    </div>
  );
}
