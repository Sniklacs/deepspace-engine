// slot-label.ts — one convention, used everywhere a Cradle slot or domain shows
// a name: `domain.<domainId>.name`, or `tile.<slotId>` for the slots that are
// not one of the five domains (today: the Workshop). The English literal stays at
// the call site as the fallback, so a slot can never render a raw key and the
// English a player sees is byte-identical to what the data table holds.
import type { T } from "./types";

export function slotLabel(t: T, s: { id: string; label: string; domain?: string | null }): string {
  return s.domain ? t(`domain.${s.domain}.name`, s.label) : t(`tile.${s.id}`, s.label);
}

/** The same convention for a domain's description line. */
export function domainDescription(
  t: T,
  domain: string,
  fallback: string | undefined,
  params?: Record<string, string | number>,
): string {
  const key = `domain.${domain}.desc`;
  return fallback
    ? params
      ? t(key, fallback, params)
      : t(key, fallback)
    : params
      ? t(key, params)
      : t(key);
}
