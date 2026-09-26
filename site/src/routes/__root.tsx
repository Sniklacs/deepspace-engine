import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactNode } from "react";

import appCss from "~/styles/app.css?url";
import { bootScript } from "~/game/i18n";
import { prepareTranslator } from "~/game/translate";
import { registerServiceWorker } from "~/game/pwa/register";
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
      { title: "Deepspace Engine" },
      {
        name: "description",
        content:
          "Rebuild a shattered colony by salvaging, studying and deploying the AI that nearly ended the world. A persistent co-op colony survivor.",
      },
      // The installable shell: dark chrome, matching the manifest's theme_color.
      { name: "theme-color", content: "#070910" },
      { name: "color-scheme", content: "dark" },
      { name: "application-name", content: "Deepspace Engine" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Deepspace" },
      // black-translucent = the page draws under the status bar. Safe because the
      // shell pads itself with the platform's own insets (styles/app.css §3c).
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon-180.png", sizes: "180x180" },
    ],
  }),
  notFoundComponent: () => <div>Page not found</div>,
  component: RootComponent,
});

function RootComponent() {
  // Register the app shell's worker once, on the client, in production builds.
  // It precaches the shell and never touches game state (see public/sw.js).
  useEffect(() => {
    void registerServiceWorker();
    // THE BUNDLED TRANSLATOR (owner: ship it with the app for every player, no
    // opt-in). Effect-scoped and client-only, like the worker above: it looks at
    // the device, downloads the weights if they are not there yet — with visible
    // progress in Settings, never a prompt — and only then loads the ML runtime
    // with a dynamic import. Nothing is registered with the seam until weights and
    // runtime are actually present, so `engine-seam` keeps its null default.
    void prepareTranslator();
  }, []);

  return (
    <RootDocument>
      <I18nProvider>
        <Outlet />
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
