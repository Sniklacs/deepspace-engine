import { LANGS, chooseDeviceLang } from "~/game/i18n";
import { useLang, useT } from "~/components/i18n/I18n";

/**
 * The compact header language picker Hans asked for — right on the landing
 * page, above the fold. A native <select> of endonyms; choosing one persists
 * it on the device (chooseDeviceLang) and the whole page re-renders.
 */
export function LandingLangPicker() {
  const lang = useLang();
  const t = useT();
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-zinc-200 hover:bg-white/10">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
      </svg>
      <span className="sr-only">{t("settings.language", "Language")}</span>
      {/* Full endonyms on comfortable screens… */}
      <select
        value={lang}
        onChange={(e) => chooseDeviceLang(e.target.value)}
        className="hidden cursor-pointer bg-transparent text-sm font-medium outline-none sm:block [&>option]:bg-zinc-900"
        aria-label={t("settings.language", "Language")}
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.endonym}
          </option>
        ))}
      </select>
      {/* …short codes on phones, where "Português (Brasil)" would blow the header out. */}
      <select
        value={lang}
        onChange={(e) => chooseDeviceLang(e.target.value)}
        className="block cursor-pointer bg-transparent text-xs font-bold tracking-wider outline-none sm:hidden [&>option]:bg-zinc-900"
        aria-label={t("settings.language", "Language")}
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.code === "pt-BR" ? "PT" : l.code.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
}
