import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "~/styles/app.css?url";
import { bootScript } from "~/game/i18n";
import { I18nProvider, LanguageGate } from "~/components/i18n/I18n";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Deepspace Engine" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  notFoundComponent: () => <div>Page not found</div>,
  component: RootComponent,
});

function RootComponent() {
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
