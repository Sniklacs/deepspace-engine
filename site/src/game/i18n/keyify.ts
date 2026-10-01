/**
 * Normalize a raw table id into a valid translation-key segment (KEY_SHAPE).
 *
 * Table ids use hyphens, underscores, and colons (`outer-ruins`, `armory_hub`,
 * `oracle_vouch:watchers`) but KEY_SHAPE allows only `[A-Za-z0-9]` per segment,
 * so helpers MUST pass ids through this before interpolating them into keys.
 *
 *   "outer-ruins"          -> "outerRuins"
 *   "armory_hub"           -> "armoryHub"
 *   "oracle_vouch:watchers"-> "oracleVouchWatchers"
 *   "azazel-3"             -> "azazel3"
 */
export function keyifySegment(raw: string): string {
  return raw
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}
