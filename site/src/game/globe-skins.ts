// globe-skins — race skin lookup for the world globe (the hub/workstation).
//
// Owner direction 2026-10-11 (Hans): the world globe gets a full race skin —
// the planet surface reads as the race's homeworld (Draconians = the Ashen
// Wastes: volcanic, dark basalt, ember veins). This is the TEMPLATE: every
// race gets its own `{raceId}-globe.webp`; adding one is a file drop, no
// code changes.
//
// Convention mirrors CradleSkin: `/art/globe/{raceId}-globe.webp`.
// Races without a skin file fall back to the procedural terrain bake.
const SKIN_DIR = "/art/globe";

/** Skin lookup: `/art/globe/{raceId}-globe.webp`, null when unkeyed. */
export function globeSkinFor(raceId: string | null | undefined): string | null {
  const id = (raceId ?? "").trim().toLowerCase();
  return id ? `${SKIN_DIR}/${id}-globe.webp` : null;
}
