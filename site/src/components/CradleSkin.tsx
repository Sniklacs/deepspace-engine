// CradleSkin — the full-page background skin for the Cradle screen.
//
// Owner direction 2026-10-11 (Hans): the Cradle screen gets a full-page,
// semi-transparent race skin as its backdrop — text, links, buttons and all
// other content layer ABOVE it and shine through. This is the TEMPLATE: once
// the layout works for one race, every other race is just a skin swap.
//
// Usage: wrap the screen's content:
//
//   <CradleSkin raceId={state.race} opacity={0.7}>
//     ...all Cradle content...
//   </CradleSkin>
//
// Skin files live at `/art/cradle/{raceId}-skin.webp` (one file per race).
// Races without a skin file yet render no background — the `onError` fallback
// hides the layer so the page still works. Opacity is adjustable per call;
// 0.7 is the starting point Hans approved (content reads well over the art).
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const SKIN_DIR = "/art/cradle";

/** Skin lookup: `/art/cradle/{raceId}-skin.webp`, null when unkeyed. */
export function cradleSkinFor(raceId: string | null | undefined): string | null {
  const id = (raceId ?? "").trim().toLowerCase();
  return id ? `${SKIN_DIR}/${id}-skin.webp` : null;
}

export default function CradleSkin({
  raceId,
  opacity = 0.7,
  children,
}: {
  /** the player's race id (draconians, grays, nephilim, ...) */
  raceId: string | null | undefined;
  /** skin opacity 0–1; content layers above at full opacity */
  opacity?: number;
  children: ReactNode;
}) {
  const wanted = cradleSkinFor(raceId);
  const [src, setSrc] = useState<string | null>(wanted);
  const [failed, setFailed] = useState(false);
  // Re-arm when the race changes (account switch, etc.).
  useEffect(() => {
    setSrc(cradleSkinFor(raceId));
    setFailed(false);
  }, [raceId]);

  const show = src && !failed;

  return (
    <div className="relative">
      {show && (
        <div
          aria-hidden="true"
          data-testid="cradle-skin"
          className="pointer-events-none fixed inset-0 z-0"
          style={{
            backgroundImage: `url("${src}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            opacity,
          }}
        >
          {/* Hidden probe: if the skin file 404s, drop the layer entirely. */}
          <img
            src={src}
            alt=""
            className="hidden"
            onError={() => setFailed(true)}
          />
        </div>
      )}
      {/* All Cradle content rides above the skin at full opacity. */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
