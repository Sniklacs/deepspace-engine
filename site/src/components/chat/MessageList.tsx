// MessageList — the thread's scroll region (chat-mail-spec §3.3/§3.5).
//
// ONE rule in here is worth the whole file: NEVER YANK A READER. A new line
// auto-scrolls only when the player is already within 48px of the bottom;
// scrolled back, they get a chip and their place is kept. The chat poll lands
// every ~5s, so getting this wrong would move the text under a thumb mid-read.
//
// The other rules are the honest states (§3.5): no skeleton rows, an error strip
// that never clears the list (stale-while-error), day separators, and the
// 120-second grouping that keeps one author's burst on one plate.
import { useLayoutEffect, useRef, useState } from "react";
import { EmptyRow } from "../ui/RowButton";
import { useLang, useT } from "../i18n/I18n";
import { Bdi } from "../ui/Bdi";
import { daysAgo, formatDate, formatNumber } from "../../game/i18n/format";
import type { ChatMessage } from "../../game/chat/chat-types";
import { MessageRow } from "./MessageRow";
import { TranslatorNotice } from "./TranslatedText";

/** How close to the bottom still counts as "reading the end" (§3.3). */
export const AUTOSCROLL_PX = 48;
/** One author's burst inside this window shares a plate and a meta line (§3.3). */
export const GROUP_MS = 120_000;

/** Is this message the head of a new group (a new author, or a long pause)? */
export function startsGroup(prev: ChatMessage, next: ChatMessage): boolean {
  if (prev.accountId !== next.accountId) return true;
  return next.createdAt - prev.createdAt > GROUP_MS;
}

/**
 * The separator a message sits under. `Today`/`Yesterday` are the two words the
 * catalogue owns; anything older is a real localised date, digits pinned to the
 * Latin numbering system by the formatter.
 */
export function dayLabel(
  lang: string,
  now: number,
  at: number,
  today: string,
  yesterday: string,
): string {
  const days = daysAgo(now, at);
  if (days === 0) return today;
  if (days === 1) return yesterday;
  return formatDate(lang, at);
}

export function MessageList({
  messages,
  me,
  phase,
  errorText,
  retryText,
  openingText,
  onRetry,
  emptyText,
}: {
  messages: ChatMessage[];
  me: string | null;
  phase: "idle" | "loading" | "ready" | "error";
  /** the keyed failure line, or null when there is nothing to say */
  errorText: string | null;
  retryText: string;
  openingText: string;
  onRetry: () => void;
  /** the honest empty state for THIS surface, resolved in the player's language */
  emptyText: string;
}) {
  const t = useT();
  const lang = useLang();
  const scroller = useRef<HTMLDivElement | null>(null);
  // "reading the end" is a ref, not state: it has to be true on the very commit
  // that appends a line, with no render in between.
  const atBottom = useRef(true);
  const prevCount = useRef(messages.length);
  const [unseen, setUnseen] = useState(0);

  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = gap <= AUTOSCROLL_PX;
    if (atBottom.current) setUnseen(0);
  };

  // Append at the bottom, and follow only a reader who is already there.
  useLayoutEffect(() => {
    const el = scroller.current;
    const grew = messages.length > prevCount.current;
    if (el && grew) {
      if (atBottom.current) {
        el.scrollTop = el.scrollHeight;
        setUnseen(0);
      } else {
        setUnseen((n) => n + (messages.length - prevCount.current));
      }
    } else if (el && prevCount.current === 0 && messages.length > 0) {
      // The first load lands at the end of the thread. Nobody opens a channel to
      // read its oldest surviving line six screens up.
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
    }
    prevCount.current = messages.length;
  }, [messages]);

  const loading = phase === "loading" && messages.length === 0;
  const empty = !loading && messages.length === 0 && !errorText;

  return (
    <div
      ref={scroller}
      onScroll={measure}
      data-testid="chat-message-list"
      aria-busy={phase === "loading"}
      className="sheet-body flex flex-col gap-2 px-4 py-3"
    >
      {/* STALE-WHILE-ERROR: the strip says what happened, and the list below it
          keeps every line already on screen. A failure never empties a thread. */}
      {errorText ? (
        <div className="flex flex-none items-center gap-2 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2">
          <span className="min-w-0 flex-1 text-[11px] text-danger-soft">{errorText}</span>
          <button
            type="button"
            onClick={onRetry}
            className="min-h-tap flex-none rounded-lg border border-line px-3 text-[11px] font-semibold text-text-1"
          >
            {retryText}
          </button>
        </div>
      ) : null}
      {/* State 1 of TranslatedText: the engine is not answerable at all, so the
          thread says so once — in the player's own language — and no per-message
          button is drawn. Never a fake control. */}
      <TranslatorNotice />
      {loading ? (
        <p aria-live="polite" className="py-6 text-center text-[12px] text-text-3">
          {openingText}
        </p>
      ) : null}
      {empty ? <EmptyRow icon="globe" text={emptyText} /> : null}
      {messages.map((m, i) => {
        const prev = i > 0 ? messages[i - 1] : null;
        const newDay = !prev || daysAgo(m.createdAt, prev.createdAt) > 0;
        return (
          <div key={m.id} className="flex flex-col gap-2">
            {newDay ? (
              <p className="border-b border-line pb-1 text-[11px] font-semibold text-text-3" data-testid="chat-day">
                <Bdi>{dayLabel(lang, Date.now(), m.createdAt, t("chat.today", "Today"), t("chat.yesterday", "Yesterday"))}</Bdi>
              </p>
            ) : null}
            <MessageRow
              message={m}
              mine={!!me && m.accountId === me}
              grouped={!!prev && !newDay && !startsGroup(prev, m)}
            />
          </div>
        );
      })}
      {/* The chip a scrolled-back reader gets instead of being yanked (§3.3). */}
      {unseen > 0 ? (
        <button
          type="button"
          data-testid="chat-jump"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
            atBottom.current = true;
            setUnseen(0);
          }}
          className="sticky bottom-0 mx-auto min-h-tap flex-none rounded-full bg-ember px-3 text-[11px] font-semibold text-black"
        >
          {t("chat.newMessages", "{n} new", { n: formatNumber(lang, unseen) })}
        </button>
      ) : null}
    </div>
  );
}

export default MessageList;
