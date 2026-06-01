#!/bin/sh
# One-time setup so this machine uses the repo's shared git hooks.
# Run once after cloning:  sh .githooks/install.sh
#
# Why this step exists: git deliberately does NOT auto-run hooks that come
# from a clone (security). So each machine has to point git at the shared
# hooks folder once. This command does exactly that — nothing else.
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit 2>/dev/null
echo "✅ Done. This machine will now block accidental commits to main."
