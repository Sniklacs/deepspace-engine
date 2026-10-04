import type { KnownColony } from "./worldmap";

/**
 * Raid target eligibility, mirrored from engine.setRaidTarget (owner 2026-10-03).
 *
 * The UI target button must apply the SAME rule as the server so the player
 * never taps "Target this colony" only to be silently rejected. Returns null
 * when the selected colony can be targeted, otherwise a hint key the UI can
 * render with an honest explanation (Hans's UI rule: always explain why).
 *
 * Regression (2026-10-04): tapping an ABANDONED colony card selected it, but
 * the button did nothing and showed "Tap a colony card on the map first" —
 * even though a card WAS tapped. The real reason was the status gate.
 */
export type TargetBlock = "noColonySelected" | "notRaidable" | null;

export function targetBlockReason(
  colony: KnownColony | null,
  selectedKey: string | null,
  myColonyId: string | undefined,
): TargetBlock {
  if (!colony || !selectedKey) return "noColonySelected";
  // SUB COLONY (owner 2026-10-03): rivals can raid sub colonies — a decisive
  // win seizes them. You can't raid your own.
  const isRivalSub =
    colony.status === "sub_colony" && colony.subClaim?.claimedBy !== (myColonyId ?? "");
  if (colony.status === "active" || isRivalSub) return null;
  return "notRaidable";
}
