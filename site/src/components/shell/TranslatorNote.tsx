// TranslatorNote.tsx — THE ONE PLACE THE BUNDLED TRANSLATOR IS VISIBLE.
//
// Two components, one file, because they are the two halves of the same promise:
//
//   • `TranslatorNote`  — the Settings row ("On this device"): what is downloaded,
//     how far along, what it costs in space, and the two honest actions (try
//     again, free the space). Progress comes from real bytes (`weights.ts`), never
//     from a timer, and a partial download is never shown as ready.
//
//   • `TranslateAffordance` — the per-string Translate control (the live prose in
//     the tutorial caption is the first caller). When the engine is not
//     answerable it does NOT vanish into a dead button: it says translation is
//     preparing IN THE PLAYER'S OWN LANGUAGE. That is the owner's requirement —
//     nobody gets a 603 MB surprise, and nobody gets a button that does nothing —
//     and it is why every string here is a catalogue key in all five languages.
//
// DIRECTION: layout only, logical CSS. `ms-auto`, `text-start`, inline size — never
// `left-` / `text-left` / `space-x-`. `i18n-verify` scans this file for exactly
// that, and this file is on its swept list.

import { useEffect, useState } from "react";
import { formatBytes } from "../../game/pwa/storage";
import {
  freeTranslatorSpace,
  prepareTranslator,
  requestTranslation,
  retryTranslator,
  subscribeTranslator,
  translatorStatus,
  weightsState,
  type TranslatorStatus,
} from "../../game/translate";
import { useLang, useT } from "../i18n/I18n";

const ROW = "text-[11px] leading-snug text-text-3";
const BTN =
  "rounded-md border border-line bg-surf-2 px-2 py-1 text-[11px] text-text-1 hover:bg-surf-3 disabled:opacity-50";

function useTranslatorStatus(): TranslatorStatus | null {
  const [status, setStatus] = useState<TranslatorStatus | null>(null);
  useEffect(() => {
    // A device nobody has looked at yet starts its own download here too: the
    // boot effect does this on a real launch, and this covers a Settings sheet
    // opened before that effect has run. It is idempotent either way.
    if (weightsState().phase === "unknown") void prepareTranslator();
    setStatus(translatorStatus());
    return subscribeTranslator(() => {
      setStatus(translatorStatus());
    });
  }, []);
  return status;
}

export default function TranslatorNote() {
  const t = useT();
  const status = useTranslatorStatus();
  if (!status) return null;
  const w = status.weights;
  // Nothing true to say: no Cache Storage on this browser (or a server render).
  if (w.phase === "unknown" || w.phase === "unsupported") return null;

  const size = formatBytes(w.totalBytes);
  const done = formatBytes(w.cachedBytes + w.receivedBytes);

  if (w.phase === "ready") {
    return (
      <div className="space-y-1" data-testid="translator-note" data-translator-phase="ready">
        <p className={ROW}>{t("translator.ready", { size })}</p>
        <button type="button" className={BTN} data-testid="translator-free" onClick={() => void freeTranslatorSpace()}>
          {t("translator.freeSpace")}
        </button>
      </div>
    );
  }

  if (w.phase === "failed") {
    return (
      <div className="space-y-1" data-testid="translator-note" data-translator-phase="failed">
        <p className={ROW}>{t("translator.failed", { done, size })}</p>
        <button type="button" className={BTN} data-testid="translator-retry" onClick={() => void retryTranslator()}>
          {t("translator.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid="translator-note" data-translator-phase={w.phase}>
      <p className={ROW} data-testid="translator-progress">
        {t("translator.preparing", { done, size, percent: String(w.percent) })}
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surf-3" aria-hidden="true">
        <div
          className="h-full rounded-full bg-purity transition-[inline-size] duration-300"
          data-testid="translator-bar"
          style={{ width: `${String(w.percent)}%` }}
        />
      </div>
      {w.cachedBytes > 0 && (
        <button type="button" className={BTN} data-testid="translator-retry" onClick={() => void retryTranslator()}>
          {t("translator.retry")}
        </button>
      )}
    </div>
  );
}

/**
 * The per-string Translate control. `text` is live prose (a tutorial caption
 * today, a chat message later) and `from` is the language it was written in.
 */
export function TranslateAffordance({ text, from }: { text: string; from?: string }) {
  const t = useT();
  const lang = useLang();
  const status = useTranslatorStatus();
  const [live, setLive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A new line clears the last translation: showing line N's translation under
  // line N+1 would be a lie about what was translated.
  useEffect(() => {
    setLive(null);
  }, [text]);

  if (!status || !status.available) {
    return (
      <p className={ROW} data-testid="translate-preparing">
        {t("translator.notReady")}
      </p>
    );
  }

  if (live !== null) {
    return (
      <div className="space-y-1" data-testid="translate-result">
        <p className="text-sm text-text-1" lang={lang} dir="auto">
          {live}
        </p>
        <button type="button" className={BTN} data-testid="translate-original" onClick={() => setLive(null)}>
          {t("translator.original")}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={BTN}
      data-testid="translate-button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void requestTranslation(text, from ?? "en", lang)
          .then((result) => {
            setLive(result);
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      {t("translator.translate")}
    </button>
  );
}
