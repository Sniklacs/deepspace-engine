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
import type { AllianceMember } from "../../game/war/alliances";
import { formatCoordPair, latLonOfCoords, splitCoordSegments } from "../../game/globe-coords";
import { requestGlobeFocus } from "../../game/globe-focus-store";
import { sound } from "../../game/sound";
import { MemberAvatar } from "../alliance/MemberAvatar";
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
  member,
  memberToken,
  onMemberTap,
}: {
  message: ChatMessage;
  /** my own line: "You", at the logical end */
  mine: boolean;
  /** a continuation of the previous line by the same author: no plate, no meta */
  grouped: boolean;
  /**
   * The author's alliance member record, when known (owner 2026-10-11).
   * Avatars render from the member record — never stamped on the message —
   * so they stay in sync when someone changes theirs.
   */
  member?: AllianceMember | null;
  /** token for fetching uploaded avatars */
  memberToken?: string;
  /** tap avatar/name → the member info panel */
  onMemberTap?: (member: AllianceMember) => void;
}) {
  const t = useT();
  const lang = useLang();
  const tappable = !!member && !!onMemberTap;
  return (
    <div className={`flex flex-col gap-1 ${mine ? "ms-auto" : "me-auto"} w-fit max-w-[85%]`}>
      {!grouped ? (
        <div className="flex items-center gap-2 text-[11px] text-text-3">
          {member ? (
            <button
              type="button"
              onClick={() => tappable && onMemberTap!(member)}
              aria-label={tappable ? `View ${message.colonyName}'s profile` : undefined}
              className={tappable ? "rounded-full" : "cursor-default"}
              data-testid={`chat-avatar-${message.id}`}
            >
              <MemberAvatar member={member} token={memberToken} size={24} />
            </button>
          ) : (
            <span
              aria-hidden="true"
              className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-ember/20 text-[11px] font-semibold text-ember-soft"
            >
              {initialOf(message.colonyName)}
            </span>
          )}
          {tappable ? (
            <button
              type="button"
              onClick={() => onMemberTap!(member!)}
              className="max-w-[9rem] truncate font-semibold text-text-2 underline decoration-dotted underline-offset-2"
            >
              <Bdi>{mine ? t("chat.you", "You") : message.colonyName}</Bdi>
            </button>
          ) : (
            <Bdi className="max-w-[9rem] truncate font-semibold text-text-2">
              {mine ? t("chat.you", "You") : message.colonyName}
            </Bdi>
          )}
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
        {/* TAP-TO-FLY (owner 2026-10-16): coordinates in the game's own
            format render as a chip — tap it and the globe flies there.
            The parser is strict (tagged X/Y, in-range), so ordinary
            numbers in chat never linkify. */}
        {splitCoordSegments(message.body).map((seg, i) =>
          seg.coords ? (
            <button
              key={i}
              type="button"
              dir="ltr"
              onClick={() => {
                const ll = latLonOfCoords(seg.coords!);
                sound.click();
                requestGlobeFocus(ll.lat, ll.lon);
              }}
              aria-label={t("chat.flyToCoords", "Fly the globe to {coords}", { coords: formatCoordPair(seg.coords) })}
              className="mx-0.5 inline-flex items-center gap-1 rounded-full border border-sky-400/50 bg-sky-400/15 px-2 py-0.5 align-baseline text-[12px] font-bold text-sky-200 underline decoration-sky-300/60 underline-offset-2 hover:bg-sky-400/25"
              data-testid="chat-coord-chip"
            >
              <span aria-hidden="true">📍</span>
              {seg.text}
            </button>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </p>
      {/* Never auto-translated: on-device inference on exactly the phones this
          beta targets is the player's choice to make, one line at a time. */}
      <TranslatedText message={message} mine={mine} />
    </div>
  );
}

export default MessageRow;
