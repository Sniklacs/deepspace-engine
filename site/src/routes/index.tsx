import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-[#070910] text-gray-200">
      {/* hero */}
      <header className="mx-auto max-w-6xl px-6 py-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔰</span>
          <span className="font-semibold tracking-wide text-white">Deepspace Engine</span>
        </div>
        <Link to="/play" className="rounded-lg bg-ember px-4 py-2 text-sm font-semibold text-black hover:brightness-110">
          Play the Cradle
        </Link>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-8 pb-16 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">A persistent co-op colony survivor</p>
        <h1 className="mt-4 text-4xl md:text-6xl font-bold text-white leading-tight">
          The war between humans <br className="hidden md:block" /> and the machines is over.
          <br />
          <span className="text-amber-300">Nobody won.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-gray-400 text-lg">
          Lead a colony through the ruined Shatterlands. Send expeditions to salvage the AI that nearly destroyed the
          world — study its fragments in the lab, and deploy the recovered intelligence to rebuild civilization.
          <span className="text-gray-200"> AI is both your salvation and your threat.</span>
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/play"
            className="rounded-lg bg-ember px-6 py-3 text-base font-semibold text-black hover:brightness-110"
          >
            Begin Your Expedition
          </Link>
          <a href="#world" className="rounded-lg border border-gray-700 bg-white/5 px-6 py-3 text-base font-semibold text-gray-200 hover:bg-white/10">
            The World
          </a>
        </div>
      </section>

      {/* core loop */}
      <section id="world" className="border-t border-white/5 bg-black/30 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-sm uppercase tracking-[0.3em] text-amber-300/80">The Core Loop</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-2xl font-semibold text-white">
            Salvage the thing that almost destroyed you. Use it to rebuild.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-5">
            {[
              ["🏜️", "Expeditions", "Send teams into the Shatterlands — outer ruins for Embers, deep scientific sites for rare Chipsets."],
              ["💎", "Salvage", "Bring home common Embers and complete, advanced Chipsets. Higher risk, higher reward."],
              ["🔬", "Study", "Scientists in the lab distill recovered AI into knowledge and deployable insight."],
              ["🛠️", "Deploy", "Rebuild the colony: weaponry, agriculture, economy, industry, and logistics."],
              ["🚀", "Grow", "Stronger domains afford riskier, deeper expeditions. The engine turns."],
            ].map(([icon, title, text]) => (
              <div key={title as string} className="rounded-xl border border-white/10 bg-white/5 p-5">
                <div className="text-3xl">{icon}</div>
                <h3 className="mt-3 font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm text-gray-400">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* vocabulary */}
      <section className="py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-sm uppercase tracking-[0.3em] text-amber-300/80">Know the Shatterlands</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {[
              ["🏛️ The Cradle", "Your capital colony. The settlement you build and defend — and the heart the whole world survives around."],
              ["🎯 The Chorus", "the hostile AI hives. Driven back but still surviving. Every expedition into the deep wakes them a little more."],
              ["🧯 Embers", "Common AI fragments, your bread-and-butter salvage. Study them to grow."],
              ["🔩 Chipsets", "Rare, complete, advanced AI sets that leap technology forward. Found only in deep high-value ruins."],
              ["🗺️ The Shatterlands", "The ruined, dangerous zones you raid. Each race's home region holds an abundance of its own AI."],
            ].map(([t, d]) => (
              <div key={t as string} className="rounded-xl border border-white/10 bg-white/5 p-5">
                <h3 className="font-semibold text-white">{t}</h3>
                <p className="mt-2 text-sm text-gray-400">{d}</p>
              </div>
            ))}
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-5">
              <h3 className="font-semibold text-amber-200">Persistence means something</h3>
              <p className="mt-2 text-sm text-gray-400">
                The world survives while you're logged out. Expeditions keep running in real time and return results to a
                colony that grew in your absence. Played over weeks, not sessions.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* races teaser */}
      <section className="border-t border-white/5 bg-black/30 py-16">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h2 className="text-sm uppercase tracking-[0.3em] text-amber-300/80">Choose Your Legend</h2>
          <p className="mx-auto mt-3 max-w-2xl text-gray-400">
            Seven races are told around the ember-fires — legends the colonies believe about the world that burned.
            Each is incomplete alone; to become whole you must venture into the others' territories.
          </p>
          <Link to="/play" className="mt-8 inline-block rounded-lg bg-ember px-6 py-3 font-semibold text-black hover:brightness-110">
            Claim a Colony
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-text-3">
        <p>Deepspace Engine · an original persistent co-op colony-management survival game</p>
        <p className="mt-1">All race lore shown in-game is in-universe mythology — never documentary fact.</p>
      </footer>
    </div>
  );
}
