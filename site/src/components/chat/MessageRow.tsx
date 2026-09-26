// MessageRow — one line of the thread (chat-mail-spec §3.3).
//
// The bidi rules that matter are here, and they are the difference between a
// Persian thread and a reordered mess:
//   • the BODY carries `dir="auto"` and `lang={msg.lang}`. `dir="auto"` gives the
//     run implicit isolation, so a Persian or Russian line can never reorder the
//     plate, the clock or the actions around it;
//   • the author's name and the time are separate `<bdi>` runs — never
//     concatenated into a sentence (the shipped bug this exists to prevent:
//     an income rate that reads "1.8+" instead of "+1.8");
//   • the time is a numeral: `<bdi dir="ltr" className="num">`, so it is not
//     mirrored and its digits are the Latin ones the formatter pinned;
//   • own/received use LOGICAL sides (`ms-auto` / `me-auto`) only, so the frame
//     mirrors with no RTL-specific rule anywhere.
//
// The Translate control is the `<TranslatedText>` block below the bubble rather
// than a button inside the meta line: a grouped message (the second line of one
// author's 120-second burst) has no meta line of its own, and a message must
// never become untranslatable because it was not the first of a burst.
import { useLang, useT } from "../i18n/I18n";
import { Bdi } from "../ui/Bdi";
import { formatTime } from "../../game/i18n/format";
import type { ChatMessage } from "../../game/chat/chat-types";
import { TranslatedText } from "./TranslatedText";

/** The initial on the author plate — the ribbon's identity idiom, at 24px. */
function initialOf(name: string): string {
  const ch = Array.from(name.trim())[0] ?? "?";
  return ch.toUpperCase();
}

export function MessageRow({
  message,
  mine,
  grouped,
}: {
  message: ChatMessage;
  /** my own line: "You", at the logical end */
  mine: boolean;
  /** a continuation of the previous line by the same author: no plate, no meta */
  grouped: boolean;
}) {
  const t = useT();
  const lang = useLang();
  return (
    <div className={`flex flex-col gap-1 ${mine ? "ms-auto" : "me-auto"} w-fit max-w-[85%]`}>
      {!grouped ? (
        <div className="flex items-center gap-2 text-[11px] text-text-3">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-ember/20 text-[11px] font-semibold text-ember-soft"
          >
            {initialOf(message.colonyName)}
          </span>
          <Bdi className="max-w-[9rem] truncate font-semibold text-text-2">
            {mine ? t("chat.you", "You") : message.colonyName}
          </Bdi>
          <Bdi dir="ltr" className="num">
            {formatTime(lang, message.createdAt)}
          </Bdi>
        </div>
      ) : null}
      <p
        dir="auto"
        lang={message.lang}
        className={`rounded-2xl px-3 py-2 text-[13px] text-text-1 ${mine ? "bg-surf-4" : "bg-surf-2"}`}
      >
        {message.body}
      </p>
      {/* Never auto-translated: on-device inference on exactly the phones this
          beta targets is the player's choice to make, one line at a time. */}
      <TranslatedText message={message} mine={mine} />
    </div>
  );
}

export default MessageRow;
