// CradleSheet — the home of every control the old web header held (§1.4/§1.5).
//
// Opened by the ribbon's identity tile. It introduces NO new player-facing
// noun: its title is the colony's own name. It is also the TOUCH PATH for the
// resource tooltips (§5.5.9) — every store's hover prose is readable here as a
// plain line of text, so no resource figure is explained only on hover.
//
// Nothing is deleted and nothing is duplicated: sound, full screen, help,
// feedback, the colonies flow and log out all live here now, and the account
// flow stays the ONE flow it already was (it is the GamesPanel's Account
// section — this sheet closes first so two dialogs never stack).
import { Sheet, SheetHeader } from "../Sheet";
import { Icon } from "../icons";
import { RowButton } from "../ui/RowButton";
import { ActionButton } from "../ui/ActionButton";
import { engineHelpers } from "../../game/client-utils";
import { getRace } from "../../game/races";
import { WORLD_CONFIG_PUBLIC } from "../../game/world-config";
import { RESOURCE_TIPS, ARMORY_TIPS } from "../../game/tooltips";
import type { GameState } from "../../game/types";
import type { IconName } from "../icons";
import { useT } from "../i18n/I18n";

function StoreRow({
  icon,
  label,
  value,
  sub,
}: {
  icon: IconName;
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <li className="flex min-h-tap items-center gap-3 rounded-xl border border-line bg-surf-3/60 px-3 py-2">
      <Icon name={icon} size={16} className="shrink-0 text-ember-soft" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-text-1">{label}</span>
        <span className="block text-[11px] leading-tight text-text-3">{sub}</span>
      </span>
      <b className="num shrink-0 text-sm text-text-1">{value.toLocaleString()}</b>
    </li>
  );
}

function CountRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <li className="flex min-h-tap items-center gap-3 rounded-xl border border-line bg-surf-3/40 px-3 py-2">
      <Icon name={icon} size={16} className="shrink-0 text-text-2" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-[13px] text-text-1">{label}</span>
      <b className="num shrink-0 text-[13px] text-text-1">{value}</b>
    </li>
  );
}

export default function CradleSheet({
  state,
  open,
  onClose,
  muted,
  isFullscreen,
  onToggleMute,
  onToggleFullscreen,
  onSettings,
  onHelp,
  onFeedback,
  onGames,
  onLogout,
}: {
  state: GameState;
  open: boolean;
  onClose: () => void;
  muted: boolean;
  isFullscreen: boolean;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onFeedback: () => void;
  onGames: () => void;
  onLogout: () => void;
}) {
  const t = useT();
  const race = getRace(state.race!);
  const r = state.resources;
  const spm = engineHelpers.suppliesPerMinute(state);
  const scientists = engineHelpers.studying(state).length;
  const scientistCap = engineHelpers.scientistCap(state);
  const teamsAway = state.expeditions.filter((e) => e.status === "out").length;
  const fieldSlots = 1 + state.deployedDomains.logistics;
  const devotion = typeof state.devotion === "number" ? state.devotion : 0;
  const streak = typeof state.devotionStreak === "number" ? state.devotionStreak : 0;

  return (
    <Sheet open={open} onClose={onClose} labelledBy="cradle-sheet-title" title={state.playerName}>
      <SheetHeader
        id="cradle-sheet-title"
        title={state.playerName}
        subtitle={`${race.name} · ${race.homeRegion} · ${WORLD_CONFIG_PUBLIC.worldName}`}
        onClose={onClose}
      />
      <div className="sheet-body space-y-4 px-4 py-3 md:px-5">
        {/* 1 · Stores — every figure, with the prose that used to be hover-only */}
        <section aria-labelledby="cradle-stores">
          <h3 id="cradle-stores" className="eyebrow">
            {t("cradleSheet.stores", "Stores")}
          </h3>
          <ul className="mt-2 space-y-1.5">
            <StoreRow icon="flame" label={t("resource.embers", "Embers")} value={Math.floor(r.embers)} sub={RESOURCE_TIPS.embers.what} />
            <StoreRow icon="chip" label={t("resource.chipsets", "Chipsets")} value={r.chipsets} sub={RESOURCE_TIPS.chipsets.what} />
            <StoreRow
              icon="crate"
              label={t("resource.supplies", "Supplies")}
              value={Math.floor(r.supplies)}
              sub={t("resource.suppliesSub", "+{rate} per minute while the Cradle stands", { rate: spm.toFixed(1) })}
            />
            <StoreRow icon="scroll" label={t("resource.codices", "Codices")} value={state.codices} sub={RESOURCE_TIPS.codices.what} />
            <StoreRow icon="spark" label={t("resource.plasma", "Plasma")} value={Math.floor(r.plasma ?? 0)} sub={ARMORY_TIPS.plasma.what} />
            <StoreRow
              icon="coin"
              label={t("resource.scrip", "Scrip")}
              value={Math.floor(state.currency.scrip)}
              sub={t("resource.scripSub", "Earned by what you do — Devotion, deeds, contribution.")}
            />
            <StoreRow
              icon="star"
              label={t("resource.votives", "Votives")}
              value={Math.floor(state.currency.votives)}
              sub={t("resource.votivesSub", "Held in the Cradle Ledger.")}
            />
          </ul>
        </section>

        {/* 2 · Roster — counts only; the rosters themselves are on the home screen */}
        <section aria-labelledby="cradle-roster">
          <h3 id="cradle-roster" className="eyebrow">
            {t("cradleSheet.roster", "Roster")}
          </h3>
          <ul className="mt-2 space-y-1.5">
            <CountRow icon="flask" label={t("cradleSheet.scientists", "Scientists in study")} value={`${scientists}/${scientistCap}`} />
            <CountRow icon="march" label={t("cradleSheet.teams", "Teams in the field")} value={`${teamsAway}/${fieldSlots}`} />
            <CountRow icon="person" label={t("cradleSheet.leaders", "Leaders sworn to the Cradle")} value={`${state.leaders.length}`} />
            <CountRow
              icon="star"
              label={streak > 0 ? `${t("cradleSheet.devotion", "Devotion")} · ${t("cradle.devotionStreak", "{n}-day streak", { n: streak })}` : t("cradleSheet.devotion", "Devotion")}
              value={`${devotion}`}
            />
          </ul>
        </section>

        {/* 3 · Commands — the old header's controls, at 44/48px */}
        <section aria-labelledby="cradle-commands" className="space-y-1.5">
          <h3 id="cradle-commands" className="eyebrow">
            {t("cradleSheet.commands", "Commands")}
          </h3>
          <RowButton
            icon="gamepad"
            title={t("cradleSheet.colonies", "Your colonies")}
            sub={t("cradleSheet.coloniesSub", "Found, switch, reset or delete a colony")}
            onClick={onGames}
          />
          <RowButton
            icon="help"
            title={t("cradleSheet.help", "How to Play")}
            sub={t("cradleSheet.helpSub", "A short primer on the core loop")}
            onClick={onHelp}
          />
          <RowButton
            icon="chat"
            title={t("cradleSheet.feedback", "Feedback")}
            sub={t("cradleSheet.feedbackSub", "Send a bug, a flow issue or a suggestion to the team")}
            onClick={onFeedback}
          />
          <RowButton
            icon="beacon"
            title={t("cradleSheet.sound", "Sound")}
            sub={
              muted
                ? t("cradleSheet.soundOff", "The Cradle is silent — tap to unmute")
                : t("cradleSheet.soundOn", "The Cradle hums — tap to mute")
            }
            chip={
              <span className="chip border border-line text-text-2">
                {muted ? t("cradleSheet.off", "off") : t("cradleSheet.on", "on")}
              </span>
            }
            onClick={onToggleMute}
          />
          <RowButton
            icon="map"
            title={t("cradleSheet.fullscreen", "Full screen")}
            sub={t("cradleSheet.fullscreenSub", "Fills your screen. Press Esc to leave.")}
            chip={
              <span className="chip border border-line text-text-2">
                {isFullscreen ? t("cradleSheet.on", "on") : t("cradleSheet.off", "off")}
              </span>
            }
            onClick={onToggleFullscreen}
          />
          <RowButton
            icon="gear"
            title={t("settings.open", "Settings")}
            sub={t("settings.openSub", "Language, text size and graphics quality")}
            onClick={onSettings}
          />
        </section>

        {/* 4 · Account — the existing destructive flow, in ONE place */}
        <section aria-labelledby="cradle-account" className="space-y-1.5 pb-2">
          <h3 id="cradle-account" className="eyebrow">
            {t("cradleSheet.account", "Account")}
          </h3>
          <RowButton
            icon="ledger"
            title={t("cradleSheet.records", "Account and colony records")}
            sub={t("cradleSheet.recordsSub", "Reset or delete a colony, or remove the whole account")}
            onClick={onGames}
          />
          <ActionButton
            label={t("cradleSheet.logout", "Log Out")}
            sub={t("cradleSheet.logoutSub", "Your colonies stay on this account and reload next login")}
            icon="logout"
            variant="destructive"
            size="sm"
            full
            onClick={onLogout}
          />
        </section>
      </div>
    </Sheet>
  );
}
