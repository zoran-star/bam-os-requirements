#!/usr/bin/env bash
# Build + serve the San Jose automation message preview on :4600, detached so it
# survives a session restart. (4599 is the mission board.)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=4600
DIR="$ROOT/build/sj-messages"

node "$ROOT/scripts/sj-message-preview.mjs"

# Reuse a server that is already up; otherwise start one detached.
if lsof -ti tcp:$PORT >/dev/null 2>&1; then
  echo "already serving on $PORT"
else
  cd "$DIR"
  nohup python3 -m http.server $PORT >/tmp/sj-messages-$PORT.log 2>&1 &
  disown || true
  sleep 1
fi
echo "http://localhost:$PORT"
