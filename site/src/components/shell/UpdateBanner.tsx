// UpdateBanner — "a new version is ready."
//
// Mounted once at the root, inside the i18n provider. It stays invisible until
// the service worker stages a newer build (see game/pwa/register.ts), then it
// shows one line with an Update button. Tapping it reloads onto the fresh
// bundle — the worker already skipWaits + claims, so a plain reload is enough.
//
// There is no dismiss button on purpose: the banner only exists while a real,
// downloaded update is waiting, and it is one line tall.
import { useEffect, useState } from "react";
import { applyUpdate, isUpdateReady, onUpdateAvailable } from "../../game/pwa/register";
import { useT } from "../i18n/I18n";

export default function UpdateBanner() {
  const t = useT();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(isUpdateReady());
    return onUpdateAvailable(() => setReady(true));
  }, []);

  if (!ready) return null;

  return (
    <div
      role="status"
      data-testid="update-banner"
      className="fixed inset-x-3 top-[calc(env(safe-area-inset-top,0px)+8px)] z-50 flex items-center gap-3 rounded-xl border border-ember/40 bg-[#141007]/95 px-4 py-2.5 shadow-lg backdrop-blur"
    >
      <span className="min-h-tap flex flex-1 items-center text-[13px] font-medium text-amber-100">
        {t("update.ready", "A new version is ready.")}
      </span>
      <button
        type="button"
        data-testid="update-cta"
        onClick={applyUpdate}
        className="min-h-tap shrink-0 rounded-lg bg-ember px-4 text-[13px] font-bold text-black hover:brightness-110 active:brightness-95"
      >
        {t("update.cta", "Update now")}
      </button>
    </div>
  );
}
