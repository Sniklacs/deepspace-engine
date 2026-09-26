// TranslatedText — per-message translation, ALL SIX STATES (chat-mail-spec §3.4).
//
// The one thing this component must never do is pretend. The shipped translator
// has NO runtime wired today, so on a real device the honest outcome is
// `translator.notReady` (once, at the top of the thread) or
// `chat.translateUnavailable` under the line the player tried. There is no
// placeholder standing in for a translation, and there is no spinner.
//
// The states, in the order they can occur:
//   1 · ENGINE NOT ANSWERABLE — no per-message control at all; one line at the
//       top of the thread says so, in the player's own language (`TranslatorNotice`,
//       re-rendered through `subscribeTranslator` when the engine changes).
//   2 · READY, UNTAPPED — the 26px "Translate" button (WCAG 2.2 §2.5.8 clear).
//   3 · IN FLIGHT — the button disables AND a one-line space is RESERVED and
//       filled with "Translating…" in `aria-live="polite"`, so the thread does
//       not jump when the result lands.
//   4 · RESULT — the translated block sits BELOW the original, never instead of
//       it, in my direction, isolated; `chat.translatedFrom` names the source by
//       its ENDONYM (the catalogue's own word for the language, not a made-up
//       name), and "Show original" collapses it.
//   5 · NULL / FAILED — "This line cannot be translated on this device." and the
//       button comes back so the player can retry.
//   6 · NOTHING TO TRANSLATE — a line already in my language, or my own line,
//       draws no control. (Mine: I wrote it; the app never offers to translate
//       the player to themselves.)
//
// The `from` of every request is `message.lang`, which the SERVER stamped when
// the line was written (D9). The client never guesses it, so the button can never
// claim to translate from a language its author did not write in.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useLang, useT } from "../i18n/I18n";
import { Bdi } from "../ui/Bdi";
import { langDir, langMeta } from "../../game/i18n/languages";
import { requestTranslation, subscribeTranslator, translatorAvailable } from "../../game/translate";
import type { ChatMessage } from "../../game/chat/chat-types";

/** Is an engine really answerable right now? (Re-renders when one appears.) */
export function useTranslatorReady(): boolean {
  return useSyncExternalStore(subscribeTranslator, translatorAvailable, () => false);
}

/**
 * State 1, said once per thread: the engine is not answerable, in the player's
 * own language, and no per-message control is drawn above it.
 */
export function TranslatorNotice() {
  const t = useT();
  const ready = useTranslatorReady();
  if (ready) return null;
  return (
    <p data-testid="chat-translator-notice" className="text-[11px] text-text-3">
      {t("translator.notReady", "Translation is preparing")}
    </p>
  );
}

type Phase = "idle" | "busy" | "done" | "failed";

export function TranslatedText({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const t = useT();
  const lang = useLang();
  const ready = useTranslatorReady();
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState<string | null>(null);

  // A different line under the same row would show the wrong translation — the
  // same rule the shipped tutorial control follows.
  useEffect(() => {
    setPhase("idle");
    setText(null);
  }, [message.id]);

  if (mine) return null; // my own line: nothing to translate (§3.4)
  if (message.lang === lang) return null; // already in my language
  if (!ready) return null; // state 1: the notice above the thread carries this

  const run = () => {
    setPhase("busy");
    void requestTranslation(message.body, message.lang, lang)
      .then((result) => {
        if (result === null) {
          // State 5: never a guess, never a placeholder pretending to be one.
          setPhase("failed");
          setText(null);
          return;
        }
        setText(result);
        setPhase("done");
      })
      .catch(() => {
        setPhase("failed");
        setText(null);
      });
  };

  return (
    <div className="flex flex-col items-start gap-1">
      {phase === "done" && text !== null ? (
        <div
          data-testid="chat-translated"
          dir={langDir(lang)}
          className="w-full rounded-xl border border-line bg-surf-3/60 px-3 py-2"
        >
          <p className="text-[13px] text-text-1">
            <Bdi>{text}</Bdi>
          </p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-text-3">
            <Bdi>{t("chat.translatedFrom", "Translated from {language}", { language: langMeta(message.lang).endonym })}</Bdi>
            <button
              type="button"
              data-testid="chat-translate-original"
              onClick={() => {
                setText(null);
                setPhase("idle");
              }}
              className="min-h-tap rounded-md px-1 font-semibold text-text-2 hover:text-text-1"
            >
              {t("translator.original", "Show original")}
            </button>
          </div>
        </div>
      ) : null}
      {phase !== "done" ? (
        <button
          type="button"
          data-testid="chat-translate"
          disabled={phase === "busy"}
          onClick={run}
          className="min-h-tap self-start rounded-md px-1 text-[11px] font-semibold text-text-3 hover:text-text-1 disabled:opacity-60"
        >
          {t("translator.translate", "Translate")}
        </button>
      ) : null}
      {/* State 3: the reserved line. No spinner, and nothing jumps. */}
      {phase === "busy" ? (
        <p aria-live="polite" className="min-h-[18px] text-[11px] text-text-3">
          {t("chat.translating", "Translating…")}
        </p>
      ) : null}
      {phase === "failed" ? (
        <p data-testid="chat-translate-unavailable" className="text-[11px] text-text-3">
          {t("chat.translateUnavailable", "This line cannot be translated on this device.")}
        </p>
      ) : null}
    </div>
  );
}

export default TranslatedText;
