// Tests for the star map audio + visual config.
// Run: bun test site/src/game/audio/starmap.test.ts
import { describe, expect, test } from "bun:test";
import {
  playHover,
  playClick,
  playSelect,
  playDeselect,
  playConfirm,
  playDenied,
  playWhoosh,
  playEntrance,
} from "./ui-sounds";
import { startMusic, stopMusic, isMusicPlaying } from "./starmap-music";
import { ac, out, reverbBus, tone, noiseBurst, subDrop, boom, now } from "./audio-core";
import { KNOWN_SERVERS } from "../servers";
import { RACES } from "../races";

describe("audio-core (no browser env)", () => {
  test("ac() returns null without window", () => {
    expect(ac()).toBeNull();
  });
  test("out() returns null without window", () => {
    expect(out()).toBeNull();
  });
  test("reverbBus() returns null without window", () => {
    expect(reverbBus()).toBeNull();
  });
  test("now() returns 0 without window", () => {
    expect(now()).toBe(0);
  });
  test("tone/noiseBurst/subDrop/boom are safe no-ops without window", () => {
    let threw = false;
    try {
      tone(440, { dur: 0.1 });
      noiseBurst({ dur: 0.1 });
      subDrop({ from: 60, to: 30 });
      boom(0, 1);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("ui-sounds (no browser env)", () => {
  test("all SFX functions are safe no-ops without window", () => {
    let threw = false;
    try {
      playHover();
      playClick();
      playSelect();
      playDeselect();
      playConfirm();
      playDenied();
      playWhoosh();
      playEntrance();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("starmap-music (no browser env)", () => {
  test("startMusic is a safe no-op without window; not playing", () => {
    let threw = false;
    try {
      startMusic();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(isMusicPlaying()).toBe(false);
  });
  test("stopMusic is safe without window", () => {
    let threw = false;
    try {
      stopMusic();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("star map server coverage", () => {
  test("every race in RACES has a known server entry", () => {
    const serverRaces = new Set(KNOWN_SERVERS.map((s) => s.raceId));
    for (const race of RACES) {
      expect(serverRaces.has(race.id)).toBe(true);
    }
  });
  test("six servers for six races", () => {
    expect(KNOWN_SERVERS.length).toBe(6);
  });
  test("two servers live, four coming soon", () => {
    const live = KNOWN_SERVERS.filter((s) => s.status === "live");
    const soon = KNOWN_SERVERS.filter((s) => s.status === "soon");
    expect(live.length).toBe(2);
    expect(soon.length).toBe(4);
  });
});
