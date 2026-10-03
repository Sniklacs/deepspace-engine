// Vercel Build Output API function entry.
//
// The Build Output Node launcher invokes the default export as a classic Node
// `(req, res)` handler — NOT a web handler. TanStack Start emits a portable web
// fetch handler (dist/server/server.js), so we adapt: Node IncomingMessage → web
// Request, run the fetch handler, stream the web Response back onto ServerResponse.
// Node 22 has global Request/Response/Headers/ReadableStream.
//
// Bundled (with its deps + the SSR handler's dynamic ./assets chunks) into
// .vercel/output/functions/render.func/index.mjs by build-vercel.sh.
import type { IncomingMessage, ServerResponse } from "node:http";

import handler from "./dist/server/server.js";
import {
  XSOLLA_WEBHOOK_PATH,
  handleXsollaWebhookRequest,
  webhookResponse,
} from "./src/game/payments/webhook-route";

const fetchHandler = handler as {
  fetch: (request: Request) => Response | Promise<Response>;
};

const toWebRequest = (req: IncomingMessage): Request => {
  const host = req.headers.host ?? "localhost";
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value != null) headers.set(key, value);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    ...(hasBody ? { body: req as unknown as ReadableStream, duplex: "half" } : {}),
  } as RequestInit);
};

/** Read and parse a JSON request body from an IncomingMessage. */
async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * Seed the test server with a day-60 raid-testing scenario.
 * Creates test accounts, game states, mock colonies, and test alliance.
 */
async function runSeed(): Promise<Record<string, any>> {
  const { neon } = await import("@neondatabase/serverless");
  const crypto = await import("node:crypto");
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) throw new Error("no database");
  const sql = neon(dbUrl);

  // Ensure tables exist (mirrors store.ts schema)
  await sql`CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    notice_dismissed BOOLEAN
  )`;
  await sql`CREATE TABLE IF NOT EXISTS saves (
    account_id TEXT PRIMARY KEY,
    data JSONB NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`;

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const day60 = now - 60 * DAY;

  const results: Record<string, any> = {
    accounts: [],
    colonies: 0,
    alliance: null,
  };

  // ── Test accounts ──
  const testPlayers = [
    { name: "testwarlord1", display: "TestWarlord1" },
    { name: "testwarlord2", display: "TestWarlord2" },
    { name: "testwarlord3", display: "TestWarlord3" },
    { name: "testwarlord4", display: "TestWarlord4" },
    { name: "testwarlord5", display: "TestWarlord5" },
  ];
  const password = "test1234";

  for (const tp of testPlayers) {
    const uname = tp.name.toLowerCase();
    // Check if exists
    const existing = await sql`SELECT account_id FROM accounts WHERE account_id = ${uname}`;
    if (existing.length === 0) {
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = crypto.scryptSync(password, salt, 64).toString("hex");
      await sql`INSERT INTO accounts (account_id, password_hash, salt, created_at, notice_dismissed)
        VALUES (${uname}, ${hash}, ${salt}, ${day60}, false)`;
      results.accounts.push(uname);
    }
  }

  // ── Game states (day-60) ──
  // We create minimal GameState objects; the engine's ensure/migration
  // functions will fill in missing fields on first advance.
  const { newGame } = await import("./src/game/engine.js");
  const { emptyWorldMap } = await import("./src/game/worldmap.js");

  // Mock colonies for the world map
  const mockColonies: any[] = [];
  const draconianNames = [
    "Ashkar the Render", "Vexnal Bloodwing", "Korath Embermaw", "Drakmor Ashfall",
    "Sylvax Cinderclaw", "Morgath Flameheart", "Zevran Scaleward", "Karthus Ironhide",
    "Vorgath Stormwing", "Desskar Nightfire", "Ravok Bloodscale", "Therax Doomwing",
  ];
  // 12 active colonies
  for (let i = 0; i < 12; i++) {
    const isSwarm = i % 3 === 0; // Every 3rd is a T1 swarm
    mockColonies.push({
      id: `mock-active-${i}`,
      serverId: "draconians-world",
      ownerName: draconianNames[i],
      race: "draconians",
      status: "active",
      lastScouted: now - Math.floor(Math.random() * 6 * 3600 * 1000),
      approxTroops: isSwarm ? 25000 + Math.floor(Math.random() * 10000) : 3000 + Math.floor(Math.random() * 5000),
      reverb: isSwarm ? 8000 + Math.floor(Math.random() * 4000) : 15000 + Math.floor(Math.random() * 10000),
    });
  }
  // 5 abandoned colonies (30+ days inactive, with loot)
  const abandonedNames = ["Fallen Emberhold", "Silent Ashfall", "Broken Wing", "Cinder Ruins", "Lost Stronghold"];
  for (let i = 0; i < 5; i++) {
    mockColonies.push({
      id: `mock-abandoned-${i}`,
      serverId: "draconians-world",
      ownerName: abandonedNames[i],
      race: "draconians",
      status: "abandoned",
      lastScouted: now - Math.floor(Math.random() * 24 * 3600 * 1000),
      loot: {
        supplies: 5000 + Math.floor(Math.random() * 15000),
        embers: 100 + Math.floor(Math.random() * 500),
        chipsets: 10 + Math.floor(Math.random() * 50),
      },
      lootObserved: {
        supplies: 5000 + Math.floor(Math.random() * 15000),
        embers: 100 + Math.floor(Math.random() * 500),
        chipsets: 10 + Math.floor(Math.random() * 50),
      },
      mercenaries: {
        count: 50 + Math.floor(Math.random() * 200),
        tier: 1 + Math.floor(Math.random() * 3),
      },
      reverb: 2000 + Math.floor(Math.random() * 3000),
    });
  }
  // 3 husks (fully gleaned)
  for (let i = 0; i < 3; i++) {
    mockColonies.push({
      id: `mock-husk-${i}`,
      serverId: "draconians-world",
      ownerName: `Husk ${i + 1}`,
      race: "draconians",
      status: "husk",
      lastScouted: now - Math.floor(Math.random() * 48 * 3600 * 1000),
      loot: { supplies: 0, embers: 0, chipsets: 0 },
      mercenaries: null,
    });
  }
  results.colonies = mockColonies.length;

  // Create game states for each test player
  for (const tp of testPlayers) {
    const uname = tp.name.toLowerCase();
    const game = newGame(tp.display, "draconians", day60);
    // Day-60 modifications
    game.createdAt = day60;
    game.lastTick = now;
    // T4 techs (unlocked at day 38)
    game.techsResearched = [
      "t1_unlock", "t2_unlock", "t3_unlock", "t4_unlock",
      "scout_probe", "muster_1", "muster_2", "muster_3",
    ];
    // Stockpiled resources (generous test amounts — Hans tests everything)
    game.resources.supplies = 500000;
    game.resources.embers = 5000;
    game.resources.chipsets = 500;
    game.resources.alloys = 1000;
    game.resources.mats = { grays: 500, nephilim: 500, draconians: 1000, anunnaki: 500, ashtar: 500, watchers: 500 };
    (game as any).codices = 100;
    // Pre-mustered troops for raid testing (owner 2026-10-03)
    const { addCohort } = await import("./src/game/war/troops.js");
    const { ensureTroops } = await import("./src/game/engine.js");
    ensureTroops(game as any, now);
    for (const t of ["bulwark", "reaver", "longeye", "thunder", "warden"] as const) {
      addCohort((game as any).troops.home.roster, t, 1000, now);
    }
    // World map with mock colonies
    const wm = emptyWorldMap(now);
    wm.scoutTechResearched = true;
    wm.probes = 5;
    for (const colony of mockColonies) {
      wm.known[`${colony.serverId}:${colony.id}`] = colony;
    }
    (game as any).worldMap = wm;
    // Mark as mock/test
    (game as any).isTestAccount = true;
    // Unique colony ID per test account (prevents "0" collision across accounts)
    (game as any).gameId = uname;

    const saves = {
      version: 2,
      activeGameId: uname,
      games: { [uname]: game },
    };
    await sql`INSERT INTO saves (account_id, data)
      VALUES (${uname}, ${JSON.stringify(saves)}::jsonb)
      ON CONFLICT (account_id) DO UPDATE SET data = ${JSON.stringify(saves)}::jsonb`;
  }

  // ── Test alliance with ships ──
  const allianceId = "ashen-vanguard";
  const shipClasses = ["scout", "frigate", "bulwark", "vanguard", "fatcat", "herald"];
  const ships: any[] = [];
  let shipSeq = 1;
  for (const sc of shipClasses) {
    for (let i = 0; i < 10; i++) {
      ships.push({
        id: `ship-${shipSeq++}`,
        shipClass: sc,
        raceId: "draconians",
        name: `${sc}-${i + 1}`,
        builtAt: now - Math.floor(Math.random() * 30 * DAY),
        builtBy: "testwarlord1",
        status: "ready",
      });
    }
  }
  const alliance = {
    id: allianceId,
    name: "Ashen Vanguard",
    banner: "🔥",
    motto: "From ash, victory.",
    members: testPlayers.map((tp, i) => ({
      colonyId: tp.name.toLowerCase(),
      colonyName: tp.display,
      role: i === 0 ? "leader" : "member",
      joinedAt: day60,
    })),
    applications: [],
    invites: [],
    foundedAt: day60,
    founderId: "testwarlord1",
    homeServerId: "draconians-world",
    version: 1,
    joinPolicy: "open",
    shipyard: {
      level: 5,
      queue: [],
      ships: ships,
      seq: shipSeq,
    },
  };
  // Store alliance in testwarlord1's game state
  const tp1Saves = await sql`SELECT data FROM saves WHERE account_id = 'testwarlord1'`;
  if (tp1Saves.length > 0) {
    const data = tp1Saves[0].data;
    const tp1GameKey = data.activeGameId || "testwarlord1";
    if (data.games && data.games[tp1GameKey]) {
      data.games[tp1GameKey].alliances = { [allianceId]: alliance };
      await sql`UPDATE saves SET data = ${JSON.stringify(data)}::jsonb WHERE account_id = 'testwarlord1'`;
    }
  }
  results.alliance = { id: allianceId, name: "Ashen Vanguard", ships: ships.length };

  return results;
}

/**
 * Seed ONLY testwarlord6 — a 6th test account NOT in any alliance, so Hans
 * can test the alliance search/join flow. Idempotent; never touches the
 * other accounts or the Ashen Vanguard alliance.
 */
async function runSeedWarlord6(): Promise<Record<string, any>> {
  const { neon } = await import("@neondatabase/serverless");
  const crypto = await import("node:crypto");
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) throw new Error("no database");
  const sql = neon(dbUrl);

  await sql`CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    notice_dismissed BOOLEAN
  )`;
  await sql`CREATE TABLE IF NOT EXISTS saves (
    account_id TEXT PRIMARY KEY,
    data JSONB NOT NULL
  )`;

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const day60 = now - 60 * DAY;
  const uname = "testwarlord6";
  const results: Record<string, any> = { account: uname, created: false, stateCreated: false };

  const existing = await sql`SELECT account_id FROM accounts WHERE account_id = ${uname}`;
  if (existing.length === 0) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync("test1234", salt, 64).toString("hex");
    await sql`INSERT INTO accounts (account_id, password_hash, salt, created_at, notice_dismissed)
      VALUES (${uname}, ${hash}, ${salt}, ${day60}, false)`;
    results.created = true;
  }

  // testwarlord6 is a disposable QA account: always (re)build its game state so
  // re-running the seed repairs or resets it. The account row itself is only
  // created once.
  {
    const { newGame } = await import("./src/game/engine.js");
    const { emptyWorldMap } = await import("./src/game/worldmap.js");
    const game = newGame("TestWarlord6", "draconians", day60);
    game.createdAt = day60;
    game.lastTick = now;
    game.techsResearched = [
      "t1_unlock", "t2_unlock", "t3_unlock", "t4_unlock",
      "scout_probe", "muster_1", "muster_2", "muster_3",
    ];
    game.resources.supplies = 500000;
    game.resources.embers = 5000;
    game.resources.chipsets = 500;
    game.resources.alloys = 1000;
    game.resources.mats = { grays: 500, nephilim: 500, draconians: 1000, anunnaki: 500, ashtar: 500, watchers: 500 };
    (game as any).codices = 100;
    // Pre-mustered troops for raid testing
    const { addCohort: addCohort6 } = await import("./src/game/war/troops.js");
    const { ensureTroops: ensureTroops6 } = await import("./src/game/engine.js");
    ensureTroops6(game as any, now);
    for (const t of ["bulwark", "reaver", "longeye", "thunder", "warden"] as const) {
      addCohort6((game as any).troops.home.roster, t, 1000, now);
    }
    const wm = emptyWorldMap(now);
    wm.scoutTechResearched = true;
    wm.probes = 5;
    // Same mock colonies as the main seed so the world map isn't empty.
    const draconianNames = [
      "Ashkar the Render", "Vexnal Bloodwing", "Korath Embermaw", "Drakmor Ashfall",
      "Sylvax Cinderclaw", "Morgath Flameheart", "Zevran Scaleward", "Karthus Ironhide",
      "Vorgath Stormwing", "Desskar Nightfire", "Ravok Bloodscale", "Therax Doomwing",
    ];
    for (let i = 0; i < 12; i++) {
      const isSwarm = i % 3 === 0;
      const colony: any = {
        id: `mock-active-${i}`,
        serverId: "draconians-world",
        ownerName: draconianNames[i],
        race: "draconians",
        status: "active",
        lastScouted: now - Math.floor(Math.random() * 6 * 3600 * 1000),
        approxTroops: isSwarm ? 25000 + Math.floor(Math.random() * 10000) : 3000 + Math.floor(Math.random() * 5000),
        reverb: isSwarm ? 8000 + Math.floor(Math.random() * 4000) : 15000 + Math.floor(Math.random() * 10000),
      };
      wm.known[`${colony.serverId}:${colony.id}`] = colony;
    }
    const abandonedNames = ["Fallen Emberhold", "Silent Ashfall", "Broken Wing", "Cinder Ruins", "Lost Stronghold"];
    for (let i = 0; i < 5; i++) {
      const colony: any = {
        id: `mock-abandoned-${i}`,
        serverId: "draconians-world",
        ownerName: abandonedNames[i],
        race: "draconians",
        status: "abandoned",
        lastScouted: now - Math.floor(Math.random() * 24 * 3600 * 1000),
        loot: { supplies: 5000 + Math.floor(Math.random() * 15000), embers: 100 + Math.floor(Math.random() * 500), chipsets: 10 + Math.floor(Math.random() * 50) },
        lootObserved: { supplies: 5000 + Math.floor(Math.random() * 15000), embers: 100 + Math.floor(Math.random() * 500), chipsets: 10 + Math.floor(Math.random() * 50) },
        mercenaries: { count: 50 + Math.floor(Math.random() * 200), tier: 1 + Math.floor(Math.random() * 3) },
        reverb: 2000 + Math.floor(Math.random() * 3000),
      };
      wm.known[`${colony.serverId}:${colony.id}`] = colony;
    }
    for (let i = 0; i < 3; i++) {
      const colony: any = {
        id: `mock-husk-${i}`,
        serverId: "draconians-world",
        ownerName: `Husk ${i + 1}`,
        race: "draconians",
        status: "husk",
        lastScouted: now - Math.floor(Math.random() * 48 * 3600 * 1000),
        loot: { supplies: 0, embers: 0, chipsets: 0 },
        mercenaries: null,
      };
      wm.known[`${colony.serverId}:${colony.id}`] = colony;
    }
    (game as any).worldMap = wm;
    (game as any).isTestAccount = true;
    (game as any).gameId = uname;
    // NOTE: no alliances field — testwarlord6 is NOT in any alliance.
    const saves = { version: 2, activeGameId: uname, games: { [uname]: game } };
    await sql`INSERT INTO saves (account_id, data)
      VALUES (${uname}, ${JSON.stringify(saves)}::jsonb)
      ON CONFLICT (account_id) DO UPDATE SET data = EXCLUDED.data`;
    results.stateCreated = true;
  }

  return results;
}

export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const pathname = new URL(
      req.url ?? "/",
      `https://${req.headers.host ?? "localhost"}`
    ).pathname;
    // Seed endpoint for test server population.
    // POST /api/seed?key=YOUR_SEED_KEY
    // Creates test accounts, day-60 game states, mock colonies, and test alliance.
    // POST /api/seed?key=YOUR_SEED_KEY&only=testwarlord6
    // Creates ONLY testwarlord6 (not in any alliance) for join-flow testing.
    if (pathname === "/api/seed" && req.method === "POST") {
      const url = new URL(req.url ?? "/", `https://${req.headers.host ?? "localhost"}`);
      const key = url.searchParams.get("key");
      const only = url.searchParams.get("only");
      const expectedKey = process.env.SEED_KEY || "draconian-test-seed-2026";
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      if (key !== expectedKey) {
        res.statusCode = 403;
        res.end(JSON.stringify({ ok: false, error: "invalid_key" }));
        return;
      }
      try {
        const result = only === "testwarlord6" ? await runSeedWarlord6() : await runSeed();
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (e: any) {
        console.error("[seed] failed", e);
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: e?.message || "seed_failed" }));
      }
      return;
    }
    // Health check endpoint for server-select UI.
    // Returns { status: "up" } if DB reachable, 503 { status: "down" } if not.
    if (pathname === "/api/health") {
      const worldId = process.env.WORLD_ID || "watchers-beta";
      const worldName = process.env.WORLD_NAME || "The Shattered Academies";
      const raceLock = process.env.RACE_LOCK || "watchers";
      const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      if (!dbUrl) {
        res.statusCode = 503;
        res.end(JSON.stringify({
          status: "down",
          reason: "database_not_configured",
          worldId,
          timestamp: new Date().toISOString(),
        }));
        return;
      }
      try {
        const { neon } = await import("@neondatabase/serverless");
        const sql = neon(dbUrl);
        await sql`select 1`;
        let playerCount = 0;
        try {
          const rows = await sql`SELECT COUNT(*) as count FROM accounts`;
          playerCount = Number((rows as any)[0]?.count ?? 0);
        } catch {}
        res.statusCode = 200;
        res.end(JSON.stringify({
          status: "up",
          worldId,
          worldName,
          raceLock,
          playerCount,
          reverb: 0,
          timestamp: new Date().toISOString(),
        }));
      } catch {
        res.statusCode = 503;
        res.end(JSON.stringify({
          status: "down",
          reason: "database",
          worldId,
          timestamp: new Date().toISOString(),
        }));
      }
      return;
    }
    // Cross-server raid warnings (owner 2026-10-03).
    // POST /api/raid-incoming { secret, raid: IncomingRaidPayload }
    // Called by the attacker's server when a raid launches. We find the
    // defender's account by colonyId and file the raid data. NOTE (owner
    // 2026-10-03): NO mailbox warning. Detection is satellite-only — if the
    // defender has no satellite covering the arrival node, they get nothing.
    // Satellites check worldMap.incomingRaids and raise the alarm.
    if (pathname === "/api/raid-incoming" && req.method === "POST") {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      try {
        const body = await readJsonBody(req);
        const expectedSecret = process.env.RAID_SHARED_SECRET || "unbound-raid-test-2026";
        if (body.secret !== expectedSecret) {
          res.statusCode = 403;
          res.end(JSON.stringify({ ok: false, error: "invalid_secret" }));
          return;
        }
        const raid = body.raid;
        if (!raid?.targetColonyId || !raid?.raidId) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: "bad_payload" }));
          return;
        }
        const { loadAllSaves, saveAccountSaves } = await import("./src/game/store");
        const { checkRaidAlarm, colonyNodeId } = await import("./src/game/satellites.js");
        const { allianceOf } = await import("./src/game/war/alliances.js");
        const all = await loadAllSaves();
        let delivered = false;
        // Collect saves we touch so the alliance broadcast persists.
        const touched = new Map<string, any>();
        for (const { accountId, saves } of all) {
          for (const [gameId, st] of Object.entries(saves.games || {})) {
            const state = st as any;
            if (state.gameId !== raid.targetColonyId && gameId !== raid.targetColonyId) continue;
            // Found the defender. File the incoming raid alert.
            if (!state.worldMap) state.worldMap = { incomingRaids: [] };
            if (!Array.isArray(state.worldMap.incomingRaids)) state.worldMap.incomingRaids = [];
            // Dedupe by raidId.
            if (!state.worldMap.incomingRaids.some((r: any) => r.raidId === raid.raidId)) {
              state.worldMap.incomingRaids.push({
                raidId: raid.raidId,
                attackerWorldId: raid.attackerWorldId,
                attackerWorldName: raid.attackerWorldName || raid.attackerWorldId,
                attackerNames: raid.attackerNames || [],
                targetColonyId: raid.targetColonyId,
                targetOwnerName: raid.targetOwnerName || "",
                shipCount: raid.shipCount || 0,
                shipClasses: Array.isArray(raid.shipClasses) ? raid.shipClasses : [],
                troopCount: raid.troopCount || 0,
                landsAt: raid.landsAt,
                launchedAt: raid.launchedAt,
                seen: false,
              });
            }
            // NO mailbox warning (owner 2026-10-03). Detection is satellite-only.
            // Satellite klaxon: if the defender's node satellite (stage >= 1)
            // sees the raid, fire the alarm on the defender's state AND every
            // alliance member's state. Blind (stage 0) = nothing.
            colonyNodeId(state);
            const rec = state.worldMap.incomingRaids.find((r: any) => r.raidId === raid.raidId);
            const alarm = rec ? checkRaidAlarm(state, rec, Date.now()) : null;
            if (alarm) {
              state.raidAlarm = alarm;
              rec.alarmFired = true;
              // Alliance-wide: the whole war band hears the klaxon.
              const alliance = allianceOf(state, raid.targetColonyId);
              const memberIds = new Set((alliance?.members ?? []).map((m: any) => m.colonyId));
              memberIds.delete(raid.targetColonyId);
              if (memberIds.size > 0) {
                for (const { accountId: aid2, saves: saves2 } of all) {
                  for (const [gid2, st2] of Object.entries(saves2.games || {})) {
                    const ms = st2 as any;
                    const cid = ms.gameId || gid2;
                    if (!memberIds.has(cid)) continue;
                    if (!ms.raidAlarm) {
                      ms.raidAlarm = JSON.parse(JSON.stringify(alarm));
                    }
                    // Mark their copy of the raid alarmed too (if they hold one).
                    const mrec = ms.worldMap?.incomingRaids?.find((r: any) => r.raidId === raid.raidId);
                    if (mrec) mrec.alarmFired = true;
                    if (!touched.has(aid2)) touched.set(aid2, saves2);
                    memberIds.delete(cid);
                  }
                  if (memberIds.size === 0) break;
                }
              }
            }
            await saveAccountSaves(accountId, saves);
            delivered = true;
            break;
          }
          if (delivered) break;
        }
        for (const [aid, saves] of touched) await saveAccountSaves(aid, saves);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, delivered }));
      } catch (e: any) {
        console.error("[raid-incoming] failed", e);
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: e?.message || "failed" }));
      }
      return;
    }
    // Cross-server raid battle results (owner 2026-10-03).
    // POST /api/raid-result { secret, result: RaidResultPayload }
    // Called by the attacker's server when the battle resolves.
    if (pathname === "/api/raid-result" && req.method === "POST") {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      try {
        const body = await readJsonBody(req);
        const expectedSecret = process.env.RAID_SHARED_SECRET || "unbound-raid-test-2026";
        if (body.secret !== expectedSecret) {
          res.statusCode = 403;
          res.end(JSON.stringify({ ok: false, error: "invalid_secret" }));
          return;
        }
        const result = body.result;
        if (!result?.targetColonyId || !result?.raidId) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: "bad_payload" }));
          return;
        }
        const { loadAllSaves, saveAccountSaves } = await import("./src/game/store");
        const { sendMail } = await import("./src/game/mailbox");
        const all = await loadAllSaves();
        let delivered = false;
        for (const { accountId, saves } of all) {
          for (const [gameId, st] of Object.entries(saves.games || {})) {
            const state = st as any;
            if (state.gameId !== result.targetColonyId && gameId !== result.targetColonyId) continue;
            // Mark the incoming alert as resolved.
            if (Array.isArray(state.worldMap?.incomingRaids)) {
              const alert = state.worldMap.incomingRaids.find((r: any) => r.raidId === result.raidId);
              if (alert) {
                alert.resolved = true;
                alert.won = result.won;
                alert.lootTaken = result.lootTaken;
              }
            }
            // The fight is over — stand down the klaxon (defender + allies).
            if (state.raidAlarm?.raidId === result.raidId) state.raidAlarm = null;
            const { allianceOf: allianceOf2 } = await import("./src/game/war/alliances.js");
            const alliance2 = allianceOf2(state, result.targetColonyId);
            const allyIds = new Set((alliance2?.members ?? []).map((m: any) => m.colonyId));
            allyIds.delete(result.targetColonyId);
            const touched2 = new Map<string, any>();
            if (allyIds.size > 0) {
              for (const { accountId: aid3, saves: saves3 } of all) {
                for (const [gid3, st3] of Object.entries(saves3.games || {})) {
                  const ms3 = st3 as any;
                  const cid3 = ms3.gameId || gid3;
                  if (!allyIds.has(cid3)) continue;
                  if (ms3.raidAlarm?.raidId === result.raidId) ms3.raidAlarm = null;
                  const ar3 = ms3.worldMap?.incomingRaids?.find((r: any) => r.raidId === result.raidId);
                  if (ar3) ar3.resolved = true;
                  if (!touched2.has(aid3)) touched2.set(aid3, saves3);
                  allyIds.delete(cid3);
                }
                if (allyIds.size === 0) break;
              }
              for (const [aid, sv] of touched2) await saveAccountSaves(aid, sv);
            }
            // Apply resource losses (what was looted).
            const loot = result.lootTaken || {};
            if (state.resources) {
              state.resources.supplies = Math.max(0, (state.resources.supplies || 0) - (loot.supplies || 0));
              state.resources.embers = Math.max(0, (state.resources.embers || 0) - (loot.embers || 0));
              state.resources.gas = Math.max(0, (state.resources.gas || 0) - (loot.fuel || 0));
            }
            // Mailbox battle report.
            const names = (result.attackerNames || []).join(", ") || "raiders";
            const outcome = result.won
              ? `They broke through and looted your stores.`
              : `Your defenses held — they were repelled.`;
            sendMail(state, {
              from: "system",
              subject: `⚔️ Raid ${result.won ? "lost" : "repelled"}: ${names}`,
              body: `${outcome} Your losses: ~${result.defenderLosses || 0} troops. Loot taken: ${loot.supplies || 0} supplies, ${loot.embers || 0} embers.`,
              category: "battle",
              sentAt: Date.now(),
            });
            await saveAccountSaves(accountId, saves);
            delivered = true;
            break;
          }
          if (delivered) break;
        }
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, delivered }));
      } catch (e: any) {
        console.error("[raid-result] failed", e);
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: e?.message || "failed" }));
      }
      return;
    }
    // The Xsolla webhook is intercepted at the transport layer, exactly like
    // serve.ts does: TanStack Start route files are not the seam for a route
    // that must read the UNPARSED body (the signature is over the exact bytes)
    // and answer with status codes rather than a page.
    if (pathname === XSOLLA_WEBHOOK_PATH) {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.setHeader("allow", "POST");
        res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const rawBody = Buffer.concat(chunks).toString("utf-8");
      const signatureHeader =
        typeof req.headers.authorization === "string"
          ? req.headers.authorization
          : null;
      const webRes = webhookResponse(
        await handleXsollaWebhookRequest({ rawBody, signatureHeader })
      );
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(await webRes.text());
      return;
    }
    const webRes = await fetchHandler.fetch(toWebRequest(req));
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    if (webRes.body) {
      const reader = webRes.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (error) {
    // Log the detail server-side (captured by the host's function logs); never
    // return a stack trace to the public visitor of the site.
    console.error("[team-site] SSR request failed", error);
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain");
    res.end("Internal Server Error");
  }
}
