# Main branch is protected + local commit guardrail

`main` is the live branch (Vercel auto-deploys from it). As of 2026-06-01 it is locked two ways so nobody, human or Claude, can commit straight to it.

## Layer 1: GitHub branch protection (server-side, everyone, zero install)
Enabled on `zoran-star/bam-os-requirements` `main`:
- Pull request required before merging (direct pushes rejected)
- Enforced for admins too (no bypass)
- Force-pushes blocked, branch deletion blocked
- Required approving reviews: 0, so a solo worker can still self-merge their own PR

Manage via `gh api repos/zoran-star/bam-os-requirements/branches/main/protection`.

## Layer 2: shared local hook (catches it earlier)
`.githooks/pre-commit` refuses any commit while on `main` and prints a friendly "make a branch first" message. Committed to the repo so it travels with clones.

One-time per machine after cloning (git will not auto-run hooks from a clone, by design):
```
sh .githooks/install.sh
```
This just runs `git config core.hooksPath .githooks`. Zoran's machine is already set up.

## Why this exists (the gotcha)
This environment auto-syncs the working tree back to `main` in the background, which can flip you off your feature branch between `checkout -b` and `commit`. That caused one stray commit on local `main` before the locks existed. The hook now blocks the bad commit no matter how you land on `main`, so always re-check the branch right before committing, or just rely on the hook.

## Normal flow (unchanged)
`git checkout -b my-change` then edit, commit, push, open a PR, merge the PR. Feature branches auto-delete on merge.
