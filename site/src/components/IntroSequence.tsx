import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import StarMap from "~/components/StarMap";
import { useT } from "~/components/i18n/I18n";
import { sound } from "~/game/sound";
import type { KnownServer } from "~/game/servers";

/**
 * Hans's intro sequence (owner-directed, Oct 11 2026).
 *
 *   gate   → "tap to enter" (also the user gesture browsers require for audio)
 *   voice  → black screen + Hans's voice clip ("My friends... get ready for... HELL!")
 *   dark   → 4s of darkness after the clip
 *   reveal → music starts; 2s later the solar system fades in
 *   done   → StarMap (planet/race select) is the landing page
 *
 * Skippable at every step (tap anywhere / Skip button). Plays once per session.
 */

type Phase = "gate" | "voice" | "dark" | "reveal" | "done";

const INTRO_FLAG = "unbound-intro-played";
const VOICE_SRC = "/audio/intro-hell.m4a";
const DARK_PAUSE_MS = 4000; // Hans: 3–5s of darkness after the clip
const MUSIC_LEAD_MS = 2000; // music starts 2s before the solar system fades in
const VOICE_TIMEOUT_MS = 14000; // safety if the clip can't play / onended never fires
const FADE_MS = 1600;

/**
 * PLACEHOLDER — Hans is supplying his own music tracks. Wire the real intro
 * track here; the 2-second lead-in timing below is already built around it.
 */
function startIntroMusic(): void {
  // TODO(Hans): play the supplied intro track here.
}

function introAlreadyPlayed(): boolean {
  try {
    return window.sessionStorage.getItem(INTRO_FLAG) === "1";
  } catch {
    return false;
  }
}

function markIntroPlayed(): void {
  try {
    window.sessionStorage.setItem(INTRO_FLAG, "1");
  } catch {
    /* ignore */
  }
}

export default function IntroSequence() {
  const t = useT();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>(() => (introAlreadyPlayed() ? "done" : "gate"));
  const [fadedIn, setFadedIn] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  const later = useCallback(
    (ms: number, fn: () => void) => {
      timersRef.current.push(window.setTimeout(fn, ms));
    },
    []
  );

  const stopVoice = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      try {
        a.pause();
      } catch {
        /* ignore */
      }
      audioRef.current = null;
    }
  }, []);

  const finish = useCallback(() => {
    clearTimers();
    stopVoice();
    markIntroPlayed();
    setPhase("done");
  }, [clearTimers, stopVoice]);

  // Begin the sequence: this tap is the user gesture that unlocks audio.
  const begin = useCallback(() => {
    sound.prime();
    setPhase("voice");
    try {
      const a = new Audio(VOICE_SRC);
      audioRef.current = a;
      a.onended = () => {
        audioRef.current = null;
        setPhase("dark");
      };
      a.onerror = () => {
        audioRef.current = null;
        setPhase("dark");
      };
      void a.play().catch(() => setPhase("dark"));
      // Safety net: never trap the player on a black screen.
      later(VOICE_TIMEOUT_MS, () => {
        if (audioRef.current) {
          stopVoice();
          setPhase("dark");
        }
      });
    } catch {
      setPhase("dark");
    }
  }, [later, stopVoice]);

  // Phase machine: dark → (music) → reveal → done.
  useEffect(() => {
    if (phase === "dark") {
      later(DARK_PAUSE_MS, () => setPhase("reveal"));
    } else if (phase === "reveal") {
      startIntroMusic();
      later(MUSIC_LEAD_MS, () => {
        markIntroPlayed();
        setPhase("done");
      });
    } else if (phase === "done") {
      // Let the StarMap mount, then fade it in.
      const raf = window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => setFadedIn(true))
      );
      return () => window.cancelAnimationFrame(raf);
    }
    return undefined;
  }, [phase, later]);

  useEffect(() => {
    return () => {
      clearTimers();
      stopVoice();
    };
  }, [clearTimers, stopVoice]);

  const handleServerPick = useCallback(
    (server: KnownServer) => {
      // Same origin = this server: continue into the game. Otherwise the
      // server lives on its own deployment — navigate there.
      try {
        const target = new URL(server.url);
        if (target.origin === window.location.origin) {
          void navigate({ to: "/play" });
          return;
        }
      } catch {
        /* fall through to navigate */
      }
      window.location.href = server.url;
    },
    [navigate]
  );

  if (phase === "done") {
    return (
      <div
        className="min-h-screen bg-[#070910] text-gray-200 transition-opacity ease-out"
        style={{ opacity: fadedIn ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
      >
        <StarMap onSelect={handleServerPick} />
      </div>
    );
  }

  const skipLabel = t("intro.skip", "Skip intro");

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black text-zinc-100"
      onPointerDown={() => {
        // Any tap during the sequence skips it — never trap the player.
        if (phase !== "gate") finish();
      }}
    >
      {phase === "gate" ? (
        <button
          type="button"
          onClick={begin}
          className="flex min-h-full w-full flex-col items-center justify-center gap-6 px-6 text-center"
          aria-label={t("intro.enter", "Enter The Unbound")}
        >
          {/* shattered-ring emblem */}
          <svg width="72" height="72" viewBox="0 0 26 26" fill="none" aria-hidden="true">
            <circle
              cx="13"
              cy="13"
              r="10.5"
              stroke="#f59e0b"
              strokeWidth="1.4"
              strokeDasharray="52 14"
              strokeLinecap="round"
              transform="rotate(-30 13 13)"
            />
            <circle cx="13" cy="13" r="3.2" fill="#f59e0b" />
          </svg>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.4em] text-amber-300/80">
              {t("intro.kicker", "A saga that feeds itself")}
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-wide text-white sm:text-5xl">
              {t("landing.brand", "The Unbound")}
            </h1>
          </div>
          <p className="animate-pulse text-sm font-semibold uppercase tracking-[0.3em] text-zinc-400">
            {t("intro.tapToEnter", "Tap to enter")}
          </p>
        </button>
      ) : (
        <>
          {/* voice / dark / reveal: pure black. The drama is the absence. */}
          <span className="sr-only">{t("intro.playing", "Intro playing")}</span>
          <button
            type="button"
            onClick={finish}
            className="absolute bottom-8 rounded-full border border-white/15 bg-white/5 px-5 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
          >
            {skipLabel}
          </button>
        </>
      )}
    </div>
  );
}
