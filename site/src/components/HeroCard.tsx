// HeroCard — the signature hero portrait card for each race (owner wire-in
// 2026-10-01). Art is the 512×768 realistic WebP in public/art/heroes/.
//
// OWNER RULE: name + title appear ON the portrait as an elegant HTML overlay
// plate (visually part of the card) — NEVER baked into image pixels. The plate
// renders from heroes.<id>.name / heroes.<id>.title with the English literal
// as the t() fallback, so es / pt-BR / ru / fa fall back gracefully.
// Labels stay in HTML outside/below the artwork. Phone-first: responsive
// sizes, lazy loading, async decoding.
import { useT } from "./i18n/I18n";
import type { RaceId } from "../game/types";

export type HeroId = RaceId | "unbound";

export interface HeroMeta {
  /** portrait path under public/ */
  file: string;
  nameKey: string;
  titleKey: string;
  /** English fallbacks — the second arg of t(nameKey, name), so non-English
      langs degrade gracefully until translated */
  name: string;
  title: string;
}

export const HEROES: Record<HeroId, HeroMeta> = {
  grays: {
    file: "/art/heroes/hero-ilyra-voss.webp",
    nameKey: "heroes.grays.name",
    titleKey: "heroes.grays.title",
    name: "Ilyra Voss",
    title: "High Strategist of the Conclave",
  },
  draconians: {
    file: "/art/heroes/hero-kaaroth.webp",
    nameKey: "heroes.draconians.name",
    titleKey: "heroes.draconians.title",
    name: "Kaaroth",
    title: "War-Captain of the Ashen Host",
  },
  watchers: {
    file: "/art/heroes/hero-gadreel.webp",
    nameKey: "heroes.watchers.name",
    titleKey: "heroes.watchers.title",
    name: "Gadreel",
    title: "The Wall of God",
  },
  ashtar: {
    file: "/art/heroes/hero-mira-solenne.webp",
    nameKey: "heroes.ashtar.name",
    titleKey: "heroes.ashtar.title",
    name: "Mira Solenne",
    title: "Emissary of the Accord",
  },
  anunnaki: {
    file: "/art/heroes/hero-ensharra.webp",
    nameKey: "heroes.anunnaki.name",
    titleKey: "heroes.anunnaki.title",
    name: "Ensharra",
    title: "Sovereign of the Gilded Court",
  },
  nephilim: {
    file: "/art/heroes/hero-garruk-stonebrow.webp",
    nameKey: "heroes.nephilim.name",
    titleKey: "heroes.nephilim.title",
    name: "Garruk Stonebrow",
    title: "Hammer of the Highlands",
  },
  unbound: {
    file: "/art/heroes/hero-aurelia-dawn.webp",
    nameKey: "heroes.unbound.name",
    titleKey: "heroes.unbound.title",
    name: "Aurelia Dawn",
    title: "First of the Unbound",
  },
};

/** Strip order: the six playable races, then the earned Unbound. */
export const HERO_ORDER: HeroId[] = [
  "grays",
  "draconians",
  "watchers",
  "ashtar",
  "anunnaki",
  "nephilim",
  "unbound",
];

/** Race portrait WebP — correct RaceId spellings (the old SVGs were
    misspelled: anunnaki.svg / asart.svg). */
export function racePortrait(raceId: string): string {
  return `/art/races/${raceId}.webp`;
}

/** Weapon thumbnail for a race + armory family:
    public/art/loadout/weapons/{race}-{family}.webp */
export function weaponThumbUrl(raceId: string, family: string): string {
  return `/art/loadout/weapons/${raceId}-${family}.webp`;
}

const SIZES = {
  /** race picker buttons, Unbound preview */
  sm: "w-16 sm:w-20",
  /** strips, cards */
  md: "w-36 sm:w-44",
  /** selected-race detail panel */
  lg: "w-44 sm:w-56",
  /** fluid width — fills a grid cell / flex wrapper */
  fill: "w-full",
} as const;

const TEXT = {
  sm: { name: "text-[11px]", title: "text-[9px]" },
  md: { name: "text-sm", title: "text-[11px]" },
  lg: { name: "text-base", title: "text-xs" },
  fill: { name: "text-sm", title: "text-[11px]" },
} as const;

export function HeroCard({
  heroId,
  size = "md",
  lazy = true,
  className = "",
}: {
  heroId: HeroId;
  size?: keyof typeof SIZES;
  /** below-fold images lazy-load; the selected-race panel is above the fold */
  lazy?: boolean;
  className?: string;
}) {
  const t = useT();
  const hero = HEROES[heroId];
  const name = t(hero.nameKey, hero.name);
  const title = t(hero.titleKey, hero.title);
  const text = TEXT[size];
  return (
    <figure
      className={`relative shrink-0 overflow-hidden rounded-xl border border-white/15 ${SIZES[size]} ${className}`}
    >
      <img
        src={hero.file}
        alt={name}
        loading={lazy ? "lazy" : "eager"}
        decoding="async"
        className="aspect-[2/3] w-full object-cover"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent"
      />
      <figcaption className="absolute inset-x-0 bottom-0 px-2 pb-2 pt-6">
        <p className={`${text.name} font-bold leading-tight text-white drop-shadow`}>
          {name}
        </p>
        <p className={`${text.title} mt-0.5 leading-tight text-amber-200/90`}>
          {title}
        </p>
      </figcaption>
    </figure>
  );
}
