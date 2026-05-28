---
description: Stop the recording started by /showtime, package the session transcript, send it to the staff portal review page, and generate summaries.
---

# /byebye — stop recording + send transcript

Tell the user: **"👋 Wrapping up — packaging and sending your session..."**

Then execute these steps. Surface any error clearly; don't silently swallow.

## Step 1 — Read the marker + config

Expected files:
- `~/.claude/showtime-active.json` — created by /showtime
- `~/.claude/showtime-config.json` — has `url` and `secret`

If `showtime-active.json` is missing, tell the user:

> "No active /showtime recording found. Run /showtime first, then /byebye when done."

And stop.

## Step 2 — Find the transcript file

Claude Code writes the current session's transcript as a JSONL file under `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`, where the encoded cwd is the project path with `/` replaced by `-`.

```bash
PROJECT_PATH=$(jq -r '.project_path' ~/.claude/showtime-active.json)
ENCODED=$(echo "$PROJECT_PATH" | sed 's|/|-|g')
# Most recently modified .jsonl in this project's dir = the active session
TRANSCRIPT_FILE=$(ls -t ~/.claude/projects/${ENCODED}/*.jsonl 2>/dev/null | head -1)
```

If `TRANSCRIPT_FILE` is empty, fall back to scanning `~/.claude/projects/` directly for the newest `.jsonl`:

```bash
TRANSCRIPT_FILE=$(find ~/.claude/projects -name "*.jsonl" -type f -newer ~/.claude/showtime-active.json 2>/dev/null | head -1)
```

If still empty, tell the user the transcript file couldn't be located. Stop.

## Step 3 — Filter transcript to lines after the /showtime marker

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

## Step 4 — POST finish

```bash
SESSION_DB_ID=$(jq -r '.session_db_id' ~/.claude/showtime-active.json)
URL=$(jq -r '.url' ~/.claude/showtime-config.json)
SECRET=$(jq -r '.secret' ~/.claude/showtime-config.json)

PAYLOAD=$(jq -n --arg id "$SESSION_DB_ID" --argjson tx "$(cat /tmp/byebye-transcript.json)" --argjson n "$MSG_COUNT" \
  '{id: $id, transcript: $tx, message_count: $n}')

curl -sS -X POST "${URL}?action=finish" \
  -H "Authorization: Bearer ${SECRET}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"
```

The server will generate technical + visual summaries via Claude and store them, then return `{"ok": true, "id": "<uuid>"}`.

## Step 5 — Cleanup + confirm

```bash
rm -f ~/.claude/showtime-active.json /tmp/byebye-transcript.json
```

Then tell the user:

> 👋 Session saved.
>
> - **{MSG_COUNT}** messages captured
> - Zoran can view it on the staff portal: Systems → Review → Agent sessions
> - Summaries are generating now (takes ~15s)

## Step 6 — Handle errors

If any curl call returns non-2xx, show the user the response body. Don't proceed with cleanup if the upload failed — leave the marker in place so we can retry.

---

## Notes for you (the assistant)

- This skill complements `/showtime`. Both live at `.claude/commands/`.
- The transcript is filtered server-side to drop very large tool outputs before summarization; you don't need to pre-trim.
- If `jq` isn't installed, tell the user to `brew install jq` and stop.
