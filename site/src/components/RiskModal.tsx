// RISK MODAL — the pre-launch radiation risk pop-up, shared by every
// launch surface (owner 2026-10-16, REDUNDANCY BY DESIGN: the hangar's
// ExpeditionTab and every site launch pad open THIS modal for deep
// zones — one risk read, one bill, everywhere). Shows % success,
// has-vs-need gear, the projected loss, and the run's full itemized
// bill; the player freely chooses to go.
import type { GameState, Zone } from "../game/types";
import { requiredGear } from "../game/engine";
import { engineHelpers } from "../game/client-utils";
import { openMaterialSheet, type MaterialSheetId } from "../game/material-sheet";
import { useT } from "./i18n/I18n";

/* Pre-launch radiation risk pop-up — shows % success, has-vs-need gear, and the
 * projected loss for the planned team; the player freely chooses to go. */
export default function RiskModal({ state, zone, scientists, onGo, onPrepare, onSafer, onCancel }: {
  state: GameState; zone: Zone; scientists: number;
  onGo: () => void; onPrepare: () => void; onSafer: () => void; onCancel: () => void;
}) {
  const r = state.resources;
  const need = requiredGear(zone, scientists);
  const loss = engineHelpers.loss(state, zone, scientists);
  const success = engineHelpers.success(state, zone, scientists);
  const bill = engineHelpers.runBill(state, zone);
  const fullyCovered = loss === 0;
  const t = useT();
  const table: { id: MaterialSheetId; icon: string; label: string; have: number; need: number }[] = [
    { id: "hazmat", icon: "🧥", label: t("play.gear.hazmatLabel", "Hazmat suits"), have: r.hazmat, need: need.hazmat },
    { id: "shots", icon: "💉", label: t("play.gear.shotsLabel", "Radiation shots"), have: r.shots, need: need.shots },
    { id: "alloy", icon: "⚙️", label: t("play.gear.alloyArmedLabel", "Alloy-armed diggers"), have: r.alloys, need: need.alloys },
  ];
  // OWNER 2026-09-30: this pop-up explains what's missing — it stays open until
  // the player clicks it shut. No backdrop-click dismiss, no Escape dismiss; the
  // ✕ and the three choice buttons below are the only ways out.
  return (
    <div className="fixed inset-0 z-[90] modal-wrap bg-black/75">
      <div className="my-auto w-full max-w-lg rounded-2xl border border-red-400/40 bg-[#0b0e16] p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-red-300">{t("play.risk.title", "☢️ High radiation: {zone}", { zone: zone.name })}</h3>
          <button onClick={onCancel} aria-label={t("play.common.cancel", "Cancel")} className="flex min-h-11 min-w-11 items-center justify-center rounded border border-white/15 px-2.5 py-2 text-sm text-gray-400 hover:bg-white/10">✕</button>
        </div>

        <div className={`mt-4 rounded-lg border p-3 text-center ${fullyCovered ? "border-ember/30 bg-ember/5" : "border-red-400/30 bg-red-400/5"}`}>
          <div className={`text-3xl font-bold ${fullyCovered ? "text-ember-soft" : success >= 50 ? "text-amber-300" : "text-red-300"}`}>
            {t("play.risk.cleanReturn", "Clean return: {pct}%", { pct: success })}
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {t("play.risk.teamLine", "Team of {n} into {zone} ({rad} radiation)", { n: scientists, zone: zone.name, rad: zone.radiationLevel })}
            {fullyCovered ? t("play.risk.fullyGeared", " — fully geared, the run should come back clean.") : t("play.risk.projectedLoss", " — projected loss {pct}%: attrition, reduced loot{cas}.", { pct: loss, cas: scientists > 1 ? t("play.risk.casualties", ", possible scientist casualties") : "" })}
          </p>
        </div>

        <div className="mt-4">
          <p className="text-xs uppercase tracking-wider text-text-3">{t("exp.gearLine")}</p>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {table.map((row) => {
                const ok = row.have >= row.need;
                const cover = row.need > 0 ? Math.min(1, row.have / row.need) : 1;
                return (
                  <tr key={row.label} className="border-b border-white/5 last:border-0">
                    <td className="py-1.5 text-gray-300">
                      <button
                        type="button"
                        onClick={() => openMaterialSheet({ id: row.id, count: Math.floor(row.have) })}
                        className="py-1 text-left underline decoration-dotted decoration-gray-500 underline-offset-2 hover:text-text-1"
                      >
                        {row.icon} {row.label} <span aria-hidden="true" className="text-text-3">ⓘ</span>
                      </button>
                    </td>
                    <td className="py-1.5 text-end">
                      {row.need > 0 ? (
                        <span className={ok ? "text-ember-soft" : "text-red-300"}>
                          {row.have}/{row.need} <span className="text-text-3">{t("play.risk.coverPct", "({pct}% cover)", { pct: Math.round(cover * 100) })}</span>
                        </span>
                      ) : (
                        <span className="text-ember-soft">{t("play.risk.notNeeded", "not needed")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-400">
            {t("play.risk.gearExplainer", "Suits are the exploration key — they let you get in and look. Alloy-armed diggers are the extraction key — without them you find, but largely cannot bring it back. What you lack shapes the loss rate. Losing scientists never wipes your colony below one; corruption rises with the taint left behind.")}
          </p>
        </div>

        <p className="mt-4 text-center text-xs italic text-text-3">{t("play.risk.quote", "\"You are always free to go. This is what you risk.\"")}</p>

        {/* THE BILL (owner 2026-10-16): the run's whole price, itemized,
            BEFORE commitment — the same numbers launchExpedition charges.
            Quoting operations alone hid the rung demand (the bulk on deep
            rungs) until after the supplies were already gone. */}
        <div className="mt-4 rounded-lg border border-white/10 bg-black/40 p-3">
          <p className="text-xs uppercase tracking-wider text-text-3">{t("play.risk.billTitle", "Cost of this run")}</p>
          <ul className="mt-2 space-y-1 text-sm">
            <li className="flex items-baseline justify-between gap-3">
              <span className="text-gray-300">{t("play.risk.billOps", "Operations — gear & crew")}</span>
              <span className="text-gray-200">{bill.operations.toLocaleString()} 📦</span>
            </li>
            <li className="flex items-baseline justify-between gap-3">
              <span className="text-gray-300">{t("play.risk.billDemand", "Rung demand")}</span>
              <span className="text-gray-200">{bill.demand.toLocaleString()} 📦</span>
            </li>
            <li className="text-[11px] leading-snug text-gray-500">
              {t("play.risk.billDemandGloss", "The rung's entry toll — {mult}× this rung's own run time, priced in your income ({days} days of it).", { mult: bill.demandMultiple, days: bill.demandIncomeDays.toFixed(2) })}
            </li>
            {bill.ordnanceSupplies > 0 && (
              <li className="flex items-baseline justify-between gap-3">
                <span className="text-gray-300">{t("play.risk.billOrdnance", "Ordnance")}</span>
                <span className="text-gray-200">{bill.ordnanceSupplies.toLocaleString()} 📦</span>
              </li>
            )}
            {bill.ordnanceEmbers > 0 && (
              <li className="flex items-baseline justify-between gap-3">
                <span className="text-gray-300">{t("play.risk.billOrdEmbers", "Ordnance Embers")}</span>
                <span className="text-gray-200">{bill.ordnanceEmbers.toLocaleString()} 🧯</span>
              </li>
            )}
            <li className="flex items-baseline justify-between gap-3">
              <span className="text-gray-300">{t("play.risk.billEnergy", "Energy charges")}</span>
              <span className="text-gray-200">{bill.energyDraw} ⚡</span>
            </li>
          </ul>
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-white/10 pt-2 text-sm font-semibold">
            <span className="text-gray-200">{t("play.risk.billTotal", "Total")}</span>
            <span className={bill.affordable ? "text-ember-soft" : "text-red-300"}>{bill.totalSupplies.toLocaleString()} 📦</span>
          </div>
          <p className={`mt-1 text-end text-xs ${bill.affordable ? "text-gray-400" : "text-red-300"}`}>
            {bill.affordable
              ? t("play.risk.billHold", "You hold {held} 📦 → {after} after launch", { held: bill.heldSupplies.toLocaleString(), after: bill.afterSupplies.toLocaleString() })
              : t("play.risk.billShort", "You hold {held} 📦 — short {short} 📦", { held: bill.heldSupplies.toLocaleString(), short: (bill.totalSupplies - bill.heldSupplies).toLocaleString() })}
          </p>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button onClick={onGo} className="rounded-lg bg-red-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-400">
            {t("play.risk.goAnyway", "☢️ Go Anyway — accept {pct}% loss", { pct: loss })}
          </button>
          <button onClick={onPrepare} className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-sm font-semibold text-amber-200 hover:bg-amber-400/20">
            {t("play.risk.goPrepare", "🏭 Go Back & Prepare")}
          </button>
          <button onClick={onSafer} className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/10">
            {t("play.risk.safer", "🗺️ Safer Destination")}
          </button>
          <button onClick={onCancel} className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-gray-400 hover:bg-white/10">
            {t("play.common.cancel", "Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
