// CradleBanner — the art band behind the top of the Cradle page.
//
// Owner direction 2026-10-01: the cradle dome painting is the Cradle page's
// background, the overview header sitting over it on a dark scrim. Race-keyed
// for the future (public/art/cradle/{raceId}.webp — one file per race, so each
// race's Cradle looks different), falling back to cradle-dome.webp whenever the
// race file does not exist yet. Only the default file ships today; no art is
// generated here.
//
// Phone-first: object-cover crops the sides on narrow screens, so the focal
// point is the domes (center frame). Text never sits on bare art — the gradient
// scrim carries it.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const CRADLE_ART_DIR = "/art/cradle";
const DEFAULT_ART = `${CRADLE_ART_DIR}/cradle-dome.webp`;

/** Race-keyed art lookup: `/art/cradle/{raceId}.webp`, default when unkeyed. */
export function cradleArtFor(raceId: string | null | undefined): string {
  const id = (raceId ?? "").trim().toLowerCase();
  return id ? `${CRADLE_ART_DIR}/${id}.webp` : DEFAULT_ART;
}

export default function CradleBanner({
  raceId,
  title,
  sub,
}: {
  /** the player's race id (grays, nephilim, draconians, anunnaki, ashtar, watchers) */
  raceId: string | null | undefined;
  title: string;
  sub?: ReactNode;
}) {
  const wanted = cradleArtFor(raceId);
  const [src, setSrc] = useState(wanted);
  // Re-arm when the race changes (account switch, etc.).
  useEffect(() => setSrc(cradleArtFor(raceId)), [raceId]);

  return (
    <div className="relative -m-3 overflow-hidden rounded-t-2xl sm:-m-4">
      <img
        src={src}
        alt=""
        aria-hidden="true"
        onError={() => {
          // The race file does not exist yet: fall back to the default dome
          // painting. Guarded so a missing default cannot loop.
          if (src !== DEFAULT_ART) setSrc(DEFAULT_ART);
        }}
        className="h-40 w-full object-cover object-[center_35%] sm:h-52"
        loading="eager"
      />
      {/* the scrim: text rides on the gradient, never on bare art */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/5"
      />
      <div className="absolute inset-x-0 bottom-0 flex items-baseline justify-between gap-2 p-3 sm:p-4">
        <h3 className="text-sm font-semibold text-white drop-shadow">{title}</h3>
        {sub ? (
          <span className="shrink-0 text-[11px] text-white/85 drop-shadow">{sub}</span>
        ) : null}
      </div>
    </div>
  );
}
