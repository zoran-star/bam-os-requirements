---
description: One-time setup for a new BAM portal team member — configures session recording (/showtime), jq, and git identity, then verifies it actually works.
---

# /setup — get set up to build on the BAM portal (one-time)

Walk the user through the one-time setup so they can build on the portal AND have their Claude Code
sessions recorded to the staff review page. Be conversational and verifying: check each piece, fix
what's missing, confirm at the end. Most steps are skipped if already done.

Tell the user: **"👋 Let's get you set up to build on the BAM portal — one-time, ~2 minutes."**

## Step 1 — Check what's already done

Run these and capture the results:

```bash
test -f ~/.claude/showtime-config.json && echo "config: EXISTS" || echo "config: MISSING"
command -v jq >/dev/null && echo "jq: OK" || echo "jq: MISSING"
echo "git name:  $(git config user.name || echo UNSET)"
echo "git email: $(git config user.email || echo UNSET)"
```

Show a short ✅/❌ checklist of what's done vs missing, then fix each missing item below. If
everything is already done, jump straight to Step 5 (verify) and Step 6.

## Step 2 — Recording config (needs the ingest secret from Zoran)

If `~/.claude/showtime-config.json` is **MISSING**:

The session recorder sends transcripts to the portal using a shared secret. **That secret is NOT in
this repo — secrets never go in git.** Tell the user:

> "You need the ingest secret from Zoran — ask him for the **agent session ingest secret**. Paste it
> here when you have it and I'll create the file."

When they paste the secret, create the file (substitute the real value for `<SECRET>`):

```bash
mkdir -p ~/.claude && cat > ~/.claude/showtime-config.json <<EOF
{
  "url": "https://portal.byanymeansbusiness.com/api/agent-sessions",
  "secret": "<SECRET>"
}
EOF
```

Confirm the file was written — **do not echo the secret back in plain text.**

If the config already **EXISTS**, skip this step.

## Step 3 — jq

If `jq` is **MISSING**:

```bash
brew install jq
```

(No Homebrew? Point them to https://brew.sh first, then re-run.)

## Step 4 — Git identity

This is how their name appears on the review page. If name or email is **UNSET**, ask them for both
(don't guess), then:

```bash
git config --global user.name "Their Name"
git config --global user.email "their@email.com"
```

## Step 5 — Verify it actually works

Once the config exists, confirm the live server accepts their secret **without creating any data** —
send a bogus action: a correct secret returns `400 unknown action`, a wrong one returns `401`.

```bash
SECRET=$(jq -r '.secret' ~/.claude/showtime-config.json)
URL=$(jq -r '.url' ~/.claude/showtime-config.json)
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL?action=__ping__" \
  -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" -d '{}'
```

- `400` → ✅ secret works — they're set.
- `401` → ❌ wrong secret. Have them double-check the value with Zoran.
- anything else → report the code (could be a network issue).

## Step 6 — Confirm + what's next

When all green, tell them:

> ✅ You're set up. From now on, when you build on the portal:
> • Run **/showtime** to start — it pulls latest, loads the full codebase context + safe-build
>   rules, and starts recording.
> • Run **/byebye** when done — it makes a quick test for what you changed, then saves your session
>   for Zoran's review.
>
> Type **/showtime** whenever you're ready to build.

---

## Notes for you (the assistant)

- This skill is shared in the repo at `.claude/commands/setup.md` — anyone who pulls the repo gets it.
- **NEVER** put the ingest secret in this file or anywhere in git. It comes from Zoran each time a
  new person sets up.
- The Step 5 verify is non-mutating (bogus action) — it does NOT create a session row.
- Full background on the recording system: `bam-ghl-agent/memories/project_agent_sessions.md`.
