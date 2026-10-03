// RAID DELIVERY — server-to-server HTTP for cross-server raids (owner 2026-10-03).
//
// The attacker's server notifies the defender's server at two points:
//   1. Launch → POST /api/raid-incoming (defender gets warned)
//   2. Battle resolves → POST /api/raid-result (defender gets battle report)
//
// These run in the api.ts server-function layer (not the pure engine),
// because they need network access. Failures are logged, not fatal —
// the raid proceeds locally even if the defender's server is unreachable.

import { serverUrlFor, raidSharedSecret } from "./server-registry";
import type { IncomingRaidPayload, RaidResultPayload } from "./raid-protocol";

/** POST a raid-incoming warning to the defender's server. */
export async function deliverRaidWarning(
  targetWorldId: string,
  payload: IncomingRaidPayload,
): Promise<{ ok: boolean; error?: string }> {
  const url = serverUrlFor(targetWorldId);
  if (!url) {
    console.warn(`[raid-delivery] no server URL for world ${targetWorldId} — warning not delivered`);
    return { ok: false, error: "unknown_world" };
  }
  try {
    const res = await fetch(`${url}/api/raid-incoming`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: raidSharedSecret(), raid: payload }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[raid-delivery] raid-incoming failed: ${res.status} ${text}`);
      return { ok: false, error: `http_${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    console.warn(`[raid-delivery] raid-incoming network error:`, e?.message || e);
    return { ok: false, error: "network_error" };
  }
}

/** POST a battle result to the defender's server. */
export async function deliverRaidResult(
  targetWorldId: string,
  payload: RaidResultPayload,
): Promise<{ ok: boolean; error?: string }> {
  const url = serverUrlFor(targetWorldId);
  if (!url) {
    console.warn(`[raid-delivery] no server URL for world ${targetWorldId} — result not delivered`);
    return { ok: false, error: "unknown_world" };
  }
  try {
    const res = await fetch(`${url}/api/raid-result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: raidSharedSecret(), result: payload }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[raid-delivery] raid-result failed: ${res.status} ${text}`);
      return { ok: false, error: `http_${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    console.warn(`[raid-delivery] raid-result network error:`, e?.message || e);
    return { ok: false, error: "network_error" };
  }
}
