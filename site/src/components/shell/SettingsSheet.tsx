// SettingsSheet.tsx — the one place a player changes the language after first
// run, plus the two honest device settings (L6/L9).
//
// L6 is why there is no "resolution" control here: the browser owns the pixels,
// so the two things this sheet can honestly offer are interface text size and
// graphics quality, both real (the CSS behind them lives in styles/app.css).
// L9 is why all three are device-shaped: they are read from, and written to, the
// device record only — nothing about them follows an account.
import { useEffect, useState } from "react";
import { Sheet, SheetHeader } from "../Sheet";
import { SegmentedControl } from "../SegmentedControl";
import { LanguageRows } from "../i18n/LanguagePicker";
import AvatarSettings from "./AvatarSettings";
import type { GameState } from "../../game/types";
import InstallAffordance from "./InstallAffordance";
import StorageNote from "./StorageNote";
import TranslatorNote from "./TranslatorNote";
import WindowLookNote from "./WindowLookNote";
import { BUILD_SHA } from "../../game/build-info";
import {
  langMeta,
  setDeviceChatChime,
  setDeviceLang,
  setDeviceTextSize,
} from "../../game/i18n";
import {
  getGraphicsMode,
  setGraphicsMode,
  subscribeGraphicsMode,
  type GraphicsMode,
} from "../../game/graphics-quality";
import { useDeviceSettings, useT } from "../i18n/I18n";

export default function SettingsSheet({
  open,
  onClose,
  player,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * The player's own record, when a colony is loaded (owner 2026-10-14):
   * unlike the device settings below, the AVATAR follows the account — it
   * is written to the player's save on the server. Absent (no colony yet),
   * the section simply doesn't render.
   */
  player?: { state: GameState; token: string; onApplied: (s: GameState) => void } | null;
}) {
  const t = useT();
  const s = useDeviceSettings();
  const meta = langMeta(s.lang);
  // The graphics ladder is its own device record (game/graphics-quality),
  // subscribed here so a change elsewhere in the session re-renders this row.
  const [gfxMode, setGfxMode] = useState<GraphicsMode>(() => getGraphicsMode());
  useEffect(() => subscribeGraphicsMode(() => setGfxMode(getGraphicsMode())), []);

  return (
    <Sheet open={open} onClose={onClose} labelledBy="settings-title" title={t("settings.title")}>
      <SheetHeader
        id="settings-title"
        title={t("settings.title")}
        subtitle={`${meta.endonym} · ${meta.english}`}
        onClose={onClose}
      />
      <div className="sheet-body space-y-4 px-4 py-3 md:px-5">
        {/* 0 · Your face — the player's own avatar (owner 2026-10-14). It is
               the one ACCOUNT-shaped thing on this sheet: it follows the
               colony record, not the device, and says so in its own copy. */}
        {player && (
          <AvatarSettings state={player.state} token={player.token} onApplied={player.onApplied} />
        )}
        {/* 1 · Language — the same list as first run, one tap and it is live */}
        <section aria-labelledby="settings-language">
          <h3 id="settings-language" className="eyebrow">
            {t("settings.language")}
          </h3>
          <p className="mt-1 text-[11px] leading-snug text-text-3">{t("settings.languageSub")}</p>
          <div className="mt-2" data-testid="settings-language-list">
            <LanguageRows
              value={s.lang}
              onPick={(code) => setDeviceLang(code)}
              testidPrefix="settings-lang"
              frameLang={s.lang}
            />
          </div>
        </section>

        {/* 2 · Interface text size — a real scale, not a placebo */}
        <section aria-labelledby="settings-text-size">
          <h3 id="settings-text-size" className="eyebrow">
            {t("settings.textSize")}
          </h3>
          <p className="mt-1 text-[11px] leading-snug text-text-3">{t("settings.textSizeSub")}</p>
          <div className="mt-2" data-testid="settings-text-size">
            <SegmentedControl
              ariaLabel={t("settings.textSize")}
              value={s.textSize}
              onChange={(id) => setDeviceTextSize(id as "normal" | "large" | "larger")}
              options={[
                { id: "normal", label: t("settings.textSizeNormal") },
                { id: "large", label: t("settings.textSizeLarge") },
                { id: "larger", label: t("settings.textSizeLarger") },
              ]}
            />
          </div>
        </section>

        {/* 3 · Graphics — the seamless-world ladder (spec §9): Cinematic is
               full fidelity; Balanced / Performance scale the effects down;
               Auto steps down on its own on sustained low frame rate and can
               be overridden anytime. Replaces the old Full/Reduced switch —
               Performance still gets the honest CSS weight rule (the module
               syncs html[data-quality]) behind the same ladder. */}
        <section aria-labelledby="settings-graphics" className="space-y-1.5">
          <h3 id="settings-graphics" className="eyebrow">
            {t("settings.graphicsLadder", "Graphics")}
          </h3>
          <p className="text-[11px] leading-snug text-text-3">
            {t(
              "settings.graphicsLadderSub",
              "Cinematic is full detail. Auto steps down on its own if the frame rate struggles.",
            )}
          </p>
          <div data-testid="settings-graphics-ladder">
            <SegmentedControl
              ariaLabel={t("settings.graphicsLadder", "Graphics")}
              value={gfxMode}
              onChange={(id) => setGraphicsMode(id as GraphicsMode)}
              options={[
                { id: "cinematic", label: t("settings.gfxCinematic", "Cinematic") },
                { id: "balanced", label: t("settings.gfxBalanced", "Balanced") },
                { id: "performance", label: t("settings.gfxPerformance", "Performance") },
                { id: "auto", label: t("settings.gfxAuto", "Auto") },
              ]}
            />
          </div>
          <p className="text-[11px] leading-snug text-text-3">{t("settings.deviceNote")}</p>
        </section>

        {/* 4 · Chat chime — a sound when a new message lands (owner 2026-10-01) */}
        <section aria-labelledby="settings-chime" className="space-y-1.5">
          <h3 id="settings-chime" className="eyebrow">
            {t("settings.chatChime", "Chat chime")}
          </h3>
          <p className="text-[11px] leading-snug text-text-3">
            {t("settings.chatChimeSub", "Play a sound when a new chat message arrives.")}
          </p>
          <div data-testid="settings-chime">
            <SegmentedControl
              ariaLabel={t("settings.chatChime", "Chat chime")}
              value={s.chatChime ? "on" : "off"}
              onChange={(id) => setDeviceChatChime(id === "on")}
              options={[
                { id: "on", label: t("settings.on", "On") },
                { id: "off", label: t("settings.off", "Off") },
              ]}
            />
          </div>
        </section>

        {/* 5 · On this device — the app shell: install it, and what it may keep.
               Both rows are silent when there is nothing true to say: no install
               path renders nothing, and a browser without the StorageManager API
               renders no storage line. */}
        <section aria-labelledby="settings-device" className="space-y-1.5">
          <h3 id="settings-device" className="eyebrow">
            {t("device.title")}
          </h3>
          <InstallAffordance variant="row" />
          <h4 className="eyebrow pt-1">{t("storage.title")}</h4>
          <StorageNote />
          {/* 6 · The bundled translator — downloaded unprompted, never a pack to
                 choose, never a prompt; its progress is real bytes. */}
          <h4 className="eyebrow pt-1">{t("translator.title")}</h4>
          <p className="text-[11px] leading-snug text-text-3">{t("translator.sub")}</p>
          <TranslatorNote />
          {/* 7 · Window look — Hans 2026-10-02: the EVE-style boxes carry a
                 translucent look he can change: opacity + tint, live. */}
          <h4 className="eyebrow pt-1">{t("windows.title", "Window look")}</h4>
          <WindowLookNote />
          {/* The build stamp: which version of the app is this copy? If the app
              ever stops updating, read this — it names the exact build. */}
          <p className="px-1 pt-2 text-[11px] text-text-3" data-testid="build-stamp">
            Build {BUILD_SHA}
          </p>
        </section>
      </div>
    </Sheet>
  );
}
