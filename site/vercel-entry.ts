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
    // Stockpiled resources
    game.resources.supplies = 500000;
    game.resources.embers = 5000;
    game.resources.chipsets = 500;
    game.resources.alloys = 100;
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

    const saves = {
      version: 2,
      activeGameId: "0",
      games: { "0": game },
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
      });
    }
  }
  const alliance = {
    id: allianceId,
    name: "Ashen Vanguard",
    banner: "🔥",
    motto: "From ash, victory.",
    members: testPlayers.map((tp, i) => ({
      accountId: tp.name.toLowerCase(),
      colonyName: tp.display,
      role: i === 0 ? "founder" : "member",
      joinedAt: day60,
    })),
    applications: [],
    invites: [],
    foundedAt: day60,
    founderId: "testwarlord1",
    homeServerId: "draconians-world",
    version: 1,
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
    if (data.games && data.games["0"]) {
      data.games["0"].alliances = { [allianceId]: alliance };
      await sql`UPDATE saves SET data = ${JSON.stringify(data)}::jsonb WHERE account_id = 'testwarlord1'`;
    }
  }
  results.alliance = { id: allianceId, name: "Ashen Vanguard", ships: ships.length };

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
    if (pathname === "/api/seed" && req.method === "POST") {
      const url = new URL(req.url ?? "/", `https://${req.headers.host ?? "localhost"}`);
      const key = url.searchParams.get("key");
      const expectedKey = process.env.SEED_KEY || "draconian-test-seed-2026";
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      if (key !== expectedKey) {
        res.statusCode = 403;
        res.end(JSON.stringify({ ok: false, error: "invalid_key" }));
        return;
      }
      try {
        const result = await runSeed();
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
