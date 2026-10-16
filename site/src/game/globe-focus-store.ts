/**
 * GLOBE FOCUS STORE — tap-to-fly (owner 2026-10-16): a coordinate chip in
 * chat (or any surface outside the World page) asks the globe to fly
 * somewhere. Same one-shared-door pattern as the material sheet store:
 * any component can call `requestGlobeFocus` with a plain call, no prop
 * threading; the Play page subscribes, switches to the World tab, and
 * hands the target to the World view, which flies the camera there.
 */

import type { GlobeFocusTarget } from "../components/WorldGlobe";

let pending: GlobeFocusTarget | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** Ask the globe to fly to (lat, lon). Safe to call from anywhere. */
export function requestGlobeFocus(lat: number, lon: number): void {
  pending = { lat, lon, nonce: Date.now() + Math.random() };
  emit();
}

export function subscribeGlobeFocus(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Read and clear the pending request (the Play page consumes it). */
export function takeGlobeFocus(): GlobeFocusTarget | null {
  const p = pending;
  pending = null;
  return p;
}
