// split.ts — THE RENDER-TIME SPLITTER: a translated value whose numerals are
// their own isolated run, in both spaces the app renders into.
//
// THE DEFECT THIS CLOSES (owner-visible, shipped): `cradle.devotionStreak` is
// "{n}-day streak", so the value itself owns where the numeral sits — and a
// numeral that arrives INSIDE a translated value is not a node, cannot be
// wrapped, and is not even grouped (translate.ts interpolates with `String()`).
// On a Persian line, `7-day streak` set as one run re-orders: the digits and the
// sentence fight for the base direction. `game/i18n/format.ts` pins the DIGITS
// but it is not this module's business to know where in a value a numeral lands.
//
// WHAT IT DOES, EXACTLY. Resolve the value for `lang` (same fallback chain as
// `t`: own file → English → engine seam → call-site literal → humanized key),
// then cut the sentence into segments:
//
//   • a `number` param        → `formatNumber(lang, n)` — the ONE formatter, in
//                               every language, so the digits are ASCII-pinned
//   • a literal digit run in the value, or a numeric-shaped `string` param
//                             → isolated AS A WHOLE (`"3d 4h"`, `"26 Sep 2026"`,
//                               `"14:05"`, `"3m 4s"`) — it is already a
//                               formatted run and splitting it apart would
//                               re-order it
//   • every other run, and a param that is a name or a word
//                             → plain text, untouched
//
// A segment with `num: true` MUST be isolated by the caller, and there is
// exactly one spelling of that in each space (`isolateLtr` in format.ts): node
// space renders `<Bdi dir="ltr" className="num">`,
// string space wraps the same text in U+2066 LRI … U+2069 PDI. `joinValue` below
// is the string-space join, so a `title=` attribute and a `<span>` get the same
// treatment instead of two half-versions of it.
//
// WHAT IT IS NOT, and must never become: `<Bdi dir="ltr">` around the WHOLE
// sentence. That forces an RTL sentence to an LTR base direction — a NEW bug,
// and §13d-2(b) of i18n-verify fails any call site that does it. Isolation
// belongs inside the value, on the numeral run only.
//
// ADDITIVE BY CONSTRUCTION: nothing here changes `t()` or any existing call
// site. A component opts in by rendering through `splitValue` (or the
// `<SplitValue>` wrapper); a `t(...)` call that nobody touches behaves exactly
// as it shipped.
import { formatNumber, isolateLtr } from "./format";
import { rawTranslate } from "./translate";
import type { TParams } from "./types";

/** One run of a resolved value: `num` segments are the caller's to isolate. */
export type ValueSegment = {
  text: string;
  /** true → isolate (`<Bdi dir="ltr" className="num">` / LRI…PDI) */
  num: boolean;
};

/** `{name}` placeholders — the same shape `translate.interpolate` substitutes. */
const PLACEHOLDER = /\{(\w+)\}/g;
/** a maximal run of ASCII digits inside the value's own prose */
const DIGIT_RUN = /\d+/g;
/** "is this string already a numeral-bearing run?" (`"3d 4h"`, `"26 Sep 2026"`) */
const HAS_DIGIT = /\d/;

/**
 * Split one translated value into segments. `lang` is the language in force,
 * `key` the catalogue key, `params` the `{name}` values, and `source` the
 * call-site English literal `t(key, source, params)` also takes.
 *
 * Purely additive: this is a NEW door into the same catalogue, and `t()` keeps
 * returning a string for every existing call site.
 */
export function splitValue(
  lang: string,
  key: string,
  params?: TParams,
  source?: string,
): ValueSegment[] {
  // Resolve WITHOUT params first: the placeholders are ours to place, because
  // the whole point is that a numeral gets the formatter and its own run.
  const template = rawTranslate(lang, key, source, undefined);
  const out: ValueSegment[] = [];
  const push = (text: string, num: boolean) => {
    if (!text) return;
    const last = out[out.length - 1];
    // adjacent runs of the same kind are one segment, so the rendered sentence
    // is as few nodes as the sentence allows
    if (last && last.num === num) last.text += text;
    else out.push({ text, num });
  };
  /** a stretch of the value's own prose — its literal digit runs isolated */
  const pushProse = (chunk: string) => {
    let at = 0;
    for (const d of chunk.matchAll(DIGIT_RUN)) {
      push(chunk.slice(at, d.index), false);
      push(formatNumber(lang, Number(d[0])), true);
      at = d.index + d[0].length;
    }
    push(chunk.slice(at), false);
  };

  let at = 0;
  PLACEHOLDER.lastIndex = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    pushProse(template.slice(at, m.index));
    const name = m[1];
    const value =
      params && Object.prototype.hasOwnProperty.call(params, name) ? params[name] : undefined;
    if (value === undefined) push(m[0], false); // a missing param keeps its placeholder
    else if (typeof value === "number") push(formatNumber(lang, value), true);
    else if (HAS_DIGIT.test(value)) push(value, true); // already a run: isolate whole
    else push(value, false);
    at = m.index + m[0].length;
  }
  pushProse(template.slice(at));
  return out;
}

/**
 * The same split, joined back into ONE string for a string-only sink — a
 * `title=`, an `aria-label`, a toast. Every `num` segment comes out wrapped in
 * U+2066 LRI … U+2069 PDI (`isolateLtr`), which is what `<bdi dir="ltr">` means
 * where there is no element to write.
 */
export function joinValue(lang: string, key: string, params?: TParams, source?: string): string {
  return splitValue(lang, key, params, source)
    .map((s) => (s.num ? isolateLtr(s.text) : s.text))
    .join("");
}
