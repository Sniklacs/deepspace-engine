import { useState } from "react";
import { classTurret } from "../game/turrets";
import type { ShipClass } from "../game/worldmap";

/**
 * TurretThumb — the signature weapon mount for a ship class, shown next to
 * the ship wherever ships are displayed (shipyard, fleet lists, raid
 * picker). Class-keyed and race-agnostic: every race's ships carry their
 * class weaponry, so no ship is ever unarmed.
 *
 * Hides itself if the art is missing — never a broken image.
 */
export function TurretThumb({
  shipClass,
  size = 24,
}: {
  shipClass: ShipClass;
  size?: number;
}) {
  const def = classTurret(shipClass);
  const [ok, setOk] = useState(true);
  // Crash-hardening (2026-10-04): a malformed ship row (unknown/undefined
  // class) must never take down the whole app — render nothing instead.
  if (!shipClass || !def || !ok) return null;
  return (
    <img
      src={def.art}
      alt={def.name}
      title={`${def.armamentLine} — ${def.flavor}`}
      loading="lazy"
      width={size}
      height={size}
      onError={() => setOk(false)}
      className="shrink-0 rounded-md border border-line object-cover"
      style={{ width: size, height: size }}
    />
  );
}
