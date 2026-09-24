// SPEAKABLE — the one pure text transform between the written line and the
// synthesiser. §4 of design/prologue-voice-direction.md, implemented whole.
//
// THE CAPTION CONTRACT: this module never touches what the player reads. The
// plate renders `cue.line` verbatim (asserted by the harness); everything here
// happens on a COPY of that string, on its way to `speak()`.
//
//   speakable(line, { direction, scene }) → SpokenPiece[]
//
// What it does, in the sheet's own order:
//   §4.1 markup strip — `**bold**` / `*italic*` markers out (the emphasis they
//        carry becomes §4.7), stage directions in parentheses out, `(beat)`
//        becomes a real pause (§3.4 #1), a leading speaker label out.
//   §4.2 numerals — a deterministic table, no Intl, no locale. Bare digits in
//        the SPOKEN text are a build failure (the harness lints for them).
//   §4.3 punctuation — em dash → comma, ranges → "to", quotes dropped,
//        ellipsis → a comma AND a real 320 ms split.
//   §4.4 the lexicon — coined names only, never a real English word.
//   §4.6 case — an ALL-CAPS line is spoken sentence-cased (some engines spell
//        all-caps runs out letter by letter); the caption keeps the caps.
//   §4.7 emphasis — an emphasised clause becomes its own utterance at
//        rate×0.94, pitch×1.04 with a 90 ms gap either side.
//   §3.4 gaps — every pause is SCHEDULING: this module returns the gaps, the
//        engine owns the timer.
//   §3.5 the cap — no utterance exceeds 180 characters (~12 s at the modelled
//        rate), split at the nearest sentence end, else the last comma before
//        the cap, else the last space, with a 90 ms gap between pieces.
//
// PURE (asserted): no DOM, no React, no window/document, no Math.random, no
// Date.now(), no store/auth/engine import, no module-level mutable state.
import {
  ORDINALS,
  SPOKEN_RESPELLINGS,
  VOICE_CONFIG,
  VOICE_DIRECTIONS,
  numberToWords,
} from "./voice-direction";
import type { VoiceDirection } from "./voice-direction";

// marks that survive normalisation and are consumed by the splitter, so a
// written beat is a scheduled silence rather than a mark the voice may skip
export const GAP_MARK = "\u0000"; // a written `(beat)`
export const HOLD_MARK = "\u0001"; // an ellipsis

export type PieceCause = "line" | "sentence" | "comma" | "cap" | "emphasis" | "ellipsis" | "beat";

export interface SpokenPiece {
  /** What the synthesiser says. Never a caption. */
  text: string;
  /** Silence the scheduler holds AFTER this piece before the next utterance of
   *  the same line (the last piece's value is the speaker's tail hold). */
  gapAfterMs: number;
  /** §4.7: the scheduled utterance runs at rate × this. */
  rateScale: number;
  /** §4.7: pitch × this. */
  pitchScale: number;
  /** Why this piece exists — harness evidence, never behaviour. */
  cause: PieceCause;
  /** 1-based position in the line. */
  index: number;
}

export interface SpeakableOptions {
  /** The speaker's direction (§1). Defaults to the Narrator's, so the function
   *  is total: every authored line can be spoken. */
  direction?: VoiceDirection;
  /** The scene id from §3.2 ("1.2", "2.4", …) — decides the `(beat)` length
   *  (Act I 320 ms / Act II 520 ms). */
  scene?: string;
}

/** Delen's comma hold (§1 "the stones are literal"). */
export const COMMA_SPLIT_GAP_MS = 220;

function beatGapFor(scene: string | undefined): number {
  return scene && /^[23]\./.test(scene) ? VOICE_CONFIG.gaps.beatActII : VOICE_CONFIG.gaps.beatActI;
}

// ---------------------------------------------------------------------------
// emphasis segmentation (§4.7) — the script's own markup, used
// ---------------------------------------------------------------------------
interface Part {
  text: string;
  emphasis: boolean;
}

/** Pull `*…*` / `**…**` clauses out of a line as their own parts. */
export function splitEmphasis(authored: string): Part[] {
  const parts: Part[] = [];
  const re = /\*+([^*]+)\*+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(authored)) !== null) {
    if (m.index > last) parts.push({ text: authored.slice(last, m.index), emphasis: false });
    parts.push({ text: m[1], emphasis: true });
    last = m.index + m[0].length;
  }
  if (last < authored.length) parts.push({ text: authored.slice(last), emphasis: false });
  return parts.length > 0 ? parts : [{ text: authored, emphasis: false }];
}

// ---------------------------------------------------------------------------
// §4.6 case
// ---------------------------------------------------------------------------
function sentenceCaseParts(parts: Part[]): void {
  const joined = parts.map((p) => p.text).join("");
  if (/[a-z]/.test(joined)) return; // not an all-caps run: leave the author alone
  let atSentenceStart = true;
  for (const part of parts) {
    let out = "";
    for (const ch of part.text.toLowerCase()) {
      if (atSentenceStart && /[a-z]/.test(ch)) {
        out += ch.toUpperCase();
        atSentenceStart = false;
      } else {
        out += ch;
        if (/[.!?]/.test(ch)) atSentenceStart = true;
        else if (atSentenceStart && /\S/.test(ch)) atSentenceStart = false;
      }
    }
    part.text = out;
  }
}

// ---------------------------------------------------------------------------
// §4.4 the lexicon
// ---------------------------------------------------------------------------
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Apply the respelling table (§4.4). Longest entry first so a compound is
 *  never half-matched; every match is word-bounded so "Kael" never hits
 *  "Kaelin" and "Codices" never hits a substring. */
export function applyLexicon(text: string): string {
  let out = text;
  for (const entry of SPOKEN_RESPELLINGS) {
    const re = new RegExp(`(?<![\\w-])${escapeRe(entry.authored)}(?![\\w-])`, "gi");
    out = out.replace(re, entry.spoken);
  }
  return out;
}

// ---------------------------------------------------------------------------
// §4.1 markup strip
// ---------------------------------------------------------------------------
const SPEAKER_LABEL = /^\s*(?:CHORUS|NARRATOR|ORACLE|KAEL|SEREV|VYRA|MIREN|DELEN)\s*:\s*/i;
/** A stage direction: lowercase words, commas, spaces — never a spoken clause. */
const STAGE_DIRECTION = /\([a-z0-9,'\-\s]+\)/g;

/** §4.1: the label, the stage directions and the emphasis markers come out; a
 *  written beat and an ellipsis become marks the splitter turns into silence. */
export function stripMarkup(text: string): string {
  return text
    .replace(SPEAKER_LABEL, "")
    .replace(/\.\.\.|…/g, HOLD_MARK)
    .replace(/\(\s*beat\s*\)/gi, GAP_MARK)
    .replace(STAGE_DIRECTION, "")
    .replace(/\*/g, "");
}

// ---------------------------------------------------------------------------
// §4.2 + §4.3 numerals and punctuation
// ---------------------------------------------------------------------------
const SYMBOLS: readonly (readonly [RegExp, string])[] = [
  [/\s&\s/g, " and "],
  [/\s\+\s/g, " plus "],
  [/\bFOB\b/g, "forward base"],
  [/\bvs\.?\b/gi, "versus"],
  [/%/g, " percent"],
];

/** Digits → words. Order matters: clock, decimals, ranges, ordinals, the level
 *  shorthand, then plain integers (with a thousands separator). */
export function normaliseNumbers(text: string): string {
  let s = text;
  // clock: 1:47 → one forty-seven
  s = s.replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h: string, mm: string) => `${numberToWords(+h)} ${numberToWords(+mm)}`);
  // decimal: 0.5 → zero point five
  s = s.replace(/\b(\d+)\.(\d+)\b/g, (_m, a: string, b: string) =>
    `${numberToWords(+a)} point ${[...b].map((d) => numberToWords(+d)).join(" ")}`,
  );
  // range / dash between numerals: 3–5 → three to five
  s = s.replace(/\b(\d[\d,]*)\s*[–—-]\s*(\d[\d,]*)\b/g, (_m, a: string, b: string) =>
    `${numberToWords(+a.replace(/,/g, ""))} to ${numberToWords(+b.replace(/,/g, ""))}`,
  );
  // ordinals: 1st → first
  s = s.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (m) => ORDINALS[m.toLowerCase()] ?? m);
  // the level shorthand: L10 → level ten
  s = s.replace(/\bL(\d+)\b/g, (_m, n: string) => `level ${numberToWords(+n)}`);
  // plain integers, with a thousands separator
  s = s.replace(/\b(\d[\d,]*)\b/g, (_m, n: string) => numberToWords(+n.replace(/,/g, "")));
  for (const [re, to] of SYMBOLS) s = s.replace(re, to);
  return s;
}

/** §4.3 — em dashes become the comma the voice already pauses on; quoting
 *  quotes come out (the authored commas carry the clause). The beat and hold
 *  marks survive: only the splitter consumes them. */
export function normalisePunctuation(text: string): string {
  const stash: string[] = [];
  const stashed = text.replace(new RegExp(`[${HOLD_MARK}${GAP_MARK}]`, "g"), (m) => {
    stash.push(m);
    return `\u0002${stash.length - 1}\u0002`;
  });
  const cleaned = stashed
    .replace(/\s*—+\s*/g, ", ")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,\s*,/g, ",")
    .trim();
  return cleaned.replace(/\u0002(\d+)\u0002/g, (_m, i: string) => stash[+i] as string);
}

/** §4 · THE TEXT TRANSFORM — idempotent, total, side-effect free. */
export function normaliseSpoken(authored: string): string {
  const parts = splitEmphasis(authored).map((p) => ({ text: stripMarkup(p.text), emphasis: p.emphasis }));
  sentenceCaseParts(parts);
  return normaliseSpokenParts(parts);
}

function normaliseSpokenParts(parts: readonly Part[]): string {
  // the marks are split points, not text: in the text-only form an ellipsis is
  // the comma it becomes and a written beat is simply a break in the words
  return parts
    .map((p) => normalisePunctuation(normaliseNumbers(applyLexicon(p.text))))
    .join(" ")
    .split(HOLD_MARK)
    .join(",")
    .split(GAP_MARK)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

// ---------------------------------------------------------------------------
// §3.5 the utterance cap + §3.4 the gaps → pieces
// ---------------------------------------------------------------------------
interface Draft {
  text: string;
  /** the silence the scheduler holds BEFORE this utterance */
  leadingGapMs: number;
  rateScale: number;
  pitchScale: number;
  cause: PieceCause;
}

function lastIndexOfSentenceEnd(window: string): number {
  for (let i = window.length - 1; i >= 0; i--) {
    if (/[.!?]/.test(window[i]) && (i === window.length - 1 || /\s/.test(window[i + 1]))) return i;
  }
  return -1;
}

function lastIndexOfComma(window: string): number {
  for (let i = window.length - 1; i >= 0; i--) if (window[i] === ",") return i;
  return -1;
}

/** §3.5 · cut a too-long utterance at ≤ maxUtteranceChars, never mid-word when
 *  a space exists. Each later piece is preceded by `gaps.split` (90 ms). */
export function capUtterance(text: string, max = VOICE_CONFIG.maxUtteranceChars): Draft[] {
  if (text.length <= max) return [{ text, leadingGapMs: 0, rateScale: 1, pitchScale: 1, cause: "line" }];
  const out: Draft[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const sentence = lastIndexOfSentenceEnd(window);
    const comma = lastIndexOfComma(window);
    const space = window.lastIndexOf(" ");
    const half = Math.floor(max / 2);
    let cut: number;
    let cause: PieceCause;
    if (sentence >= half) {
      cut = sentence + 1;
      cause = "sentence";
    } else if (comma >= half) {
      cut = comma + 1;
      cause = "comma";
    } else if (space > 0) {
      cut = space;
      cause = "cap";
    } else {
      cut = max;
      cause = "cap";
    }
    out.push({ text: rest.slice(0, cut).trim(), leadingGapMs: 0, rateScale: 1, pitchScale: 1, cause });
    rest = rest.slice(cut).trim();
  }
  out.push({ text: rest, leadingGapMs: 0, rateScale: 1, pitchScale: 1, cause: "cap" });
  out.forEach((d, i) => {
    if (i > 0) d.leadingGapMs = VOICE_CONFIG.gaps.split;
    if (i > 0 && d.cause === "cap") d.cause = "cap";
  });
  return out;
}

/** Delen's comma hold (§1): every comma ends an utterance, 220 ms apart. */
function commaSplit(text: string, dir: VoiceDirection): Draft[] {
  if (!dir.splitAtCommas || dir.neverSplit || !text.includes(",")) {
    return [{ text, leadingGapMs: 0, rateScale: 1, pitchScale: 1, cause: "line" }];
  }
  const pieces = text
    .split(/,\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return pieces.map((p, i) => ({
    text: i < pieces.length - 1 ? `${p},` : p,
    leadingGapMs: i === 0 ? 0 : COMMA_SPLIT_GAP_MS,
    rateScale: 1,
    pitchScale: 1,
    cause: (i < pieces.length - 1 ? "comma" : "line") as PieceCause,
  }));
}

/** Split one part's text at the authored holds: a written beat (§3.4 #1) and an
 *  ellipsis (§4.3) each become a real scheduled silence. */
function splitHolds(text: string, dir: VoiceDirection, beatGap: number): Draft[] {
  if (dir.neverSplit) {
    const flat = text.replace(new RegExp(HOLD_MARK, "g"), ",").replace(new RegExp(GAP_MARK, "g"), "");
    return [{ text: flat.replace(/\s+/g, " ").trim(), leadingGapMs: 0, rateScale: 1, pitchScale: 1, cause: "line" }];
  }
  const chunks = text.split(new RegExp(`([${HOLD_MARK}${GAP_MARK}])`));
  const out: Draft[] = [];
  let pendingGap = 0;
  let pendingCause: PieceCause = "line";
  let lastWasHold = false;
  for (const chunk of chunks) {
    if (chunk === HOLD_MARK) {
      pendingGap = VOICE_CONFIG.gaps.ellipsis;
      pendingCause = "ellipsis";
      lastWasHold = true;
      continue;
    }
    if (chunk === GAP_MARK) {
      pendingGap = beatGap;
      pendingCause = "beat";
      lastWasHold = false;
      continue;
    }
    const clean = chunk.replace(/\s+/g, " ").trim();
    if (clean.length === 0) continue;
    if (lastWasHold && out.length > 0) {
      out[out.length - 1].text = `${out[out.length - 1].text.replace(/,$/, "")},`;
    }
    out.push({
      text: clean,
      leadingGapMs: out.length === 0 ? 0 : pendingGap,
      rateScale: 1,
      pitchScale: 1,
      cause: out.length === 0 ? "line" : pendingCause,
    });
    pendingGap = 0;
    pendingCause = "line";
    lastWasHold = false;
  }
  return out;
}

/**
 * §4 · THE WHOLE TRANSFORM, one call. Returns the utterances to schedule, in
 * order, each with the silence that follows it. Total: a line that normalises
 * to nothing returns an empty array rather than throwing.
 */
export function speakable(authored: string, opts: SpeakableOptions = {}): SpokenPiece[] {
  if (typeof authored !== "string" || authored.trim().length === 0) return [];
  const dir = opts.direction ?? VOICE_DIRECTIONS.narrator;
  const beatGap = beatGapFor(opts.scene);

  const parts = splitEmphasis(authored).map((p) => ({ text: stripMarkup(p.text), emphasis: p.emphasis }));
  sentenceCaseParts(parts);

  const drafts: Draft[] = [];
  parts.forEach((part, i) => {
    const normalised = normalisePunctuation(normaliseNumbers(applyLexicon(part.text)));
    if (normalised.trim().length === 0) return;
    const emphasised = part.emphasis && !dir.neverSplit;
    const previousEmphasised = i > 0 && parts[i - 1].emphasis && !dir.neverSplit;
    // §4.7: 90 ms either side of an emphasised clause
    const partLeading = i === 0 ? 0 : emphasised || previousEmphasised ? VOICE_CONFIG.gaps.emphasis : 0;

    const own: Draft[] = [];
    for (const hold of splitHolds(normalised, dir, beatGap)) {
      const commaed = commaSplit(hold.text, dir);
      commaed.forEach((piece, pi) => {
        capUtterance(piece.text).forEach((c, ci) => {
          own.push({
            text: c.text,
            leadingGapMs:
              ci > 0
                ? VOICE_CONFIG.gaps.split
                : pi === 0
                  ? hold.leadingGapMs
                  : piece.leadingGapMs,
            rateScale: emphasised ? 0.94 : 1,
            pitchScale: emphasised ? 1.04 : 1,
            cause: c.cause !== "line" ? c.cause : piece.cause !== "line" ? piece.cause : hold.cause,
          });
        });
      });
    }
    if (own.length === 0) return;
    own[0].leadingGapMs = Math.max(own[0].leadingGapMs, partLeading);
    drafts.push(...own);
  });

  const clean = drafts.filter((d) => d.text.trim().length > 0);
  if (clean.length === 0) return [];
  return clean.map((d, i) => ({
    text: d.text,
    gapAfterMs: i + 1 < clean.length ? clean[i + 1].leadingGapMs : dir.tailGapMs,
    rateScale: d.rateScale,
    pitchScale: d.pitchScale,
    cause: d.cause,
    index: i + 1,
  }));
}

// ---------------------------------------------------------------------------
// Audio-text helpers (the harness's lints and the budget maths)
// ---------------------------------------------------------------------------
export function spokenText(pieces: readonly SpokenPiece[]): string {
  return pieces.map((p) => p.text).join(" ");
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** §3.5's modelled speaking time — characters at the modelled rate. Honest
 *  approximation for the authoring caps, never used to schedule. */
export function estimatedSeconds(text: string, rate = 1): number {
  return text.length / (VOICE_CONFIG.charsPerSecond * Math.max(0.1, rate));
}

/** §4.2's lint: a digit, `%` or `#` left in the SPOKEN text has no entry in the
 *  numeral table, so a line could be read as a serial number. */
export function bareDigitTokens(text: string): string[] {
  return text.split(/\s+/).filter((t) => /[\d%#]/.test(t));
}

/** §4.2's second lint: an acronym run of three or more capitals. */
export function acronymRuns(text: string): string[] {
  return text.match(/\b[A-Z]{3,}\b/g) ?? [];
}
