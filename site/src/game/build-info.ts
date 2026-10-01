// build-info.ts — which build is this copy of the app?
//
// Baked in at build time: build-vercel.sh exports VITE_BUILD_SHA (the short
// commit hash) before running vite build. Shown in Settings → On this device,
// so a stale install can be identified by sight instead of by guessing.
// Falls back to "dev" for local dev-server runs, which have no stamp.
export const BUILD_SHA: string =
  (import.meta.env.VITE_BUILD_SHA as string | undefined) || "dev";
