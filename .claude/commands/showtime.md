---
description: Start a portal build session — primes full codebase context + safe-build rules, then records the session to the staff portal. End with /byebye.
---

# /showtime — start (and prime) a build session

`/showtime` does two jobs:
1. **Primes the session** so you know the whole portal, the best practices, and how to build
   without breaking anything (Step A).
2. **Starts recording** the session to the staff portal for review (Steps B–E).

Tell the user up front: **"🎬 Setting up your session — loading the codebase + safe-build rules, then recording…"**

Do Step A first (it's the important part), then run B–E silently (no narration beyond the
confirmations and any errors).

---

## Step A — Prime the session (know everything + build safely)

This is what makes the session safe. Do it before any building.

1. **Pull latest** so you're not building on stale code:
   ```bash
   cd /Users/zoransavic/bam-os-requirements && git checkout main && git pull --ff-only
   ```
   If pull fails (conflicts / "untracked files would be overwritten"), **stop and ask the user** —
   don't force anything.

2. **Load the canonical context — actually read these now, in full:**
   - `bam-ghl-agent/docs/portal-engineering-guide.md` ← the build reference (map, patterns, safe-build protocol, footguns)
   - `bam-ghl-agent/CLAUDE.md` ← project overview + rules
   - `bam-ghl-agent/memories/MEMORY.md` ← the index of deep-dive notes (open the specific note when its topic comes up)

3. **Internalize the safe-build protocol** from the guide (branch — never `main`; smallest diff;
   don't touch `archive/`/legacy HTML; update the paired `memories/` note in the same commit; run
   pre-ship checks before commit). `main` auto-deploys to prod on merge — there is no staging.

4. **Give the user a short, scannable confirmation** so they know you're primed — e.g.:
   ```
   ✅ Primed for the BAM portal.
   • Pulled latest main
   • Loaded: engineering guide + CLAUDE.md + memory index
   • Rules locked: branch (never main) · smallest diff · run pre-ship checks · update memory
   What are we building? (I'll branch before editing.)
   ```

If `bam-ghl-agent/docs/portal-engineering-guide.md` is missing, say so and fall back to reading
`bam-ghl-agent/CLAUDE.md` — then continue.

---

## Step B — Read config

The config file lives at `~/.claude/showtime-config.json`. Expected shape:

```json
{
  "url": "https://portal.byanymeansbusiness.com/api/agent-sessions",
  "secret": "<AGENT_SESSION_INGEST_SECRET value>"
}
```

If the file doesn't exist, **tell the user** (but you've already primed them in Step A, so building
can still proceed — recording just won't be on):

> "Recording setup needed (priming is done, you can still build). Create
> `~/.claude/showtime-config.json` with the URL and ingest secret — ask Zoran for the secret:
> ```json
> { "url": "https://portal.byanymeansbusiness.com/api/agent-sessions", "secret": "ask-zoran" }
> ```"

## Step C — Gather identity + context

Run these in parallel via Bash and capture the output:

```bash
git config user.email
git config user.name
pwd
```

If `git config user.email` is empty, fall back to `whoami` + a generic `@unknown` suffix.

## Step D — POST start

Call the API with the ingest secret. Replace `<URL>`, `<SECRET>`, `<EMAIL>`, `<NAME>`, `<PWD>` with the real values:

```bash
curl -sS -X POST "<URL>?action=start" \
  -H "Authorization: Bearer <SECRET>" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg email "<EMAIL>" --arg name "<NAME>" --arg path "<PWD>" \
        '{user_email: $email, user_display_name: $name, project_path: $path}')"
```

The response is `{"id": "<uuid>"}`. Save the `id`.

## Step E — Write the active-session marker

Write to `~/.claude/showtime-active.json`:

```json
{
  "session_db_id": "<uuid from step D>",
  "started_at": "<ISO-8601 timestamp from `date -u +"%Y-%m-%dT%H:%M:%SZ"`>",
  "project_path": "<pwd>",
  "user_email": "<email>",
  "user_display_name": "<name>"
}
```

## Step F — Confirm

After priming (Step A) and recording setup, output:

> 🎬 Primed + recording. Run /byebye when you're done — I'll generate a test script for what we
> changed before we send it.

If recording setup failed (config missing, API error, jq missing), **say exactly what failed** —
but note that priming succeeded and they can still build.

---

## Notes for you (the assistant)

- This skill is shared in the repo at `.claude/commands/showtime.md`. Anyone using Claude Code in this repo gets it.
- **Step A (priming) is the point of this skill — never skip it.** Recording is secondary; if
  recording can't start, still prime and let the user build.
- The actual transcript capture happens at /byebye time — /showtime just marks the start.
- Do NOT push the marker file or the config file to git — they're local-only.
