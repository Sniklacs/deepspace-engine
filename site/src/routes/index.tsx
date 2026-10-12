import { createFileRoute } from "@tanstack/react-router";
import IntroSequence from "~/components/IntroSequence";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

/**
 * The landing page IS the solar system now (owner decision, Oct 11 2026).
 * IntroSequence runs Hans's intro — dark screen, his voice clip, a beat of
 * darkness, music, then the StarMap fades in — and the StarMap itself is the
 * planet/race select. The old explainer page is retired (recoverable from git).
 */
function LandingPage() {
  return <IntroSequence />;
}
