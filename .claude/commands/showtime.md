---
description: Start recording this Claude Code session — captures transcript to the staff portal review page. End with /byebye.
---

# /showtime — start recording this session

Tell the user: **"🎬 Recording started. Run /byebye when you're done to save the session."**

Then execute these steps silently (no narration to the user beyond the line above and any errors).

## Step 1 — Read config

The config file lives at `~/.claude/showtime-config.json`. Expected shape:

```json
{
  "url": "https://portal.byanymeansbusiness.com/api/agent-sessions",
  "secret": "<AGENT_SESSION_INGEST_SECRET value>"
}
```

If the file doesn't exist, **stop and tell the user**:

> "Setup needed. Create `~/.claude/showtime-config.json` with the URL and ingest secret. Ask Zoran for the secret. The file should look like:
> ```json
> { "url": "https://portal.byanymeansbusiness.com/api/agent-sessions", "secret": "ask-zoran" }
> ```"

Don't proceed without the config.

## Step 2 — Gather identity + context

Run these in parallel via Bash and capture the output:

```bash
git config user.email
git config user.name
pwd
```

If `git config user.email` is empty, fall back to `whoami` + a generic `@unknown` suffix.

## Step 3 — POST start

Call the API with the ingest secret. Replace `<URL>`, `<SECRET>`, `<EMAIL>`, `<NAME>`, `<PWD>` with the real values:

```bash
curl -sS -X POST "<URL>?action=start" \
  -H "Authorization: Bearer <SECRET>" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg email "<EMAIL>" --arg name "<NAME>" --arg path "<PWD>" \
        '{user_email: $email, user_display_name: $name, project_path: $path}')"
```

The response is `{"id": "<uuid>"}`. Save the `id`.

## Step 4 — Write the active-session marker

Write to `~/.claude/showtime-active.json`:

```json
{
  "session_db_id": "<uuid from step 3>",
  "started_at": "<ISO-8601 timestamp from `date -u +"%Y-%m-%dT%H:%M:%SZ"`>",
  "project_path": "<pwd>",
  "user_email": "<email>",
  "user_display_name": "<name>"
}
```

## Step 5 — Confirm

If everything succeeded silently, output only:

> 🎬 Recording started. Run /byebye when you're done.

If anything failed (config missing, API error, jq missing), **tell the user exactly what failed** — don't silently swallow errors.

---

## Notes for you (the assistant)

- This skill is shared in the repo at `.claude/commands/showtime.md`. Anyone using Claude Code in this repo gets it.
- The actual transcript capture happens at /byebye time — /showtime just marks the start.
- Do NOT push the marker file or the config file to git — they're local-only.
