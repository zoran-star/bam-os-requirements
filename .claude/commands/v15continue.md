---
description: Resume getting all academies onto V1.5 (GHL inbox + pipelines in the portal) — load state, catch Zoran up, continue flipping academies
---

Resume the **V1.5 rollout** — moving every real academy onto V1.5 so their GHL
**inbox + pipelines + contacts** surface in the portal. Paused 2026-06-22.

## Step 1 — Load the handoff
Read in order:
1. `bam-ghl-agent/memories/project_v15_rollout.md` — the full state + playbook
   (tools built, connect method, what's done, REMAINING, gotchas). **Primary handoff.**
2. `bam-ghl-agent/memories/project_v15_onboarding_tracker.md` — the per-academy board.
3. `bam-ghl-agent/CLAUDE.md` — V1/V1.5/V2 tier model + the ⛔ "never touch V1" rule.

## Step 2 — Confirm connections
`git pull`. Confirm GitHub + Supabase MCP (portal project `jnojmfmpnsfmtqmwhopz`).
Flag anything missing.

## Step 3 — Pull the live state (don't trust memory alone)
Query Supabase for the real current state:
```sql
select business_name, v15_access, v2_access,
  (ghl_access_token is not null) as connected,
  v15_config->'athlete_name_field_ids' as athlete_map
from clients
where ghl_location_id is not null
order by v15_access desc, business_name;
```
This shows who's connected, who's already V1.5, and who's mapped.

## Step 4 — Catch Zoran up (ADHD + visual: tables/boxes, minimum words)
- 1 line: what V1.5 is (their GHL inbox + pipelines in the portal).
- Counts: connected · already-V1.5 · still-V1.
- The 4-step per-academy checklist: v15_access toggle · GHL connected · athlete-name mapped · owner login. (Webhook is V2-only + already app-level.)

## Step 5 — Continue the rollout
The remaining work (from the handoff note):
1. **Zoran flips real connected academies to `v15_access=true`** in the staff portal.
   SKIP test/junk rows (Test biz, Demo Academy, MIKEEEEEE, BAM Coaches,
   BAM Business: Internal Ads, etc.). Offer to print the clean "real vs test" list first.
2. **After he flips them, re-run the athlete auto-map** (it only touches v15 academies):
   `staff.byanymeansbusiness.com/api/contacts?action=auto-map-athletes&dry=1` (preview)
   then without `&dry=1` (apply). Verify via the SQL above.
3. **Owner logins** — ensure each flipped academy's owner has a `client_users` account
   (see [[project_multi_user_portal.md]]); invite any missing.
4. Spot-check `staff.byanymeansbusiness.com/api/ghl/all-pipelines` reflects everyone.

## Tools already live (reuse, don't rebuild)
- **Pipelines report (public):** `staff.byanymeansbusiness.com/api/ghl/all-pipelines`
  — academy rows + stage→arrow→stage + saving notes (`pipeline_notes` table). `?format=json` for data.
- **Athlete auto-map (public, idempotent):** `/api/contacts?action=auto-map-athletes`
  (`&dry=1` preview, `&overwrite=1` to force).
- **App-level reply webhook:** FC app `InboundMessage` → `/api/ghl/inbound-webhook`
  (confirmed firing; covers all academies, no per-academy setup). ⚠️ Delete GTA's old
  "agent trigger" Workflow (it duplicates + sends body "undefined").

## Gotchas (read before deploying)
- **Deploy race:** bam-portal production lags/flaps (other sessions clobber it). After
  merging a portal change, FORCE a deploy (trivial bam-portal commit via PR) and POLL the
  live URL until the change shows — don't trust the merge. See [[project_bam_portal_deploy]].
- **Agency one-click mint is BLOCKED** (FC app is Sub-Account-target). Use **per-account
  connect**: `/api/messaging/connect?action=admin-start&client_id=<uuid>&key=<CRON_SECRET>`
  or the portal "Connect GHL" step. Pick the matching academy in the GHL picker.
- No local Vercel env creds — do DB/token work via Supabase MCP or the server endpoints.

Update `project_v15_rollout.md` + the tracker as academies flip.
