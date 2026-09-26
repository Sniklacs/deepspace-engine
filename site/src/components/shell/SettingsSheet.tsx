// SettingsSheet.tsx — the one place a player changes the language after first
// run, plus the two honest device settings (L6/L9).
//
// L6 is why there is no "resolution" control here: the browser owns the pixels,
// so the two things this sheet can honestly offer are interface text size and
// graphics quality, both real (the CSS behind them lives in styles/app.css).
// L9 is why all three are device-shaped: they are read from, and written to, the
// device record only — nothing about them follows an account.
import { Sheet, SheetHeader } from "../Sheet";
import { SegmentedControl } from "../SegmentedControl";
import { LanguageRows } from "../i18n/LanguagePicker";
import InstallAffordance from "./InstallAffordance";
import StorageNote from "./StorageNote";
import TranslatorNote from "./TranslatorNote";
import {
  langMeta,
  setDeviceLang,
  setDeviceQuality,
  setDeviceTextSize,
} from "../../game/i18n";
import { useDeviceSettings, useT } from "../i18n/I18n";

export default function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const s = useDeviceSettings();
  const meta = langMeta(s.lang);

  return (
    <Sheet open={open} onClose={onClose} labelledBy="settings-title" title={t("settings.title")}>
      <SheetHeader
        id="settings-title"
        title={t("settings.title")}
        subtitle={`${meta.endonym} · ${meta.english}`}
        onClose={onClose}
      />
      <div className="sheet-body space-y-4 px-4 py-3 md:px-5">
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

        {/* 3 · Graphics quality — fewer effects, honest wording, real weight */}
        <section aria-labelledby="settings-quality" className="space-y-1.5">
          <h3 id="settings-quality" className="eyebrow">
            {t("settings.quality")}
          </h3>
          <p className="text-[11px] leading-snug text-text-3">{t("settings.qualitySub")}</p>
          <div data-testid="settings-quality">
            <SegmentedControl
              ariaLabel={t("settings.quality")}
              value={s.quality}
              onChange={(id) => setDeviceQuality(id as "full" | "reduced")}
              options={[
                { id: "full", label: t("settings.qualityFull") },
                { id: "reduced", label: t("settings.qualityReduced") },
              ]}
            />
          </div>
          <p className="text-[11px] leading-snug text-text-3">{t("settings.deviceNote")}</p>
        </section>

        {/* 4 · On this device — the app shell: install it, and what it may keep.
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
          {/* 5 · The bundled translator — downloaded unprompted, never a pack to
                 choose, never a prompt; its progress is real bytes. */}
          <h4 className="eyebrow pt-1">{t("translator.title")}</h4>
          <p className="text-[11px] leading-snug text-text-3">{t("translator.sub")}</p>
          <TranslatorNote />
        </section>
      </div>
    </Sheet>
  );
}
