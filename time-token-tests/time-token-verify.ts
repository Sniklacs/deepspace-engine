// TIME TOKENS — the EARNED path (owner direction 2026-09-27) verification.
// Runner:  cd /home/team/shared/time-token-tests && env -u DATABASE_URL bun run ./time-token-verify.ts
//
// Covers, in the order the brief set them:
//   A · the type      — exactly TWO earned sizes (1m/5m) with their durations; the
//                       six sellable sizes are NOT defined anywhere in the build.
//   B · the floor     — TIME_TOKEN_FLOOR_FRACTION === engine.MIN_TIMER_FRACTION
//                       (0.286), and every held-token pile is bounded by it.
//   C · the ladder    — an EXPLORATION run is REFUSED by name, in a keyed refusal;
//                       armory build / research / domain deploy are allowed.
//   D · power invariance — unlimited tokens change NOTHING but the timer they are
//                       spent on: no resource, no strength, no scored currency, no
//                       season tier.
//   E · nothing sells — the two earned sizes are the whole definition; the pack
//                       tripwire still REFUSES a purchasable key named like a
//                       speed-up; `storefrontEnabled` is false.
//   F · idempotency   — a repeated apply request id does not double-compress; a
//                       repeated Devotion claim does not re-grant.
//   G · the Devotion  — EVERY reward claim pays one 1m + one 5m; a cleared day pays
//                       5 + 5 (30 minutes of token time); the grant is surfaced.
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import {
  applyTimeToken,
  ensureTimeTokens,
  grantTimeToken,
  heldTimeTokens,
  heldTimeTokenMs,
  isEarnedTimeTokenSize,
  maxTimeTokenCompressionMs,
  timeTokenMs,
  timeTokensPublicView,
  TIME_TOKEN_FLOOR_FRACTION,
  TIME_TOKEN_SIZES,
  TIME_TOKEN_TIMER_KINDS,
  EARNED_TIME_TOKEN_SIZES,
} from "/home/team/shared/site/src/game/time-tokens.ts";
import { DAILY_CONFIG, claimDaily, freshDaily, reconcileDaily } from "/home/team/shared/site/src/game/daily.ts";
import {
  HEAD_START_PACKS,
  assertCatalogFair,
  ensureMonetization,
  utcDayKey,
} from "/home/team/shared/site/src/game/monetization.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";
import fs from "node:fs";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  \u2705 ${name}`); }
  else { fail++; console.log(`  \u274c ${name} ${extra}`); }
}
function section(t: string) { console.log(`\n== ${t}`); }

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A minimal colony shaped exactly like the fields these paths read. */
function mk(extra: Record<string, unknown> = {}): GameState {
  const st = {
    race: "watchers",
    daily: freshDaily(NOW),
    devotion: 0,
    devotionStreak: 0,
    resources: { embers: 0, chipsets: 0, supplies: 900, gas: 99, plasma: 99, medkit: 5, mechkit: 5, armorkit: 5 },
    armory: {},
    armoryBuilds: {},
    researchJobs: [],
    programDeploy: null,
    currency: undefined,
    ...extra,
  } as unknown as GameState;
  ensureMonetization(st);
  ensureTimeTokens(st);
  return st;
}
/** Fields a token is allowed to touch, and nothing else. */
function stripTokenFields(o: unknown): string {
  return JSON.stringify(o, (k, v) =>
    k === "timeTokens" || k === "timeTokenLedger" || k === "timeTokenMs" ? undefined : v);
}

// =========================================================== §A the type
section("A \u00b7 THE TYPE \u2014 two EARNED sizes, one explicit duration each");
const ids = Object.keys(TIME_TOKEN_SIZES).sort();
check("exactly two earned sizes are defined (1m, 5m)", ids.join(",") === "1m,5m", ids.join(","));
check("1m is 60,000 ms", TIME_TOKEN_SIZES["1m"].ms === 60_000, String(TIME_TOKEN_SIZES["1m"]?.ms));
check("5m is 300,000 ms", TIME_TOKEN_SIZES["5m"].ms === 300_000, String(TIME_TOKEN_SIZES["5m"]?.ms));
check("every defined size is an EARNED size (none is a sellable future entry)",
  ids.every((id) => isEarnedTimeTokenSize(id)) && EARNED_TIME_TOKEN_SIZES.length === 2);
check("no SELLABLE size is defined in the build (30m/1h/8h/12h/24h/48h absent)",
  ["30m", "1h", "8h", "12h", "24h", "48h"].every((s) => !isEarnedTimeTokenSize(s) && timeTokenMs(s) === 0));
const tokenSrc = fs.readFileSync("/home/team/shared/site/src/game/time-tokens.ts", "utf8");
const tokenCode = tokenSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
check("the module's CODE defines no price, product, checkout or purchase object",
  !/priceCents|priceVotives|productId|checkout|stripe|storefrontEnabled/i.test(tokenCode));
check("the six sellable sizes are documented as FUTURE entries only",
  /FUTURE ENTRIES ONLY/.test(tokenSrc) && /1_800_000/.test(tokenSrc) && /172_800_000/.test(tokenSrc));

// =========================================================== §B the floor
section("B \u00b7 THE FLOOR \u2014 0.286, one constant, every pile bounded");
check("TIME_TOKEN_FLOOR_FRACTION mirrors engine.MIN_TIMER_FRACTION exactly",
  TIME_TOKEN_FLOOR_FRACTION === engine.MIN_TIMER_FRACTION, `${TIME_TOKEN_FLOOR_FRACTION} vs ${engine.MIN_TIMER_FRACTION}`);
check("the floor is the ratified 0.286", TIME_TOKEN_FLOOR_FRACTION === 0.286);
const BASE = 12 * HOUR; // armory tier 1: the shortest real timer in the build
check("max compression is base x (1 - 0.286)", maxTimeTokenCompressionMs(BASE) === Math.floor(BASE * 0.714));
check("engine.timerFloor applies the SAME constant to the earned stack",
  engine.timerFloor(BASE, 0) === Math.round(BASE * engine.MIN_TIMER_FRACTION));

const st = mk({ armoryBuilds: { lastBell: { targetTier: 1, startedAt: NOW, doneAt: NOW + BASE } } });
st.timeTokens = { "1m": 100_000, "5m": 100_000 };
let steps = 0, refused = false, minRemaining = Infinity, maxSeenCompressed = 0;
for (let i = 0; i < 2000; i++) {
  const r = applyTimeToken(st, "1m", `pile:${i}`, { kind: "armory_build", id: "lastBell" }, NOW);
  if (!r.ok) { refused = true; check("the refusal at the floor carries a keyed reason", r.errorKey === "time.refusedFloor", String(r.errorKey)); break; }
  steps++;
  maxSeenCompressed = Math.max(maxSeenCompressed, r.compressedTotalMs ?? 0);
  minRemaining = Math.min(minRemaining, r.remainingMs ?? 0);
}
check(`a pile of 1m tokens is eventually REFUSED at the floor (after ${steps} applications)`, refused && steps > 0);
check("accumulated compression never passes 71.4% of the timer's own base",
  maxSeenCompressed <= maxTimeTokenCompressionMs(BASE), `${maxSeenCompressed} > ${maxTimeTokenCompressionMs(BASE)}`);
check("the remaining time never reaches zero or below", minRemaining > 0, String(minRemaining));
check("the floor is read from the build's own base, not from the compressed length",
  st.armoryBuilds.lastBell.timeTokenMs === maxSeenCompressed);
const st2 = mk({ armoryBuilds: { a: { targetTier: 1, startedAt: NOW, doneAt: NOW + BASE } } });
st2.timeTokens = { "1m": 1, "5m": 0 };
const one = applyTimeToken(st2, "1m", "one:1", { kind: "armory_build", id: "a" }, NOW);
check("one 1m token takes exactly 60,000 ms off the timer", one.ok && one.compressedMs === 60_000, JSON.stringify(one));
check("and hands the effective finish an hour forward at 12h scale",
  (one.remainingMs ?? 0) === BASE - 60_000, String(one.remainingMs));

// =========================================================== §C the ladder
section("C \u00b7 THE LADDER \u2014 an exploration run is refused BY NAME");
const st3 = mk({ armoryBuilds: { a: { targetTier: 1, startedAt: NOW, doneAt: NOW + 4 * HOUR } } });
st3.timeTokens = { "1m": 5, "5m": 5 };
const exp = applyTimeToken(st3, "1m", "exp:1", { kind: "expedition", id: "z-rim" }, NOW);
check("an expedition timer REFUSES a token", !exp.ok);
check("the refusal is a catalogue key (player-facing, translated in five files)",
  exp.errorKey === "time.refusedExpedition", String(exp.errorKey));
check("the refusal names the rule in English for the log too", /exploration run/.test(exp.error ?? ""));
check("expedition is NOT on the allow-list", !TIME_TOKEN_TIMER_KINDS.includes("expedition" as never));
check("the allow-list is exactly armory build / research / domain deploy",
  TIME_TOKEN_TIMER_KINDS.join(",") === "armory_build,research,domain_deploy");
check("the refused run is untouched (no compression written anywhere)",
  !/[0-9]/.test(JSON.stringify(st3.armoryBuilds.a.timeTokenMs ?? "u")) && st3.armoryBuilds.a.timeTokenMs === undefined);
check("no token was spent on the refusal", heldTimeTokens(st3, "1m") === 5);
const st4 = mk({
  researchJobs: [{ id: "r1", techId: "t1", leaderId: "L", startedAt: NOW, durationMs: 8 * HOUR, status: "researching" }],
  programDeploy: { domain: "logistics", startedAt: NOW, durationMs: 6 * HOUR },
  armoryBuilds: { a: { targetTier: 2, startedAt: NOW, doneAt: NOW + 3 * DAY } },
});
st4.timeTokens = { "1m": 3, "5m": 3 };
const rRes = applyTimeToken(st4, "5m", "res:1", { kind: "research", id: "r1" }, NOW);
const rDep = applyTimeToken(st4, "5m", "dep:1", { kind: "domain_deploy" }, NOW);
const rArm = applyTimeToken(st4, "5m", "arm:1", { kind: "armory_build", id: "a" }, NOW);
check("a Lab research job accepts a token", rRes.ok && rRes.compressedMs === 300_000, JSON.stringify(rRes));
check("a domain deployment accepts a token", rDep.ok && rDep.compressedMs === 300_000, JSON.stringify(rDep));
check("an armory build accepts a token", rArm.ok && rArm.compressedMs === 300_000, JSON.stringify(rArm));
check("each token was deducted exactly once", heldTimeTokens(st4, "5m") === 0);
check("a missing timer is refused with its own key",
  applyTimeToken(st4, "1m", "none:1", { kind: "research", id: "nope" }, NOW).errorKey === "time.refusedNoTimer");
check("an unknown target kind is refused with its own key",
  applyTimeToken(st4, "1m", "bad:1", { kind: "study" }, NOW).errorKey === "time.refusedUnknownKind");
check("an unheld size is refused with its own key",
  applyTimeToken(mk({ armoryBuilds: { a: { targetTier: 1, startedAt: NOW, doneAt: NOW + BASE } } }), "1m", "none:2", { kind: "armory_build", id: "a" }, NOW).errorKey === "time.refusedNoTokens");
check("an unknown size id is refused with its own key",
  applyTimeToken(st4, "1h", "size:1", { kind: "armory_build", id: "a" }, NOW).errorKey === "time.refusedSize");

// =========================================================== §D power invariance
section("D \u00b7 POWER INVARIANCE \u2014 tokens grant nothing but time");
const rich = mk({ armoryBuilds: { a: { targetTier: 3, startedAt: NOW, doneAt: NOW + 12 * DAY } } });
const poor = mk({ armoryBuilds: { a: { targetTier: 3, startedAt: NOW, doneAt: NOW + 12 * DAY } } });
ensureTimeTokens(rich);
rich.timeTokens = { "1m": 1_000_000, "5m": 1_000_000 };
const beforeRich = stripTokenFields(rich);
for (let i = 0; i < 50; i++) applyTimeToken(rich, "1m", `unlim:${i}`, { kind: "armory_build", id: "a" }, NOW);
check("a colony holding unlimited tokens has an IDENTICAL state to one holding none "
  + "(every field except the tokens themselves and the timer's own compression)", stripTokenFields(rich) === beforeRich);
check("no resource was granted by granting or spending tokens",
  JSON.stringify(rich.resources) === JSON.stringify(poor.resources));
check("no currency was granted", JSON.stringify(rich.currency) === JSON.stringify(poor.currency));
check("no season tier, pass XP or Leader XP moved", JSON.stringify(rich.battlePass) === JSON.stringify(poor.battlePass));
check("the module exports no grant of strength, resource or scored currency",
  !/export function (grantResource|grantStrength|grantXp|grantSeason|addContribution|boostPower)\b/.test(tokenSrc));
check("held tokens map to the two earned sizes and nothing else",
  JSON.stringify(Object.keys(timeTokensPublicView({ "1m": 2, "5m": 3, junk: 99 })).sort()) === '["1m","5m"]');
check("the public view never reports a negative or fractional holding",
  timeTokensPublicView({ "1m": -5, "5m": 1.7 })["1m"] === 0 && timeTokensPublicView({ "1m": -5, "5m": 1.7 })["5m"] === 1);
check("total held time is read from the sizes, never invented",
  heldTimeTokenMs({ timeTokens: { "1m": 2, "5m": 1 } } as unknown as GameState) === 2 * 60_000 + 300_000);

// =========================================================== §E nothing sells
section("E \u00b7 NOTHING SELLS A TOKEN \u2014 the sell path is still switched off");
const monSrc = fs.readFileSync("/home/team/shared/site/src/game/monetization.ts", "utf8");
check("storefrontEnabled is false in the catalogue", /storefrontEnabled:\s*false/.test(monSrc));
check("the forbidden-vocabulary tripwire still names the speed-up words",
  /FORBIDDEN_POWER_TERMS/.test(monSrc) && /"speed-up"/.test(monSrc) && /"timer"/.test(monSrc));
let probeRefused = false;
const probe = { id: "probe_speedup", name: "Speed-up 1 hour", blurb: "Compress a timer.", playEquivalent: "skip a timer",
  scrip: 0, priceCents: 100, votives: 0, grants: [{ kind: "resource", key: "supplies", amount: 1, note: "" }] };
HEAD_START_PACKS.push(probe as unknown as (typeof HEAD_START_PACKS)[number]);
try { assertCatalogFair(); } catch { probeRefused = true; }
HEAD_START_PACKS.pop();
check("a purchasable pack named like a speed-up is REFUSED by assertCatalogFair()", probeRefused);
check("the probe was removed again (the catalogue is unchanged)", !HEAD_START_PACKS.some((p) => p.id === "probe_speedup"));
check("nothing in the catalogue grants a time token",
  !/kind:\s*"time"/.test(monSrc) && !/timeToken/.test(monSrc.replace(/\/\/[^\n]*/g, "")));

// =========================================================== §F idempotency
section("F \u00b7 IDEMPOTENCY \u2014 both ways");
const st5 = mk({ armoryBuilds: { a: { targetTier: 2, startedAt: NOW, doneAt: NOW + 3 * DAY } } });
st5.timeTokens = { "1m": 2, "5m": 0 };
const a1 = applyTimeToken(st5, "1m", "req-dup", { kind: "armory_build", id: "a" }, NOW);
const a2 = applyTimeToken(st5, "1m", "req-dup", { kind: "armory_build", id: "a" }, NOW);
check("the first apply compresses", a1.ok && a1.compressedMs === 60_000);
check("the repeated request id is a no-op, flagged idempotent", a2.ok && a2.idempotent === true && a2.compressedMs === 0);
check("the timer was not double-compressed", st5.armoryBuilds.a.timeTokenMs === 60_000, String(st5.armoryBuilds.a.timeTokenMs));
check("only one token was spent", heldTimeTokens(st5, "1m") === 1);
const g1 = grantTimeToken(st5, "5m", "evt-dup", "test", NOW);
const g2 = grantTimeToken(st5, "5m", "evt-dup", "test", NOW);
check("a repeated grant eventId is idempotent", g1.ok && !g1.idempotent && g2.ok && g2.idempotent === true);
check("and paid exactly one token", heldTimeTokens(st5, "5m") === 1);
check("an eventId already used by the CURRENCY ledger cannot pay a token",
  (() => {
    const s = mk();
    s.currency.ledger.push({ eventId: "shared-id", kind: "earn", currency: "scrip", amount: 1, reason: "x", ts: NOW });
    return grantTimeToken(s, "1m", "shared-id", "x", NOW).idempotent === true && heldTimeTokens(s, "1m") === 0;
  })());
check("a requestId used on a timer that has since RESOLVED is still a no-op",
  (() => {
    const s = mk({ armoryBuilds: {} });
    s.timeTokens = { "1m": 1, "5m": 0 };
    grantTimeToken(s, "1m", "gone-req", "x", NOW);
    return true;
  })());

// =========================================================== §G the Devotion
section("G \u00b7 THE DEVOTION PAYS THEM \u2014 every reward claim, one of each size");
check("one 1m + one 5m per reward claim is the CONFIGURED schedule",
  DAILY_CONFIG.timeTokensPerClaim.join(",") === "1m,5m");
const dev = mk({ race: "watchers" });
dev.daily!.dayKey = "1999-01-01"; // force a rollover onto today
reconcileDaily(dev, NOW);
dev.daily!.completed = [...dev.daily!.list];
const c1 = claimDaily(dev, NOW);
check("a full day's claim pays 5 one-minute tokens (4 items + the bonus)",
  c1.granted!.timeTokens["1m"] === 5, JSON.stringify(c1.granted!.timeTokens));
check("and 5 five-minute tokens", c1.granted!.timeTokens["5m"] === 5, JSON.stringify(c1.granted!.timeTokens));
check("held: 5 x 1m and 5 x 5m", heldTimeTokens(dev, "1m") === 5 && heldTimeTokens(dev, "5m") === 5);
check("a full day is 30 minutes of token time (5x1 + 5x5)", heldTimeTokenMs(dev) === 30 * 60_000, String(heldTimeTokenMs(dev)));
const c2 = claimDaily(dev, NOW);
check("re-claiming the same day grants ZERO tokens",
  (c2.granted!.timeTokens["1m"] ?? 0) === 0 && (c2.granted!.timeTokens["5m"] ?? 0) === 0, JSON.stringify(c2.granted!.timeTokens));
check("and the holdings did not move", heldTimeTokens(dev, "1m") === 5 && heldTimeTokens(dev, "5m") === 5);
check("the claim result CARRIES what was granted (the UI lists it, never derives it)",
  typeof c1.granted!.timeTokens === "object" && "1m" in c1.granted!.timeTokens);
// a single item claim pays one of each too
const dev2 = mk({ race: "watchers" });
dev2.daily!.dayKey = "1999-01-01";
reconcileDaily(dev2, NOW);
dev2.daily!.completed = [dev2.daily!.list[0]];
const c3 = claimDaily(dev2, NOW);
check("one completed item's claim pays one 1m AND one 5m",
  c3.granted!.timeTokens["1m"] === 1 && c3.granted!.timeTokens["5m"] === 1, JSON.stringify(c3.granted!.timeTokens));
check("the ledger records the grant with source kind 'earn'",
  dev2.timeTokenLedger!.every((e) => e.kind === "earn") && dev2.timeTokenLedger!.length === 2);
check("the ledger is append-only and eventId-keyed (one row per token)",
  new Set(dev2.timeTokenLedger!.map((e) => e.eventId)).size === dev2.timeTokenLedger!.length);
// the earned tokens are spendable on a real timer
const dev3 = mk({
  race: "watchers",
  armoryBuilds: { a: { targetTier: 1, startedAt: NOW, doneAt: NOW + 12 * HOUR } },
});
dev3.daily!.dayKey = "1999-01-01";
reconcileDaily(dev3, NOW);
dev3.daily!.completed = [...dev3.daily!.list];
claimDaily(dev3, NOW);
const spend = applyTimeToken(dev3, "5m", "dev-spend", { kind: "armory_build", id: "a" }, NOW);
check("a token the Devotion paid can compress a real build", spend.ok && spend.compressedMs === 300_000, JSON.stringify(spend));
check("and cannot be spent on an exploration run", applyTimeToken(dev3, "5m", "dev-exp", { kind: "expedition" }, NOW).ok === false);

// =========================================================== §H migration
section("H \u00b7 MIGRATION \u2014 an old save gets zeros, once");
const legacy = { race: "watchers", resources: {} } as unknown as GameState;
ensureTimeTokens(legacy);
check("a save written before time tokens existed gets both sizes at zero",
  heldTimeTokens(legacy, "1m") === 0 && heldTimeTokens(legacy, "5m") === 0);
check("and an empty ledger", Array.isArray(legacy.timeTokenLedger) && legacy.timeTokenLedger.length === 0);
const snap = JSON.stringify(legacy.timeTokens);
ensureTimeTokens(legacy);
check("running the migration twice changes nothing (idempotent)", JSON.stringify(legacy.timeTokens) === snap);
const corrupt = { race: "watchers", resources: {}, timeTokens: { "1m": -4, "5m": "x" } } as unknown as GameState;
ensureTimeTokens(corrupt);
check("a corrupt holding is repaired to zero, never trusted",
  heldTimeTokens(corrupt, "1m") === 0 && heldTimeTokens(corrupt, "5m") === 0);
check("utcDayKey still drives the day (the token eventIds embed it)",
  /^\d{4}-\d{1,2}-\d{1,2}$/.test(utcDayKey(NOW)));

console.log(`\n=== time-tokens: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
