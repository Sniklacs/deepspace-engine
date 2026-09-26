// I18n.tsx — the React half of the language foundation.
//
// Three jobs, in this order:
//
//  1. RESOLVE BEFORE FIRST PAINT. The inline boot script in __root reads the
//     device record and hides the app (class `i18n-boot` on <html>) whenever the
//     device is not a settled English one. This provider applies the resolved
//     language to the document and only then removes that class — so a Spanish
//     player's first painted frame is Spanish, never an English flash-and-swap.
//     `clientReady` exists precisely so the hydration render still matches the
//     server's English HTML: React hydrates English (invisible), the store
//     reports the device truth, and the un-hide happens on that second,
//     pre-paint commit.
//
//  2. HAND OUT `t()`. `useT()` returns a lookup bound to the language in force;
//     changing the language re-renders every subscriber (no reload, no refetch).
//
//  3. MEET THE PLAYER AT THE DOOR. `LanguageGate` shows the picker on a device
//     that has never chosen (L1: first run, before the game door), on ANY route,
//     so a player who cannot read English is never stuck on a page they cannot
//     read. It is a real overlay, not a redirect: the app is already mounted in
//     the suggested language underneath.
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import {
  SOURCE_LANG,
  applyToDocument,
  deviceServerSnapshot,
  deviceSnapshot,
  makeT,
  subscribeDevice,
} from "../../game/i18n";
import type { DeviceSettings, T } from "../../game/i18n";
import { LanguagePicker } from "./LanguagePicker";

const LangContext = createContext<string>(SOURCE_LANG);
const TContext = createContext<T>(makeT(SOURCE_LANG));

export function I18nProvider({ children }: { children: ReactNode }) {
  const settings = useSyncExternalStore(subscribeDevice, deviceSnapshot, deviceServerSnapshot);
  const [clientReady, setClientReady] = useState(false);

  // After hydration only: the store's real device value becomes the truth.
  useEffect(() => setClientReady(true), []);

  const lang = clientReady ? settings.lang : SOURCE_LANG;
  const t = useMemo(() => makeT(lang), [lang]);

  // Before paint, on the commit that carries the resolved language: stamp the
  // document and lift the boot veil (see device.applyToDocument).
  useLayoutEffect(() => {
    if (clientReady) applyToDocument(settings);
  }, [clientReady, settings]);

  return (
    <LangContext.Provider value={lang}>
      <TContext.Provider value={t}>{children}</TContext.Provider>
    </LangContext.Provider>
  );
}

/** The lookup the UI holds: `t("nav.colony")`, `t("ribbon.pill", { label, value })`. */
export function useT(): T {
  return useContext(TContext);
}

/** The language in force right now (always a shipped code; English by default). */
export function useLang(): string {
  return useContext(LangContext);
}

/** Everything device-shaped the Settings sheet edits (L9). */
export function useDeviceSettings(): DeviceSettings {
  return useSyncExternalStore(subscribeDevice, deviceSnapshot, deviceServerSnapshot);
}

/**
 * The first-run picker. Renders nothing until hydration (the server cannot know
 * a device's choice), nothing once a choice exists, and a fixed overlay
 * otherwise — above the app, on every route.
 */
export function LanguageGate() {
  const settings = useDeviceSettings();
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => setClientReady(true), []);
  if (!clientReady || settings.chosen) return null;
  return <LanguagePicker firstRun suggested={settings.suggested} />;
}
