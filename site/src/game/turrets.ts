/**
 * Ship turret & weaponry mounts — the guns (and one command array) bolted
 * onto each jump-ship class.
 *
 * Owner direction 2026-10-04 (Hans): every ship class carries turret
 * weaponry fitting its role — the fatcat carries chain-gun turrets, the
 * frigate carries light turrets, and so on. Creative license granted;
 * Hans corrects what looks off.
 *
 * NOT modules: hero modules (design/modules-build.md) are forge-crafted
 * commodities worn by heroes. Turrets are ship-mounted, fixed per class,
 * and never tradeable — they are part of the hull, not inventory.
 */

import type { ShipClass } from "./worldmap";
import { SHIP_CLASSES } from "./worldmap";

export type TurretKind = "weapon" | "system";

export interface TurretDef {
  /** Stable id, e.g. "light-turret". */
  id: string;
  /** Display name, e.g. "Light Turret". */
  name: string;
  /** The ship class that carries this mount. */
  shipClass: ShipClass;
  /** "weapon" for guns, "system" for non-weapon mounts (herald). */
  kind: TurretKind;
  /** Skin path. Race-neutral gunmetal — reads next to any race's ships. */
  art: string;
  /** One-line flavor for the shipyard. */
  flavor: string;
  /** Short armament line, e.g. "Armament: twin light turrets". */
  armamentLine: string;
}

/**
 * One signature mount per class — modest by design. Hans adjusts.
 * The herald carries no weapons (complex systems, no guns — see
 * SHIP_BUILD_MS comment in worldmap.ts), so its mount is a command
 * system, not a turret.
 */
export const TURRETS: TurretDef[] = [
  {
    id: "needle-battery",
    name: "Needle Battery",
    shipClass: "scout",
    kind: "weapon",
    art: "/art/turrets/needle-battery.webp",
    flavor: "Light defensive guns — stings anything that gets close, never starts a fight.",
    armamentLine: "Armament: needle battery (defensive)",
  },
  {
    id: "light-turret",
    name: "Light Turret",
    shipClass: "frigate",
    kind: "weapon",
    art: "/art/turrets/light-turret.webp",
    flavor: "Twin light turrets — the workhorse guns of the line.",
    armamentLine: "Armament: twin light turrets",
  },
  {
    id: "aegis-grid",
    name: "Aegis Grid",
    shipClass: "bulwark",
    kind: "weapon",
    art: "/art/turrets/aegis-grid.webp",
    flavor: "Interlocking point-defense grid — swats strikecraft and ordnance out of the sky.",
    armamentLine: "Armament: aegis point-defense grid",
  },
  {
    id: "siege-cannon",
    name: "Siege Cannon",
    shipClass: "vanguard",
    kind: "weapon",
    art: "/art/turrets/siege-cannon.webp",
    flavor: "A single heavy siege cannon — slow to aim, ruinous when it lands.",
    armamentLine: "Armament: heavy siege cannon",
  },
  {
    id: "chain-gun-battery",
    name: "Chain-Gun Battery",
    shipClass: "fatcat",
    kind: "weapon",
    art: "/art/turrets/chain-gun-battery.webp",
    flavor: "Twin rotary chain-guns — a wall of lead for anything dumb enough to close with a hauler.",
    armamentLine: "Armament: twin chain-gun turrets",
  },
  {
    id: "war-drum-array",
    name: "War-Drum Array",
    shipClass: "herald",
    kind: "system",
    art: "/art/turrets/war-drum-array.webp",
    flavor: "Spinal command array — no guns; it conducts the fleet's fire instead of adding its own.",
    armamentLine: "Systems: war-drum command array (no guns)",
  },
];

/** The signature mount for a ship class. Every class has exactly one. */
export const TURRET_BY_CLASS: Record<ShipClass, TurretDef> = Object.fromEntries(
  TURRETS.map((t) => [t.shipClass, t]),
) as Record<ShipClass, TurretDef>;

/** Skin URL for a turret id, or null when unknown. */
export function turretArtUrl(id: string): string | null {
  return TURRETS.find((t) => t.id === id)?.art ?? null;
}

/** The signature mount for a ship class (alias of TURRET_BY_CLASS). */
export function classTurret(cls: ShipClass): TurretDef {
  return TURRET_BY_CLASS[cls];
}

/** Every ship class is covered — the list stays in lockstep with SHIP_CLASSES. */
export function turretCoverageOk(): boolean {
  return SHIP_CLASSES.every((c) => TURRET_BY_CLASS[c] != null);
}
