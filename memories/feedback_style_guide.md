---
name: Style Guide Source of Truth
description: Which style guide file to always read and update — canonical location in GitHub repo
type: feedback
originSessionId: 06a91b2b-6978-45ac-9d3c-92974fc626f4
---
Always use `prototype/docs/style-guide.md` in the `bam-os-requirements` GitHub repo (`https://github.com/zoran-star/bam-os-requirements`). Local path: `/Users/zoransavic/bam-ghl-agent/prototype/docs/style-guide.md`.

**Why:** Multiple worktree copies exist under `.claude/worktrees/*/prototype/docs/style-guide.md` — these get out of sync. The canonical file lives at the root of the main repo and is the one that gets committed to `main` and deployed.

**How to apply:**
- When reading the style guide, read the worktree's copy (`prototype/docs/style-guide.md` relative to the worktree root) — it should be in sync with main.
- When updating the style guide, commit to `main` (not just a worktree branch) so it persists in GitHub.
- Section 10 (Questions Database Input Guide) was added April 2026 — always load it when working on portal form questions or running `/setup-menu-item`.
- If a worktree's copy is missing content vs another, cherry-pick the update to `main` immediately.
