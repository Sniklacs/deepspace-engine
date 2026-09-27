// format.ts — the ONE place the app formats a number, a time, a date or a DURATION.
//
// WHY A MODULE AND NOT `toLocaleString()` AT THE CALL SITE (chat-mail-spec §3.6
// rule 5): the shipped catalogue forbids Persian-Indic digits, and `Intl` will
// PRODUCE them for `fa` unless the numbering system is pinned. So every formatter
// here pins `-u-nu-latn` (and `numberingSystem: "latn"`), and a Persian player
// reads ۱۲:۳۴ as 12:34 — the same digits the rest of the game prints.
//
// Direction is NOT this module's business and is not decided here: a time is
// rendered as one isolated run by the CALLER (`<Bdi dir="ltr" className="num">`),
// because the first thing a right-to-left line does to "12:34" is reorder it.
//
// Everything is guarded: an unknown language tag or a hostile `Intl` falls back to
// English rather than throwing inside a render.
import type { T } from "./types";

/** The tag suffix that pins ASCII digits as the numbering system. */
const NU_LATN = "-u-nu-latn";

/** A tag that is safe to hand `Intl`, or the English one when it is not. */
function safeTag(lang: string): string {
  const candidate = `${lang}${NU_LATN}`;
  try {
    new Intl.DateTimeFormat(candidate);
    return candidate;
  } catch {
    return `en${NU_LATN}`;
  }
}

function dtf(lang: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(safeTag(lang), { ...options, numberingSystem: "latn" });
  } catch {
    return new Intl.DateTimeFormat(`en${NU_LATN}`, { ...options, numberingSystem: "latn" });
  }
}

/** A clock time, e.g. `14:05`. Western digits, always. */
export function formatTime(lang: string, at: number): string {
  return dtf(lang, { hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}

/** A short calendar date, e.g. `26 Sep 2026` in the player's language. */
export function formatDate(lang: string, at: number): string {
  return dtf(lang, { day: "numeric", month: "short", year: "numeric" }).format(at);
}

/** A grouped number, e.g. `1,204`. Never a Persian-Indic digit. */
export function formatNumber(lang: string, n: number): string {
  try {
    return new Intl.NumberFormat(`${lang}${NU_LATN}`, { numberingSystem: "latn" }).format(n);
  } catch {
    return new Intl.NumberFormat(`en${NU_LATN}`, { numberingSystem: "latn" }).format(n);
  }
}

/** The calendar day a timestamp belongs to, as a sortable local key. */
export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** How many whole calendar days ago `at` was, measured from `now` (0 = today). */
export function daysAgo(now: number, at: number): number {
  const a = new Date(dayKey(at)).getTime();
  const b = new Date(dayKey(now)).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * A DURATION, in the player's language, at DAY SCALE — the ONE duration
 * formatter. Every "returns in…", "…left" and "Forging —" reads this function.
 *
 * WHY IT LIVES HERE (2026-09-26/27, THE RE-TIME): under the ratified ladder a
 * single exploration run runs for 4 h at the rim and 168 h at the deepest rung,
 * so a minutes-only formatter printed a week as `10080m 0s`. Research and
 * deployment timers are rung-scaled too. A duration therefore needs DAYS, and
 * it needs them in five languages — the units are catalogue keys
 * (`dur.day|hour|minute|second`, translated in all five files in the same
 * commit), never an English suffix glued on at a call site.
 *
 * WHAT IT IS NOT: it never reads a clock. `ms` is always a remaining-time
 * arithmetic on `startedAt + durationMs` from the server's own state — there is
 * no `now − <something we remembered>` anywhere in this file, and a wrong
 * device clock cannot move a timer.
 *
 * SHAPE: hours-and-minutes, then minutes-and-seconds, then seconds; and once a
 * day is on the clock the seconds are dropped (nobody needs a 168 h timer to the
 * second). The digits go through `formatNumber`, so they are western ones even
 * in Persian. Direction is the CALLER's business, not this module's: render the
 * result inside `<Bdi dir="ltr">` — the first thing a right-to-left line does to
 * "3d 4h" is reorder it.
 */
export function fmtDuration(t: T, ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  const n = (v: number) => formatNumber(t.lang ?? "en", v);
  if (d > 0) return t("dur.day", { d: n(d), h: n(h) });
  if (h > 0) return t("dur.hour", { h: n(h), m: n(m) });
  if (m > 0) return t("dur.minute", { m: n(m), s: n(s) });
  return t("dur.second", { s: n(s) });
}
