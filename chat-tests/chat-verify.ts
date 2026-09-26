// CHAT SLICE A1 — SERVER-LAYER VERIFICATION (chat-mail-spec §4 · §7 gate 1).
//
// Run:  cd /home/team/shared/chat-tests && env -u DATABASE_URL bun run chat-verify.ts
//
// WHAT THIS SUITE IS FOR. Slice A1 puts chat's data on TWO backends and its rules in
// one module. The headless battery has no DATABASE_URL, so everything here runs on
// the filesystem fallback — and the Postgres half is asserted STRUCTURALLY (every
// table created in `ensureTables`, every accessor carrying a real DB branch), never
// claimed as "we ran Postgres". That distinction is written into the check names so
// nobody can misread a green run.
//
// THE COVERAGE THE GATE REQUIRES (definition of done, item 1):
//   1 · SIX TABLES ON BOTH BACKENDS — a real round-trip of each table through its
//       accessor on the fs store, landed in `data/chat.json` (the store is a file,
//       not a memory), plus the DDL/branch structure of the other backend.
//   2 · THE LANGUAGE STAMP (D9) — the author's language is resolved ON THE SERVER;
//       an unshipped claim cannot become a row's `lang`.
//   3 · LENGTH (D12) — 500 characters accepted, 501 refused, and the refusal names
//       a catalogue key while writing NOTHING.
//   4 · RATE (D12) — one per 2 s, and 30 in a rolling minute, both refused with a
//       key, both leaving the table untouched.
//   5 · RETENTION (D7) — the last 200 messages per channel, oldest-first eviction,
//       PROVEN END TO END: seed 200, post one, and the oldest line is gone while
//       the newest 199 and the new line remain.
//   6 · EXACT-MATCH RESOLUTION (D10) — hit, case-folded hit, miss, whitespace,
//       ambiguity, over-long and non-string input. No substring, no prefix search.
//   7 · UNREAD SEMANTICS (D11) — World and Covenant are structurally uncountable;
//       Personal, Rooms (joined only) and Mail carry the counts; my own line is
//       never unread; a read mark clears it.
//   8 · ACCOUNT DELETION (D13) — the account's messages are HARD-DELETED (the text
//       is gone, not blanked), its threads are closed, and the other participant
//       keeps the thread and their own lines. The deletion path in `api.ts` calls it.
//
// Everything is called against the REAL functions the handlers call. No rule is
// re-implemented here, so this suite cannot agree with itself.
//
// This file FAILS AGAINST THE CODE BEFORE SLICE A1 BY CONSTRUCTION: on the previous
// revision the chat module does not exist, the six tables are not created and
// `deleteChatByAccount` is not on the account-deletion path — the import alone fails.

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// ── isolation FIRST: the fs store reads `process.cwd()/data` at import time, so
// the working directory has to move before any site module is loaded. Every import
// below is therefore dynamic (a static import would hoist above this line).
const scratch = mkdtempSync(path.join(tmpdir(), "chat-a1-"));
process.chdir(scratch);

const SITE = "/home/team/shared/site";
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}
const section = (t: string) => console.log(`\n— ${t} —`);
/** Comments describe an absence ("no typing indicator") as often as a presence, so
 *  the absence checks read CODE, never prose. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const store = await import(`${SITE}/src/game/store.ts`);
const auth = await import(`${SITE}/src/game/auth.ts`);
const engine = await import(`${SITE}/src/game/engine.ts`);
const T = await import(`${SITE}/src/game/chat/chat-types.ts`);
const S = await import(`${SITE}/src/game/chat/chat-server.ts`);
const langs = await import(`${SITE}/src/game/i18n/languages.ts`);

const WORLD = T.WORLD_CHANNEL;
const now = Date.now(); // the real clock (project rule: time is never mocked)

/** A signed-up account with one named colony, exactly as a real player has. */
async function makeColony(handle: string, colony: string, createdAt: number) {
  const res = await auth.signup(handle, "test-password");
  if (!res.ok || !res.token) throw new Error(`signup failed for ${handle}: ${res.error}`);
  const st = engine.newGame(colony, "watchers", createdAt);
  st.gameId = `g-${handle}`;
  const saves = { version: 2 as const, activeGameId: st.gameId, games: { [st.gameId]: st } };
  await store.saveAccountSaves(handle, saves as never);
  return { accountId: handle, token: res.token, colony };
}

// ───────────────────────────────────────────────────────────────────────────
section("1 · SIX TABLES, TWO BACKENDS (the fs fallback is what this run proves)");
const storeSrc = readFileSync(`${SITE}/src/game/store.ts`, "utf8");
const TABLES = ["chat_messages", "chat_threads", "chat_rooms", "chat_room_members", "chat_reads", "mail_letters"];
check(
  `all six tables are CREATEd on the Postgres backend (${TABLES.length} of 6)`,
  TABLES.every((t) => new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`).test(storeSrc)),
  TABLES.filter((t) => !new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`).test(storeSrc)).join(",")
);
const ACCESSORS = [
  "loadChatMessages",
  "appendChatMessage",
  "evictChatMessages",
  "countChatMessagesSince",
  "lastChatMessageAt",
  "deleteChatByAccount",
  "loadChatThreadsFor",
  "appendChatThread",
  "loadChatRooms",
  "loadMyRoomMemberships",
  "loadChatReads",
  "saveChatRead",
  "loadMailFor",
  "appendMailLetter",
];
const accessorBodies = ACCESSORS.map((fn) => {
  const at = storeSrc.indexOf(`export async function ${fn}(`);
  if (at < 0) return { fn, body: "" };
  const next = storeSrc.indexOf("\nexport ", at + 10);
  return { fn, body: storeSrc.slice(at, next < 0 ? undefined : next) };
});
check(
  `every chat accessor exists in the store (${ACCESSORS.length})`,
  accessorBodies.every((a) => a.body.length > 0),
  accessorBodies.filter((a) => !a.body.length).map((a) => a.fn).join(",")
);
check(
  "every chat accessor carries a REAL Postgres branch (not an fs-only shim) — asserted structurally, since this run has no DATABASE_URL",
  accessorBodies.every((a) => a.body.includes("if (USE_DB)") && a.body.includes("ensureTables()") && a.body.includes("db().query(")),
  accessorBodies.filter((a) => !(a.body.includes("if (USE_DB)") && a.body.includes("ensureTables()") && a.body.includes("db().query("))).map((a) => a.fn).join(",")
);
check("the fs fallback keeps all six tables in ONE versioned file (data/chat.json), mirroring feedback.json", /CHAT_PATH = path\.join\(DATA_DIR, "chat\.json"\)/.test(storeSrc));

// the real round-trip, table by table, through the same accessors the handlers use
const probe = {
  id: "rt-msg-1",
  channel: T.roomChannel("rt-room"),
  accountId: "round-trip",
  colonyName: "Round Trip",
  lang: "fa",
  body: "پیام آزمایشی",
  createdAt: now,
};
await store.appendChatMessage(probe);
const backMsgs = await store.loadChatMessages(T.roomChannel("rt-room"));
check("chat_messages round-trips through the fs store", backMsgs.length === 1 && backMsgs[0].body === probe.body && backMsgs[0].lang === "fa" && backMsgs[0].colonyName === "Round Trip");

await store.appendChatThread({ id: "rt-thread", a: "alpha", b: "beta", createdAt: now, closedAt: null });
const backThreads = await store.loadChatThreadsFor("alpha");
check("chat_threads round-trips (and is readable per participant)", backThreads.length === 1 && backThreads[0].b === "beta" && backThreads[0].closedAt === null);

await store.saveChatRead("round-trip", WORLD, now);
const backReads = await store.loadChatReads("round-trip");
check("chat_reads round-trips as an advancing mark", backReads.length === 1 && backReads[0].lastReadAt === now);

await store.appendMailLetter({
  id: "rt-letter",
  fromAccount: "alpha",
  fromName: "Alpha",
  toAccount: "beta",
  subject: "s",
  body: "b",
  lang: "ru",
  createdAt: now,
  readAt: null,
});
const backLetters = await store.loadMailFor("beta");
check("mail_letters round-trips as RECEIVED mail for its addressee", backLetters.length === 1 && backLetters[0].fromAccount === "alpha");
check("it is NOT handed to a third party", (await store.loadMailFor("gamma")).length === 0);

// rooms + memberships land through the same file: the A2 surface uses them, and the
// table exists from A1 (chat-mail-spec §4) — so its storage is proven here, not later.
const roomFile = JSON.parse(readFileSync(path.join(scratch, "data", "chat.json"), "utf8")) as {
  version: number;
  messages: unknown[];
  threads: unknown[];
  rooms: unknown[];
  members: unknown[];
  reads: unknown[];
  letters: unknown[];
};
check("the fs store is a REAL FILE with all six arrays (not an in-process cache)", existsSync(path.join(scratch, "data", "chat.json")) && roomFile.version === 1 && ["messages", "threads", "rooms", "members", "reads", "letters"].every((k) => Array.isArray((roomFile as Record<string, unknown>)[k])));
check("chat_rooms and chat_room_members are readable through their accessors", Array.isArray(await store.loadChatRooms()) && Array.isArray(await store.loadMyRoomMemberships("round-trip")));
check("nothing chat-shaped is in the DEVICE record (language/text size live there, chat UI state does not)", !/dse\.device|localStorage/.test(storeSrc) && !/dse\.device|localStorage/.test(readFileSync(`${SITE}/src/game/chat/chat-types.ts`, "utf8") + readFileSync(`${SITE}/src/game/chat/chat-server.ts`, "utf8")));

// ───────────────────────────────────────────────────────────────────────────
section("2 · THE LANGUAGE STAMP IS THE SERVER'S DECISION (D9)");
const alice = await makeColony("alice", "Ashfall", now - 90_000);
const bob = await makeColony("bob", "Bright Harbor", now - 80_000);
const sentFa = await S.sendWorldMessage({ token: alice.token, body: "سلام از گهواره", lang: "fa" });
check("a signed-in message is accepted", sentFa.ok && !!sentFa.message);
check("the shipped language the client sent is STORED on the row", sentFa.message?.lang === "fa");
check("the row carries the author's colony name, resolved server-side", sentFa.message?.colonyName === "Ashfall");
check("the row carries the authoring account id", sentFa.message?.accountId === "alice");
const reloaded = (await store.loadChatMessages(WORLD)).find((m) => m.id === sentFa.message?.id);
check("and it is the STORED value that comes back (not the client's word on read)", reloaded?.lang === "fa");
const badClaim = await S.sendWorldMessage({ token: bob.token, body: "hello world", lang: "zz-not-a-language" });
check("an unshipped language claim cannot become a row's lang", badClaim.message?.lang === langs.SOURCE_LANG, `got ${badClaim.message?.lang}`);
const noClaim = await (async () => {
  // a second account so the 2 s guard does not interfere
  const carol = await makeColony("carol", "Cinder", now - 70_000);
  return S.sendWorldMessage({ token: carol.token, body: "no claim here" });
})();
check("a missing claim becomes the source language, never an invented one", noClaim.message?.lang === langs.SOURCE_LANG);
check("the stamp is a language the catalogs and the bidi rules know", langs.isShippedLang(S.stampLang("pt-BR")) && S.stampLang("pt-BR") === "pt-BR" && S.stampLang(undefined) === "en" && S.stampLang(42) === "en");
check("an anonymous caller is refused before anything is written", (await S.sendWorldMessage({ token: "not-a-token", body: "hi", lang: "en" })).signedOut === true);

// ───────────────────────────────────────────────────────────────────────────
section("3 · LENGTH (D12: 500 characters, refused-with-a-key, never truncated)");
const dave = await makeColony("dave", "Dune Watch", now - 60_000);
const before501 = (await store.loadChatMessages(WORLD)).length;
const long501 = "x".repeat(501);
const refusedLong = await S.sendWorldMessage({ token: dave.token, body: long501, lang: "en" });
check("a 501-character body is REFUSED", refusedLong.ok === false);
check("and the refusal names the catalogue key the player reads", refusedLong.errorKey === "chat.tooLong");
check("and it wrote NOTHING to the table", (await store.loadChatMessages(WORLD)).length === before501);
const ok500 = await S.sendWorldMessage({ token: dave.token, body: "y".repeat(500), lang: "en" });
check("a 500-character body is ACCEPTED and stored whole (never truncated)", ok500.ok === true && [...(ok500.message?.body ?? "")].length === 500);
const empty = await S.sendWorldMessage({ token: dave.token, body: "   \n  ", lang: "en" });
check("whitespace alone is not a message", empty.ok === false && empty.errorKey === "chat.sendFailed");
check("the limit is counted in CODE POINTS, so a 500-character Persian line is not refused", S.validateBody("م".repeat(500)).ok === true && S.validateBody("م".repeat(501)).ok === false);
check("the same constant is what the client's composer will cap at", T.CHAT_MAX_MESSAGE === 500);

// ───────────────────────────────────────────────────────────────────────────
section("4 · RATE LIMITS (D12: 1 per 2 s, 30 per rolling minute)");
const erin = await makeColony("erin", "Ember Row", now - 50_000);
const first = await S.sendWorldMessage({ token: erin.token, body: "first", lang: "en" });
const second = await S.sendWorldMessage({ token: erin.token, body: "second", lang: "en" });
check("the first message goes", first.ok === true);
check("a second within 2 seconds is refused", second.ok === false && second.errorKey === "chat.tooFast");
check("the refusal is a catalogue key, not a raw server string", second.errorKey === "chat.tooFast" && typeof second.error === "string");
check("the refused message is NOT in the table", (await store.loadChatMessages(WORLD)).every((m) => m.body !== "second"));
// The guard must read the TABLE, not an in-process counter: an account whose last
// line is already older than the gap speaks again, and one that has none speaks
// immediately.
const gina = await makeColony("gina", "Glass Reef", now - 30_000);
await store.appendChatMessage({ id: "gina-old", channel: WORLD, accountId: "gina", colonyName: "Glass Reef", lang: "en", body: "gina, five seconds ago", createdAt: now - 5_000 });
check("the guards read the REAL table: an account whose last line is older than 2 s may speak", (await S.sendWorldMessage({ token: gina.token, body: "gina after the gap", lang: "en" })).ok === true);
check("the 2 s rule is a constant the store agrees with", T.CHAT_MIN_GAP_MS === 2000 && S.rateRefusal(10_000, 9_000, 0) === "tooFast" && S.rateRefusal(10_000, 8_000, 0) === null);
check("30 in a rolling minute is the ceiling", T.CHAT_MAX_PER_MINUTE === 30 && S.rateRefusal(10_000, 0, 30) === "tooMany" && S.rateRefusal(10_000, 0, 29) === null);
const fiona = await makeColony("fiona", "Frostline", now - 40_000);
for (let i = 0; i < 30; i++) {
  await store.appendChatMessage({ id: `burst-${i}`, channel: WORLD, accountId: "fiona", colonyName: "Frostline", lang: "en", body: `burst ${i}`, createdAt: now - 5_000 });
}
const burst = await S.sendWorldMessage({ token: fiona.token, body: "one more", lang: "en" });
check("the minute ceiling refuses the 31st, from the rows — not from a client counter", burst.ok === false && burst.errorKey === "chat.tooFast");

// ───────────────────────────────────────────────────────────────────────────
section("5 · RETENTION: the last 200 per channel, oldest-first eviction (D7)");
check("the retention constant is 200", T.CHAT_RETENTION === 200);
const seeder = await makeColony("seeder", "Seed Bank", now - 30_000);
// Start from an empty channel so the eviction is unambiguous: `keep = 0` empties a
// channel — which is itself the proof that the eviction DELETES rows rather than
// hiding them behind a read window.
const beforeClear = (await store.loadChatMessages(WORLD, 10_000)).length;
const cleared = await store.evictChatMessages(WORLD, 0);
check("the channel had traffic to clear (the eviction is not vacuous)", beforeClear > 0 && cleared === beforeClear, `${cleared}/${beforeClear}`);
check("keep = 0 empties the channel — the eviction really deletes", (await store.loadChatMessages(WORLD, 10_000)).length === 0);
const seededIds: string[] = [];
for (let i = 0; i < 200; i++) {
  const id = `ret-${String(i).padStart(3, "0")}`;
  seededIds.push(id);
  await store.appendChatMessage({ id, channel: WORLD, accountId: "seeder", colonyName: "Seed Bank", lang: "en", body: `seeded ${i}`, createdAt: now - 100_000 + i });
}
const afterSeed = await store.loadChatMessages(WORLD, 10_000);
check("the 200 seeded lines are all present before the eviction", afterSeed.length === 200 && seededIds.every((id) => afterSeed.some((m) => m.id === id)));
const grace = await makeColony("grace", "Glass Coast", now - 20_000);
const trigger = await S.sendWorldMessage({ token: grace.token, body: "the 201st line", lang: "en" });
check("the message that trips retention is accepted", trigger.ok === true);
const afterEvict = await store.loadChatMessages(WORLD, 10_000);
check("the channel is now EXACTLY 200 messages", afterEvict.length === 200, `=${afterEvict.length}`);
check("the OLDEST line is the one that went", !afterEvict.some((m) => m.id === seededIds[0]));
check("the second-oldest survived (eviction is oldest-first, not a sweep)", afterEvict.some((m) => m.id === seededIds[1]));
check("the newest seeded line survived", afterEvict.some((m) => m.id === seededIds[199]));
check("the new line survived and is the newest", afterEvict[afterEvict.length - 1].id === trigger.message?.id);
check("the eviction reports how many rows it removed, so it can never claim one it did not do", (await store.evictChatMessages(WORLD, 200)) === 0);
check("retention is per channel — a quiet room is untouched by the world's traffic", (await store.loadChatMessages(T.roomChannel("rt-room"))).length === 1);
void seeder;

// ───────────────────────────────────────────────────────────────────────────
section("6 · COLONY RESOLUTION IS EXACT MATCH, CASE-FOLDED, AND NOTHING ELSE (D10)");
const hit = await S.resolveColonyName("Ashfall");
check("an exact name resolves to its account", hit?.accountId === "alice");
check("case does not matter to a player typing a name", (await S.resolveColonyName("ashfall"))?.accountId === "alice");
check("surrounding whitespace is forgiven", (await S.resolveColonyName("  Ashfall "))?.accountId === "alice");
check("a PREFIX is not a hit (no search, no autocomplete)", (await S.resolveColonyName("Ashf")) === null);
check("a SUBSTRING is not a hit", (await S.resolveColonyName("hfal")) === null);
check("a typo is not a near-miss with a suggestion", (await S.resolveColonyName("Ashfal")) === null);
check("an empty or whitespace name resolves to nothing", (await S.resolveColonyName("   ")) === null && (await S.resolveColonyName("")) === null);
check("a non-string cannot be resolved", S.resolveColony(42 as unknown, []) === null && S.resolveColony(null, []) === null && S.resolveColony(undefined, []) === null);
check("an over-long name is refused before any comparison (the cap)", (await S.resolveColonyName("z".repeat(33))) === null && (await S.resolveColonyName("z".repeat(32))) === null);
const dup = await makeColony("dup", "Ashfall", now - 10_000);
check("two colonies sharing a display name resolve to NOTHING rather than a guess at a stranger", (await S.resolveColonyName("Ashfall")) === null);
check("the resolution is column-exact: the accepter is the name, the answer is the account", (await S.resolveColonyName("Bright Harbor"))?.accountId === "bob");
void dup;

// ───────────────────────────────────────────────────────────────────────────
section("7 · UNREAD SEMANTICS (D11: World and Covenant are NEVER counted)");
const worldCount = T.unreadBySurface({
  messages: [
    { id: "w1", channel: WORLD, accountId: "alice", colonyName: "Ashfall", lang: "fa", body: "x", createdAt: now },
    { id: "w2", channel: T.COVENANT_CHANNEL, accountId: "alice", colonyName: "Ashfall", lang: "fa", body: "y", createdAt: now },
  ],
  letters: [],
  reads: [],
  threadIds: [],
  roomIds: [],
  me: "bob",
});
check("a WORLD message from someone else is never unread", worldCount.world === 0);
check("a COVENANT message is never unread either", worldCount.covenant === 0);
check("the rule is structural, not incidental — only three surfaces may count", T.surfaceCountsUnread("personal") && T.surfaceCountsUnread("rooms") && T.surfaceCountsUnread("mail") && !T.surfaceCountsUnread("world") && !T.surfaceCountsUnread("covenant"));
check("the counted set is exactly Personal · Rooms · Mail", T.COUNTED_SURFACES.join(",") === "personal,rooms,mail");
const withThread = T.unreadBySurface({
  messages: [
    { id: "p1", channel: T.personalChannel("th1"), accountId: "alice", colonyName: "Ashfall", lang: "fa", body: "in a thread", createdAt: now },
    { id: "p2", channel: T.personalChannel("th1"), accountId: "bob", colonyName: "Bright Harbor", lang: "en", body: "my own line", createdAt: now },
    { id: "p3", channel: T.personalChannel("other"), accountId: "alice", colonyName: "Ashfall", lang: "fa", body: "someone else's thread", createdAt: now },
    { id: "r1", channel: T.roomChannel("joined"), accountId: "alice", colonyName: "Ashfall", lang: "fa", body: "in a joined room", createdAt: now },
    { id: "r2", channel: T.roomChannel("not-joined"), accountId: "alice", colonyName: "Ashfall", lang: "fa", body: "in a room I never joined", createdAt: now },
  ],
  letters: [
    { id: "l1", fromAccount: "alice", fromName: "Ashfall", toAccount: "bob", subject: "s", body: "b", lang: "fa", createdAt: now, readAt: null },
    { id: "l2", fromAccount: "alice", fromName: "Ashfall", toAccount: "bob", subject: "s", body: "b", lang: "fa", createdAt: now, readAt: now },
    { id: "l3", fromAccount: "alice", fromName: "Ashfall", toAccount: "carol", subject: "s", body: "b", lang: "fa", createdAt: now, readAt: null },
  ],
  reads: [],
  threadIds: ["th1"],
  roomIds: ["joined"],
  me: "bob",
});
check("a thread I am in counts", withThread.personal === 1);
check("my OWN line in that thread does not count", withThread.personal !== 2);
check("a thread I am not in does not count (and cannot leak)", withThread.personal === 1);
check("a joined room counts", withThread.rooms === 1);
check("a room I never joined does not count", withThread.rooms === 1);
check("unread mail counts; already-read mail does not; another colony's mail never does", withThread.mail === 1);
const readClear = T.unreadBySurface({
  messages: [{ id: "p1", channel: T.personalChannel("th1"), accountId: "alice", colonyName: "Ashfall", lang: "fa", body: "x", createdAt: now - 10 }],
  letters: [],
  reads: [{ accountId: "bob", channel: T.personalChannel("th1"), lastReadAt: now }],
  threadIds: ["th1"],
  roomIds: [],
  me: "bob",
});
check("a read mark clears the count", readClear.personal === 0);
const chip = T.unreadChip({ world: 9, covenant: 9, rooms: 4, personal: 0, mail: 2 });
check("the dock's ONE chip follows Personal → Mail → Rooms, and can never show World/Covenant", chip.surface === "mail" && chip.n === 2 && T.UNREAD_PRIORITY.join(",") === "personal,mail,rooms");
check("nothing unread is a real 0, not an absence", T.unreadChip({ world: 0, covenant: 0, rooms: 0, personal: 0, mail: 0 }).surface === null);
const sync = await S.chatSync({ token: bob.token });
check("chatSync answers with the world feed", Array.isArray(sync.messages) && sync.messages.length === 200);
check("and with a full unread record", !!sync.unread && T.CHAT_SURFACES.every((s) => typeof sync.unread?.[s] === "number"));
check("World and Covenant come back 0 from the server even though the world is busy", sync.unread?.world === 0 && sync.unread?.covenant === 0);
check("chatSync refuses an unknown token", (await S.chatSync({ token: "nope" })).signedOut === true);

// ───────────────────────────────────────────────────────────────────────────
section("8 · A DELETED ACCOUNT'S MESSAGES GO (D13)");
const gone = await makeColony("ghost", "Ghost Light", now - 5_000);
const keeper = await makeColony("keeper", "Keep Watch", now - 4_000);
const g1 = await S.sendWorldMessage({ token: gone.token, body: "ghost line one", lang: "en" });
const g2 = await S.sendWorldMessage({ token: keeper.token, body: "keeper line one", lang: "en" });
await store.appendChatThread({ id: "th-ghost", a: "ghost", b: "keeper", createdAt: now, closedAt: null });
await store.appendChatMessage({ id: "th-ghost-1", channel: T.personalChannel("th-ghost"), accountId: "ghost", colonyName: "Ghost Light", lang: "en", body: "inside the thread", createdAt: now });
const removed = await store.deleteChatByAccount("ghost");
check("the deletion reports what it removed", removed.messages === 2, JSON.stringify(removed));
const afterDelete = await store.loadChatMessages(WORLD, 10_000);
check("the deleted account's world line is GONE from the table", !afterDelete.some((m) => m.accountId === "ghost"));
check("HARD-deleted, not blanked: the text exists nowhere in the channel", !afterDelete.some((m) => m.body === "ghost line one" || (m.body === "" && m.accountId === "ghost")));
check("nothing anywhere in the store still holds the deleted account's body", !Object.values(JSON.parse(readFileSync(path.join(scratch, "data", "chat.json"), "utf8")) as Record<string, unknown>)
  .filter(Array.isArray)
  .flat()
  .some((row) => JSON.stringify(row).includes("ghost line one")));
check("the OTHER participant keeps their own line", afterDelete.some((m) => m.accountId === "keeper" && m.body === "keeper line one"));
const threadAfter = (await store.loadChatThreadsFor("keeper")).find((t) => t.id === "th-ghost");
check("the thread itself survives for the other participant (closed, never deleted)", !!threadAfter && threadAfter.closedAt !== null);
check("and the deleted account is gone from its own thread's message history", (await store.loadChatMessages(T.personalChannel("th-ghost"), 100)).every((m) => m.accountId !== "ghost"));
check("mail from the deleted account goes with it", (await store.loadMailFor(null)).every((l) => l.fromAccount !== "ghost" && l.toAccount !== "ghost"));
check("read marks and room memberships go with it", (await store.loadChatReads("ghost")).length === 0 && (await store.loadMyRoomMemberships("ghost")).length === 0);
const apiSrc = readFileSync(`${SITE}/src/game/api.ts`, "utf8");
const trashAt = apiSrc.indexOf("const trashAccountFn =");
const trashBody = apiSrc.slice(trashAt, apiSrc.indexOf("\n});", trashAt));
check("the REAL account-deletion path calls it (the API, not only the store)", trashBody.includes("deleteChatByAccount(accountId)"));
check("and the deletion is part of that path only — no other route can wipe a table", (apiSrc.match(/deleteChatByAccount\(/g) ?? []).length === 1);
void g1; void g2;

// ───────────────────────────────────────────────────────────────────────────
section("9 · THE API DOORS ARE ZOD-VALIDATED AND THE RULES LIVE SERVER-SIDE");
const apiChatSrc = readFileSync(`${SITE}/src/game/chat/chat-api.ts`, "utf8");
check("all three chat server functions exist", ["worldFeedFn", "sendWorldFn", "chatSyncFn"].every((n) => apiChatSrc.includes(`export const ${n} = createServerFn`)));
check("each one is zod-validated before it reaches a rule (3 of 3)", (apiChatSrc.match(/\.validator\(/g) ?? []).length === 3);
check("each one is a POST (a message is never a cacheable GET)", (apiChatSrc.match(/createServerFn\(\{ method: "POST" \}\)/g) ?? []).length === 3);
check("the limits are not re-implemented in the API layer — it calls chat-server's functions", apiChatSrc.includes("sendWorldMessage({") && apiChatSrc.includes("chatSync({") && !apiChatSrc.includes("CHAT_MIN_GAP_MS"));
check("the chat module imports nothing from the DEVICE record (chat UI state is not stored there)", !/dse\.device/.test(readFileSync(`${SITE}/src/game/chat/chat-types.ts`, "utf8") + readFileSync(`${SITE}/src/game/chat/chat-server.ts`, "utf8")));
const chatCodeNoComments = stripComments(
  apiChatSrc +
    storeSrc.slice(storeSrc.indexOf("chat + mail")) +
    readFileSync(`${SITE}/src/game/chat/chat-types.ts`, "utf8") +
    readFileSync(`${SITE}/src/game/chat/chat-server.ts`, "utf8")
);
check("no presence, typing indicator, read receipt or last-seen exists in the chat modules' CODE", !/presence|typing|lastSeen|last_seen|readReceipt|deliveredAt|delivered_at/i.test(chatCodeNoComments));
check("and none of the six tables has a column for one (D4)", !/presence|typing|last_seen|read_receipt/.test(stripComments(storeSrc.slice(storeSrc.indexOf("chat_messages"), storeSrc.indexOf("mail_letters") + 400))));

console.log(`\n${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
