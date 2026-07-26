#!/usr/bin/env bash
# Mission board server. Runs detached so it survives Claude Code restarts,
# session ends, and preview-manager restarts. Safe to run repeatedly.
#
#   scripts/mission-board.sh          start (or confirm already running)
#   scripts/mission-board.sh stop     stop it
#   scripts/mission-board.sh status   check it
set -euo pipefail

PORT=4599
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/board"
PIDFILE="/tmp/bam-mission-board.pid"
LOGFILE="/tmp/bam-mission-board.log"
URL="http://localhost:$PORT"

alive() { curl -s -o /dev/null --max-time 2 "$URL/data.json"; }

case "${1:-start}" in
  stop)
    [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null || true
    lsof -ti :$PORT 2>/dev/null | xargs kill 2>/dev/null || true
    rm -f "$PIDFILE"
    echo "mission board stopped"
    ;;
  status)
    if alive; then echo "running: $URL"; else echo "not running"; exit 1; fi
    ;;
  *)
    if alive; then
      echo "already running: $URL"
      exit 0
    fi
    lsof -ti :$PORT 2>/dev/null | xargs kill 2>/dev/null || true
    nohup python3 -m http.server "$PORT" --directory "$DIR" >"$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    for _ in $(seq 1 20); do
      if alive; then echo "mission board up: $URL"; exit 0; fi
      sleep 0.25
    done
    echo "failed to start, see $LOGFILE" >&2
    exit 1
    ;;
esac
