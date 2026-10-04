// Mailbox tests (owner 2026-10-03).
import { describe, expect, test } from "bun:test";
import {
  sendMail,
  sendGameUpdate,
  markRead,
  markAllRead,
  deleteMail,
  unreadCount,
  ensureMailbox,
  MAILBOX_CAP,
} from "./mailbox";
import type { GameState } from "./types";

function blankState(): GameState {
  return {
    version: 1,
    createdAt: Date.now(),
    lastTick: Date.now(),
    playerName: "Test",
    race: null,
    raceLocked: false,
  } as unknown as GameState;
}

describe("mailbox", () => {
  test("sendMail appends newest-first and starts unread", () => {
    const st = blankState();
    const m1 = sendMail(st, { subject: "First", body: "one", category: "alert", sentAt: 1000 });
    const m2 = sendMail(st, { subject: "Second", body: "two", category: "update", sentAt: 2000 });
    const box = ensureMailbox(st);
    expect(box.length).toBe(2);
    expect(box[0].id).toBe(m2.id); // newest first
    expect(box[1].id).toBe(m1.id);
    expect(m1.read).toBe(false);
    expect(unreadCount(st)).toBe(2);
  });

  test("sendMail defaults from to system / The Unbound", () => {
    const st = blankState();
    const m = sendMail(st, { subject: "Hi", body: "x", category: "announcement" });
    expect(m.from).toBe("system");
    expect(m.fromName).toBe("The Unbound");
  });

  test("sendGameUpdate uses update category", () => {
    const st = blankState();
    const m = sendGameUpdate(st, "Patch 1.2", "We shipped stuff.");
    expect(m.category).toBe("update");
    expect(m.subject).toBe("Patch 1.2");
  });

  test("markRead flips one message; unknown id returns false", () => {
    const st = blankState();
    const m = sendMail(st, { subject: "A", body: "b", category: "alert" });
    expect(markRead(st, "nope")).toBe(false);
    expect(markRead(st, m.id)).toBe(true);
    expect(unreadCount(st)).toBe(0);
  });

  test("markAllRead clears the badge", () => {
    const st = blankState();
    sendMail(st, { subject: "A", body: "b", category: "alert" });
    sendMail(st, { subject: "B", body: "b", category: "supply" });
    sendMail(st, { subject: "C", body: "b", category: "alliance" });
    expect(unreadCount(st)).toBe(3);
    markAllRead(st);
    expect(unreadCount(st)).toBe(0);
  });

  test("deleteMail removes; unknown id returns false", () => {
    const st = blankState();
    const m = sendMail(st, { subject: "A", body: "b", category: "alert" });
    expect(deleteMail(st, "nope")).toBe(false);
    expect(deleteMail(st, m.id)).toBe(true);
    expect(ensureMailbox(st).length).toBe(0);
  });

  test("mailbox caps at MAILBOX_CAP, newest survive", () => {
    const st = blankState();
    for (let i = 0; i < MAILBOX_CAP + 10; i++) {
      sendMail(st, { subject: `M${i}`, body: "b", category: "alert", sentAt: i });
    }
    const box = ensureMailbox(st);
    expect(box.length).toBe(MAILBOX_CAP);
    // Newest first: the last-sent (highest sentAt) is at index 0.
    expect(box[0].subject).toBe(`M${MAILBOX_CAP + 9}`);
  });

  test("ensureMailbox migrates old saves without a mailbox", () => {
    const st = blankState();
    delete (st as any).mailbox;
    expect(ensureMailbox(st)).toEqual([]);
    expect(unreadCount(st)).toBe(0);
  });

  test("sendMail stores a goTo deep-link when provided (owner 2026-10-04)", () => {
    const st = blankState();
    const m = sendMail(st, {
      subject: "Welcome",
      body: "b",
      category: "alliance",
      goTo: { tab: "battles", label: "Open war band" },
    });
    expect(m.goTo).toEqual({ tab: "battles", label: "Open war band" });
    expect(ensureMailbox(st)[0].goTo).toEqual({ tab: "battles", label: "Open war band" });
  });

  test("sendMail leaves goTo absent when not provided (old mails get no button)", () => {
    const st = blankState();
    const m = sendMail(st, { subject: "Plain", body: "b", category: "alert" });
    expect(m.goTo).toBeUndefined();
  });
});
