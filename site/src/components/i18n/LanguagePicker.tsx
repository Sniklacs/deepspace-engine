// LanguagePicker.tsx — the picker a player meets at first run, and the same list
// reused in Settings (L1).
//
// Two rules drive the whole component:
//   • the language NAMES are the languages' own names for themselves ("Español",
//     "Português (Brasil)", "Русский") — a player who cannot read English reads
//     their own name for their own language, not a translation of "Spanish";
//   • the frame AROUND the names (heading, the note about voices) is rendered in
//     the SUGGESTED language when we ship it, else English. That is the one job
//     browser language is allowed to do here: a suggestion, never a lock.
//
// No new colour is introduced: the plate uses the existing surface/line/ember
// tokens only. Every target is ≥44px.
import { useState } from "react";
import { LANGS, SOURCE_LANG, chooseDeviceLang, makeT } from "../../game/i18n";

export function LanguageRows({
  value,
  onPick,
  testidPrefix = "lang-option",
  frameLang,
}: {
  value: string;
  onPick: (code: string) => void;
  testidPrefix?: string;
  /** the language the row chrome (not the names) is written in */
  frameLang?: string;
}) {
  const tf = makeT(frameLang ?? value);
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="list">
      {LANGS.map((l) => {
        const active = l.code === value;
        return (
          <li key={l.code}>
            <button
              type="button"
              data-testid={`${testidPrefix}-${l.code}`}
              data-lang-option={l.code}
              lang={l.code}
              aria-pressed={active}
              onClick={() => onPick(l.code)}
              className={`flex min-h-tap w-full items-center justify-between gap-2 rounded-tile border px-3 py-2 text-start ${
                active
                  ? "border-ember/60 bg-ember/10 text-text-1"
                  : "border-line bg-surf-3/70 text-text-2 hover:bg-surf-4"
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-text-1">{l.endonym}</span>
                <span className="block truncate text-[11px] text-text-3">{l.english}</span>
              </span>
              {active ? (
                <span
                  className="chip flex-none border border-ember/50 text-ember-soft"
                  aria-hidden="true"
                  title={tf("settings.change")}
                >
                  ✓
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function LanguagePicker({
  firstRun = false,
  suggested = null,
  onDone,
}: {
  firstRun?: boolean;
  suggested?: string | null;
  onDone?: () => void;
}) {
  const frame = suggested ?? SOURCE_LANG;
  const tf = makeT(frame);
  const [pick, setPick] = useState<string>(suggested ?? SOURCE_LANG);

  const commit = (code: string) => {
    chooseDeviceLang(code);
    onDone?.();
  };

  if (!firstRun) {
    // the Settings row's list: a click is the choice, no second step
    return <LanguageRows value={pick} onPick={commit} testidPrefix="settings-lang" frameLang={frame} />;
  }

  return (
    <div
      className="i18n-gate fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-surf-0/97 p-4"
      data-testid="language-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lang-gate-title"
      data-frame-lang={frame}
    >
      <div className="w-full max-w-md rounded-tile border border-line bg-surf-2 p-4 shadow-xl">
        <p className="eyebrow" lang={frame}>
          {tf("app.name")}
        </p>
        <h1 id="lang-gate-title" className="mt-1 text-lg font-bold text-text-1" lang={frame}>
          {tf("lang.choose")}
        </h1>
        <p className="mt-1 text-[12px] leading-snug text-text-2" lang={frame}>
          {tf("lang.intro")}
        </p>
        <div className="mt-3">
          <LanguageRows value={pick} onPick={setPick} frameLang={frame} />
        </div>
        <p className="mt-3 text-[11px] leading-snug text-text-3" lang={frame}>
          {tf("lang.voiceNote")}
        </p>
        <button
          type="button"
          data-testid="lang-continue"
          onClick={() => commit(pick)}
          className="mt-3 flex min-h-tap w-full items-center justify-center rounded-tile bg-ember px-4 text-[14px] font-semibold text-black hover:brightness-110"
        >
          {tf("lang.continue")}
        </button>
      </div>
    </div>
  );
}

export default LanguagePicker;
