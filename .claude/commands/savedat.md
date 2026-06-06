---
description: Save the CURRENT Claude Code chat to the staff portal Agent Sessions review tab — no /showtime needed. Creates the session row, uploads this session's transcript (screenshots stripped + long text trimmed to fit), and triggers the technical+visual summaries.
---

# /savedat — save this session to Agent Sessions (no /showtime required)

Does what `/byebye` does but **without a prior `/showtime` marker** — it runs the
`start` and `finish` calls back-to-back against the staff portal. Use it any time
to archive the current chat for review at **Feedback → Agent sessions**.

Tell the user: **"💾 Saving this session to the review tab…"** then run the steps.
Surface any error clearly; don't silently swallow. Needs `jq` (`brew install jq`).

## Step 1 — Config
Read `~/.claude/showtime-config.json` — must have `{url, secret}`. If missing, tell
the user to create it (see `bam-ghl-agent/memories/project_agent_sessions.md`) and stop.

## Step 2 — Locate this session's transcript + identity
```bash
EMAIL=$(git config user.email); NAME=$(git config user.name); PWD_PATH=$(pwd)
ENCODED=$(echo "$PWD_PATH" | sed 's|/|-|g')
TRANSCRIPT=$(ls -t ~/.claude/projects/${ENCODED}/*.jsonl 2>/dev/null | head -1)
[ -z "$TRANSCRIPT" ] && TRANSCRIPT=$(ls -t ~/.claude/projects/*/*.jsonl 2>/dev/null | head -1)
SESSION_ID=$(basename "$TRANSCRIPT" .jsonl)
echo "transcript: $TRANSCRIPT"
```
If `TRANSCRIPT` is empty, tell the user it couldn't be located and stop.

## Step 3 — Start (create the session row)
```bash
URL=$(jq -r .url ~/.claude/showtime-config.json)
SECRET=$(jq -r .secret ~/.claude/showtime-config.json)
ID=$(curl -sS -X POST "${URL}?action=start" \
  -H "Authorization: Bearer ${SECRET}" -H "Content-Type: application/json" \
  -d "$(jq -n --arg e "$EMAIL" --arg n "$NAME" --arg p "$PWD_PATH" --arg s "$SESSION_ID" \
        '{user_email:$e,user_display_name:$n,project_path:$p,session_id:$s}')" | jq -r .id)
echo "session id: $ID"
```

## Step 4 — Build the payload (strip screenshots + trim to fit Vercel's ~4.5MB limit)
Pass `ID` and `TRANSCRIPT` via env to this python (writes `/tmp/savedat-payload.json`):
```bash
SAVEDAT_ID="$ID" SAVEDAT_SRC="$TRANSCRIPT" python3 - <<'PY'
import json,os
SRC=os.environ["SAVEDAT_SRC"]; ID=os.environ["SAVEDAT_ID"]
def strip_images(o):
    if isinstance(o,dict):
        if o.get("type")=="image": return {"type":"image","note":"[screenshot omitted]"}
        return {k:strip_images(v) for k,v in o.items()}
    if isinstance(o,list): return [strip_images(x) for x in o]
    return o
def trunc(o,n):
    if isinstance(o,dict): return {k:trunc(v,n) for k,v in o.items()}
    if isinstance(o,list): return [trunc(x,n) for x in o]
    if isinstance(o,str) and len(o)>n: return o[:n]+"…[+%d]"%(len(o)-n)
    return o
E=[]
for ln in open(SRC,encoding="utf-8"):
    ln=ln.strip()
    if ln:
        try: E.append(strip_images(json.loads(ln)))
        except: pass
size=lambda a: len(json.dumps({"id":ID,"transcript":a,"message_count":len(a)}))
arr=E
if size(arr)>3_200_000:
    for n in (4000,2000,1200,800,500,300):
        arr=trunc(E,n)
        if size(arr)<3_200_000: break
json.dump({"id":ID,"transcript":arr,"message_count":len(E)},open("/tmp/savedat-payload.json","w"))
print("payload %.2f MB, %d messages"%(os.path.getsize("/tmp/savedat-payload.json")/1048576,len(E)))
PY
```

## Step 5 — Finish (upload + generate summaries)
```bash
curl -sS -w "\nHTTP %{http_code}\n" -X POST "${URL}?action=finish" \
  -H "Authorization: Bearer ${SECRET}" -H "Content-Type: application/json" \
  -d @/tmp/savedat-payload.json
rm -f /tmp/savedat-payload.json
```
Expect `{"ok":true,"id":"…"}`. If non-2xx, show the body and stop (don't claim success).

## Step 6 — Confirm
> 💾 Session saved — **N messages**. View at **Feedback → Agent sessions** (admin).
> Technical + visual summaries are generating now (~15s).

## Notes
- Screenshots are stripped and long entries trimmed only to fit the upload limit;
  the server further drops big tool outputs before summarizing.
- Unlike `/byebye`, this does NOT need or touch `~/.claude/showtime-active.json`.
- Background: `bam-ghl-agent/memories/project_agent_sessions.md`.
