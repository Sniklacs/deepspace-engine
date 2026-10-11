// chat-members — the chat's view of the alliance roster (owner 2026-10-11).
//
// The chat window doesn't own GameState, so the shell publishes the player's
// alliance here on every state refresh. MessageRow resolves each sender's
// colony name to a live member record — the avatar renders from the record,
// so it stays in sync when someone changes theirs. Tapping a member opens
// their profile (avatar, troops sacrificed in service, contribution).

import type { Alliance, AllianceMember } from "../war/alliances";

interface ChatMemberContext {
  token: string;
  me: string;
  alliance: Alliance;
  isLeader: boolean;
  isOfficer: boolean;
}

let ctx: ChatMemberContext | null = null;
let listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeChatMembers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function chatMemberSnapshot(): ChatMemberContext | null {
  return ctx;
}

export function chatMemberServerSnapshot(): ChatMemberContext | null {
  return null;
}

/**
 * Published by the shell (play.tsx) on every state refresh. Null when
 * signed out or alliance-less — chat falls back to the initial placeholder.
 */
export function configureChatMembers(next: ChatMemberContext | null): void {
  ctx = next;
  emit();
}

/** colonyName → live alliance member (name match; world chat senders use colony names). */
export function resolveChatMember(colonyName: string): AllianceMember | null {
  const a = ctx?.alliance;
  if (!a) return null;
  return a.members.find((m) => m.colonyName === colonyName) ?? null;
}
