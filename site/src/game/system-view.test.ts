// Tests for the solar-system layer kernel (game/system-view.ts) — Hans,
// Oct 6 2026: zoom-out backs out to the solar system, probes launch from
// there, foreign planets show probe-gated intel only. Run:
//   bun test site/src/game/system-view.test.ts
import { describe, expect, test } from "bun:test";
import { KNOWN_SERVERS } from "./servers";
import {
  SCALE_MAX,
  SCALE_MIN,
  SYSTEM_FULL_SCALE,
  SYSTEM_GLOBE_SCALE,
  buildPlanets,
  clampScale,
  fmtEtaMs,
  isSystemDominant,
  orbitRadiusFactor,
  planetDefById,
  planetScreenPositions,
  planetScreenRadius,
  probeGate,
  systemTFromScale,
  zoomInAction,
} from "./system-view";
import { emptyWorldMap, type ScoutProbe } from "./worldmap";

const HOME = "draconians-world";
const NOW = 1_800_000_000_000;

describe("zoom band", () => {
  test("systemT is 0 across the whole globe band", () => {
    expect(systemTFromScale(SYSTEM_GLOBE_SCALE)).toBe(0);
    expect(systemTFromScale(1)).toBe(0);
    expect(systemTFromScale(SCALE_MAX)).toBe(0);
  });

  test("systemT is 1 at and below the full-system scale", () => {
    expect(systemTFromScale(SYSTEM_FULL_SCALE)).toBe(1);
    expect(systemTFromScale(SCALE_MIN)).toBe(1);
    expect(systemTFromScale(0.2)).toBe(1);
  });

  test("systemT blends monotonically through the back-out band", () => {
    const mid = (SYSTEM_GLOBE_SCALE + SYSTEM_FULL_SCALE) / 2;
    const tMid = systemTFromScale(mid);
    expect(tMid).toBeGreaterThan(0);
    expect(tMid).toBeLessThan(1);
    expect(tMid).toBeCloseTo(0.5, 5); // smoothstep midpoint
    let prev = -1;
    for (let i = 0; i <= 16; i++) {
      const s = SYSTEM_GLOBE_SCALE - (i / 16) * (SYSTEM_GLOBE_SCALE - SYSTEM_FULL_SCALE);
      const t = systemTFromScale(s);
      expect(t >= prev).toBe(true);
      prev = t;
    }
    expect(prev).toBe(1);
  });

  test("clampScale pins the continuous range", () => {
    expect(clampScale(0.01)).toBe(SCALE_MIN);
    expect(clampScale(99)).toBe(SCALE_MAX);
    expect(clampScale(1)).toBe(1);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  test("system dominance flips inside the band", () => {
    expect(isSystemDominant(1)).toBe(false);
    expect(isSystemDominant(SCALE_MIN)).toBe(true);
  });
});

describe("planets", () => {
  test("every known world becomes a planet; home is flagged exactly once", () => {
    const planets = buildPlanets(HOME);
    expect(planets.length).toBe(KNOWN_SERVERS.length);
    expect(planets.filter((p) => p.isHome).map((p) => p.id)).toEqual([HOME]);
    for (const p of planets) {
      expect(p.palette.core).toMatch(/^#/);
      expect(p.palette.rim).toMatch(/^#/);
    }
  });

  test("planetDefById resolves planets and flags home", () => {
    expect(planetDefById("grays-world", HOME)?.raceName).toBe("Grays");
    expect(planetDefById(HOME, HOME)?.isHome).toBe(true);
    expect(planetDefById("no-such-world", HOME)).toBeUndefined();
  });

  test("orbit factors grow outward and stay inside the system", () => {
    expect(orbitRadiusFactor(0)).toBeLessThan(orbitRadiusFactor(5));
    expect(orbitRadiusFactor(KNOWN_SERVERS.length - 1) <= 1).toBe(true);
  });

  test("home planet rides bigger than foreign planets", () => {
    expect(planetScreenRadius(2, true, 400)).toBeGreaterThan(
      planetScreenRadius(2, false, 400),
    );
  });
});

describe("orbit layout", () => {
  const opts = {
    homeWorldId: HOME,
    cx: 180,
    cy: 260,
    maxOrbit: 170,
    minDim: 360,
    nowMs: NOW,
    phaseOffset: 0,
  };

  test("deterministic: same instant in, same sky out", () => {
    expect(planetScreenPositions(opts)).toEqual(planetScreenPositions(opts));
  });

  test("positions are finite, on-screen-ish, and distinct (phone viewport)", () => {
    const pos = planetScreenPositions(opts);
    expect(pos.length).toBe(KNOWN_SERVERS.length);
    const seen = new Set<string>();
    for (const p of pos) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.r).toBeGreaterThan(0);
      // within one planet-radius of the 360×520 phone canvas
      expect(p.x).toBeGreaterThan(-p.r);
      expect(p.x).toBeLessThan(360 + p.r);
      expect(p.y).toBeGreaterThan(-p.r);
      expect(p.y).toBeLessThan(520 + p.r);
      const key = `${Math.round(p.x)},${Math.round(p.y)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test("the sky moves with time and with the player's drag phase", () => {
    const a = planetScreenPositions(opts);
    const b = planetScreenPositions({ ...opts, nowMs: NOW + 60_000 });
    const c = planetScreenPositions({ ...opts, phaseOffset: 0.5 });
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });

  test("exactly one position is home, at the home orbit slot", () => {
    const pos = planetScreenPositions(opts);
    const homes = pos.filter((p) => p.isHome);
    expect(homes.length).toBe(1);
    expect(homes[0].serverId).toBe(HOME);
  });
});

describe("probe gate", () => {
  const probe: ScoutProbe = {
    id: "probe-1",
    targetServerId: "grays-world",
    launchedAt: NOW,
    returnsAt: NOW + 30_000,
    status: "inflight",
  };

  test("home world never needs a probe", () => {
    expect(probeGate(undefined, HOME, HOME, NOW).kind).toBe("home");
    const wm = emptyWorldMap(NOW);
    expect(probeGate(wm, HOME, HOME, NOW).kind).toBe("home");
  });

  test("unresearched → needs-research, even with probes somehow in hand", () => {
    const wm = emptyWorldMap(NOW);
    wm.probes = 3;
    expect(probeGate(wm, "grays-world", HOME, NOW).kind).toBe("needs-research");
    expect(probeGate(undefined, "grays-world", HOME, NOW).kind).toBe("needs-research");
  });

  test("researched, nothing flying → launch gate carries ready count + report", () => {
    const wm = emptyWorldMap(NOW);
    wm.scoutTechResearched = true;
    wm.probes = 2;
    const gate = probeGate(wm, "grays-world", HOME, NOW);
    expect(gate.kind).toBe("launch");
    if (gate.kind === "launch") {
      expect(gate.probesReady).toBe(2);
      expect(gate.report).toBeUndefined();
    }
    // A returned report surfaces through the same gate (fog: report-gated).
    wm.reports["grays-world"] = {
      id: "report-probe-0",
      serverId: "grays-world",
      playerCount: 120,
      colonyCount: 150,
      abandonedCount: 12,
      receivedAt: NOW - 1000,
    };
    const withReport = probeGate(wm, "grays-world", HOME, NOW);
    if (withReport.kind === "launch") {
      expect(withReport.report?.playerCount).toBe(120);
    } else {
      throw new Error("expected launch gate");
    }
  });

  test("no probes ready → launch gate reports zero (sheet shows the shortfall)", () => {
    const wm = emptyWorldMap(NOW);
    wm.scoutTechResearched = true;
    const gate = probeGate(wm, "grays-world", HOME, NOW);
    expect(gate.kind).toBe("launch");
    if (gate.kind === "launch") expect(gate.probesReady).toBe(0);
  });

  test("en route → enroute gate; ready flips at returnsAt", () => {
    const wm = emptyWorldMap(NOW);
    wm.scoutTechResearched = true;
    wm.inflight = [probe];
    const flying = probeGate(wm, "grays-world", HOME, NOW + 10_000);
    expect(flying.kind).toBe("enroute");
    if (flying.kind === "enroute") expect(flying.ready).toBe(false);
    const landed = probeGate(wm, "grays-world", HOME, NOW + 30_000);
    expect(landed.kind).toBe("enroute");
    if (landed.kind === "enroute") expect(landed.ready).toBe(true);
    // A probe to a DIFFERENT planet doesn't gate this one.
    expect(probeGate(wm, "ashtar-world", HOME, NOW).kind).toBe("launch");
  });
});

describe("zoom-in action + eta", () => {
  test("only home (or nothing) zooms into a globe; foreign approaches", () => {
    expect(zoomInAction(null, HOME)).toBe("globe");
    expect(zoomInAction(HOME, HOME)).toBe("globe");
    expect(zoomInAction("grays-world", HOME)).toBe("approach");
  });

  test("fmtEtaMs renders compact countdowns", () => {
    expect(fmtEtaMs(45_000)).toBe("45s");
    expect(fmtEtaMs(192_000)).toBe("3m 12s");
    expect(fmtEtaMs(7_500_000)).toBe("2h 05m");
    expect(fmtEtaMs(-5)).toBe("0s");
  });
});
