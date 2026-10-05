#!/usr/bin/env bash
# Produce a Vercel Build Output API bundle (.vercel/output) for this site, then
# deploy it with:  bunx vercel deploy --prebuilt
#
# Why Build Output API instead of Vercel's Vite/framework detection:
#  - TanStack Start emits a host-agnostic fetch handler (dist/server/server.js)
#    that dynamic-imports its own ./assets chunks and externalizes node deps.
#    Letting Vercel trace/detect that is fragile.
#  - Bundling it into one self-contained file (deps + dynamic chunks inlined) in a
#    single render.func removes all tracing/detection risk. vercel-entry.ts adapts
#    the Node (req,res) launcher to the web fetch handler.
set -euo pipefail
cd "$(dirname "$0")"
umask 002

echo "[1/3] vite build (light — safe under the sandbox memory cap)"
# Stamp the build with its commit so the app can say which build it is
# (Settings → On this device). Falls back to "dev" outside a git checkout.
export VITE_BUILD_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
echo "build sha: $VITE_BUILD_SHA"
# WORLD IDENTITY (owner P0 2026-10-05): the client bundle bakes the world's
# identity at build time (vite.config `define.__WORLD_ENV__`), while the
# server reads process.env at runtime. If these are unset here, the client
# silently falls back to the watchers-beta defaults ("The Shattered Academies",
# raceLock=watchers) on EVERY deployment — the server then rejects colony
# founding with a race-lock error the UI swallows, and new players hit a dead
# "Found The Cradle" button. These values MUST match the Vercel project's env
# vars for the deployment target.
WORLD="${1:-watchers-beta}"
case "$WORLD" in
  draconians-world)
    export WORLD_ID="draconians-world"
    export WORLD_NAME="The Ashen Wastes"
    export RACE_LOCK="draconians"
    export WORLD_TAGLINE="The Draconian test world — raid target practice. Only Draconian colonies may be founded here."
    export DEBUG_WORLD="true"
    ;;
  watchers-beta)
    export WORLD_ID="watchers-beta"
    export WORLD_NAME="The Shattered Academies"
    export RACE_LOCK="watchers"
    export WORLD_TAGLINE="The Watchers debug world — the beta test bed. This world belongs to the Fallen Teachers, and only Watcher colonies may be founded here."
    export DEBUG_WORLD="true"
    ;;
  *)
    echo "Unknown world: $WORLD (expected draconians-world or watchers-beta)" >&2
    exit 1
    ;;
esac
echo "world: $WORLD_ID ($WORLD_NAME, raceLock=$RACE_LOCK)"
# The workspace starts as sources only (deps live with the image's pre-built
# placeholder copy); no-op once node_modules is current.
bun install
bun run build

echo "[2/3] assemble .vercel/output (Build Output API v3)"
rm -rf .vercel/output
mkdir -p .vercel/output/functions/render.func
cp -R dist/client .vercel/output/static
rm -f .vercel/output/static/index.html   # SSR owns "/", not a static shell
# Stamp the service worker's build token. public/sw.js ships with the literal
# @@BUILD@@ and only serve.ts's stampBuildToken replaces it — but serve.ts
# never runs on Vercel (static files are served directly), so without this
# every deploy ships a byte-identical /sw.js, the browser never fires
# `updatefound`, the update banner never appears, and the installed app sits
# stale until a full reinstall (owner report 2026-10-01). A new deploy must
# produce a different sw.js.
if [ -f .vercel/output/static/sw.js ]; then
  sed -i "s/@@BUILD@@/${VITE_BUILD_SHA}/g" .vercel/output/static/sw.js
  echo "stamped sw.js build: ${VITE_BUILD_SHA}"
fi

echo "[3/3] bundle SSR handler + deps into the render function"
# Stamp the server build SHA (surfaced via /api/health as `serverBuild`;
# --env inlines it at bundle time, unset → "dev").
# The client and server ship in SEPARATE bundles — NEVER deploy with only
# `vite build` (it rebuilds the client but leaves render.func stale, so
# server fixes silently don't ship — bit us 2026-10-04). Always build and
# deploy through this script.
export SERVER_BUILD_SHA="$VITE_BUILD_SHA"
bun build vercel-entry.ts --target node \
  --env=SERVER_BUILD_* \
  --outfile .vercel/output/functions/render.func/index.mjs

cat > .vercel/output/functions/render.func/.vc-config.json <<'JSON'
{ "runtime": "nodejs22.x", "handler": "index.mjs", "launcherType": "Nodejs", "supportsResponseStreaming": true }
JSON
cat > .vercel/output/config.json <<'JSON'
{ "version": 3, "routes": [ { "handle": "filesystem" }, { "src": "/(.*)", "dest": "/render" } ] }
JSON

echo "done -> .vercel/output ready for: bunx vercel deploy --prebuilt"
