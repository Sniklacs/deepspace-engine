// Mailbox — the in-game inbox (owner 2026-10-03).
//
// Hans: "everybody when they log into the game they should be checking their
// mailbox for alerts for announcements for updates on what's happened ... this
// should include everything in the alliance has happened."
//
// A clean inbox list: categories with icons/colors, tap to read, mark-all-read.
// Game events (sub colony upkeep, alliance joins, patch notes) land here
// automatically via sendMail().
import { useMemo, useState } from "react";
import type { GameState } from "../game/types";
import type { GameResult } from "../game/api";
import {
  ensureMailbox,
  type MailCategory,
  type MailMessage,
} from "../game/mailbox";
import { markMailReadFn, markAllMailReadFn, deleteMailFn } from "../game/api";
import { Panel } from "./ui/Panel";
import { ActionButton } from "./ui/ActionButton";
import { Sheet, SheetHeader } from "./Sheet";
import { Icon, type IconName } from "./icons";
import { useT } from "./i18n/I18n";
import { Bdi } from "./ui/Bdi";

type Act = (fn: () => Promise<GameResult>, label: string) => void;

const CATEGORY_META: Record<MailCategory, { icon: IconName; tone: string }> = {
  alert: { icon: "beacon", tone: "text-hazard-soft" },
  announcement: { icon: "scroll", tone: "text-acc" },
  alliance: { icon: "shield", tone: "text-ember" },
  update: { icon: "spark", tone: "text-acc" },
  supply: { icon: "crate", tone: "text-amber-300" },
  battle: { icon: "sword", tone: "text-hazard-soft" },
};

function fmtWhen(sentAt: number, now: number): string {
  const d = now - sentAt;
  if (d < 0) return "now";
  const m = Math.floor(d / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(sentAt).toLocaleDateString();
}

export function MailboxButton({
  state,
  onOpen,
}: {
  state: GameState;
  onOpen: () => void;
}) {
  const t = useT();
  const unread = useMemo(
    () => ensureMailbox(state).filter((m) => !m.read).length,
    [state],
  );
  return (
    <button
      type="button"
      data-testid="mailbox-button"
      onClick={onOpen}
      aria-label={
        unread > 0
          ? t("mailbox.newMail", "{n} unread messages", { n: unread })
          : t("mailbox.title", "Mailbox")
      }
      className="relative flex h-tap w-tap flex-none items-center justify-center rounded-xl border border-line bg-surf-2 text-text-2"
    >
      <Icon name="mail" size={16} aria-hidden="true" />
      {unread > 0 ? (
        <span
          data-testid="mailbox-badge"
          className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-hazard px-1 text-[10px] font-bold text-white"
        >
          <Bdi dir="ltr" className="num">{unread > 99 ? "99+" : unread}</Bdi>
        </span>
      ) : null}
    </button>
  );
}

export default function MailboxSheet({
  state,
  now,
  token,
  onAction,
  onClose,
}: {
  state: GameState;
  now: number;
  token?: string;
  onAction: Act;
  onClose: () => void;
}) {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const messages = useMemo(() => ensureMailbox(state), [state]);
  const unread = messages.filter((m) => !m.read).length;

  const doMarkRead = (m: MailMessage) => {
    if (m.read) {
      setOpenId(m.id);
      return;
    }
    onAction(
      () => markMailReadFn({ data: { token: token!, mailId: m.id } }),
      "mail-read",
    );
    setOpenId(m.id);
  };

  const doMarkAll = () => {
    onAction(() => markAllMailReadFn({ data: { token: token! } }), "mail-read-all");
  };

  const doDelete = (id: string) => {
    onAction(() => deleteMailFn({ data: { token: token!, mailId: id } }), "mail-delete");
    if (openId === id) setOpenId(null);
  };

  const openMsg = openId ? messages.find((m) => m.id === openId) : null;

  return (
    <Sheet
      open
      onClose={onClose}
      labelledBy="mailbox-sheet-title"
      title={t("mailbox.title", "Mailbox")}
    >
      <SheetHeader
        id="mailbox-sheet-title"
        title={t("mailbox.title", "Mailbox")}
        subtitle={
          unread > 0
            ? t("mailbox.unreadCount", "{n} unread", { n: unread })
            : t("mailbox.allCaughtUp", "All caught up")
        }
        onClose={onClose}
      />
      <div className="space-y-2 px-4 pb-6">
        {unread > 0 ? (
          <ActionButton
            size="sm"
            variant="secondary"
            icon="check"
            label={t("mailbox.markAllRead", "Mark all read")}
            onClick={doMarkAll}
            testid="mailbox-mark-all"
          />
        ) : null}
        {messages.length === 0 ? (
          <Panel className="p-4 text-center">
            <p className="text-[13px] text-text-2">
              {t(
                "mailbox.empty",
                "No messages yet. Alerts, alliance news, and game updates will land here.",
              )}
            </p>
          </Panel>
        ) : (
          messages.map((m) => {
            const meta = CATEGORY_META[m.category] ?? CATEGORY_META.alert;
            const isOpen = openId === m.id;
            return (
              <Panel
                key={m.id}
                testid={`mail-${m.id}`}
                className={`p-3 ${m.read ? "" : "border-acc/40"}`}
              >
                <button
                  type="button"
                  onClick={() => (isOpen ? setOpenId(null) : doMarkRead(m))}
                  className="flex w-full items-start gap-2.5 text-left"
                >
                  <span className={`mt-0.5 flex-none ${meta.tone}`}>
                    <Icon name={meta.icon} size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-[13px] ${m.read ? "font-normal text-text-2" : "font-semibold text-text-1"}`}
                      >
                        {m.subject}
                      </span>
                      {!m.read ? (
                        <span className="h-2 w-2 flex-none rounded-full bg-acc" aria-hidden="true" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-text-3">
                      {m.fromName} · {fmtWhen(m.sentAt, now)}
                    </span>
                  </span>
                </button>
                {isOpen && openMsg ? (
                  <div className="mt-2 border-t border-line pt-2">
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-1">
                      {openMsg.body}
                    </p>
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => doDelete(m.id)}
                        className="rounded-lg px-2 py-1 text-[11px] text-text-3 hover:text-hazard-soft"
                      >
                        {t("mailbox.delete", "Delete")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </Panel>
            );
          })
        )}
      </div>
    </Sheet>
  );
}
