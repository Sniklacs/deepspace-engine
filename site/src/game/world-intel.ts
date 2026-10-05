// world-intel.ts — WORLD INTEL PANEL data (owner 2026-10-04, WS D).
//
// Pure helpers behind the World page's "World Intel" panel. Two flavors of
// data, deliberately kept separate:
//
//   • PLANET FLAVOR — world name, diameter, mean temperature. Pure flavor,
//     deterministic per worldId (hash-derived, stable across sessions).
//     NEVER presented as live telemetry — the panel labels it "world flavor".
//   • LIVE COUNTS — real client data only: colony count from
//     state.worldMap.known, alliance rankings from state.alliances.
//     Player/online counts are NOT wired: the client has no presence feed
//     (no presence API exists in game/api.ts or the server build), so the
//     panel omits those rows rather than inventing numbers.
//
// Alliance turf: centroid of the alliance's member colonies' globe positions.
// KnownColony carries no alliance affiliation, so membership is resolved by
// matching member.colonyId / member.colonyName against known colonies — and
// the player's own colony ("home:" + gameId) counts for the player's own
// alliance. When no member colony can be placed, turf falls back to a stable
// hash-derived position and is flagged `estimated: true` so the UI can say
// "turf approx" instead of pretending precision.
import { hash01 } from "./chorus-intel";
import { colonyGlobePosition } from "./globe-layers";
import type { Alliance } from "./war/alliances";
import type { KnownColony } from "./worldmap";

// ---------------------------------------------------------------------------
// PLANET FLAVOR (deterministic per worldId — NOT telemetry)
// ---------------------------------------------------------------------------

/** World flavor stats. Hand the panel `worldId` and it stays stable forever. */
export interface WorldFlavor {
  /** Equatorial diameter, km — a flavor number, not measured. */
  diameterKm: number;
  /** Mean surface temperature, °C — flavor, not telemetry. */
  meanTempC: number;
}

/** Flavor stats for a world. hash01 is stable across sessions, so these
 *  never drift between builds. Labeled "world flavor" wherever shown. */
export function worldFlavor(worldId: string): WorldFlavor {
  const diameterKm = 6400 + Math.floor(hash01(worldId + ":diameter") * 12600);
  const meanTempC = Math.round(-50 + hash01(worldId + ":temp") * 95);
  return { diameterKm, meanTempC };
}

// ---------------------------------------------------------------------------
// LIVE COUNTS
// ---------------------------------------------------------------------------

/** Live colony count, broken down by status. Source: state.worldMap.known. */
export interface ColonyCounts {
  total: number;
  active: number;
  abandoned: number;
  husk: number;
  settingUp: number;
}

/** Count known colonies by status. `setting_up` and `sub_colony` fold into
 *  active (they are living colonies); husks get their own row. */
export function colonyCounts(known: Record<string, KnownColony> | undefined): ColonyCounts {
  const counts: ColonyCounts = { total: 0, active: 0, abandoned: 0, husk: 0, settingUp: 0 };
  for (const c of Object.values(known ?? {})) {
    counts.total += 1;
    switch (c.status) {
      case "active":
      case "sub_colony":
        counts.active += 1;
        break;
      case "abandoned":
        counts.abandoned += 1;
        break;
      case "husk":
        counts.husk += 1;
        break;
      case "setting_up":
        counts.settingUp += 1;
        counts.active += 1;
        break;
    }
  }
  return counts;
}

/** Top N alliances by member count (descending). Ties break by name. */
export function topAlliances(
  alliances: Record<string, Alliance> | undefined,
  limit = 3,
): Alliance[] {
  return Object.values(alliances ?? {})
    .slice()
    .sort(
      (a, b) =>
        b.members.length - a.members.length || a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// ALLIANCE TURF (snap-to target)
// ---------------------------------------------------------------------------

/** Where an alliance's turf sits on the globe, for snap-to. */
export interface AllianceTurf {
  lat: number;
  lon: number;
  /** True when no member colony could be placed — hash-derived stand-in. */
  estimated: boolean;
  /** How many member colonies actually anchored the position. */
  anchored: number;
}

/**
 * Alliance turf position: centroid of member colonies' globe positions.
 * Matches member.colonyId against known colonies' `id`, then
 * member.colonyName against `ownerName` (case-insensitive). The player's own
 * colony ("home:" + gameId) always counts when they're a member. When nothing
 * anchors, a stable hash position from the alliance id is used and
 * `estimated` is true.
 */
export function allianceTurf(
  alliance: Alliance,
  known: Record<string, KnownColony> | undefined,
  gameId: string | undefined,
): AllianceTurf {
  const points: { lat: number; lon: number }[] = [];
  const colonies = Object.values(known ?? {});
  for (const m of alliance.members) {
    // The player's own colony is always placeable via the home key.
    if (gameId && m.colonyId === gameId) {
      points.push(colonyGlobePosition("home:" + gameId));
      continue;
    }
    const byId = colonies.find((c) => c.id === m.colonyId);
    const byName =
      byId ??
      colonies.find(
        (c) => c.ownerName.toLowerCase() === m.colonyName.toLowerCase(),
      );
    if (byName) {
      points.push(colonyGlobePosition(`${byName.serverId}:${byName.id}`));
    }
  }
  if (points.length === 0) {
    // No member colony placeable — stable stand-in, flagged as approximate.
    return {
      lat: (hash01(alliance.id + ":turflat") * 2 - 1) * 68,
      lon: hash01(alliance.id + ":turflon") * 360 - 180,
      estimated: true,
      anchored: 0,
    };
  }
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
    estimated: false,
    anchored: points.length,
  };
}
