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
  | "sword" // battle header / the attacker
  | "march" // troop column with a direction arrow (Reinforce)
  | "beacon" // a lit signal (Call for aid)
  // ---- shell delta (game-ui-shell-spec §5.4) — the chrome's line set ----
  | "flame" // Embers
  | "chip" // Chipsets
  | "flask" // Lab nav slot
  | "map" // Circuit nav slot
  | "wheat" // Agriculture domain tile
  | "hammer" // Industry domain tile
  | "chat" // the reserved chat dock
  | "help" // Help row
  | "gamepad" // Games (your colonies)
  | "logout" // Log Out
  // ---- chat delta (chat-mail-spec §2/§4) — the chat surface's line set ----
  | "send" // the composer's send control (an ARROW: joins DIR_FLIP)
  | "mail" // the Mail surface tab
  | "globe" // the World surface tab
  | "users" // the Covenant / Rooms tab (a group, never a person)
  | "hash"; // a room / channel marker

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
  sword: (
    <>
      <path d="M14.5 3H21v6.5L11 19.5l-6.5-6.5L14.5 3z" />
      <path d="M6 18l-3 3" />
      <path d="M9.5 15.5l-2 2" />
    </>
  ),
  march: (
    <>
      <circle cx="9" cy="4.5" r="2" />
      <path d="M9 6.5v7h4" />
      <path d="M9 9.5l-3 2v5" />
      <path d="M13 13.5V19" />
      <path d="M17 8.5l3 3-3 3" />
      <path d="M20 11.5h-6" />
    </>
  ),
  beacon: (
    <>
      <path d="M12 3v4" />
      <path d="M12 7l3 6H9l3-6z" />
      <path d="M5 21h14" />
      <path d="M7.5 17.5c1.6 1 3 1 4.5 1s2.9 0 4.5-1" />
      <path d="M4.5 13.5l1.5 1M19.5 13.5l-1.5 1" />
    </>
  ),
  // ---- shell delta (game-ui-shell-spec §5.4): 24×24, 1.75 stroke, same
  // hand-drawn line dialect. These replace the chrome emoji (§1.7 rule 3).
  flame: (
    <>
      <path d="M12 3c3.5 3.2 5.5 6 5.5 9a5.5 5.5 0 01-11 0c0-3 2-5.8 5.5-9z" />
      <path d="M12 12.5c1.4 1.3 2 2.4 2 3.4a2 2 0 11-4 0c0-1 .6-2.1 2-3.4z" />
    </>
  ),
  chip: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3h6" />
      <path d="M10 3v6L5.5 17.5A2 2 0 007.3 20.5h9.4a2 2 0 001.8-3L14 9V3" />
      <path d="M7.2 14.5h9.6" />
    </>
  ),
  map: (
    <>
      <path d="M3 6.5l6-2.5 6 2.5 6-2.5v13l-6 2.5-6-2.5-6 2.5v-13z" />
      <path d="M9 4v13M15 6.5v13" />
    </>
  ),
  wheat: (
    <>
      <path d="M12 21V9" />
      <path d="M12 9c-2.6 0-4-1.6-4-4 2.6 0 4 1.5 4 4z" />
      <path d="M12 9c2.6 0 4-1.6 4-4-2.6 0-4 1.5-4 4z" />
      <path d="M12 15c-2.6 0-4-1.6-4-4 2.6 0 4 1.5 4 4z" />
      <path d="M12 15c2.6 0 4-1.6 4-4-2.6 0-4 1.5-4 4z" />
    </>
  ),
  hammer: (
    <>
      <path d="M14.5 3.5l6 6-3 3-6-6 3-3z" />
      <path d="M11.5 6.5L4 14v6h6l7.5-7.5" />
      <path d="M7 17.5h2.5" />
    </>
  ),
  chat: (
    <>
      <path d="M4.5 5.5h15v10h-9L6 19v-3.5H4.5z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 114.2 2.3c-.9.7-1.8 1.2-1.8 2.4" />
      <path d="M12 17.2v.3" />
    </>
  ),
  gamepad: (
    <>
      <rect x="2.5" y="7" width="19" height="10" rx="4" />
      <path d="M7 10.5v4M5 12.5h4" />
      <path d="M15.5 11.5h.01M18 13.5h.01" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4.5H6.5A1.5 1.5 0 005 6v12a1.5 1.5 0 001.5 1.5H14" />
      <path d="M17 8.5l3.5 3.5L17 15.5" />
      <path d="M20 12H10" />
    </>
  ),
  // ---- chat delta: same 24×24, 1.75 stroke, hand-drawn line dialect.
  // `send` is an ARROW — the one glyph whose meaning is a direction, so it joins
  // DIR_FLIP below and points left in Persian (a mirrored chrome with a
  // right-pointing "send" would be the classic RTL bug).
  send: (
    <>
      <path d="M4 12h13.5" />
      <path d="M11.5 6l6 6-6 6" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3.6 7.2l8.4 5.8 8.4-5.8" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c3.2 3.4 3.2 14.6 0 18" />
      <path d="M12 3c-3.2 3.4-3.2 14.6 0 18" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20v-1.6a3.9 3.9 0 013.9-3.9h3.2a3.9 3.9 0 013.9 3.9V20" />
      <path d="M16 4.9a3.2 3.2 0 010 6.2" />
      <path d="M17.6 14.7a3.9 3.9 0 012.9 3.7V20" />
    </>
  ),
  hash: (
    <>
      <path d="M9 3.5L7.5 20.5M16.5 3.5L15 20.5" />
      <path d="M4 9h16M3.5 15h16" />
    </>
  ),
};

/**
 * DIRECTIONAL GLYPHS (i18n slice 2 — RTL). These paths carry an arrow that POINTS
 * somewhere: the `march` column's arrow and the `logout` door arrow both point
 * right, which is "forward" only in a left-to-right frame. In a right-to-left
 * language they must point left. A glyph cannot inherit a direction, so the icon
 * box is flipped by one CSS rule (`styles/app.css` §13 → `html[dir="rtl"]
 * .dir-flip`) and every glyph in this set gets the class unconditionally — in LTR
 * the rule does not match, so the English render is untouched.
 *
 * Only box-level glyphs belong here. Nothing that carries TEXT may ever be
 * flipped (`scaleX(-1)` mirrors letters and digits), and no container is ever
 * flipped — that is what keeps this list safe as it grows.
 */
export const DIR_FLIP: ReadonlySet<IconName> = new Set<IconName>(["march", "logout", "send"]);

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
      className={DIR_FLIP.has(name) ? `dir-flip${className ? ` ${className}` : ""}` : className}
      style={style}
    >
      {PATHS[name]}
    </svg>
  );
}