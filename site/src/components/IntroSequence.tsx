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

type Phase = "gate" | "gate-armed" | "voice" | "dark" | "reveal" | "done";

const VOICE_SRC = "/audio/intro-hell.m4a";
const DARK_PAUSE_MS = 4000; // Hans: 3–5s of darkness after the clip
const MUSIC_LEAD_MS = 5000; // music starts 5s before the solar system fades in — let it breathe
const VOICE_TIMEOUT_MS = 14000; // safety if the clip can't play / onended never fires
const FADE_MS = 1600;

/**
 * Hans's intro music program (owner-directed, Oct 13 2026): two of his
 * tracks back to back — Track 8 first, then Track 10 — then the pair loops.
 * Both at the same program level; the old two-layer mix is gone.
 */
const INTRO_TRACK_SRCS = ["/audio/intro-track-1.m4a", "/audio/intro-track-2.m4a"] as const;
const MUSIC_VOLUME = 0.8; // the old main loop's program level
let introTrackEls: HTMLAudioElement[] | null = null;
let musicChainActive = false;
let musicFadeTimer: number | null = null;

function getIntroTrackEls(): HTMLAudioElement[] {
  if (!introTrackEls) {
    introTrackEls = INTRO_TRACK_SRCS.map((src) => {
      const el = new Audio(src);
      el.preload = "auto";
      el.volume = MUSIC_VOLUME;
      return el;
    });
    // Hard cut at the seam: when one track ends, the next starts; after the
    // second, the pair loops back to the first. Chained on `ended` only —
    // no timers to drift, nothing to glitch.
    introTrackEls[0].onended = () => {
      if (musicChainActive) playIntroTrack(1);
    };
    introTrackEls[1].onended = () => {
      if (musicChainActive) playIntroTrack(0);
    };
  }
  return introTrackEls;
}

function playIntroTrack(index: 0 | 1): void {
  const el = getIntroTrackEls()[index];
  try {
    el.currentTime = 0;
    el.volume = MUSIC_VOLUME;
    void el.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

function startIntroMusic(): void {
  try {
    musicChainActive = true;
    const first = getIntroTrackEls()[0];
    first.currentTime = 0;
    first.volume = 0;
    void first.play().then(() => {
      // Same slow fade-in the old main loop had.
      if (musicFadeTimer !== null) window.clearInterval(musicFadeTimer);
      let v = 0;
      musicFadeTimer = window.setInterval(() => {
        v += 0.05;
        if (v >= MUSIC_VOLUME) {
          first.volume = MUSIC_VOLUME;
          if (musicFadeTimer !== null) window.clearInterval(musicFadeTimer);
          musicFadeTimer = null;
        } else {
          first.volume = v;
        }
      }, 200);
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Go FULLSCREEN (Hans, Oct 12 2026): no browser chrome, all game.
 *  Must be called from a user gesture (the entry taps qualify). */
function goFullscreen(): void {
  try {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      void el.requestFullscreen({ navigationUI: "hide" }).catch(() => {
        void el.requestFullscreen().catch(() => {});
      });
    }
  } catch {
    /* ignore */
  }
}

function stopIntroMusic(): void {
  // Kill the chain first so a pending `ended` can never start the next
  // track, then stop BOTH elements — including the one not yet playing.
  musicChainActive = false;
  if (musicFadeTimer !== null) {
    window.clearInterval(musicFadeTimer);
    musicFadeTimer = null;
  }
  try {
    if (introTrackEls) {
      for (const el of introTrackEls) {
        el.pause();
        el.currentTime = 0;
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * The gate title: "THE UNBOUND" rushes from tiny to huge, then BOOM.
 * The boom fires at ~1.85s when the title slams to full size.
 */
function TitleRush({ t, onSlamDone }: { t: (k: string, d: string) => string; onSlamDone: () => void }) {
  useEffect(() => {
    // This component only mounts after a user tap — audio is unlocked, the boom WILL play.
    const boomTimer = window.setTimeout(() => {
      try {
        const boom = new Audio("/audio/intro-boom.m4a");
        boom.volume = 1.0;
        void boom.play().catch(() => {});
      } catch {
        /* ignore */
      }
    }, 3340);
    // After slam + shake + 2s clean impact, reveal "tap to enter".
    const doneTimer = window.setTimeout(onSlamDone, 7300);
    return () => {
      window.clearTimeout(boomTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onSlamDone]);

  return (
    <>
      {/* Kicker: static, above the title, like the original. */}
      <p className="absolute top-[28%] text-xs font-semibold uppercase tracking-[0.4em] text-amber-300/80">
        {t("intro.kicker", "A saga that feeds itself")}
      </p>
      <div className="title-rush flex flex-col items-center">
        <img
          src="/art/title-unbound.webp"
          alt="The Unbound"
          className="w-[85vw] max-w-[600px]"
          draggable={false}
        />
      </div>
    </>
  );
}

export default function IntroSequence() {
  const t = useT();
  const navigate = useNavigate();
  // Hans: the intro plays EVERY time the game opens. No session skip.
  const [phase, setPhase] = useState<Phase>("gate");
  const [fadedIn, setFadedIn] = useState(false);
  const [slamDone, setSlamDone] = useState(false);
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
    goFullscreen();
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
        // (gate and gate-armed are the entry; taps there advance, not skip.)
        if (phase !== "gate" && phase !== "gate-armed") finish();
      }}
    >
      {phase === "gate" ? (
        <button
          type="button"
          onClick={() => setPhase("gate-armed")}
          className="flex min-h-full w-full flex-col items-center justify-center bg-black px-6"
          aria-label="Begin"
        >
          <span className="animate-pulse text-xs font-semibold uppercase tracking-[0.4em] text-zinc-600">
            Tap
          </span>
        </button>
      ) : phase === "gate-armed" ? (
        <button
          type="button"
          onClick={begin}
          className="relative flex min-h-full w-full flex-col items-center justify-center overflow-hidden bg-black px-6 text-center"
          aria-label={t("intro.enter", "Enter The Unbound")}
        >
          {/* Rushing title: starts tiny, hurtles toward the viewer, then BOOM. */}
          <style>{`
            @keyframes title-rush {
              0% { transform: scale(0.08); opacity: 0; filter: brightness(0.3); }
              45% { transform: scale(0.25); opacity: 0.7; filter: brightness(0.6); }
              70% { transform: scale(0.55); opacity: 1; filter: brightness(0.9); }
              88% { transform: scale(1.12); opacity: 1; filter: brightness(1.7); }
              100% { transform: scale(1.12); opacity: 1; filter: brightness(1.7); }
            }
            @keyframes title-shake {
              0%, 100% { transform: scale(1.12) translate(0, 0); }
              20% { transform: scale(1.12) translate(-6px, 3px); }
              40% { transform: scale(1.12) translate(5px, -4px); }
              60% { transform: scale(1.12) translate(-4px, -3px); }
              80% { transform: scale(1.12) translate(4px, 4px); }
            }
            .title-rush {
              animation: title-rush 3.8s cubic-bezier(0.55, 0, 0.85, 0.4) forwards,
                         title-shake 0.5s ease-in-out 3.8s 3;
            }
          `}</style>
          <TitleRush t={t} onSlamDone={() => setSlamDone(true)} />
          {slamDone && (
            <p className="absolute bottom-16 animate-pulse text-sm font-semibold uppercase tracking-[0.3em] text-zinc-400">
              {t("intro.tapToEnter", "Tap to enter")}
            </p>
          )}
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
