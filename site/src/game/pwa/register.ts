// register.ts — the client end of the app shell: register the worker, catch the
// install offer, and hand the browser's own dialog to the UI.
//
// Two rules the UI depends on:
//   • the worker is registered from the ROOT SCOPE (`/sw.js` → scope "/"), so
//     every route of the app is inside its reach;
//   • the install offer is kept, not consumed. `beforeinstallprompt` fires once
//     and its event can be used once, so it is stored (and re-announced to the
//     UI) rather than being acted on the moment it arrives — the player taps a
//     button, and only then does `prompt()` run, from inside that tap.
//
// Nothing here touches game state, the account, or the API.

export const SW_PATH = "/sw.js";

/** Subscribe/unsubscribe for the install offer. */
type Listener = () => void;
const listeners = new Set<Listener>();

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallEvent | null = null;
let installed = false;

function announce() {
  for (const fn of listeners) fn();
}

export function onInstallChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The offer the browser made, if it is still unspent. */
export function deferredInstallPrompt(): { available: boolean } {
  return { available: deferred !== null };
}

/**
 * Open the browser's install dialog. Only ever called from a real tap — and it
 * consumes the stored offer either way, so a second tap cannot promise something
 * the browser will no longer do.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  deferred = null;
  announce();
  if (!event) return "unavailable";
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    return "unavailable";
  }
}

/** True once the app was actually installed during this session. */
export function wasInstalled(): boolean {
  return installed;
}

let wired = false;

/**
 * Wire the install events. Idempotent, and safe to call on any render.
 */
export function watchInstallEvents(): () => void {
  if (typeof window === "undefined" || wired) return () => {};
  wired = true;
  const onOffer = (e: Event) => {
    // The browser's own mini-infobar is suppressed: the affordance decides where
    // and when the dialog opens, and never twice.
    e.preventDefault();
    deferred = e as InstallEvent;
    announce();
  };
  const onInstalled = () => {
    installed = true;
    deferred = null;
    announce();
  };
  window.addEventListener("beforeinstallprompt", onOffer);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onOffer);
    window.removeEventListener("appinstalled", onInstalled);
    wired = false;
  };
}

/**
 * Register the service worker. Production only: in the Vite dev server there is
 * no hashed build output to precache, and a dev-time worker would sit between a
 * teammate and their own edits. Returns the registration (or null when skipped
 * or unsupported), so a caller can log it.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!import.meta.env.PROD) return null;
  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
    return registration;
  } catch {
    // A failed registration must never break the game: the app works without a
    // worker, it just cannot be installed or launched offline.
    return null;
  }
}
