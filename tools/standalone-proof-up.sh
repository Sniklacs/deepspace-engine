#!/usr/bin/env bash
# standalone-proof-up.sh — the browser the standalone proof drives.
#
# The proof needs a Chromium whose CDP port it OWNS, and the emulation has to land
# on the target BEFORE the page loads. A Chromium spawned as a child of the Bun
# script was unreliable here: it opened :9333, logged `DevTools listening`, then
# died seconds later and left the client waiting. Detached with setsid it stays up.
# Detached also means this script must be paired with a kill at the end:
#   for p in $(lsof -t -iTCP:9333 -sTCP:LISTEN); do kill $p; done
set -u
PORT="${PWA_CDP_PORT:-9333}"
PROFILE="${PWA_CDP_PROFILE:-/tmp/pwa-cdp-profile}"
CHROME="${CHROME_BIN:-/usr/local/bin/chromium}"
pkill -f "$PROFILE" 2>/dev/null
sleep 1
rm -rf "$PROFILE"
setsid nohup "$CHROME" \
  --headless=new --remote-debugging-port="$PORT" --no-first-run --no-default-browser-check \
  --no-sandbox --disable-dev-shm-usage --enable-unsafe-swiftshader \
  --disable-background-networking --disable-sync --disable-features=Translate \
  --user-data-dir="$PROFILE" --window-size=390,844 about:blank \
  > /tmp/pwa-cdp-chrome.log 2>&1 &
for _ in $(seq 1 40); do
  v=$(curl -s -m 2 "http://127.0.0.1:$PORT/json/version")
  if [ -n "$v" ]; then echo "CDP up on :$PORT"; exit 0; fi
  sleep 0.5
done
echo "CDP never came up on :$PORT" >&2
exit 1
