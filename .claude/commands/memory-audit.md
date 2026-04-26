---
description: Audit CLAUDE.md + memories/ folders across all projects in the current repo and report stale/missing items
---

Audit memory hygiene across the current repo. Don't fix anything yet — return a punch list and wait for user approval.

## Steps

1. **Find all CLAUDE.md files** in the repo (root + every subdirectory). For each one, note whether a sibling `memories/` folder exists.

2. **For each `memories/` folder**, check:
   - Does `README.md` exist? (human-facing conventions)
   - Does `MEMORY.md` exist? (Claude-facing index)
   - Are all `.md` notes in the folder listed in `MEMORY.md`?
   - Are there entries in `MEMORY.md` pointing to files that no longer exist?
   - Open every note file. For each:
     - Does the frontmatter (`name`, `description`, `type`) match the body?
     - Does it reference file paths that still exist? (grep the repo for the paths)
     - Does it describe state that may have changed (e.g. "currently broken", "next step is X", dates older than 60 days)?
     - Flag anything that smells stale.

3. **For each CLAUDE.md**, check:
   - Does it have a "Project memory" section pointing at `memories/`?
   - Does it have a "Memory upkeep" section?
   - Are all file paths it mentions still valid?
   - Are there sections marked "current phase" / "status as of" with dates older than 30 days?

4. **Also check `~/.claude/projects/-Users-zoransavic/memory/`** (the personal cabinet):
   - Same checks as above for `MEMORY.md` sync, broken links, stale notes.

## Output format

Return a punch list grouped by project, like this:

```
=== bam-ghl-agent/ ===
[STALE]   memories/project_player_intake_setup.md — says "Phase 4 SQL ready" but file no longer exists
[MISSING] memories/MEMORY.md — index doesn't list project_new_thing.md
[OUTDATED] CLAUDE.md — "current phase" dated 2026-04-24, may need refresh

=== prototype/ ===
[OK] no issues

=== personal cabinet ===
[BROKEN] MEMORY.md — links to user_role.md but file is named user_profile.md
```

End with a one-line summary: total issues found, suggested next step.

**Do not fix anything.** Just report. Wait for user to say which items to address.
