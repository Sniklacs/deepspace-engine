// THE FALL — the entry into Act I ("The Height"), opening-prologue-spec §3/§4.
//
// One honest door into the full-power state. It is not a debug backdoor: this
// route IS the opening's front door, and when the cataclysm slice lands the
// same door leads into the Fall instead of a preview you can walk away from.
//
// It does exactly one thing: ask the server to put the player's account on the
// height (enterActOneFn — seed-or-resume, idempotent), then hand off to /play,
// where the colony, the Battles screen and the live front are waiting. The
// player's own colonies are untouched: they are one click away.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { enterActOneFn } from "../game/api";
export const Route = createFileRoute("/the-fall")({
  component: TheFallPage,
});
const TOKEN_KEY = "deepspace_session_token";
function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function TheFallPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = typeof window !== "undefined" && !!readToken();
  async function takeTheField() {
    const token = readToken();
    if (!token) {
      setError("Sign in first — the chair at the Ashline is yours, but it is still yours.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await enterActOneFn({ data: { token } }).catch(() => null);
    setBusy(false);
    if (!res) {
      setError("The signal did not carry. Try again in a moment.");
      return;
    }
    if (res.signedOut || !res.ok || !res.state) {
      setError(res.error || "The front would not open.");
      return;
    }
    window.location.assign("/play");
  }
  return (
    <div className="min-h-screen bg-[#070910] text-gray-200">
      <header className="mx-auto max-w-3xl px-6 py-8 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden="true">🔰</span>
          <span className="font-semibold tracking-wide text-white">Deepspace Engine</span>
        </Link>
        <Link to="/play" className="rounded-lg border border-gray-700 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10">
          Your colonies
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-20">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">The Fall · The Height</p>
        <h1 className="mt-4 text-3xl md:text-5xl font-bold text-white leading-tight">
          The last season of the war, <span className="text-amber-300">at full strength.</span>
        </h1>
        <p className="mt-6 text-gray-400 text-lg">
          The Last Academy holds the Ashline. Every domain is deployed, every recovered technology is in the
          stacks, the whole Watcher roster is sworn and the arsenal stands at its final tier. The Chorus is
          already on the line.
        </p>
        <p className="mt-4 text-gray-400">
          Take the field and you command that colony as it stands — its Leaders at the table, its heroes in the
          vanguard, its ship of war supplied. The front opens on its own clock.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={takeTheField}
            disabled={busy}
            data-testid="take-the-field"
            className="rounded-lg bg-ember px-6 py-3 text-base font-semibold text-black hover:brightness-110 disabled:opacity-60"
          >
            {busy ? "Climbing to the command deck…" : "Take the field"}
          </button>
          <Link to="/play" className="rounded-lg border border-gray-700 bg-white/5 px-6 py-3 text-base font-semibold text-gray-200 hover:bg-white/10">
            Back to your colonies
          </Link>
        </div>
        {!signedIn && (
          <p className="mt-4 text-sm text-gray-400">
            You will need a colony seat first —{" "}
            <Link to="/play" className="text-amber-300 underline decoration-amber-300/40 hover:decoration-amber-300">
              sign in
            </Link>
            .
          </p>
        )}
        {error && (
          <p className="mt-4 text-sm text-red-300" role="alert" data-testid="the-fall-error">{error}</p>
        )}
        <p className="mt-10 text-sm text-gray-500">
          The Ashline is its own seat in your account. Leave it whenever you like — your other colonies are
          exactly where you left them.
        </p>
      </main>
    </div>
  );
}
