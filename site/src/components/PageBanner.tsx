// PageBanner — the shared art band behind page headers.
//
// Owner direction 2026-10-01: every page gets a background picture. This is
// the generalized form of the CradleBanner pattern (art band, dark scrim for
// readability, title/sub riding the gradient — labels never baked into the
// art). Phone-first: object-cover crops the sides on narrow screens, so pick
// a `focal` object-position that keeps the subject in frame.
//
// Race-keyed art: pass `raceArtDir` (e.g. "pages") and `raceId`; the banner
// tries `/art/{raceArtDir}/{raceId}.webp` and falls back to `image` on 404.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export default function PageBanner({
  image,
  title,
  sub,
  raceId,
  raceArtDir,
  focal = "center 35%",
  titleClassName = "text-2xl font-bold text-white drop-shadow",
  className = "",
}: {
  /** default art, e.g. "/art/pages/armory-banner.webp" */
  image: string;
  /** header title over the scrim; omit for a bare art band */
  title?: ReactNode;
  sub?: ReactNode;
  /** the player's race id (grays, nephilim, draconians, anunnaki, ashtar, watchers) */
  raceId?: string | null;
  /** art dir holding optional per-race files, e.g. "pages" for /art/pages/{raceId}.webp */
  raceArtDir?: string;
  /** object-position focal point for phone crops */
  focal?: string;
  titleClassName?: string;
  className?: string;
}) {
  const raceSrc =
    raceArtDir && raceId && raceId.trim()
      ? `/art/${raceArtDir}/${raceId.trim().toLowerCase()}.webp`
      : null;
  const wanted = raceSrc ?? image;
  const [src, setSrc] = useState(wanted);
  // Re-arm when the art changes (race/account switch).
  useEffect(() => {
    const r =
      raceArtDir && raceId && raceId.trim()
        ? `/art/${raceArtDir}/${raceId.trim().toLowerCase()}.webp`
        : null;
    setSrc(r ?? image);
  }, [image, raceArtDir, raceId]);

  return (
    <div className={`relative overflow-hidden rounded-xl ${className}`}>
      <img
        src={src}
        alt=""
        aria-hidden="true"
        onError={() => {
          // The race file does not exist yet: fall back to the page's default
          // art. Guarded so a missing default cannot loop.
          if (src !== image) setSrc(image);
        }}
        className="h-40 w-full object-cover sm:h-52"
        style={{ objectPosition: focal }}
        loading="lazy"
      />
      {/* the scrim: text rides on the gradient, never on bare art */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/5"
      />
      {(title != null || sub != null) && (
        <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
          {title != null && <div className={titleClassName}>{title}</div>}
          {sub != null && (
            <div className="mt-1 text-sm text-white/85 drop-shadow">{sub}</div>
          )}
        </div>
      )}
    </div>
  );
}
