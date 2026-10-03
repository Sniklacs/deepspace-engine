import { sql } from "~/db";
import { WORLD_CONFIG } from "~/game/world-config";
import { loadAllSaves } from "~/game/store";

/**
 * GET /api/health — server liveness probe for the server-select UI.
 *
 * Returns { status: "up" } only when BOTH the server is serving AND the
 * database is reachable. Returns 503 { status: "down" } if the DB query fails.
 *
 * The server-select page pings this on every known server; green light =
 * "up", red light = anything else (timeout, 503, network error).
 *
 * Also returns:
 * - playerCount: number of registered accounts (inhabitants)
 * - reverb: aggregate planetary reverb (sum of troop counts across all colonies)
 */
async function getPlayerCount(): Promise<number> {
  try {
    const rows = await sql()`SELECT COUNT(*) as count FROM accounts`;
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

async function getReverb(): Promise<number> {
  try {
    const allSaves = await loadAllSaves();
    let total = 0;
    for (const { saves } of allSaves) {
      for (const gameId of Object.keys(saves.games)) {
        const game = saves.games[gameId];
        const cohorts = game.troops?.home?.roster?.cohorts ?? [];
        for (const cohort of cohorts) {
          total += cohort.count ?? 0;
        }
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export async function GET() {
  try {
    await sql()`select 1`;
  } catch {
    return Response.json(
      {
        status: "down",
        reason: "database",
        worldId: WORLD_CONFIG.worldId,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
  const [playerCount, reverb] = await Promise.all([
    getPlayerCount(),
    getReverb(),
  ]);
  return Response.json({
    status: "up",
    worldId: WORLD_CONFIG.worldId,
    worldName: WORLD_CONFIG.worldName,
    raceLock: WORLD_CONFIG.raceLock,
    debugWorld: WORLD_CONFIG.debugWorld,
    playerCount,
    reverb,
    timestamp: new Date().toISOString(),
  });
}
