import { describe, expect, test } from "bun:test";
import {
  chorusSiteIntel,
  chorusSitesOfGrade,
  hash01,
  recommendedReverbForGrade,
  recommendedTroopsForGrade,
  recommendedTroopsForSite,
  siteGlobePosition,
} from "./chorus-intel";

describe("chorus-intel", () => {
  test("enriches all 15 pinned sites with real zone names", () => {
    const sites = chorusSiteIntel();
    expect(sites).toHaveLength(15);
    for (const s of sites) {
      expect(s.siteName).not.toBe(s.zoneId); // name resolved, not raw id
      expect(s.siteName.length).toBeGreaterThan(0);
    }
    const names = sites.map((s) => s.siteName);
    expect(names).toContain("Outer Ruins");
    expect(names).toContain("Super-Collider Ruins");
  });

  test("strengths match the pinned grade ladder (21/100/186/345/1330) + the heart (5360)", () => {
    const sites = chorusSiteIntel();
    const byGrade: Record<number, number[]> = {};
    for (const s of sites) (byGrade[s.grade] ||= []).push(s.strength);
    expect(byGrade[1]).toEqual([21, 21, 21]);
    expect(byGrade[2]).toEqual([100, 100, 100]);
    expect(byGrade[3]).toEqual([186, 186, 186]);
    expect(byGrade[4]).toEqual([345, 345, 345]);
    // Two grade-V sites read the ladder; the heart sits above it.
    expect(byGrade[5].filter((n) => n === 1330)).toHaveLength(2);
    const heart = sites.find((s) => s.isHeart)!;
    expect(heart.zoneId).toBe("dark-matter-observatory");
    expect(heart.strength).toBe(5360);
    expect(heart.strength).toBeGreaterThan(1330);
  });

  test("garrison troops match the pinned ladder (25/50/100/200/400) + the heart (3000)", () => {
    const sites = chorusSiteIntel();
    const byGrade: Record<number, number[]> = {};
    for (const s of sites) (byGrade[s.grade] ||= []).push(s.garrisonTroops);
    expect(byGrade[1]).toEqual([25, 25, 25]);
    expect(byGrade[2]).toEqual([50, 50, 50]);
    expect(byGrade[3]).toEqual([100, 100, 100]);
    expect(byGrade[4]).toEqual([200, 200, 200]);
    expect(byGrade[5].filter((n) => n === 400)).toHaveLength(2);
    const heart = sites.find((s) => s.isHeart)!;
    expect(heart.garrisonTroops).toBe(3000);
  });

  test("recommended reverb equals grade strength (same force-power scale)", () => {
    expect(recommendedReverbForGrade(1)).toBe(21);
    expect(recommendedReverbForGrade(2)).toBe(100);
    expect(recommendedReverbForGrade(3)).toBe(186);
    expect(recommendedReverbForGrade(4)).toBe(345);
    expect(recommendedReverbForGrade(5)).toBe(1330);
  });

  test("recommended troops are 1.5× garrison, rounded up to 10", () => {
    expect(recommendedTroopsForGrade(1)).toBe(40); // 25*1.5=37.5 → 40
    expect(recommendedTroopsForGrade(2)).toBe(80); // 50*1.5=75 → 80
    expect(recommendedTroopsForGrade(3)).toBe(150); // 100*1.5
    expect(recommendedTroopsForGrade(4)).toBe(300); // 200*1.5
    expect(recommendedTroopsForGrade(5)).toBe(600); // 400*1.5
    // The heart recommends 1.5× ITS garrison: a full-rally ask.
    expect(recommendedTroopsForSite("dark-matter-observatory")).toBe(4500); // 3000*1.5
    expect(recommendedTroopsForSite("collider-ruins")).toBe(600);
  });

  test("the heart's recommended reverb is its own strength", () => {
    const heart = chorusSiteIntel().find((s) => s.isHeart)!;
    expect(heart.recommendedReverb).toBe(5360);
    expect(heart.recommendedReverb).toBe(heart.strength);
  });

  test("isHeart is set only on the heart site", () => {
    const sites = chorusSiteIntel();
    expect(sites.filter((s) => s.isHeart)).toHaveLength(1);
    expect(sites.find((s) => s.isHeart)!.zoneId).toBe("dark-matter-observatory");
  });

  test("globe positions are deterministic and in-bounds", () => {
    const a = siteGlobePosition("outer-ruins", 1);
    const b = siteGlobePosition("outer-ruins", 1);
    expect(a).toEqual(b);
    const sites = chorusSiteIntel();
    for (const s of sites) {
      expect(s.lat >= -80).toBe(true);
      expect(s.lat).toBeLessThanOrEqual(80);
      expect(s.lon >= -180).toBe(true);
      expect(s.lon).toBeLessThanOrEqual(180);
    }
  });

  test("grade clusters are spread across the globe", () => {
    const sites = chorusSiteIntel();
    const grade1 = sites.filter((s) => s.grade === 1);
    const grade5 = sites.filter((s) => s.grade === 5);
    // mean lon of grade I vs grade V clusters should be far apart
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const d = Math.abs(mean(grade1.map((s) => s.lon)) - mean(grade5.map((s) => s.lon)));
    expect(d).toBeGreaterThan(60);
  });

  test("hash01 is deterministic in [0,1)", () => {
    const h = hash01("outer-ruins:a");
    expect(h >= 0).toBe(true);
    expect(h).toBeLessThan(1);
    expect(hash01("outer-ruins:a")).toBe(h);
    expect(hash01("other")).not.toBe(h);
  });

  test("chorusSitesOfGrade returns 3 sites for each grade", () => {
    for (const g of [1, 2, 3, 4, 5] as const) {
      const sites = chorusSitesOfGrade(g);
      expect(sites).toHaveLength(3);
      expect(sites.every((s) => s.grade === g)).toBe(true);
    }
  });
});
