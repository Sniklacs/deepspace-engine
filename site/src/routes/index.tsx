import { createFileRoute, Link } from "@tanstack/react-router";
import { useT } from "~/components/i18n/I18n";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const t = useT();
  return (
    <div className="min-h-screen bg-[#070910] text-gray-200">
      {/* hero */}
      <header className="mx-auto max-w-6xl px-6 py-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔰</span>
          <span className="font-semibold tracking-wide text-white">{t("app.name")}</span>
        </div>
        <Link to="/play" className="rounded-lg bg-ember px-4 py-2 text-sm font-semibold text-black hover:brightness-110">
          {t("landing.play")}
        </Link>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-8 pb-16 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">{t("landing.kicker")}</p>
        <h1 className="mt-4 text-4xl md:text-6xl font-bold text-white leading-tight">
          {t("landing.h1a")} <br className="hidden md:block" /> {t("landing.h1b")}
          <br />
          <span className="text-amber-300">{t("landing.h1c")}</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-gray-400 text-lg">
          {t("landing.lede")}
          <span className="text-gray-200"> {t("landing.ledeStrong")}</span>
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/play"
            className="rounded-lg bg-ember px-6 py-3 text-base font-semibold text-black hover:brightness-110"
          >
            {t("landing.begin")}
          </Link>
          <Link
            to="/the-fall"
            className="rounded-lg border border-amber-400/40 bg-amber-400/5 px-6 py-3 text-base font-semibold text-amber-100 hover:bg-amber-400/10"
          >
            {t("landing.fall")}
          </Link>
          <a href="#world" className="rounded-lg border border-gray-700 bg-white/5 px-6 py-3 text-base font-semibold text-gray-200 hover:bg-white/10">
            {t("landing.world")}
          </a>
        </div>
      </section>

      {/* core loop */}
      <section id="world" className="border-t border-white/5 bg-black/30 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-sm uppercase tracking-[0.3em] text-amber-300/80">{t("landing.coreLoop")}</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-2xl font-semibold text-white">
            {t("landing.coreLine")}
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-5">
            {[
              ["🏜️", "expeditions"],
              ["💎", "salvage"],
              ["🔬", "study"],
              ["🛠️", "deploy"],
              ["🚀", "grow"],
            ].map(([icon, id]) => (
              <div key={id} className="rounded-xl border border-white/10 bg-white/5 p-5">
                <div className="text-3xl">{icon}</div>
                <h3 className="mt-3 font-semibold text-white">{t(`landing.step.${id}.title`)}</h3>
                <p className="mt-2 text-sm text-gray-400">{t(`landing.step.${id}.text`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* vocabulary */}
      <section className="py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-sm uppercase tracking-[0.3em] text-amber-300/80">{t("landing.know")}</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {["cradle", "chorus", "embers", "chipsets", "shatterlands"].map((id) => (
              <div key={id} className="rounded-xl border border-white/10 bg-white/5 p-5">
                <h3 className="font-semibold text-white">{t(`landing.know.${id}.title`)}</h3>
                <p className="mt-2 text-sm text-gray-400">{t(`landing.know.${id}.text`)}</p>
              </div>
            ))}
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-5">
              <h3 className="font-semibold text-amber-200">{t("landing.persistenceTitle")}</h3>
              <p className="mt-2 text-sm text-gray-400">{t("landing.persistenceText")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* races teaser */}
      <section className="border-t border-white/5 bg-black/30 py-16">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h2 className="text-sm uppercase tracking-[0.3em] text-amber-300/80">{t("landing.racesTitle")}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-gray-400">{t("landing.racesText")}</p>
          <Link to="/play" className="mt-8 inline-block rounded-lg bg-ember px-6 py-3 font-semibold text-black hover:brightness-110">
            {t("landing.claim")}
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-text-3">
        <p>{t("landing.footer1")}</p>
        <p className="mt-1">{t("landing.footer2")}</p>
      </footer>
    </div>
  );
}
