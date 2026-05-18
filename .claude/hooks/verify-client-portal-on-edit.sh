#!/bin/bash
# PostToolUse hook: when Edit or Write touches client-portal.html, run the
# tour verifier so any UI change that breaks a spotlight target is caught
# immediately instead of shipping silently broken.
#
# Wire up by adding to .claude/settings.local.json (or settings.json):
#   {
#     "hooks": {
#       "PostToolUse": [
#         {
#           "matcher": "Edit|Write",
#           "hooks": [
#             { "type": "command", "command": "bash $CLAUDE_PROJECT_DIR/.claude/hooks/verify-client-portal-on-edit.sh" }
#           ]
#         }
#       ]
#     }
#   }
#
# Stdin format (Claude Code PostToolUse hook):
#   { "tool_name": "Edit", "tool_input": { "file_path": "...", ... }, ... }
#
# Exits 0 always (verifier failure is reported via stderr but doesn't block
# the tool). To make a failure BLOCK the next action, change `exit 0` to
# `exit 2` on the verifier-fail branch.

set -u

INPUT="$(cat)"

# Pull the file_path out of the JSON. Try python3 first (most macs have it),
# fall back to a regex if python is missing.
FILE_PATH=""
if command -v python3 >/dev/null 2>&1; then
  FILE_PATH=$(echo "$INPUT" | python3 -c "import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except Exception:
    pass" 2>/dev/null)
else
  FILE_PATH=$(echo "$INPUT" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"\(.*\)"/\1/')
fi

# Only act when client-portal.html in bam-portal was the file edited.
case "$FILE_PATH" in
  */bam-portal/public/client-portal.html)
    # Derive verifier location from the file path so this is portable
    # across collaborators with different repo locations.
    VERIFIER="${FILE_PATH%/public/client-portal.html}/scripts/verify-client-portal-ui.mjs"
    if [ -f "$VERIFIER" ]; then
      echo ""
      echo "📋 client-portal.html edited — running tour verifier..."
      node "$VERIFIER"
    else
      echo "⚠️  verify-client-portal-ui.mjs not found at $VERIFIER (skipping)"
    fi
    ;;
esac

exit 0
