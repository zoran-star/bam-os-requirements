# Core Service Reference Setup

Set this up once so the `align-core-data-model` skill can review the latest core-service architecture before prototype data-model work.

The two repositories must be sibling folders:

```text
some-parent-folder/
├── bam-os-requirements/
└── fc-core-srvc/
```

The `fc-core-srvc` checkout is a read-only architecture reference for prototype work. Do not make backend changes there unless someone explicitly asks.

## Easiest Setup: Tell The Agent

Open the `bam-os-requirements` repository in Claude Code and paste:

```text
Set up the FullControl core service as a read-only sibling reference for this repository.

1. Find the parent folder that contains bam-os-requirements.
2. Clone https://github.com/Full-Control/fc-core-srvc.git into that parent folder as fc-core-srvc. Do not clone it inside bam-os-requirements.
3. If fc-core-srvc already exists, do not overwrite, delete, reset, stash, or clean it. Verify it is a clean checkout whose origin is https://github.com/Full-Control/fc-core-srvc.git.
4. Switch the reference checkout to main and run git pull --ff-only origin main.
5. Confirm the final folder layout, remote URL, branch, clean status, and current commit.
6. Do not install dependencies or run the backend. This checkout is only for reading architecture and data models.
7. Confirm bam-os-requirements/.claude/skills/align-core-data-model/SKILL.md exists. If this setup happened during an active Claude Code session, tell me to restart Claude Code so it loads the project skill.
```

The agent may ask for permission to access GitHub. Approve the clone or pull only when the repository URL is exactly:

`https://github.com/Full-Control/fc-core-srvc.git`

## Manual Setup

Run these commands from the folder that contains `bam-os-requirements`:

```bash
git clone https://github.com/Full-Control/fc-core-srvc.git fc-core-srvc
git -C fc-core-srvc switch main
git -C fc-core-srvc pull --ff-only origin main
git -C fc-core-srvc status --short
```

Success means the final `status --short` command prints nothing.

Verify the remote:

```bash
git -C fc-core-srvc remote get-url origin
```

It must print:

```text
https://github.com/Full-Control/fc-core-srvc.git
```

## If A Legacy `bam-os-srvc` Folder Exists

Do not rename, delete, reset, or clean it because it may contain someone else's backend work.

Create the fresh `fc-core-srvc` sibling reference using the setup instructions above. The skill prefers that canonical folder and pulls its latest `main` before every review.

## After Setup

Start or restart Claude Code from the `bam-os-requirements` repository root. Project skills are loaded from `.claude/skills/` when Claude Code starts.

The PM does not need to remember to invoke this skill. The root `CLAUDE.md` tells the agent to use it automatically whenever work changes persistent data.

No manual core-service update is normally required. Whenever work changes persistent data, the skill automatically:

1. Finds the sibling `fc-core-srvc` checkout.
2. Confirms it is clean and points to the canonical GitHub repository.
3. Pulls the latest `main` with `--ff-only`.
4. Reviews the relevant core-service models and architecture.
5. Implements the prototype change and reports alignment or deliberate deviations.
