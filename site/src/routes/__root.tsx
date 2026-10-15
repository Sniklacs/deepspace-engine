import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactNode } from "react";

import appCss from "~/styles/app.css?url";
import { bootScript } from "~/game/i18n";
import { IS_TEST_SURFACE, OG_IMAGE_URL, SITE_ORIGIN } from "~/game/site-origin";
import { inspectTranslator } from "~/game/translate";
import { initWindowAppearance } from "~/game/windows/window-appearance";
import { registerServiceWorker } from "~/game/pwa/register";
import UpdateBanner from "~/components/shell/UpdateBanner";
import { I18nProvider, LanguageGate } from "~/components/i18n/I18n";

/**
 * THE DOCUMENT HEAD — including everything the installable app shell needs.
 *
 * `viewport-fit=cover` is what lets a standalone launch use the whole screen,
 * notch included. That is a real trade, not a free upgrade: with the status bar
 * drawn OVER the page (`black-translucent`), the top of the chrome and the bottom
 * of the nav would sit under the cutout and the home indicator — which is why
 * `viewport-fit=cover` and the `env(safe-area-inset-*)` padding in styles/app.css
 * ship together and never one without the other.
 *
 * The manifest's own `name`/`short_name` stay English: the product's title is
 * transliterated by the owner's glossary rule, so there is nothing there to
 * translate. The INTERFACE's language and direction are resolved per device
 * before first paint by the boot script below (Persian included, `dir="rtl"`).
 */
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "The Unbound | Free Sci-Fi Strategy MMO — Six Worlds at War" },
      {
        name: "description",
        content:
          "Play The Unbound free in your browser: a sci-fi strategy MMO of colony-building and real-time war across six race worlds. Rebuild from the ruins, raid rival worlds, and earn heroes — never bought. No download.",
      },
      // THE SHARE CARD (SEO audit 2026-10-15): social scrapers (Facebook,
      // Telegram, WhatsApp, X) never run the app — for them this head IS the
      // pitch. og:url / canonical / og:image name THIS surface's own origin
      // (site-origin.ts derives it from the build's WORLD_ID), never a
      // sibling surface's URL.
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "The Unbound" },
      { property: "og:title", content: "The Unbound — Six Worlds. One War. Play Free in Your Browser." },
      {
        property: "og:description",
        content:
          "A free browser sci-fi strategy MMO. Found your colony in the ruins of the Shatterlands, wage real-time war across six race worlds, and earn heroes that can never be bought. No download — the war is live now.",
      },
      { property: "og:url", content: `${SITE_ORIGIN}/` },
      { property: "og:image", content: OG_IMAGE_URL },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "The Unbound — the Shatterlands" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "The Unbound — Six Worlds. One War. Play Free in Your Browser." },
      {
        name: "twitter:description",
        content:
          "A free browser sci-fi strategy MMO. Found your colony in the ruins of the Shatterlands, wage real-time war across six race worlds, and earn heroes that can never be bought. No download — the war is live now.",
      },
      { name: "twitter:image", content: OG_IMAGE_URL },
      // The Draconians TEST world must never be indexed or mistaken for the
      // real game (audit §4) — noindex applies to that build ONLY. Production
      // surfaces and the portal get no robots meta (index/follow default).
      ...(IS_TEST_SURFACE ? [{ name: "robots", content: "noindex, nofollow" }] : []),
      // The installable shell: dark chrome, matching the manifest's theme_color.
      { name: "theme-color", content: "#070910" },
      { name: "color-scheme", content: "dark" },
      { name: "application-name", content: "The Unbound" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "The Unbound" },
      // black-translucent = the page draws under the status bar. Safe because the
      // shell pads itself with the platform's own insets (styles/app.css §3c).
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    ],
    links: [
      // Canonical: this surface's own root, so the portal, the worlds, and
      // any preview domains don't split search ranking as duplicates.
      { rel: "canonical", href: `${SITE_ORIGIN}/` },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon-180.png", sizes: "180x180" },
    ],
  }),
  // THE EXIT LAW (owner 2026-10-13): no dead ends, ever. A stale install or a
  // mistyped link must never strand a player on bare text with only the
  // browser's own navigation to save them — the game carries its own door
  // back in. A plain anchor (full load) is deliberate: if the bundle that
  // rendered this page is the stale one, a client-side nav would keep it.
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#070910] px-6 text-center text-gray-200">
      <p className="text-lg font-semibold text-white">This corner of the Shatterlands isn&rsquo;t charted.</p>
      <p className="max-w-md text-sm text-gray-400">
        The page you&rsquo;re looking for isn&rsquo;t here — but your colony is.
      </p>
      <a
        href="/"
        className="rounded-lg bg-ember px-5 py-2.5 font-semibold text-black hover:brightness-110"
      >
        Back to the game
      </a>
    </div>
  ),
  component: RootComponent,
});

function RootComponent() {
  // Register the app shell's worker once, on the client, in production builds.
  // It precaches the shell and never touches game state (see public/sw.js).
  useEffect(() => {
    void registerServiceWorker();
    // The player's window chrome (Hans 2026-10-02): paint the saved
    // translucency + tint before anything else draws a window.
    initWindowAppearance();
    // THE BUNDLED TRANSLATOR — NEVER PREPARED AUTOMATICALLY (owner crash
    // fix, rounds 1+3, 2026-10-13). Preparing means starting a ~600 MB
    // weights download and, once the pack is on the device, constructing
    // the WASM engine with all of it in renderer memory. At boot that
    // OOM-killed mid-range Android WebViews before the solar system
    // painted; deferred to a timer + idle callback it killed them again
    // ~30 s after a smooth boot (Chrome's "Aw, Snap"). So boot does the
    // cheap thing only: INSPECT the device (reads the cache receipt,
    // starts nothing, cannot throw into the tree) so Settings can show an
    // honest status. The translator prepares ONLY on an explicit player
    // act — a Translate tap or opening the Settings translator row (see
    // game/translate/index.ts).
    void inspectTranslator().catch(() => {
      /* status stays "unknown"; the first need surface retries the look */
    });
  }, []);

  return (
    <RootDocument>
      <I18nProvider>
        <Outlet />
        <UpdateBanner />
        {/* First run, on every route — the picker is met BEFORE the game door
            (L1), and the app behind it is already in the suggested language. */}
        <LanguageGate />
      </I18nProvider>
    </RootDocument>
  );
}

/**
 * `suppressHydrationWarning` on <html> is deliberate: the inline boot script
 * stamps `lang`/`data-lang`/`dir` on the element before React hydrates, exactly so
 * the first painted frame is already in the player's language AND direction (see
 * game/i18n/device.ts → bootScript). `lang="en" dir="ltr"` is the server's honest
 * default — the server cannot know the device — and the boot script replaces both
 * before paint for any device that is not a settled English one, which is also why
 * the attribute diff must not warn.
 */
function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: bootScript() }} />
        <noscript>
          {/* JavaScript off: no language resolution can run, so show the app. */}
          <style>{`html.i18n-boot body > :not(.i18n-gate){visibility:visible}`}</style>
        </noscript>
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
