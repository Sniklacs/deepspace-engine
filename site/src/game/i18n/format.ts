// format.ts — the ONE place chat formats a number, a time or a date.
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
