import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import InstallAffordance from "~/components/shell/InstallAffordance";
import { useT } from "~/components/i18n/I18n";
import { LandingLangPicker } from "~/components/i18n/LandingLangPicker";
import { sound } from "~/game/sound";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

const PILLARS = ["world", "war", "seasons", "legend"] as const;
const STEPS = ["explore", "salvage", "research", "build", "raid", "ascend"] as const;

/** The shattered-ring emblem: the broken orbital ring over the Shatterlands. */
function Emblem() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <circle cx="13" cy="13" r="10.5" stroke="#f59e0b" strokeWidth="2" strokeDasharray="52 14" strokeLinecap="round" transform="rotate(-30 13 13)" />
      <circle cx="13" cy="13" r="3.2" fill="#f59e0b" />
    </svg>
  );
}

function LandingPage() {
  const t = useT();
  const [muted, setMuted] = useState(false);

  // The drift starts on the visitor's first tap — browser autoplay rules
  // forbid sound before a gesture, so the landing page arms it the same way
  // the game does. The header carries a mute toggle; mute is per-visit.
  useEffect(() => {
    const onFirst = () => {
      sound.prime();
      sound.startMusic();
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
    };
    window.addEventListener("pointerdown", onFirst);
    window.addEventListener("keydown", onFirst);
    return () => {
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
    };
  }, []);

  const toggleMute = () => setMuted(sound.toggleMute());

  return (
    <div className="safe-area-top min-h-screen bg-[#07070c] text-zinc-100">
      {/* header — brand, language picker, play */}
      <header className="fixed inset-x-0 top-0 z-20 border-b border-white/10 bg-[#07070c]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex min-w-0 items-center gap-2" aria-label={t("landing.brand", "The Unbound")}>
            <Emblem />
            <span className="truncate text-base font-bold tracking-wide text-white sm:text-lg">{t("landing.brand", "The Unbound")}</span>
          </Link>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <LandingLangPicker />
            <button
              onClick={toggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
              title={muted ? "Unmute" : "Mute"}
              className="rounded-lg border border-white/15 bg-white/5 p-2 text-zinc-300 hover:bg-white/10"
            >
              {muted ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M11 5 6 9H2v6h4l5 4V5z" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M11 5 6 9H2v6h4l5 4V5z" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  <path d="M18.5 5.5a9.4 9.4 0 0 1 0 13" />
                </svg>
              )}
            </button>
            <Link
              to="/play"
              className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-black hover:brightness-110 sm:px-4 sm:text-sm"
            >
              {t("landing.play", "Play the Cradle")}
            </Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="relative flex min-h-[96vh] items-end overflow-hidden">
        <img
          src="/art/landing/hero-shatterlands.webp"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07070c] via-[#07070c]/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#07070c]/60 via-transparent to-transparent" />
        <div className="relative mx-auto w-full max-w-6xl px-4 pb-14 pt-36 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-300">
            {t("landing.kicker", "A persistent online strategy game")}
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-black leading-[1.05] text-white sm:text-6xl">
            {t("landing.h1a", "The war against the machines")}
            <br />
            {t("landing.h1b", "is over. Nobody won.")}
            <br />
            <span className="text-amber-300">{t("landing.h1c", "The rebuilding is yours.")}</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
            {t(
              "landing.lede",
              "The Unbound is a persistent multiplayer colony-survivor set in the Shatterlands."
            )}
          </p>
          <p className="mt-3 font-semibold text-amber-200">
            {t("landing.ledeStrong", "Every season the world resets. Legends don't.")}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/play"
              className="rounded-lg bg-amber-500 px-6 py-3 text-base font-bold text-black hover:brightness-110"
            >
              {t("landing.begin", "Begin Your Exploration")}
            </Link>
            <Link
              to="/the-fall"
              className="rounded-lg border border-amber-400/40 bg-amber-400/5 px-6 py-3 text-base font-semibold text-amber-100 hover:bg-amber-400/10"
            >
              {t("landing.fall", "The Fall · The Height")}
            </Link>
            <a
              href="#world"
              className="rounded-lg border border-white/15 bg-white/5 px-6 py-3 text-base font-semibold text-zinc-200 hover:bg-white/10"
            >
              {t("landing.world", "The World")}
            </a>
          </div>

          {/* The install door, on the first screen. Renders nothing at all when the
              browser offers no install path, or when this is already an installed
              app (display-mode: standalone). */}
          <div className="mt-8 max-w-2xl">
            <InstallAffordance variant="card" />
          </div>
        </div>
      </section>

      {/* what is the game */}
      <section id="world" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-300/80">
          {t("landing.kicker", "A persistent online strategy game")}
        </p>
        <h2 className="mt-3 text-3xl font-bold text-white sm:text-4xl">
          {t("landing.what", "What is The Unbound")}
        </h2>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-zinc-300">
          {t(
            "landing.whatBody",
            "Seven races went to war with the machine Chorus and nearly wiped each other out."
          )}
        </p>
        <div className="mt-10 grid items-start gap-8 lg:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <img
              src="/art/landing/explore-ruins.webp"
              alt={t("landing.step.explore.title", "Explore")}
              className="aspect-[4/3] w-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="grid gap-4">
            {PILLARS.map((id) => (
              <div key={id} className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
                <h3 className="font-semibold text-white">
                  {t(`landing.pillar.${id}.title`, id)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  {t(`landing.pillar.${id}.text`, "")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* core loop */}
      <section className="border-y border-white/5 bg-black/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-amber-300/80">
            {t("landing.coreLoop", "The Core Loop")}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-2xl font-semibold text-white">
            {t("landing.coreLine", "Salvage the thing that almost destroyed you. Use it to rebuild.")}
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((id, i) => (
              <div key={id} className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
                <div className="text-xs font-bold tracking-[0.2em] text-amber-400/80">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 className="mt-2 font-semibold text-white">
                  {t(`landing.step.${id}.title`, id)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  {t(`landing.step.${id}.text`, "")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* the chorus waits — pull-quote band */}
      <section className="relative overflow-hidden">
        <img
          src="/art/landing/chorus-threat.webp"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-[#07070c]/55" />
        <div className="relative mx-auto max-w-4xl px-4 py-24 text-center sm:px-6 sm:py-32">
          <p className="text-2xl font-bold leading-snug text-white sm:text-4xl">
            “{t("landing.ledeStrong", "Every season the world resets. Legends don't.")}”
          </p>
          <p className="mt-4 text-sm uppercase tracking-[0.25em] text-red-300/80">
            {t("landing.pillar.war.title", "War across worlds")}
          </p>
        </div>
      </section>

      {/* races teaser — a taste, not the whole roster */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold text-white sm:text-4xl">
              {t("landing.racesTitle", "Six races survived. Choose yours.")}
            </h2>
            <p className="mt-4 leading-relaxed text-zinc-400">
              {t("landing.racesText", "")}
            </p>
            <Link
              to="/play"
              className="mt-8 inline-block rounded-lg bg-amber-500 px-6 py-3 font-bold text-black hover:brightness-110"
            >
              {t("landing.claim", "Claim a Colony")}
            </Link>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <img
              src="/art/landing/races-teaser.webp"
              alt={t("landing.racesTitle", "Six races survived. Choose yours.")}
              className="aspect-[4/3] w-full object-cover"
              loading="lazy"
            />
          </div>
        </div>
      </section>

      <footer className="safe-area-bottom border-t border-white/5 py-8 text-center text-xs text-zinc-500">
        <p>{t("landing.footer1", "The Unbound · a persistent multiplayer colony-survival strategy game")}</p>
        <p className="mt-1">{t("landing.footer2", "")}</p>
      </footer>
    </div>
  );
}
