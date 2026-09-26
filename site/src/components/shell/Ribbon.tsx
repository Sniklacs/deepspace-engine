// Ribbon — the sticky 56px HUD (game-ui-shell-spec §1.2).
//
// One row of game chrome where the old web header used to be:
//   identity tile (opens the Cradle sheet) → the resource pills (the ONLY
//   horizontal scroll region) → the pinned cluster (Chorus alert at ≥50, the
//   Ledger storefront seam, the reports bell).
//
// Every figure comes from server state through `.num`; every control is ≥44px;
// the alert is never colour-only (it says the word "Chorus" and the number).
// This file introduces no colour of its own except `race.accent` (identity,
// passed in from races.ts — the single allowed source, §9.1 rule 4).
import { getRace } from "../../game/races";
import { WORLD_CONFIG_PUBLIC } from "../../game/world-config";
import { tip, RESOURCE_TIPS, ARMORY_TIPS } from "../../game/tooltips";
import { Icon } from "../icons";
import { LedgerButton } from "../LedgerButton";
import { ResourcePill } from "../ui/ResourcePill";
import { Tooltip } from "../Tooltip";
import type { GameState } from "../../game/types";
import { useT } from "../i18n/I18n";

export default function Ribbon({
  state,
  unread,
  busy = false,
  onIdentity,
  onLedger,
  onReports,
  onOpenStores,
  onAlertGo,
}: {
  state: GameState;
  unread: number;
  busy?: boolean;
  /** opens the Cradle sheet (§1.5) — the home of every old header control */
  onIdentity: () => void;
  onLedger: () => void;
  onReports: () => void;
  /** the pills' touch path: the Cradle sheet's Stores section (§1.5/§5.5.9) */
  onOpenStores: () => void;
  /** the alert chip's door — the home screen, where the status strip lives */
  onAlertGo: () => void;
}) {
  const t = useT();
  const race = getRace(state.race!);
  const r = state.resources;
  const alert = state.chorusAttention >= 50 || state.corruption >= 50;
  return (
    <header
      role="banner"
      data-testid="app-ribbon"
      data-busy={busy || undefined}
      data-chorus={alert ? "alert" : undefined}
      className="ribbon sticky top-0 z-40 h-ribbon border-b border-line-strong bg-surf-1/95 backdrop-blur-sm"
    >
      <div className="mx-auto flex h-full w-full max-w-6xl items-center gap-1.5 px-2 sm:gap-2 sm:px-3">
        {/* 1 · identity tile — 44×44, opens the Cradle sheet */}
        <button
          type="button"
          data-testid="ribbon-identity"
          aria-haspopup="dialog"
          aria-label={t("ribbon.identity", {
            name: state.playerName,
            race: race.name,
            world: WORLD_CONFIG_PUBLIC.worldName,
          })}
          onClick={onIdentity}
          className="relative flex h-tap w-tap flex-none items-center justify-center rounded-xl border border-line bg-surf-2 text-[13px] font-bold text-text-1"
        >
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-xl"
            style={{ background: race.accent + "1a" }}
          />
          <span className="relative">{state.playerName.slice(0, 1).toUpperCase()}</span>
          {alert ? (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-surf-1 bg-hazard"
            />
          ) : null}
        </button>

        {/* 2 · resources — the ONLY horizontal scroll region in the chrome */}
        <div
          className="resource-row flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:overflow-visible"
          data-testid="ribbon-stores"
        >
          <Tooltip className="flex-none" content={tip(RESOURCE_TIPS.embers)}>
            <ResourcePill icon="flame" value={Math.floor(r.embers)} tone="ember" label={t("ribbon.embers")} onClick={onOpenStores} />
          </Tooltip>
          <Tooltip className="flex-none" content={tip(RESOURCE_TIPS.chipsets)}>
            <ResourcePill icon="chip" value={r.chipsets} tone="plain" label={t("ribbon.chipsets")} onClick={onOpenStores} />
          </Tooltip>
          <Tooltip className="flex-none" content={tip(RESOURCE_TIPS.supplies)}>
            <ResourcePill icon="crate" value={Math.floor(r.supplies)} tone="ember" label={t("ribbon.supplies")} onClick={onOpenStores} />
          </Tooltip>
          <Tooltip className="flex-none" content={tip(RESOURCE_TIPS.codices)}>
            <ResourcePill icon="scroll" value={state.codices} tone="plain" label={t("ribbon.codices")} onClick={onOpenStores} />
          </Tooltip>
          <Tooltip className="flex-none" content={tip(ARMORY_TIPS.plasma)}>
            <ResourcePill icon="spark" value={Math.floor(r.plasma ?? 0)} tone="ember" label={t("ribbon.plasma")} onClick={onOpenStores} />
          </Tooltip>
        </div>

        {/* 3 · the pinned cluster: alert chip, store seam, reports */}
        <div className="ml-auto flex flex-none items-center gap-1.5" aria-busy={busy || undefined}>
          {alert ? (
            <button
              type="button"
              data-testid="ribbon-alert"
              aria-label={t("ribbon.chorusAlert", { pct: Math.round(state.chorusAttention) })}
              onClick={onAlertGo}
              className="flex h-tap flex-none items-center gap-1 rounded-xl border border-hazard/50 bg-hazard/10 px-2 text-[11px] font-semibold text-hazard-soft"
            >
              <Icon name="beacon" size={12} aria-hidden="true" />
              <span>
                {t("ribbon.chorus")} <b className="num">{Math.round(state.chorusAttention)}%</b>
              </span>
            </button>
          ) : null}
          <LedgerButton
            scrip={state.currency.scrip}
            votives={state.currency.votives}
            variant="ribbon"
            onClick={onLedger}
          />
          <button
            type="button"
            data-testid="ribbon-reports"
            aria-haspopup="dialog"
            onClick={onReports}
            aria-label={
              unread > 0 ? t("ribbon.reportsNew", { n: unread }) : t("ribbon.reportsNone")
            }
            className="relative flex h-tap w-tap flex-none items-center justify-center rounded-xl border border-line bg-surf-2 text-text-2"
          >
            <Icon name="bell" size={16} aria-hidden="true" />
            {unread > 0 ? (
              <span className="num absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-ember px-1 text-[11px] font-bold leading-none text-black">
                {unread}
              </span>
            ) : null}
          </button>
        </div>
      </div>
    </header>
  );
}
