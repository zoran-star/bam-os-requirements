---
description: Wrap a build session — generate a test script for what changed (recommended), then package the session transcript, send it to the staff portal, and generate summaries.
---

# /byebye — test, then stop recording + send transcript

Tell the user: **"👋 Wrapping up — let me check what we changed and put together a quick test for you…"**

Then execute these steps. Surface any error clearly; don't silently swallow.

## Step 1 — Read the marker + config

Expected files:
- `~/.claude/showtime-active.json` — created by /showtime
- `~/.claude/showtime-config.json` — has `url` and `secret`

If `showtime-active.json` is missing, tell the user:

> "No active /showtime recording found. Run /showtime first, then /byebye when done."

(You can still do Step 2 — the test step doesn't need the marker — but there's nothing to send.)

## Step 2 — Generate + recommend a test script (the quality gate)

Before sending, look at what changed this session and produce a **runnable test script** so the
user can catch breakage before it ships. **Generate + recommend — never block.** Build it, urge
them to run it, let them skip.

1. **See what changed:**
   ```bash
   cd /Users/zoransavic/bam-os-requirements
   git rev-parse --abbrev-ref HEAD
   git diff --stat "$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD~1)"...HEAD
   git status --short
   ```
   If there are **no code changes** this session (only chatting, or nothing touched), say
   "No code changes this session — nothing to test 👍" and go to Step 3.

2. **Build a tailored test script** from the changed files. Always include the baseline gate for any
   `bam-portal/` change, then add change-specific checks. Heuristics:
   - touched `bam-portal/src/**` (or anything imported by the app) →
     `cd bam-ghl-agent/bam-portal && npm run build && npm run lint`
   - touched `bam-portal/public/client-portal.html` →
     `node bam-portal/scripts/verify-client-portal-ui.mjs`
   - touched any `bam-portal/api/*.js` → `node --check` each changed file; for an endpoint, add a
     **non-mutating curl auth probe** (bogus `?action=` with a bad bearer) expecting `401/403`, plus
     a happy-path note for the user to eyeball.
   - touched Supabase schema / RLS → a printed reminder to verify the migration AND that the `api/`
     code still gates access (service-role key bypasses RLS).
   - only docs / skills / memories changed → a light check (e.g. confirm referenced files exist /
     links resolve); don't fabricate heavy tests.

   Write it to `/tmp/byebye-test.sh`, make it `chmod +x`, and have it `echo` a clear PASS/FAIL per
   check and exit non-zero on any failure.

3. **Show the user and recommend running it:**
   > 🧪 Generated a test script for this session's changes: `/tmp/byebye-test.sh`
   > It runs: <one-line list of the checks>.
   > **Recommend running it before we send.** Want me to run it now, or skip?

   - If **run** → run it, show results. If anything fails, flag it clearly and ask whether to fix
     first or send anyway (their call).
   - If **skip** → note "tests skipped" and continue. Don't nag more than once.

   Always continue to Step 3 afterward — this step never blocks the send.

## Step 3 — Find the transcript file

Claude Code writes the current session's transcript as a JSONL file under `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`, where the encoded cwd is the project path with `/` replaced by `-`.

```bash
PROJECT_PATH=$(jq -r '.project_path' ~/.claude/showtime-active.json)
ENCODED=$(echo "$PROJECT_PATH" | sed 's|/|-|g')
# Most recently modified .jsonl in this project's dir = the active session
TRANSCRIPT_FILE=$(ls -t ~/.claude/projects/${ENCODED}/*.jsonl 2>/dev/null | head -1)
```

If `TRANSCRIPT_FILE` is empty, fall back to scanning `~/.claude/projects/` for the newest `.jsonl`
modified after the marker (the session's cwd may differ from the recorded `project_path`):

```bash
TRANSCRIPT_FILE=$(find ~/.claude/projects -name "*.jsonl" -type f -newer ~/.claude/showtime-active.json 2>/dev/null | head -1)
```

If still empty, tell the user the transcript file couldn't be located. Stop.

## Step 4 — Filter transcript to lines after the /showtime marker

```bash
STARTED_AT=$(jq -r '.started_at' ~/.claude/showtime-active.json)
# Build a JSON array of transcript entries with timestamp >= started_at.
# Each JSONL line has a `timestamp` field at top-level OR inside `message`.
jq -s --arg started "$STARTED_AT" '
  map(select(
    (.timestamp // .message.timestamp // "") >= $started
  ))
' "$TRANSCRIPT_FILE" > /tmp/byebye-transcript.json
MSG_COUNT=$(jq 'length' /tmp/byebye-transcript.json)
```

If the count is 0 or very small (<3), the marker timestamp may have been after the most recent activity. Send anyway — let the server handle it — but include a note in the assistant output: "⚠ only N messages captured."

## Step 5 — POST finish

**Build the payload as a FILE and upload with `curl -d @file`** — a long session is too big to pass
on the command line (`jq -n --argjson tx "$(cat …)"` overflows `ARG_MAX` and fails with "Argument
list too long"). Use `--slurpfile`:

```bash
SESSION_DB_ID=$(jq -r '.session_db_id' ~/.claude/showtime-active.json)
URL=$(jq -r '.url' ~/.claude/showtime-config.json)
SECRET=$(jq -r '.secret' ~/.claude/showtime-config.json)

jq -n --arg id "$SESSION_DB_ID" --slurpfile tx /tmp/byebye-transcript.json --argjson n "$MSG_COUNT" \
  '{id: $id, transcript: $tx[0], message_count: $n}' > /tmp/byebye-payload.json

curl -sS -w "\nHTTP %{http_code}\n" -X POST "${URL}?action=finish" \
  -H "Authorization: Bearer ${SECRET}" \
  -H "Content-Type: application/json" \
  -d @/tmp/byebye-payload.json
```

The server generates technical + visual summaries via a forced tool call and stores them, then
returns `{"ok": true, "id": "<uuid>"}`.

## Step 6 — Cleanup + confirm

```bash
rm -f ~/.claude/showtime-active.json /tmp/byebye-transcript.json /tmp/byebye-payload.json
```

Then tell the user:

> 👋 Session saved.
>
> - **{MSG_COUNT}** messages captured
> - Tests: {ran ✅ / skipped}
> - Admins can view it on the staff portal: **Feedback → Agent sessions**
> - Summaries are generating now (~15s)

(Leave `/tmp/byebye-test.sh` in place in case they want to re-run it.)

## Step 7 — Handle errors

If the finish call returns non-2xx, show the user the response body. Don't proceed with cleanup if
the upload failed — leave the marker in place so we can retry.

---

## Notes for you (the assistant)

- This skill complements `/showtime`. Both live at `.claude/commands/`.
- The transcript is filtered server-side to drop very large tool outputs before summarization; you don't need to pre-trim.
- If `jq` isn't installed, tell the user to `brew install jq` and stop.
- The test step (Step 2) is **recommend-not-require** per Zoran — generate the script and urge it,
  but the user can always skip and still send.
