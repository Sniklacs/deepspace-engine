// runtime/engine.ts — THE BROWSER-NATIVE TRANSLATION RUNTIME.
//
// Updated 2026-10-01 (owner: the chat Translate button must actually work).
// The 603 MB bundled-model plan stays intact in `model-manifest.ts` as the later
// slice, but shipping it means every player downloads 600 MB — against the
// lean-app rule — and no runtime for it exists in this repository. The phone's
// OWN translator (the built-in Translator API: on-device after a language-pack
// download, no server, no key, no app weight) answers the same seam, so the
// button works today. The weights pipeline in `index.ts` remains the fallback:
// where the browser has no translator, the pipeline ends in the honest
// "translation is preparing" state, exactly as before.
//
// (The seam's old note rejected this API because it "does not work on mobile" —
// that was true of the 2024 docs and is not true anymore: it ships in Chrome on
// Android, the phones this game targets. Nothing cloud-based is involved: the
// language packs live on the device.)
//
// HONESTY CONTRACT (unchanged): `createRuntime` returns null when the browser
// has no translator, and `translate()` returns null for any pair the browser
// cannot do — never the input echoed back, never a guess. The UI's preparing
// state is the truth then, not a placeholder.

import type { ModelProfile } from "../model-manifest";

export interface TranslatorRuntimeContext {
  model: ModelProfile;
  /** the cached weights, chunk by chunk and in order — never one 603 MB buffer */
  readWeights: () => AsyncIterable<Uint8Array>;
  /** the Cache Storage bucket the weights live in (`dse-model-v1`) */
  cacheName: string;
}

export interface TranslatorRuntime {
  /** for the diagnostics line, e.g. "browser-translator" */
  name: string;
  /** null when it cannot translate this string — never the input echoed back */
  translate(text: string, from: string, to: string): Promise<string | null>;
  /**
   * Optional: fill a translation key the catalogues are missing, given its English
   * source. Synchronous by contract — `engine-seam.ts` consults it inside a render, so
   * it may only answer what it already knows; return null when it cannot. A runtime
   * that omits it is simply silent and the catalogue's own fallbacks take over.
   */
  key?(key: string, lang: string, englishSource: string): string | null;
  dispose?(): void;
}

/** The game's five codes -> the BCP-47 the browser API wants. */
function apiLang(code: string): string {
  return code === "pt-BR" ? "pt" : code;
}

type Availability = "available" | "downloadable" | "downloading" | "unavailable";

interface BrowserTranslator {
  translate(text: string): Promise<string>;
  destroy(): void;
}

/** Chrome 138+ shape (`window.Translator`), with the legacy adapter below. */
interface TranslatorNS {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  createTranslator(opts: { sourceLanguage: string; targetLanguage: string }): Promise<BrowserTranslator>;
}

function translatorNS(): TranslatorNS | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    Translator?: TranslatorNS;
    translation?: { createTranslator: TranslatorNS["createTranslator"] };
  };
  if (w.Translator && typeof w.Translator.availability === "function") return w.Translator;
  if (w.translation && typeof w.translation.createTranslator === "function") {
    // Pre-138 shape: no availability() — creation itself fetches what it needs,
    // and throws for a pair the browser cannot do (caught by the caller).
    const create = w.translation.createTranslator.bind(w.translation);
    return {
      availability: () => Promise.resolve<Availability>("downloadable"),
      createTranslator: (opts) => create(opts),
    };
  }
  return null;
}

export async function createRuntime(_ctx: TranslatorRuntimeContext): Promise<TranslatorRuntime | null> {
  const maybeNS = translatorNS();
  if (!maybeNS) return null; // no browser translator: the honest "preparing" state stands
  // Bind to a non-null-typed const so the pair() closures below keep the type.
  const NS: TranslatorNS = maybeNS;

  const cache = new Map<string, Promise<BrowserTranslator | null>>();

  function pair(from: string, to: string): Promise<BrowserTranslator | null> {
    const f = apiLang(from);
    const t = apiLang(to);
    if (f === t) return Promise.resolve(null);
    const key = `${f}::${t}`;
    let p = cache.get(key);
    if (!p) {
      p = (async (): Promise<BrowserTranslator | null> => {
        try {
          const avail = await NS.availability({ sourceLanguage: f, targetLanguage: t });
          if (avail === "unavailable") return null;
          // "downloadable"/"downloading": creation pulls the language pack onto
          // the device; the promise resolves when it is ready to translate.
          return await NS.createTranslator({ sourceLanguage: f, targetLanguage: t });
        } catch {
          return null;
        }
      })();
      cache.set(key, p);
    }
    return p;
  }

  return {
    name: "browser-translator",
    async translate(text: string, from: string, to: string): Promise<string | null> {
      const clean = text.trim();
      if (!clean) return null;
      const tr = await pair(from, to);
      if (!tr) return null;
      try {
        const out = await tr.translate(clean);
        return typeof out === "string" && out.trim().length > 0 ? out : null;
      } catch {
        return null;
      }
    },
    dispose(): void {
      for (const p of cache.values()) {
        void p.then((tr) => {
          try {
            tr?.destroy();
          } catch {
            /* a dying translator is not an error */
          }
        });
      }
      cache.clear();
    },
  };
}
