import { describe, expect, test } from "bun:test";
import { computeForcePower } from "./battle-engine";
import {
  CHORUS_GRADES,
  CHORUS_HEART,
  CHORUS_HEART_ZONE_ID,
  CHORUS_SITES,
  chorusGarrison,
  chorusSiteOf,
  chorusSiteStrength,
  chorusSiteTroops,
  isChorusHeart,
} from "./chorus-sites";

describe("chorus-sites: the Chorus heart (endgame)", () => {
  test("the heart zone is the design doc's heart", () => {
    expect(CHORUS_HEART_ZONE_ID).toBe("dark-matter-observatory");
    expect(chorusSiteOf(CHORUS_HEART_ZONE_ID)?.grade).toBe(5);
  });

  test("isChorusHeart is true only at the heart zone", () => {
    expect(isChorusHeart(CHORUS_HEART_ZONE_ID)).toBe(true);
    expect(isChorusHeart("collider-ruins")).toBe(false);
    expect(isChorusHeart("starfall-core")).toBe(false);
    expect(isChorusHeart("outer-ruins")).toBe(false);
  });

  test("heart strength is exactly what the engine prices the heart garrison at", () => {
    const garrison = chorusGarrison(CHORUS_HEART_ZONE_ID);
    expect(garrison).not.toBeNull();
    // The pinned figure is DERIVED, not chosen: if the engine's pricing moves,
    // this names the new figure — tune the rows, carry the result.
    expect(computeForcePower(garrison!)).toBe(CHORUS_HEART.strength);
  });

  test("heart garrison fields the heart rows at the grade-V FOB ceiling", () => {
    const garrison = chorusGarrison(CHORUS_HEART_ZONE_ID)!;
    expect(garrison.fobStage).toBe(4); // still the shipped stage 4 — final boss, not a sixth stage
    expect(garrison.troops).toBe(CHORUS_HEART.troops);
    expect(garrison.heroSquad).toHaveLength(CHORUS_HEART.cells);
    expect(garrison.weapons).toHaveLength(1);
    expect(garrison.weapons[0].family).toBe("assault");
    expect(garrison.weapons[0].tier).toBe(4);
  });

  test("every site's strength is what the engine prices its garrison at", () => {
    // The ladder's discipline, extended to all 15 sites (heart included):
    // no carried strength may drift from computeForcePower of the garrison
    // the module builds.
    for (const site of CHORUS_SITES) {
      const garrison = chorusGarrison(site.zoneId)!;
      expect(computeForcePower(garrison)).toBe(chorusSiteStrength(site.zoneId));
    }
  });

  test("heart lookups out-stat grade V", () => {
    const gradeV = CHORUS_GRADES[4];
    expect(chorusSiteStrength(CHORUS_HEART_ZONE_ID)).toBeGreaterThan(gradeV.strength);
    expect(chorusSiteTroops(CHORUS_HEART_ZONE_ID)).toBeGreaterThan(gradeV.troops);
    // Non-heart sites read the grade ladder, untouched.
    expect(chorusSiteStrength("collider-ruins")).toBe(gradeV.strength);
    expect(chorusSiteTroops("collider-ruins")).toBe(gradeV.troops);
  });

  test("difficulty climbs monotonically: grades I→V, then the heart", () => {
    const strengths = CHORUS_GRADES.map((g) => g.strength);
    const troops = CHORUS_GRADES.map((g) => g.troops);
    for (let i = 1; i < strengths.length; i++) {
      expect(strengths[i]).toBeGreaterThan(strengths[i - 1]);
      expect(troops[i]).toBeGreaterThan(troops[i - 1]);
    }
    expect(CHORUS_HEART.strength).toBeGreaterThan(strengths[4]);
    expect(CHORUS_HEART.troops).toBeGreaterThan(troops[4]);
  });
});
