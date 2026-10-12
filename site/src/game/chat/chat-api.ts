// chat-api.ts — the chat doors the client knocks on (slice A1).
//
// Three server functions, zod-validated exactly like the feedback channel's
// precedent (`submitFeedbackFn` in `api.ts`), so a malformed call is refused
// BEFORE it reaches a rule:
//
//   • worldFeedFn  — the world channel's last 200 lines
//   • sendWorldFn  — post one line (the guards, the stamp and retention all live
//                    in chat-server.ts and run server-side)
//   • chatSyncFn   — one poll answer: the feed + the unread counts
//
// POLLING ONLY, AND ONLY WHILE SOMEBODY IS LOOKING (D8). `chatSyncFn` is called by
// the client store on a ~5 s beat that is gated on the sheet being open or the bar
// being on screen, and paused on `visibilitychange`. It is deliberately NOT part of
// the existing 4 s state poll: chat is a different cadence and a different cost,
// and folding it in would make every player pay for a channel they never opened.
//
// Every handler is thin on purpose: it resolves the token, refuses politely, and
// hands the work to a function in chat-server.ts that the headless harness calls
// directly. There is no rule in this file that the tests cannot reach.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CHAT_MAX_MESSAGE, CHAT_MAX_SUBJECT } from "./chat-types";
import {
  channelFeed,
  chatLists,
  chatSync,
  closeThread,
  createRoom,
  joinRoom,
  leaveRoom,
  markChannelRead,
  markLetterRead,
  openThread,
  sendChannelMessage,
  sendLetter,
  sendWorldMessage,
  worldFeed,
  type ChatListsResult,
  type ChatOpenThreadResult,
  type ChatResult,
  type ChatSendResult,
} from "./chat-server";

export type { ChatListsResult, ChatOpenThreadResult, ChatResult, ChatSendResult } from "./chat-server";

/** zod's own cap is a backstop; the real refusal is `validateBody`'s, and it names
 *  a catalogue key. A body longer than the limit is REFUSED, never truncated: a
 *  silently shortened message would be a lie about what the player wrote. */
const bodyValidator = z.string().max(CHAT_MAX_MESSAGE * 4);

export const worldFeedFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }): Promise<ChatResult> => worldFeed({ token: data.token }));

export const sendWorldFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      body: bodyValidator,
      /** the device's language; stored, never trusted later (D9) */
      lang: z.string().optional(),
    })
  )
  .handler(async ({ data }): Promise<ChatSendResult> =>
    sendWorldMessage({ token: data.token, body: data.body, lang: data.lang })
  );

export const chatSyncFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }): Promise<ChatResult> => chatSync({ token: data.token }));

// ── slice A2: every other surface ───────────────────────────────────────────
// Same posture as A1: zod at the door, every rule in chat-server.ts.

export const channelFeedFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), channel: z.string().max(128) }))
  .handler(async ({ data }): Promise<ChatResult> => channelFeed({ token: data.token, channel: data.channel }));

export const sendChannelFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      channel: z.string().max(128),
      body: bodyValidator,
      lang: z.string().optional(),
    })
  )
  .handler(async ({ data }): Promise<ChatSendResult> =>
    sendChannelMessage({ token: data.token, channel: data.channel, body: data.body, lang: data.lang })
  );

export const markReadFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), channel: z.string().max(128) }))
  .handler(async ({ data }): Promise<ChatResult> => markChannelRead({ token: data.token, channel: data.channel }));

export const chatListsFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }): Promise<ChatListsResult> => chatLists({ token: data.token }));

export const openThreadFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), colonyName: z.string().max(64) }))
  .handler(async ({ data }): Promise<ChatOpenThreadResult> => openThread({ token: data.token, colonyName: data.colonyName }));

export const closeThreadFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), threadId: z.string().max(128) }))
  .handler(async ({ data }): Promise<ChatResult> => closeThread({ token: data.token, threadId: data.threadId }));

export const createRoomFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), name: z.string().max(160) }))
  .handler(async ({ data }): Promise<ChatResult & { roomId?: string; channel?: string }> =>
    createRoom({ token: data.token, name: data.name })
  );

export const joinRoomFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), roomId: z.string().max(128) }))
  .handler(async ({ data }): Promise<ChatResult> => joinRoom({ token: data.token, roomId: data.roomId }));

export const leaveRoomFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), roomId: z.string().max(128) }))
  .handler(async ({ data }): Promise<ChatResult> => leaveRoom({ token: data.token, roomId: data.roomId }));

export const sendLetterFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token: z.string(),
      colonyName: z.string().max(64),
      subject: z.string().max(CHAT_MAX_SUBJECT * 4),
      body: bodyValidator,
      lang: z.string().optional(),
    })
  )
  .handler(async ({ data }): Promise<ChatResult> =>
    sendLetter({ token: data.token, colonyName: data.colonyName, subject: data.subject, body: data.body, lang: data.lang })
  );

export const markLetterReadFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string(), letterId: z.string().max(128) }))
  .handler(async ({ data }): Promise<ChatResult> => markLetterRead({ token: data.token, letterId: data.letterId }));
