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

const VOICE_SRC = "/audio/intro-hell.m4a";
const DARK_PAUSE_MS = 4000; // Hans: 3–5s of darkness after the clip
const MUSIC_LEAD_MS = 2000; // music starts 2s before the solar system fades in
const VOICE_TIMEOUT_MS = 14000; // safety if the clip can't play / onended never fires
const FADE_MS = 1600;

/**
 * Hans's own intro music track. Plays with a 2-second lead before the
 * solar system fades in.
 */
const INTRO_MUSIC_SRC = "/audio/intro-music.m4a";
let introMusicEl: HTMLAudioElement | null = null;

function startIntroMusic(): void {
  try {
    if (!introMusicEl) {
      introMusicEl = new Audio(INTRO_MUSIC_SRC);
      introMusicEl.loop = true;
      introMusicEl.volume = 0.7;
    }
    void introMusicEl.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

function stopIntroMusic(): void {
  try {
    if (introMusicEl) {
      introMusicEl.pause();
      introMusicEl.currentTime = 0;
    }
  } catch {
    /* ignore */
  }
}

/**
 * The gate title: "THE UNBOUND" rushes from tiny to huge, then BOOM.
 * The boom fires at ~1.85s when the title slams to full size.
 */
function TitleRush({ t }: { t: (k: string, d: string) => string }) {
  useEffect(() => {
    const boomTimer = window.setTimeout(() => {
      try {
        const boom = new Audio("/audio/intro-boom.m4a");
        boom.volume = 1.0;
        void boom.play().catch(() => {});
      } catch {
        /* ignore */
      }
    }, 1850);
    return () => window.clearTimeout(boomTimer);
  }, []);

  return (
    <div className="title-rush flex flex-col items-center">
      <p className="text-xs font-semibold uppercase tracking-[0.4em] text-amber-300">
        {t("intro.kicker", "A saga that feeds itself")}
      </p>
      <h1
        className="mt-3 font-black tracking-wide text-white"
        style={{
          fontSize: "clamp(3rem, 12vw, 6rem)",
          textShadow:
            "0 0 30px rgba(245,158,11,0.6), 0 0 80px rgba(245,158,11,0.3), 0 4px 24px rgba(0,0,0,0.9)",
        }}
      >
        {t("landing.brand", "The Unbound")}
      </h1>
    </div>
  );
}

export default function IntroSequence() {
  const t = useT();
  const navigate = useNavigate();
  // Hans: the intro plays EVERY time the game opens. No session skip.
  const [phase, setPhase] = useState<Phase>("gate");
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
    stopIntroMusic();
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
          className="relative flex min-h-full w-full flex-col items-center justify-center overflow-hidden px-6 text-center"
          aria-label={t("intro.enter", "Enter The Unbound")}
        >
          {/* Rushing title: starts tiny, hurtles toward the viewer, then BOOM. */}
          <style>{`
            @keyframes title-rush {
              0% { transform: scale(0.1); opacity: 0; filter: brightness(0.4); }
              55% { transform: scale(0.7); opacity: 1; filter: brightness(0.9); }
              82% { transform: scale(2.6); opacity: 1; filter: brightness(1.6); }
              100% { transform: scale(2.6); opacity: 1; filter: brightness(1.6); }
            }
            @keyframes title-shake {
              0%, 100% { transform: scale(2.6) translate(0, 0); }
              20% { transform: scale(2.6) translate(-6px, 3px); }
              40% { transform: scale(2.6) translate(5px, -4px); }
              60% { transform: scale(2.6) translate(-4px, -3px); }
              80% { transform: scale(2.6) translate(4px, 4px); }
            }
            @keyframes kicker-fade {
              0%, 88% { opacity: 0; }
              100% { opacity: 1; }
            }
            .title-rush {
              animation: title-rush 2.2s cubic-bezier(0.15, 0.85, 0.35, 1) forwards,
                         title-shake 0.5s ease-in-out 2.2s 3;
            }
            /* Tap to enter fades in ~2s after the title slams home. Clean. */
            .kicker-fade { animation: kicker-fade 5.8s ease-out forwards; }
          `}</style>
          <TitleRush t={t} />
          <p className="kicker-fade absolute bottom-16 animate-pulse text-sm font-semibold uppercase tracking-[0.3em] text-zinc-400">
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
