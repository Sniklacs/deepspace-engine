// SERVER REGISTRY — cross-server raid protocol (owner 2026-10-03).
//
// The six worlds are separate Vercel deployments with separate databases.
// For cross-server raids to work, the attacker's server must notify the
// defender's server via HTTP. This registry maps worldId → server URL.
//
// In production, all six worlds will be registered here. For testing,
// Watchers (phone) and Draconians (tablet) are the two live worlds.

export interface ServerEntry {
  worldId: string;
  url: string;
  raceLock: string;
}

/** Known worlds. Override via WORLD_REGISTRY_JSON env var (JSON array). */
function loadRegistry(): ServerEntry[] {
  // Env override first (for deployments).
  if (typeof process !== "undefined" && process.env?.WORLD_REGISTRY_JSON) {
    try {
      const parsed = JSON.parse(process.env.WORLD_REGISTRY_JSON);
      if (Array.isArray(parsed)) return parsed as ServerEntry[];
    } catch {}
  }
  // Built-in registry for the live test worlds.
  return [
    {
      worldId: "watchers-world",
      url: "https://the-unbound-chi.vercel.app",
      raceLock: "watchers",
    },
    {
      worldId: "watchers-beta",
      url: "https://the-unbound-chi.vercel.app",
      raceLock: "watchers",
    },
    {
      worldId: "draconians-world",
      url: "https://the-unbound-draconians.vercel.app",
      raceLock: "draconians",
    },
  ];
}

let _registry: ServerEntry[] | null = null;

export function serverRegistry(): ServerEntry[] {
  if (!_registry) _registry = loadRegistry();
  return _registry;
}

/** Get the server URL for a worldId, or null if unknown. */
export function serverUrlFor(worldId: string): string | null {
  const entry = serverRegistry().find((s) => s.worldId === worldId);
  return entry?.url ?? null;
}

/** Shared secret for server-to-server raid calls. Must match on both ends. */
export function raidSharedSecret(): string {
  if (typeof process !== "undefined" && process.env?.RAID_SHARED_SECRET) {
    return process.env.RAID_SHARED_SECRET;
  }
  // Test default — set RAID_SHARED_SECRET in production.
  return "unbound-raid-test-2026";
}
