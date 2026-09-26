// Composer — the input line (chat-mail-spec §3.2/§3.5).
//
// Three rules, all of them about not losing the player's words:
//   • a FAILED send keeps the text in the input (never clear on failure);
//   • an over-length body is REFUSED, never truncated — a silently shortened
//     message is a lie about what the player wrote (and `maxLength` keeps the
//     browser from offering it in the first place, as a courtesy, not a rule);
//   • every refusal is rendered from a catalogue key, so "too fast" and "too
//     long" read in the player's own language and direction.
//
// The composer is the sheet's LAST FLEX CHILD (see ChatSheet): no `position:
// fixed`, nothing under the keyboard. The safe-area padding sits on its bottom
// edge so the input clears the home indicator.
import { useState } from "react";
import { Icon } from "../icons";
import { useLang, useT } from "../i18n/I18n";
import { Bdi } from "../ui/Bdi";
import { formatNumber } from "../../game/i18n/format";
import { CHAT_MAX_MESSAGE } from "../../game/chat/chat-types";
import { sendChatMessage } from "../../game/chat/chat-store";

/**
 * The refusal line, keyed. Every arm is a real `t()` call with the catalogue's
 * English literal, so the strings are greppable and no key can go unused — and
 * the count comes from the SAME constant the server enforces, through the
 * Latin-digit formatter.
 */
function refusalText(
  t: ReturnType<typeof useT>,
  lang: string,
  key: string | null,
): string | null {
  switch (key) {
    case "chat.tooLong":
      return t("chat.tooLong", "Keep a message under {n} characters.", { n: formatNumber(lang, CHAT_MAX_MESSAGE) });
    case "chat.tooFast":
      return t("chat.tooFast", "Too fast — wait a moment.");
    case "chat.loggedOut":
      return t("chat.loggedOut", "Sign in to talk with your world.");
    case "chat.sendFailed":
      return t("chat.sendFailed", "That did not send. Try again.");
    default:
      return null;
  }
}

export function Composer() {
  const t = useT();
  const lang = useLang();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);

  const submit = async () => {
    const body = text.trim();
    if (busy || body.length === 0) return;
    if (body.length > CHAT_MAX_MESSAGE) {
      // Refused, not cut. The words stay in the input for the player to edit.
      setErrorKey("chat.tooLong");
      return;
    }
    setBusy(true);
    setNoticeKey(null);
    const outcome = await sendChatMessage(body, lang);
    setBusy(false);
    if (outcome.ok) {
      setText("");
      setErrorKey(null);
      return;
    }
    setNoticeKey(outcome.errorKey ?? "chat.sendFailed");
    if (outcome.errorKey === "chat.tooLong") setErrorKey("chat.tooLong");
  };

  // The live refusal is either the local check or the server's own key.
  const line = refusalText(t, lang, errorKey ?? noticeKey);

  return (
    <form
      data-testid="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-none flex-col gap-1 border-t border-line bg-surf-3 px-3 pt-2 pb-[calc(var(--safe-inset-bottom)+0.5rem)]"
    >
      {line ? (
        <p aria-live="polite" data-testid="chat-error" className="text-[11px] text-danger-soft">
          {line}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          dir="auto"
          lang={lang}
          maxLength={CHAT_MAX_MESSAGE}
          placeholder={t("chat.composerPlaceholder", "Write a message")}
          aria-label={t("chat.composerPlaceholder", "Write a message")}
          data-testid="chat-input"
          onChange={(e) => setText(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surf-2 px-3 text-[13px] text-text-1 placeholder:text-text-3"
        />
        {/* The `send` glyph joins DIR_FLIP, so it points LEFT in Persian. */}
        <button
          type="submit"
          disabled={busy || text.trim().length === 0}
          aria-label={t("chat.send", "Send")}
          data-testid="chat-send"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-ember text-black disabled:opacity-50"
        >
          <Icon name="send" size={18} aria-hidden="true" />
        </button>
        {/* The count is a numeral in a right-to-left line: isolated, Latin digits. */}
        {text.length > 0 ? (
          <Bdi dir="ltr" className="num flex-none text-[11px] text-text-3">
            {formatNumber(lang, text.length)}
          </Bdi>
        ) : null}
      </div>
    </form>
  );
}

export default Composer;
