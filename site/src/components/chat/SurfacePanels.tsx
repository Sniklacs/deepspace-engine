// SurfacePanels — slice A2: every chat surface, live, in one body component.
//
// ChatSheet and ChatWindowBody both render `ChatSurfaceBody` under the tabs:
// the world floor (A1) plus the Covenant channel, the Rooms directory and its
// channels, Personal threads, and Mail — each backed by the real server
// functions in chat-api.ts, with visibility enforced server-side
// (chat-server.ts `canSeeChannel`). Nothing here fakes a channel: a surface a
// player cannot see refuses on the server and renders its honest state here.
//
// Layout contract (unchanged from A1): the component returns the tabpanel
// region AND the composer as siblings of the host's flex column — the
// composer is the column's LAST flex child, never position:fixed, so the
// keyboard rule (§3.2) still holds. A channel view is therefore two pieces
// (scroll region here, composer below) assembled by this component.
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { EmptyRow } from "../ui/RowButton";
import { useLang, useT } from "../i18n/I18n";
import { Bdi } from "../ui/Bdi";
import { formatDate, formatNumber, formatTime } from "../../game/i18n/format";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { MemberProfile } from "../alliance/MemberProfile";
import {
  chatServerSnapshot,
  chatSnapshot,
  closeActiveThread,
  closeChannelView,
  createChatRoom,
  joinChatRoom,
  leaveChatRoom,
  openChannel,
  readChatLetter,
  refreshChat,
  refreshChannel,
  sendChannelChatMessage,
  sendChatLetter,
  startThread,
  subscribeChat,
  type ChatState,
} from "../../game/chat/chat-store";
import {
  chatMemberServerSnapshot,
  chatMemberSnapshot,
  resolveChatMember,
  subscribeChatMembers,
} from "../../game/chat/chat-members";
import {
  channelKind,
  personalChannel,
  roomChannel,
  type MailLetter,
} from "../../game/chat/chat-types";
import type { AllianceMember } from "../../game/war/alliances";
import type { GameResult } from "../../game/api";

/** The refusal lines the A2 forms render, keyed — same discipline as Composer. */
function a2Refusal(t: ReturnType<typeof useT>, lang: string, key: string | null): string | null {
  switch (key) {
    case "chat.noSuchColony":
      return t("chat.noSuchColony", "No colony by that exact name.");
    case "chat.selfThread":
      return t("chat.selfThread", "That is your own colony.");
    case "chat.roomName":
      return t("chat.roomName", "Give the room a name (up to 40 characters).");
    case "chat.noSuchRoom":
      return t("chat.noSuchRoom", "That room is gone.");
    case "chat.letterSubject":
      return t("chat.letterSubject", "Give the letter a subject (up to 80 characters).");
    case "chat.tooLong":
      return t("chat.tooLong", "Keep a message under {n} characters.", { n: formatNumber(lang, 500) });
    case "chat.threadClosed":
      return t("chat.threadClosed", "This conversation is closed.");
    case "chat.loggedOut":
      return t("chat.loggedOut", "Sign in to talk with your world.");
    case "chat.sendFailed":
      return t("chat.sendFailed", "That did not send. Try again.");
    default:
      return null;
  }
}

const smallBtn =
  "min-h-tap flex-none rounded-lg border border-line px-3 text-[11px] font-semibold text-text-1";
const inputCls =
  "h-11 min-w-0 flex-1 rounded-xl border border-line bg-surf-2 px-3 text-[13px] text-text-1 placeholder:text-text-3";

interface MemberProps {
  memberToken?: string;
  onMemberTap: (member: AllianceMember) => void;
}

/** A channel's scroll region: header row + the thread. The composer is a
 *  sibling rendered by ChatSurfaceBody (the keyboard rule), not part of this. */
function ChannelScroll({
  chat,
  title,
  onBack,
  headerExtra,
  emptyText,
  memberProps,
}: {
  chat: ChatState;
  title: string;
  onBack?: () => void;
  headerExtra?: ReactNode;
  emptyText: string;
  memberProps: MemberProps;
}) {
  const t = useT();
  return (
    <>
      <div className="flex flex-none items-center gap-2 px-4 pt-2">
        {onBack ? (
          <button type="button" onClick={onBack} className={smallBtn} data-testid="chat-channel-back">
            {t("chat.back", "Back")}
          </button>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-1">
          <Bdi>{title}</Bdi>
        </span>
        {headerExtra}
      </div>
      <MessageList
        messages={chat.channelMessages}
        me={chat.me}
        phase={chat.phase}
        errorText={null}
        retryText={t("chat.retry", "Try again")}
        openingText={t("chat.opening", "Opening the channel…")}
        onRetry={() => void refreshChannel()}
        emptyText={emptyText}
        resolveMember={resolveChatMember}
        memberToken={memberProps.memberToken}
        onMemberTap={memberProps.onMemberTap}
      />
    </>
  );
}

export function ChatSurfaceBody() {
  const t = useT();
  const lang = useLang();
  const chat = useSyncExternalStore(subscribeChat, chatSnapshot, chatServerSnapshot);
  const memberCtx = useSyncExternalStore(subscribeChatMembers, chatMemberSnapshot, chatMemberServerSnapshot);
  const [profileId, setProfileId] = useState<string | null>(null);
  // Rooms create form
  const [roomName, setRoomName] = useState("");
  const [roomError, setRoomError] = useState<string | null>(null);
  // Personal: write-to form
  const [dmName, setDmName] = useState("");
  const [dmError, setDmError] = useState<string | null>(null);
  // Mail: open letter + compose form
  const [openLetterId, setOpenLetterId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [letterTo, setLetterTo] = useState("");
  const [letterSubject, setLetterSubject] = useState("");
  const [letterBody, setLetterBody] = useState("");
  const [letterError, setLetterError] = useState<string | null>(null);
  const [letterSent, setLetterSent] = useState(false);

  const profileMember =
    profileId && memberCtx ? memberCtx.alliance.members.find((m) => m.colonyId === profileId) ?? null : null;

  const memberProps: MemberProps = {
    memberToken: memberCtx?.token,
    onMemberTap: (m) => setProfileId(m.colonyId),
  };

  let body: ReactNode = null;
  /** the host column's last flex child: a composer, a closed note, or nothing */
  let tail: ReactNode = null;

  if (chat.signedOut) {
    body = <EmptyRow icon="chat" text={t("chat.loggedOut", "Sign in to talk with your world.")} />;
  } else if (chat.surface === "world") {
    body = (
      <MessageList
        messages={chat.messages}
        me={chat.me}
        phase={chat.phase}
        errorText={chat.errorKey === "chat.loadFailed" ? t("chat.loadFailed", "The channel did not load.") : null}
        retryText={t("chat.retry", "Try again")}
        openingText={t("chat.opening", "Opening the channel…")}
        onRetry={() => void refreshChat()}
        emptyText={t("chat.world.empty", "The world channel is quiet. Say the first thing.")}
        resolveMember={resolveChatMember}
        memberToken={memberProps.memberToken}
        onMemberTap={memberProps.onMemberTap}
      />
    );
    tail = <Composer />;
  } else if (chat.surface === "covenant") {
    if (!chat.covenant) {
      body = (
        <EmptyRow
          icon="users"
          text={t("chat.covenant.none", "You are not in a Covenant yet. This channel opens the day you join one.")}
        />
      );
    } else if (chat.activeChannel === chat.covenant.channel) {
      body = (
        <ChannelScroll
          chat={chat}
          title={chat.covenant.name}
          emptyText={t("chat.covenant.empty", "Your Covenant's channel is quiet. Say the first thing.")}
          memberProps={memberProps}
        />
      );
      tail = <Composer sendFn={sendChannelChatMessage} />;
    } else {
      body = (
        <div className="flex flex-col items-start gap-2 px-1 py-2">
          <p className="text-[13px] text-text-2">
            <Bdi>{chat.covenant.name}</Bdi>
          </p>
          <button
            type="button"
            className={smallBtn}
            data-testid="chat-covenant-open"
            onClick={() => openChannel(chat.covenant!.channel)}
          >
            {t("chat.covenant.open", "Open the channel")}
          </button>
        </div>
      );
    }
  } else if (chat.surface === "rooms") {
    const activeRoom = chat.activeChannel
      ? chat.rooms.find((r) => roomChannel(r.room.id) === chat.activeChannel)
      : undefined;
    if (chat.activeChannel && channelKind(chat.activeChannel) === "room") {
      body = (
        <ChannelScroll
          chat={chat}
          title={activeRoom?.room.name ?? t("chat.surface.rooms", "Rooms")}
          onBack={closeChannelView}
          headerExtra={
            activeRoom ? (
              <button
                type="button"
                className={smallBtn}
                data-testid="chat-room-leave"
                onClick={() => void leaveChatRoom(activeRoom.room.id)}
              >
                {t("chat.room.leave", "Leave")}
              </button>
            ) : null
          }
          emptyText={t("chat.room.empty", "This room is quiet. Say the first thing.")}
          memberProps={memberProps}
        />
      );
      tail = <Composer sendFn={sendChannelChatMessage} />;
    } else {
      body = (
        <div className="sheet-body flex flex-col gap-2 px-1 py-1" data-testid="chat-room-list">
          <form
            className="flex flex-col gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const name = roomName.trim();
              if (!name) return;
              void createChatRoom(name).then((out) => {
                if (out.ok) {
                  setRoomName("");
                  setRoomError(null);
                } else setRoomError(a2Refusal(t, lang, out.errorKey ?? null));
              });
            }}
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={roomName}
                maxLength={40}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder={t("chat.room.namePlaceholder", "Name a new room")}
                aria-label={t("chat.room.namePlaceholder", "Name a new room")}
                data-testid="chat-room-name"
                className={inputCls}
              />
              <button type="submit" disabled={roomName.trim().length === 0} className={`${smallBtn} disabled:opacity-50`} data-testid="chat-room-create">
                {t("chat.room.create", "Create")}
              </button>
            </div>
            {roomError ? (
              <p aria-live="polite" className="text-[11px] text-danger-soft">
                {roomError}
              </p>
            ) : null}
          </form>
          {!chat.listsLoaded ? (
            <p className="py-4 text-center text-[12px] text-text-3">{t("chat.opening", "Opening the channel…")}</p>
          ) : chat.rooms.length === 0 ? (
            <EmptyRow icon="hash" text={t("chat.rooms.empty", "No rooms yet. Found the first one above.")} />
          ) : (
            chat.rooms.map(({ room, joined, memberCount, unread }) => (
              <div key={room.id} className="flex items-center gap-2 rounded-xl border border-line bg-surf-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-text-1">
                    <Bdi>{room.name}</Bdi>
                  </span>
                  <span className="block text-[11px] text-text-3">
                    {t("chat.room.members", "{n} members", { n: formatNumber(lang, memberCount) })}
                    {joined ? ` · ${t("chat.room.joined", "Joined")}` : ""}
                  </span>
                </span>
                {unread > 0 ? (
                  <Bdi dir="ltr" className="num shrink-0 rounded-full bg-ember/20 px-2 py-0.5 text-[11px] font-semibold text-ember-soft">
                    {formatNumber(lang, unread)}
                  </Bdi>
                ) : null}
                {joined ? (
                  <>
                    <button
                      type="button"
                      className={smallBtn}
                      data-testid={`chat-room-open-${room.id}`}
                      onClick={() => openChannel(roomChannel(room.id))}
                    >
                      {t("chat.room.open", "Open")}
                    </button>
                    <button
                      type="button"
                      className={smallBtn}
                      data-testid={`chat-room-leave-${room.id}`}
                      onClick={() => void leaveChatRoom(room.id)}
                    >
                      {t("chat.room.leave", "Leave")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={smallBtn}
                    data-testid={`chat-room-join-${room.id}`}
                    onClick={() => void joinChatRoom(room.id, roomChannel(room.id))}
                  >
                    {t("chat.room.join", "Join")}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      );
    }
  } else if (chat.surface === "personal") {
    const activeThread = chat.activeChannel
      ? chat.threads.find((th) => personalChannel(th.thread.id) === chat.activeChannel)
      : undefined;
    if (chat.activeChannel && channelKind(chat.activeChannel) === "personal") {
      const closed = activeThread ? activeThread.thread.closedAt !== null : false;
      body = (
        <ChannelScroll
          chat={chat}
          title={activeThread?.otherName ?? t("chat.surface.personal", "Personal")}
          onBack={closeChannelView}
          headerExtra={
            activeThread && !closed ? (
              <button
                type="button"
                className={smallBtn}
                data-testid="chat-thread-close"
                onClick={() => void closeActiveThread()}
              >
                {t("chat.thread.close", "Close")}
              </button>
            ) : null
          }
          emptyText={t("chat.personal.empty", "Nothing said yet. Say the first thing.")}
          memberProps={memberProps}
        />
      );
      tail = closed ? (
        <p className="flex-none border-t border-line px-4 py-3 text-[12px] text-text-3">
          {t("chat.threadClosed", "This conversation is closed.")}
        </p>
      ) : (
        <Composer sendFn={sendChannelChatMessage} />
      );
    } else {
      body = (
        <div className="sheet-body flex flex-col gap-2 px-1 py-1" data-testid="chat-thread-list">
          <form
            className="flex flex-col gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const name = dmName.trim();
              if (!name) return;
              void startThread(name).then((out) => {
                if (out.ok) {
                  setDmName("");
                  setDmError(null);
                } else setDmError(a2Refusal(t, lang, out.errorKey ?? null));
              });
            }}
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={dmName}
                onChange={(e) => setDmName(e.target.value)}
                placeholder={t("chat.personal.toPlaceholder", "Colony name (exact)")}
                aria-label={t("chat.personal.toPlaceholder", "Colony name (exact)")}
                data-testid="chat-dm-name"
                className={inputCls}
              />
              <button type="submit" disabled={dmName.trim().length === 0} className={`${smallBtn} disabled:opacity-50`} data-testid="chat-dm-start">
                {t("chat.personal.write", "Write")}
              </button>
            </div>
            {dmError ? (
              <p aria-live="polite" className="text-[11px] text-danger-soft">
                {dmError}
              </p>
            ) : null}
          </form>
          {!chat.listsLoaded ? (
            <p className="py-4 text-center text-[12px] text-text-3">{t("chat.opening", "Opening the channel…")}</p>
          ) : chat.threads.length === 0 ? (
            <EmptyRow icon="chat" text={t("chat.personal.none", "No conversations yet. Write to a colony by its exact name.")} />
          ) : (
            chat.threads.map((view) => (
              <button
                key={view.thread.id}
                type="button"
                data-testid={`chat-thread-open-${view.thread.id}`}
                onClick={() => openChannel(personalChannel(view.thread.id))}
                className="flex items-center gap-2 rounded-xl border border-line bg-surf-2 px-3 py-2 text-start"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-text-1">
                    <Bdi>{view.otherName}</Bdi>
                  </span>
                  <span className="block truncate text-[11px] text-text-3">
                    {view.thread.closedAt !== null ? (
                      t("chat.thread.closedTag", "Closed")
                    ) : view.lastBody ? (
                      <Bdi>{view.lastBody}</Bdi>
                    ) : (
                      t("chat.personal.empty", "Nothing said yet. Say the first thing.")
                    )}
                  </span>
                </span>
                {view.lastAt ? (
                  <Bdi dir="ltr" className="num shrink-0 text-[11px] text-text-3">
                    {formatTime(lang, view.lastAt)}
                  </Bdi>
                ) : null}
                {view.unread > 0 ? (
                  <Bdi dir="ltr" className="num shrink-0 rounded-full bg-ember/20 px-2 py-0.5 text-[11px] font-semibold text-ember-soft">
                    {formatNumber(lang, view.unread)}
                  </Bdi>
                ) : null}
              </button>
            ))
          )}
        </div>
      );
    }
  } else {
    // ── mail ──────────────────────────────────────────────────────────────
    const letters = [...chat.letters].reverse();
    const openLetter: MailLetter | null = openLetterId
      ? (chat.letters.find((l) => l.id === openLetterId) ?? null)
      : null;
    if (openLetter) {
      body = (
        <div className="sheet-body flex flex-col gap-2 px-1 py-1" data-testid="chat-letter-view">
          <div className="flex items-center gap-2">
            <button type="button" className={smallBtn} data-testid="chat-letter-back" onClick={() => setOpenLetterId(null)}>
              {t("chat.back", "Back")}
            </button>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-1">
              <Bdi>{openLetter.subject}</Bdi>
            </span>
          </div>
          <p className="text-[11px] text-text-3">
            <Bdi>{openLetter.fromName}</Bdi> ·{" "}
            <Bdi dir="ltr" className="num">
              {formatDate(lang, openLetter.createdAt)}
            </Bdi>
          </p>
          <p dir="auto" lang={openLetter.lang} className="rounded-2xl bg-surf-2 px-3 py-2 text-[13px] text-text-1">
            {openLetter.body}
          </p>
          <div>
            <button
              type="button"
              className={smallBtn}
              data-testid="chat-letter-reply"
              onClick={() => {
                setOpenLetterId(null);
                setComposing(true);
                setLetterSent(false);
                setLetterTo(openLetter.fromName);
                setLetterSubject(`Re: ${openLetter.subject}`.slice(0, 80));
              }}
            >
              {t("chat.mail.reply", "Reply")}
            </button>
          </div>
        </div>
      );
    } else {
      body = (
        <div className="sheet-body flex flex-col gap-2 px-1 py-1" data-testid="chat-mail-list">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={smallBtn}
              data-testid="chat-mail-compose-toggle"
              onClick={() => {
                setComposing((c) => !c);
                setLetterSent(false);
                setLetterError(null);
              }}
            >
              {t("chat.mail.write", "Write a letter")}
            </button>
            {letterSent ? (
              <span className="text-[11px] text-text-2">{t("chat.mail.sent", "Sent. It will wait for them.")}</span>
            ) : null}
          </div>
          {composing ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void sendChatLetter(letterTo.trim(), letterSubject.trim(), letterBody.trim(), lang).then((out) => {
                  if (out.ok) {
                    setComposing(false);
                    setLetterTo("");
                    setLetterSubject("");
                    setLetterBody("");
                    setLetterError(null);
                    setLetterSent(true);
                  } else setLetterError(a2Refusal(t, lang, out.errorKey ?? null));
                });
              }}
            >
              <input
                type="text"
                value={letterTo}
                onChange={(e) => setLetterTo(e.target.value)}
                placeholder={t("chat.personal.toPlaceholder", "Colony name (exact)")}
                aria-label={t("chat.personal.toPlaceholder", "Colony name (exact)")}
                data-testid="chat-letter-to"
                className={inputCls}
              />
              <input
                type="text"
                value={letterSubject}
                maxLength={80}
                onChange={(e) => setLetterSubject(e.target.value)}
                placeholder={t("chat.mail.subjectPlaceholder", "Subject")}
                aria-label={t("chat.mail.subjectPlaceholder", "Subject")}
                data-testid="chat-letter-subject"
                className={inputCls}
              />
              <textarea
                value={letterBody}
                maxLength={500}
                onChange={(e) => setLetterBody(e.target.value)}
                placeholder={t("chat.mail.bodyPlaceholder", "Write your letter")}
                aria-label={t("chat.mail.bodyPlaceholder", "Write your letter")}
                data-testid="chat-letter-body"
                rows={4}
                className="min-w-0 flex-1 rounded-xl border border-line bg-surf-2 px-3 py-2 text-[13px] text-text-1 placeholder:text-text-3"
              />
              {letterError ? (
                <p aria-live="polite" className="text-[11px] text-danger-soft">
                  {letterError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={letterTo.trim().length === 0 || letterSubject.trim().length === 0 || letterBody.trim().length === 0}
                className={`${smallBtn} disabled:opacity-50`}
                data-testid="chat-letter-send"
              >
                {t("chat.mail.send", "Send letter")}
              </button>
            </form>
          ) : null}
          {!chat.listsLoaded ? (
            <p className="py-4 text-center text-[12px] text-text-3">{t("chat.opening", "Opening the channel…")}</p>
          ) : letters.length === 0 ? (
            <EmptyRow icon="mail" text={t("chat.mail.empty", "No letters yet.")} />
          ) : (
            letters.map((letter) => (
              <button
                key={letter.id}
                type="button"
                data-testid={`chat-letter-open-${letter.id}`}
                onClick={() => {
                  setOpenLetterId(letter.id);
                  void readChatLetter(letter.id);
                }}
                className="flex items-center gap-2 rounded-xl border border-line bg-surf-2 px-3 py-2 text-start"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-text-1">
                    <Bdi>{letter.subject}</Bdi>
                  </span>
                  <span className="block truncate text-[11px] text-text-3">
                    <Bdi>{letter.fromName}</Bdi>
                  </span>
                </span>
                <Bdi dir="ltr" className="num shrink-0 text-[11px] text-text-3">
                  {formatTime(lang, letter.createdAt)}
                </Bdi>
                {letter.readAt === null ? (
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-ember" />
                ) : null}
              </button>
            ))
          )}
        </div>
      );
    }
  }

  return (
    <>
      <div
        id={`chat-panel-${chat.surface}`}
        role="tabpanel"
        aria-labelledby={`chat-tab-${chat.surface}`}
        className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3"
      >
        {body}
      </div>
      {tail}
      {profileMember && memberCtx && (
        <MemberProfile
          member={profileMember}
          alliance={memberCtx.alliance}
          me={memberCtx.me}
          isLeader={memberCtx.isLeader}
          isOfficer={memberCtx.isOfficer}
          token={memberCtx.token}
          onAction={(fn: () => Promise<GameResult>) => {
            void fn().catch(() => {});
          }}
          onClose={() => setProfileId(null)}
        />
      )}
    </>
  );
}

export default ChatSurfaceBody;
