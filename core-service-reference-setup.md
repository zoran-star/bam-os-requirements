# Core Service Reference Setup

Set up `fc-core-srvc` as a read-only sibling of `bam-os-requirements`:

```text
parent/
├── bam-os-requirements/
└── fc-core-srvc/
```

## Tell The Agent

Paste this in Claude Code while `bam-os-requirements` is open:

```text
Set up https://github.com/Full-Control/fc-core-srvc.git as a read-only sibling folder named fc-core-srvc.

If it already exists, verify its origin and clean status. Do not overwrite, reset, stash, or clean it.
Switch it to main, run git pull --ff-only origin main, and report its path, origin, status, and commit.
Do not install dependencies or run the backend.
Confirm .claude/skills/align-core-data-model/SKILL.md exists, then tell me to restart Claude Code.
```

## Manual Setup

Run from the folder containing `bam-os-requirements`:

```bash
git clone https://github.com/Full-Control/fc-core-srvc.git fc-core-srvc
git -C fc-core-srvc switch main
git -C fc-core-srvc pull --ff-only origin main
git -C fc-core-srvc status --short
```

The final command should print nothing. Then restart Claude Code from `bam-os-requirements`.

Do not rename or modify an existing legacy `bam-os-srvc` folder. Create the clean `fc-core-srvc` reference instead.
