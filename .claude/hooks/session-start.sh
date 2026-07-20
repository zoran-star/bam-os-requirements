#!/bin/bash
# BAM OS - Claude Code on the web session setup
# Installs the CLIs + node deps that CLOUD sessions do not inherit from your
# local machine, so tests/linters/dev servers work the same as local.
#
# What it does NOT do (these are configured elsewhere, not in a script):
#   - Notion / Stripe MCP  -> authorize as connectors in claude.ai settings
#   - GHL MCP + secrets     -> environment config (never commit secrets to git)
set -euo pipefail

# Only run in the remote (Claude Code on the web) environment. On local machines
# this is a no-op so it never touches your real setup.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# SessionStart stdout is injected into the model's context. Keep it clean:
# send all progress logs to stderr instead.
exec 1>&2
log() { echo "[bam-setup] $*"; }

SUDO=""
command -v sudo >/dev/null 2>&1 && SUDO="sudo"

# ---- 1. jq (JSON wrangling + session tooling) ----
if command -v jq >/dev/null 2>&1; then
  log "jq already present"
else
  log "installing jq"
  $SUDO apt-get update -qq && $SUDO apt-get install -y -qq jq
fi

# ---- 2. Supabase CLI (portal runtime tests: supabase status) ----
# Best-effort ONLY. Isolated in a function so a blocked download (network
# policy) returns non-zero into the `elif` guard instead of aborting the hook.
# Runtime tests also need Docker, so this is a nice-to-have, not core.
install_supabase() {
  local arch ver
  arch="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
  ver="$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
        https://github.com/supabase/cli/releases/latest 2>/dev/null \
        | sed 's#.*/tag/v##')" || return 1
  [ -n "$ver" ] || return 1
  curl -fsSL \
    "https://github.com/supabase/cli/releases/download/v${ver}/supabase_${ver}_linux_${arch}.deb" \
    -o /tmp/supabase.deb || return 1
  $SUDO dpkg -i /tmp/supabase.deb || return 1
  rm -f /tmp/supabase.deb
  log "supabase CLI v${ver} installed"
}
if command -v supabase >/dev/null 2>&1; then
  log "supabase CLI already present"
elif install_supabase; then
  :
else
  log "WARN: supabase CLI not installed (network policy?) - skipping; only /apply-sql runtime tests need it"
fi

# ---- 3. Node deps for the projects you actually run on cloud ----
# Add a folder here if you start running its dev server / linter / tests on web.
NODE_PROJECTS=(
  "prototype"
  "bam-ghl-agent/bam-portal"
)
for proj in "${NODE_PROJECTS[@]}"; do
  if [ -f "$CLAUDE_PROJECT_DIR/$proj/package.json" ]; then
    log "npm install -> $proj"
    ( cd "$CLAUDE_PROJECT_DIR/$proj" && npm install --no-audit --no-fund )
  fi
done

log "done"
