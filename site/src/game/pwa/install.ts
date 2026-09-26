// install.ts — WHERE AN INSTALL IS POSSIBLE, as a pure function.
//
// The install affordance is the one piece of app-shell chrome that must be able
// to say "no". A browser with no install path (desktop Firefox, an in-app
// browser, anything already installed) gets nothing at all — no button that
// quietly does nothing, no instruction for a menu that does not exist. Keeping
// that decision in one pure function, with the platform facts passed in, is what
// lets `pwa-tests` prove the standalone case hides the affordance instead of
// hoping a media query is enough.
//
// The four answers:
//   standalone  → already installed (display-mode: standalone, or iOS's own
//                 `navigator.standalone`): there is nothing to offer.
//   prompt      → Chromium told us it can install (`beforeinstallprompt`): show
//                 the real button, which opens the real browser dialog.
//   ios         → iOS/iPadOS has no install event at all; the honest affordance
//                 is the true instruction (Share → Add to Home Screen).
//   unavailable → everywhere else: show nothing.

export type InstallPath = "standalone" | "prompt" | "ios" | "unavailable";

export interface InstallInputs {
  /** `matchMedia("(display-mode: standalone)").matches` || iOS `navigator.standalone` */
  standalone: boolean;
  /** true once the browser has fired `beforeinstallprompt` */
  hasPrompt: boolean;
  /** `navigator.userAgent` (empty string on the server) */
  userAgent: string;
}

/**
 * iOS and iPadOS — detected by platform, not by "Safari": every iOS browser runs
 * WebKit and installs the same way, through the Share sheet, so the instruction
 * is correct for all of them. iPadOS 13+ reports a Macintosh user agent with
 * touch points, which is why the touch test is here.
 */
export function isIos(userAgent: string): boolean {
  if (!userAgent) return false;
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && /Mobile\//.test(userAgent);
}

export function installPath(inputs: InstallInputs): InstallPath {
  if (inputs.standalone) return "standalone";
  if (inputs.hasPrompt) return "prompt";
  if (isIos(inputs.userAgent)) return "ios";
  return "unavailable";
}

/** True when the affordance should be visible at all. */
export function showsInstall(path: InstallPath): boolean {
  return path === "prompt" || path === "ios";
}

/** Where the dismissal of the first-screen card is remembered (per device). */
export const INSTALL_DISMISS_KEY = "dse.install.v1";

/** True when a launched-from-home-screen session is already running. */
export function isRunningStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
    if (window.matchMedia?.("(display-mode: fullscreen)").matches) return true;
    if (window.matchMedia?.("(display-mode: minimal-ui)").matches) return true;
    // iOS Safari's own flag — `display-mode` is not always honoured there.
    return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}
