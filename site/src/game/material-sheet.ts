/**
 * MATERIAL SHEET STORE — the explanation box for materials (owner
 * 2026-10-14): "a box explaining where you get it, what it's for, how you
 * obtain it."
 *
 * The full what/does/how copy has lived in tooltips.tsx for a long time,
 * but its only doors were hover (desktop) and a 480ms long-press (touch)
 * — a player who simply TAPS never saw any of it, and said so. This store
 * is the tap door: any component that names a material can open the one
 * shared sheet with a plain call, no prop threading. The sheet component
 * (components/MaterialSheet.tsx) renders the registry copy from
 * tooltips.tsx — one registry, two doors.
 */

export type MaterialSheetId =
  | "embers"
  | "chipsets"
  | "supplies"
  | "warplate"
  | "plasma"
  | "mats"
  | "alloy"
  | "hazmat"
  | "shots"
  | "medkit"
  | "mechkit"
  | "armorkit"
  | "skmech"
  | "gas"
  | "battery"
  | "insight"
  | "codices";

export interface MaterialSheetRequest {
  id: MaterialSheetId;
  /** how many the player holds, when the opener knows it */
  count?: number;
  /** per-race territory material counts (id "mats" only) */
  mats?: Record<string, number>;
}

let current: MaterialSheetRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function subscribeMaterialSheet(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getMaterialSheet(): MaterialSheetRequest | null {
  return current;
}

export function openMaterialSheet(req: MaterialSheetRequest): void {
  current = req;
  emit();
}

export function closeMaterialSheet(): void {
  if (!current) return;
  current = null;
  emit();
}
