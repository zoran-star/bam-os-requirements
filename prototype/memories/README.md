# memories/

Project notes that Claude reads when relevant. Lives in git so collaborators share the same context.

## How it works

- **MEMORY.md** — index of every note in this folder, one line each. Claude scans this first.
- **`*.md`** — individual notes. Each has YAML frontmatter (`name`, `description`, `type`).
- **types**: `project` (facts/decisions about the work), `feedback` (working-style rules), `reference` (pointers to external systems).

## When to add a note

- A decision was made that future-you will want context on
- A deferred plan you don't want to lose ("not now, but when X happens")
- A non-obvious gotcha or constraint
- A working-style preference that should persist across sessions

## When to update or delete

- A note's facts changed → update it
- The decision was reversed or the plan shipped → delete it
- A file path it references moved → update it

Drift is the enemy. Stale notes waste context and mislead. After any session that changed something here, update before commit.
