// LINE-ICON FAMILY — storefront seam (visual-pass-1-storefront.md §3.6: no
// emoji in the storefront markup; 16px line icons in the 1.5–1.75px stroke
// dialect). Inline SVGs only — no icon font, no external asset, no emoji.
//
// Glyphs are hand-drawn 24×24 line paths (stroke-only, round caps/joins) so
// the set survives 16px rendering. `strokeWidth` defaults to the storefront
// dialect (1.75); pass 1.5 for hairline contexts if ever needed.
import type { CSSProperties, ReactNode } from "react";

export type IconName =
  | "crate" // head-start pack
  | "fuel" // gas resource
  | "gear" // mechkit / workshop
  | "aegis" // medkit / aid
  | "armor" // armorkit
  | "check" // OWNED / claimed
  | "lock" // locked / never-for-sale
  | "star" // sigils / votives
  | "scroll" // codices / records
  | "emblem" // banner / sigil-frame cosmetics
  | "cart" // vehicle trim
  | "building" // cradle facade
  | "person" // leader garb
  | "bell" // shrine motif
  | "palette" // palettes
  | "coin" // currency
  | "ledger" // the Cradle Ledger
  | "x" // close
  | "shield" // trust / G1–G4 footer
  | "card" // pass
  | "spark" // earned

const PATHS: Record<IconName, ReactNode> = {
  crate: (
    <>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
    </>
  ),
  fuel: (
    <>
      <path d="M5 3h10v18H5z" />
      <path d="M15 7h3v6h-3" />
      <path d="M5 10h10" />
      <path d="M5 15h10" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M18.7 5.3l-2.8 2.8M8.1 15.9l-2.8 2.8" />
    </>
  ),
  aegis: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v9M7.5 12h9" />
    </>
  ),
  armor: (
    <path d="M12 3l7 2.5V11c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V5.5L12 3z" />
  ),
  check: <path d="M4.5 12.5l5 5L19.5 6.5" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  star: <path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13" />,
  scroll: (
    <>
      <path d="M6 3.5h12V20a1.5 1.5 0 01-1.5 1.5H7A1.5 1.5 0 015.5 20V5A1.5 1.5 0 017 3.5z" />
      <path d="M9 7.5h6M9 11h6M9 14.5h4" />
    </>
  ),
  emblem: (
    <>
      <path d="M5 3v18" />
      <path d="M5 4.5h12l-3 4.25 3 4.25H5" />
    </>
  ),
  cart: (
    <>
      <path d="M3.5 4h2l2.4 10.5H18l2-7H7" />
      <circle cx="9" cy="19.5" r="1.4" />
      <circle cx="16.5" cy="19.5" r="1.4" />
    </>
  ),
  building: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V8l7-5 7 5v13" />
      <path d="M10 21v-5h4v5" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M5 21v-2.5a4.5 4.5 0 014.5-4.5h5a4.5 4.5 0 014.5 4.5V21" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 16.5h11" />
      <path d="M8 16.5a4 4 0 008 0" />
      <path d="M9 16.5v-.5a3 3 0 016 0v.5" />
    </>
  ),
  palette: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8" cy="9.2" r="0.9" />
      <circle cx="13" cy="7.5" r="0.9" />
      <circle cx="16.4" cy="12" r="0.9" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 12h5M12 9.5v5" />
    </>
  ),
  ledger: (
    <>
      <path d="M4.5 5A1.5 1.5 0 016 3.5h13.5V20H6A1.5 1.5 0 014.5 18.5v-13z" />
      <path d="M19.5 20a1.5 1.5 0 01-1.5 1.5H6" />
      <path d="M8 8h7M8 11.5h7M8 15h4" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  shield: (
    <>
      <path d="M12 3l7 2.5V11c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V5.5L12 3z" />
      <path d="M9 11.8l2.2 2.2 4-4.5" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h6" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
      <path d="M6.5 6.5L10 10M14 14l3.5 3.5M17.5 6.5L14 10M10 14l-3.5 3.5" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
  style,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      {PATHS[name]}
    </svg>
  );
}