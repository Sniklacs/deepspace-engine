// storage.ts — ON-DEVICE STORAGE, measured and asked for honestly.
//
// This is the slot the local translation engine lands in (the owner's next
// slice: "put the local translator inside it"). A model file is large, so two
// things have to be true BEFORE anything is downloaded, and both are checks this
// module performs rather than assumptions it makes:
//
//   1. There is room, and the browser will keep it. `navigator.storage.estimate()`
//      reports what this origin may use; `persist()` asks the browser not to
//      evict us under pressure. A phone that refuses persistence gets a truthful
//      "no", and the caller must not download a model it cannot keep.
//   2. The file has a named, versioned home. `MODEL_CACHE` is that home: a
//      Cache Storage bucket separate from the app shell's, so replacing the model
//      never touches the shell's cache and vice versa.
//
// NOTHING IS DOWNLOADED HERE. No model, no request, no fetch — this module is
// capability and measurement only. `pwa-tests` asserts that it stays that way.
//
// Everything is SSR-safe: with no `navigator` (the server render) every call
// reports "unsupported" rather than throwing.

/** The bucket a cached model file lands in. Versioned like the shell caches. */
export const MODEL_CACHE = "dse-model-v1";

/** Where the "we have already asked this device" flag lives (per device). */
export const PERSIST_ASKED_KEY = "dse.storage.v1";

export interface StorageReport {
  /** false on the server, and on any browser without the StorageManager API */
  supported: boolean;
  /** bytes this origin has stored (null when unknown) */
  usage: number | null;
  /** bytes this origin may use (null when unknown) */
  quota: number | null;
  /** true = the browser promises not to evict it; false = it may; null = unknown */
  persisted: boolean | null;
  /** bytes still free inside the quota (null when unknown) */
  headroom: number | null;
}

function storageManager(): StorageManager | null {
  if (typeof navigator === "undefined") return null;
  const sm = (navigator as Navigator & { storage?: StorageManager }).storage;
  return sm ?? null;
}

/** What this device will actually allow, right now. Never throws. */
export async function storageReport(): Promise<StorageReport> {
  const sm = storageManager();
  if (!sm) return { supported: false, usage: null, quota: null, persisted: null, headroom: null };
  let usage: number | null = null;
  let quota: number | null = null;
  try {
    const estimate = await sm.estimate();
    usage = typeof estimate.usage === "number" ? estimate.usage : null;
    quota = typeof estimate.quota === "number" ? estimate.quota : null;
  } catch {
    /* an estimate that fails is "unknown", never a wrong number */
  }
  let persisted: boolean | null = null;
  try {
    if (typeof sm.persisted === "function") persisted = await sm.persisted();
  } catch {
    /* same */
  }
  return {
    supported: true,
    usage,
    quota,
    persisted,
    headroom: usage !== null && quota !== null ? Math.max(0, quota - usage) : null,
  };
}

/**
 * Ask the browser to keep what we store. Returns the real answer — a refusal is
 * a fact the caller must handle, not an error to hide. Some browsers resolve
 * false with no prompt at all (they decided already), so the return value is the
 * only thing worth reporting.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const sm = storageManager();
  if (!sm || typeof sm.persist !== "function") return false;
  try {
    if (typeof sm.persisted === "function" && (await sm.persisted())) return true;
    return await sm.persist();
  } catch {
    return false;
  }
}

/** The named, versioned home a model file is fetched into (a Cache Storage key). */
export function modelCacheSlot(): { cacheName: string; url: string } {
  return { cacheName: MODEL_CACHE, url: `/${MODEL_CACHE}/model` };
}

/**
 * "1.2 GB" / "640 MB" / "12 KB" — a size a player can read. Decimal units, which
 * is what every browser's own storage screen shows, so the two never disagree.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** Has this device already been asked to keep our data? (per device, like L9) */
export function persistAlreadyAsked(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PERSIST_ASKED_KEY) === "asked";
  } catch {
    return false;
  }
}

export function markPersistAsked(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PERSIST_ASKED_KEY, "asked");
  } catch {
    /* private mode: the flag simply does not stick */
  }
}
