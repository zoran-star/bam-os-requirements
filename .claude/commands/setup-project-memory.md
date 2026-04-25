---
description: Scaffold CLAUDE.md + memories/ for a new project folder in the repo
argument-hint: <folder-name> (e.g. "new-feature" or "client-tools")
---

Set up the standard memory structure for a new project folder in this repo.

## Inputs
- `$1` — the folder name (relative to repo root). If not provided, ask the user.

## Steps

1. **Verify the folder exists.** If it doesn't, ask whether to create it or stop.

2. **Check for existing files.** If `<folder>/CLAUDE.md` or `<folder>/memories/` already exist, show the user what's there and ask before overwriting.

3. **Create the structure:**
   - `<folder>/CLAUDE.md` (if missing) — minimal scaffold:
     ```markdown
     # <Folder Name>

     ## Project memory
     Notes live in [`memories/`](memories/). Scan [`memories/MEMORY.md`](memories/MEMORY.md) first, then open the specific note. See [`memories/README.md`](memories/README.md) for conventions.

     ## Memory upkeep
     Before every commit, run through:
     - Decision worth keeping? → save to `memories/` and add a line to `MEMORY.md`
     - File moved, created, or renamed? → update CLAUDE.md paths
     - A memory note stale or wrong? → update or delete it
     - Is `MEMORY.md` in sync with the files in the folder?

     Run `/memory-audit` periodically.

     ---

     <!-- Add project-specific instructions below: what this folder is, who works on it, conventions, etc. -->
     ```
   - `<folder>/memories/README.md` — copy from `memories/README.md` at repo root (the human-facing guide)
   - `<folder>/memories/MEMORY.md` — empty index:
     ```markdown
     # Memories — <folder-name>

     (no notes yet — add a one-liner here when a note is added to this folder)
     ```

4. **Confirm what was created.** Show the user the resulting tree:
   ```
   <folder>/
   ├── CLAUDE.md          (created / already existed)
   └── memories/
       ├── README.md
       └── MEMORY.md
   ```

5. **Suggest next steps:**
   - Fill out the project-specific section of CLAUDE.md (what this folder is, who works on it, etc.)
   - Commit the scaffold so collaborators get it on `git pull`
   - When you make decisions worth keeping, save them as `<type>_<topic>.md` notes

**Do not commit automatically.** Leave that to the user.
