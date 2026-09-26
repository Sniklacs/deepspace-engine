// InstallAffordance — the honest way into the home screen.
//
// Three states, and no fourth:
//   • the browser offered an install (`beforeinstallprompt`) → a real button that
//     opens the browser's own dialog, on the player's tap;
//   • iOS, which has no install event at all → the true instruction, Share →
//     Add to Home Screen, because a button there could only lie;
//   • already installed, or no install path at all → NOTHING is rendered. No
//     dead button, no instruction for a menu that does not exist.
//
// The decision itself lives in `game/pwa/install.ts` (pure, testable); this file
// is only the surface. Two variants, one component: `card` on the landing page
// (dismissible — see INSTALL_DISMISS_KEY) and `row` in Settings, which stays
// there after a dismissal so the door is never closed for good.
//
// `data-install-path` on <html> is written for diagnostics and for the browser
// pass: it makes "the affordance hid itself, and why" measurable instead of
// eyeballed.
import { useEffect, useState } from "react";
import {
  INSTALL_DISMISS_KEY,
  installPath,
  isRunningStandalone,
  showsInstall,
} from "../../game/pwa/install";
import type { InstallPath } from "../../game/pwa/install";
import {
  deferredInstallPrompt,
  onInstallChange,
  promptInstall,
  watchInstallEvents,
} from "../../game/pwa/register";
import { Icon } from "../icons";
import { useT } from "../i18n/I18n";

/** The live install state this session is in. */
export function useInstallState(): { path: InstallPath; install: () => void } {
  const [standalone, setStandalone] = useState(true); // optimistic: hide until known
  const [hasPrompt, setHasPrompt] = useState(false);

  useEffect(() => {
    setStandalone(isRunningStandalone());
    const off = watchInstallEvents();
    setHasPrompt(deferredInstallPrompt().available);
    const unsubscribe = onInstallChange(() => setHasPrompt(deferredInstallPrompt().available));
    // A launch from the home screen changes display-mode without a reload in
    // some browsers; watch the query so the affordance can retire itself.
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia("(display-mode: standalone)");
      const onChange = () => setStandalone(isRunningStandalone());
      mq.addEventListener("change", onChange);
      return () => {
        off();
        unsubscribe();
        mq?.removeEventListener("change", onChange);
      };
    } catch {
      return () => {
        off();
        unsubscribe();
      };
    }
  }, []);

  const path = installPath({
    standalone,
    hasPrompt,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.installPath = path;
  }, [path]);

  return { path, install: () => void promptInstall() };
}

/** Has the landing card been dismissed on this device? */
function readDismissed(): boolean {
  if (typeof window === "undefined") return true; // nothing to show while rendering on the server
  try {
    return window.localStorage.getItem(INSTALL_DISMISS_KEY) === "dismissed";
  } catch {
    return false;
  }
}

export default function InstallAffordance({ variant }: { variant: "card" | "row" }) {
  const t = useT();
  const { path, install } = useInstallState();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => setDismissed(readDismissed()), []);

  if (!showsInstall(path)) return null;
  if (variant === "card" && dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(INSTALL_DISMISS_KEY, "dismissed");
    } catch {
      /* private mode — it comes back next visit, which is honest */
    }
  };

  const action = (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {path === "prompt" ? (
        <button
          type="button"
          data-testid="install-cta"
          onClick={install}
          className="flex min-h-tap items-center gap-2 rounded-xl bg-ember px-4 text-[13px] font-semibold text-black hover:brightness-110"
        >
          <Icon name="beacon" size={16} aria-hidden="true" />
          {t("install.cta")}
        </button>
      ) : (
        <p className="text-[13px] leading-snug text-text-2" data-testid="install-ios">
          {t("install.ios")}
        </p>
      )}
      {variant === "card" ? (
        <button
          type="button"
          data-testid="install-dismiss"
          onClick={dismiss}
          className="min-h-tap rounded-xl border border-line px-4 text-[13px] font-medium text-text-3 hover:text-text-1"
        >
          {t("install.dismiss")}
        </button>
      ) : null}
    </div>
  );

  if (variant === "row") {
    return (
      <div className="rounded-xl border border-line bg-surf-3/50 px-3 py-2" data-testid="install-row">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-text-1">
          <Icon name="beacon" size={18} className="shrink-0 text-ember-soft" aria-hidden="true" />
          {t("install.title")}
        </span>
        <p className="mt-1 text-[11px] leading-snug text-text-3">{t("install.body")}</p>
        {action}
      </div>
    );
  }

  return (
    <section
      className="rounded-xl border border-ember/30 bg-ember/5 p-5 text-start"
      data-testid="install-card"
    >
      <h3 className="font-semibold text-ember-soft">{t("install.title")}</h3>
      <p className="mt-1 text-sm text-text-2">{t("install.body")}</p>
      {action}
    </section>
  );
}
