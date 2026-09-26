// device.ts — where language and interface size live (L9: "Language + graphics/
// text size are device-shaped → stored per device, and honoured before first
// sign-in").
//
// Pure, framework-free and SSR-safe: on the server every read returns defaults
// (there is no device), on the client it reads one localStorage record. Nothing
// here touches the account, the store or the network — the gate in
// `i18n-verify` asserts that, because "per device" is a promise about *where the
// value lives*, and a promise about behaviour is only as good as its wiring.

import { LANGS, LANG_CODES, SOURCE_LANG, matchLangTag, suggestLang } from "./languages";
import type { Catalogue } from "./types";

/** One record per device. Versioned so a shape change can migrate, not guess. */
export const DEVICE_KEY = "dse.device.v1";
/** The class the pre-paint boot script puts on <html> while it hides the app. */
export const BOOT_CLASS = "i18n-boot";
/** URL parameter that pins a language for one arrival (shareable, testable). */
export const LANG_QUERY = "lang";

export type TextSize = "normal" | "large" | "larger";
export type Quality = "full" | "reduced";

export interface DeviceSettings {
  /** the language in force right now, always a shipped code */
  lang: string;
  /** true once the player has actually chosen (or pinned via ?lang=) */
  chosen: boolean;
  /** what the browser asked for, when it is worth offering (L1: a suggestion) */
  suggested: string | null;
  textSize: TextSize;
  quality: Quality;
}

export function deviceDefaults(): DeviceSettings {
  return { lang: SOURCE_LANG, chosen: false, suggested: null, textSize: "normal", quality: "full" };
}

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readRecord(): Partial<DeviceSettings> & { lang?: string } {
  if (!hasWindow()) return {};
  try {
    const raw = window.localStorage.getItem(DEVICE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Partial<DeviceSettings>;
  } catch {
    return {}; // a corrupt record is not a crash — it is an un-chosen device
  }
}

function writeRecord(next: Partial<DeviceSettings>): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(DEVICE_KEY, JSON.stringify({ ...readRecord(), ...next }));
  } catch {
    /* private mode / quota: the choice holds for this session, nothing breaks */
  }
}

function urlLang(): string | null {
  if (!hasWindow()) return null;
  try {
    return matchLangTag(new URLSearchParams(window.location.search).get(LANG_QUERY));
  } catch {
    return null;
  }
}

function browserTags(): string[] {
  if (typeof navigator === "undefined") return [];
  const n = navigator as Navigator & { languages?: readonly string[] };
  const list = Array.isArray(n.languages) && n.languages.length > 0 ? [...n.languages] : [];
  if (n.language) list.push(n.language);
  return list;
}

/** The settings in force on this device, resolved once and cached. */
export function resolveDeviceSettings(): DeviceSettings {
  const rec = readRecord();
  const pinned = urlLang();
  const stored = LANG_CODES.includes(String(rec.lang)) ? String(rec.lang) : null;
  const suggested = suggestLang(browserTags());
  const lang = pinned ?? stored ?? suggested ?? SOURCE_LANG;
  const textSize: TextSize =
    rec.textSize === "large" || rec.textSize === "larger" ? rec.textSize : "normal";
  const quality: Quality = rec.quality === "reduced" ? "reduced" : "full";
  return { lang, chosen: !!(pinned ?? stored), suggested, textSize, quality };
}

// ---- a tiny store the UI subscribes to (no framework import here) -----------
let snapshot: DeviceSettings | null = null;
const listeners = new Set<() => void>();

export function deviceSnapshot(): DeviceSettings {
  if (!snapshot) snapshot = resolveDeviceSettings();
  return snapshot;
}

export function deviceServerSnapshot(): DeviceSettings {
  return deviceDefaults();
}

export function subscribeDevice(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

/** The player's choice: language, per device (L9), applied live and persisted. */
export function setDeviceLang(code: string): void {
  if (!LANG_CODES.includes(code)) return;
  writeRecord({ lang: code });
  snapshot = resolveDeviceSettings();
  applyToDocument(snapshot);
  emit();
}

export function setDeviceTextSize(size: TextSize): void {
  writeRecord({ textSize: size });
  snapshot = resolveDeviceSettings();
  applyToDocument(snapshot);
  emit();
}

export function setDeviceQuality(quality: Quality): void {
  writeRecord({ quality });
  snapshot = resolveDeviceSettings();
  applyToDocument(snapshot);
  emit();
}

/** What a player picked at first run, without pretending the browser locked it. */
export function chooseDeviceLang(code: string): void {
  if (!LANG_CODES.includes(code)) return;
  const wasChosen = deviceSnapshot().chosen;
  writeRecord({ lang: code, chosen: true });
  snapshot = { ...resolveDeviceSettings(), chosen: true };
  void wasChosen;
  applyToDocument(snapshot);
  emit();
}

// ---- the document, in one place --------------------------------------------
export function applyToDocument(s: DeviceSettings): void {
  if (!hasWindow() || typeof document === "undefined") return;
  const html = document.documentElement;
  const meta = LANGS.find((l) => l.code === s.lang) ?? LANGS[0];
  if (html.getAttribute("lang") !== s.lang) html.setAttribute("lang", s.lang);
  html.setAttribute("data-lang", s.lang);
  html.setAttribute("dir", meta.dir);
  html.setAttribute("data-text-size", s.textSize);
  html.setAttribute("data-quality", s.quality);
  html.classList.remove(BOOT_CLASS);
}

/** Test/utility door: drop the cached snapshot so the next read re-reads storage. */
export function resetDeviceCache(): void {
  snapshot = null;
}

// ---- the pre-paint boot script (see I18n boot in components/i18n) -----------
/**
 * A tiny inline script for <head>. It runs BEFORE first paint and, when the
 * device is not a settled English one, hides the app until React has rendered in
 * the resolved language — that is what stops an English flash-and-swap. It also
 * stamps `lang`/`data-lang` on <html> so the very first painted frame is already
 * in the right language.
 *
 * The code list is injected from the registry, so adding a language cannot leave
 * this script behind. The 2500ms un-hide is a failsafe: a device with JS blocked
 * mid-way shows the app in English rather than a blank screen (a `<noscript>`
 * rule in the root document covers JavaScript being off entirely).
 */
export function bootScript(codes: readonly string[] = LANG_CODES): string {
  return [
    "(function(){try{",
    `var c=${JSON.stringify(codes)},k=${JSON.stringify(DEVICE_KEY)},q=${JSON.stringify(LANG_QUERY)};`,
    "var d=null;try{d=JSON.parse(localStorage.getItem(k)||'null')}catch(e){}",
    "var p=null;try{p=new URLSearchParams(location.search).get(q)}catch(e){}",
    "var norm=function(t){if(!t)return null;t=String(t).replace(/_/g,'-');",
    "for(var i=0;i<c.length;i++){if(c[i].toLowerCase()===t.toLowerCase())return c[i]}",
    "var b=t.split('-')[0].toLowerCase();",
    "for(var j=0;j<c.length;j++){if(c[j].split('-')[0].toLowerCase()===b)return c[j]}return null};",
    "var pin=norm(p),sto=(d&&typeof d.lang==='string')?norm(d.lang):null;",
    "var tags=[];try{tags=(navigator.languages||[]).concat([navigator.language])}catch(e){}",
    "var sug=null;for(var m=0;m<tags.length&&!sug;m++)sug=norm(tags[m]);",
    "var lang=pin||sto||sug||'en',chosen=!!(pin||sto);",
    "var h=document.documentElement;h.setAttribute('lang',lang);h.setAttribute('data-lang',lang);",
    "if(lang!=='en'||!chosen){h.className+=' i18n-boot';",
    "setTimeout(function(){try{h.classList.remove('i18n-boot')}catch(e){}},2500);}",
    "}catch(e){try{document.documentElement.classList.remove('i18n-boot')}catch(e2){}}})();",
  ].join("");
}

/** Un-hide hook for the React side (kept here so class names live in one file). */
export function clearBootClass(): void {
  if (typeof document !== "undefined") document.documentElement.classList.remove(BOOT_CLASS);
}

/** Just for the picker: the languages as the picker must render them. */
export function shippedLanguages(): typeof LANGS {
  return LANGS;
}

/** Typed access for tests without dragging the catalogue into this module. */
export type DeviceCatalogue = Catalogue;
