// chorus-intel.ts — ENRICHED CHORUS SITE INTEL for the World page.
//
// Pure data + pure functions. Reads the pinned ladder in war/chorus-sites.ts
// (grades, strengths, troop counts) and ZONES (display names), and derives
// the player-facing intel Hans asked for on the World page:
//
//   • strength — the grade's force power (comparable to a player's own force
//     BY CONSTRUCTION — see war/chorus-sites.ts §1).
//   • recommended troop size/counts — DERIVED: 1.5× the garrison's troop
//     count, rounded up to the nearest 10. Marked as a recommendation,
//     not a guarantee.
//   • recommended reverb — DERIVED: equals the grade's strength. Rationale:
//     a loadout's reverb is the same force-power scale (troops, ships and
//     equipment add reverb as they are added), so a loadout whose reverb
//     meets or beats this figure is expected to survive the site. Hans
//     (Oct 4 2026): "you can gauge ... if it's going to get stomped in the
//     mud or if you're going to actually have a chance to survive".
//
// Also carries the deterministic globe coordinates each site is pinned at
// (seeded from the zone id — stable across renders and sessions) and the
// grade artwork path.

import { CHORUS_GRADES, CHORUS_SITES, chorusSiteStrength, chorusSiteTroops, isChorusHeart, type ChorusGradeId } from "./war/chorus-sites";
import { ZONES } from "./zones";

/** One Chorus site, enriched for display. */
export interface ChorusSiteIntel {
  /** Zone id (stable key, e.g. "collider-ruins"). */
  zoneId: string;
  /** Display name from the shipped zone table (e.g. "Super-Collider Ruins"). */
  siteName: string;
  /** 1–5. */
  grade: ChorusGradeId;
  /** Roman numeral for display ("I".."V"). */
  gradeLabel: string;
  /** Garrison force power — same scale as the player's own force. */
  strength: number;
  /** Garrison troop count at this site (the heart's, at the heart). */
  garrisonTroops: number;
  /** True only at the Chorus-held heart (dark-matter-observatory) — the
   *  endgame target. Its numbers sit above grade V by named multiples
   *  (CHORUS_HEART, war/chorus-sites.ts §5). */
  isHeart: boolean;
  /** Recommended attacking troop count (1.5× garrison, rounded up to 10). */
  recommendedTroops: number;
  /** Recommended loadout reverb (== strength — same force-power scale). */
  recommendedReverb: number;
  /** Deterministic globe position (degrees). */
  lat: number;
  lon: number;
  /** Grade artwork path (public/art/chorus/grade-<roman>.webp). */
  art: string;
}

const GRADE_LABEL: Record<ChorusGradeId, string> = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
  5: "V",
};

/** Grade cluster centers on the globe (lat/lon degrees) — spread so the
 *  five grades read as five distinct Chorus regions. */
const GRADE_CLUSTER: Record<ChorusGradeId, { lat: number; lon: number }> = {
  1: { lat: 38, lon: -60 }, // grade I — northern rim
  2: { lat: 8, lon: 55 }, // grade II — equatorial east
  3: { lat: -22, lon: -15 }, // grade III — southern
  4: { lat: 52, lon: 110 }, // grade IV — northern far side
  5: { lat: -48, lon: 145 }, // grade V — deep south
};

/** Tiny deterministic hash of a string → [0, 1). Stable across sessions. */
export function hash01(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

/** Globe position for a site: its grade's cluster center plus a deterministic
 *  jitter so the three sites of a grade sit near each other but don't stack. */
export function siteGlobePosition(zoneId: string, grade: ChorusGradeId): { lat: number; lon: number } {
  const c = GRADE_CLUSTER[grade];
  const j1 = (hash01(zoneId + ":a") - 0.5) * 28; // ±14°
  const j2 = (hash01(zoneId + ":b") - 0.5) * 28;
  const lat = Math.max(-80, Math.min(80, c.lat + j1));
  let lon = (c.lon + j2) % 360;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat, lon };
}

/** Recommended attacking troop count for a grade: 1.5× the garrison,
 *  rounded up to the nearest 10. A recommendation, not a promise. */
export function recommendedTroopsForGrade(grade: ChorusGradeId): number {
  const g = CHORUS_GRADES[grade - 1];
  return troopsRecommendation(g.troops);
}

/** One shared formula: 1.5× a garrison, rounded up to the nearest 10. */
function troopsRecommendation(troops: number): number {
  return Math.ceil((troops * 1.5) / 10) * 10;
}

/** Recommended attacking troop count for a SITE — 1.5× ITS garrison, so the
 *  heart reads 1.5× the heart's garrison (4,500), not 1.5× grade V's. */
export function recommendedTroopsForSite(zoneId: string): number {
  return troopsRecommendation(chorusSiteTroops(zoneId) ?? 0);
}

/** Recommended loadout reverb for a grade: the grade's own strength.
 *  Same force-power scale as a loadout's reverb, so reverb ≥ this figure
 *  is expected to survive the site. */
export function recommendedReverbForGrade(grade: ChorusGradeId): number {
  return CHORUS_GRADES[grade - 1].strength;
}

/** Grade artwork path. Every grade has dedicated art under
 *  public/art/chorus/grade-<roman>.webp. */
export function chorusGradeArt(grade: ChorusGradeId): string {
  return `art/chorus/grade-${GRADE_LABEL[grade]}.webp`;
}

const zoneNameCache = new Map<string, string>();
function zoneName(zoneId: string): string {
  let n = zoneNameCache.get(zoneId);
  if (n === undefined) {
    n = ZONES.find((z) => z.id === zoneId)?.name ?? zoneId;
    zoneNameCache.set(zoneId, n);
  }
  return n;
}

/** All 15 Chorus sites, enriched, sorted grade-ascending then by name. The
 *  heart (dark-matter-observatory) carries the heart's numbers — strength
 *  5,360, garrison 3,000, rec. troops 4,500, rec. reverb 5,360 — everything
 *  else reads the grade ladder. */
export function chorusSiteIntel(): ChorusSiteIntel[] {
  return CHORUS_SITES.map((s) => {
    const grade = CHORUS_GRADES[s.grade - 1];
    const pos = siteGlobePosition(s.zoneId, s.grade);
    const strength = chorusSiteStrength(s.zoneId) ?? grade.strength;
    const garrisonTroops = chorusSiteTroops(s.zoneId) ?? grade.troops;
    return {
      zoneId: s.zoneId,
      siteName: zoneName(s.zoneId),
      grade: s.grade,
      gradeLabel: GRADE_LABEL[s.grade],
      strength,
      garrisonTroops,
      isHeart: isChorusHeart(s.zoneId),
      recommendedTroops: recommendedTroopsForSite(s.zoneId),
      recommendedReverb: strength,
      lat: pos.lat,
      lon: pos.lon,
      art: chorusGradeArt(s.grade),
    };
  }).sort((a, b) => a.grade - b.grade || a.siteName.localeCompare(b.siteName));
}

/** Sites of one grade (for the grade-filtered list). */
export function chorusSitesOfGrade(grade: ChorusGradeId): ChorusSiteIntel[] {
  return chorusSiteIntel().filter((s) => s.grade === grade);
}
