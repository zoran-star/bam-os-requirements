---
description: Onboarding cockpit - list the academies currently onboarding, pick one, see its live progress scorecard, then keep building whatever it needs next.
---

The umbrella skill for **operating academy onboarding** (not building the
onboarding system - that's /onboarding-continue). Zoran runs this to see who is
in flight, how far along each academy is, and to jump straight into the next
useful piece of work for one of them.

## Ground rules

- **Short + visual.** Scorecards and batteries, not prose.
- **Never use an em dash** in anything you output. Hyphens only.
- **Popups for choices** (AskUserQuestion), never "reply 1 or 2" prose.
- **One academy at a time.** Pick, focus, build. Re-run to switch.
- The scorecard is a READ of live data. Never guess a status - query it.

## Step 0 - Connect

Data lives in the bam-portal Supabase project, ref `jnojmfmpnsfmtqmwhopz`.

1. Prefer the **Supabase MCP** (`mcp__supabase__execute_sql`).
2. No MCP? Use a FRESH service key. ⚠ `bam-portal/.env.local`'s
   SUPABASE_SERVICE_KEY is known-STALE - do not trust it.

## Step 1 - List who is onboarding

```sql
select id, business_name, owner_name, slack_channel_id, ghl_location_id,
       stripe_connect_status, v2_access, website_setup, onboarding_setup,
       legal_name, created_at
from clients
where v2_access = true and archived_at is null
order by created_at;
```

Today that returns **BAM GTA** and **DETAIL Miami**; any academy the Add
Academy front door creates joins the list automatically - never hardcode the
names. For each, show one line: name + a single-phrase temperature
("agreement chunk ready, nobody on it" / "waiting on owner pricing").
Then a popup: which academy?

## Step 2 - The scorecard

⚠ **Do not invent status logic.** The flag derivations (what makes a wizard
step "done", what makes a chunk "ready") live in
`bam-ghl-agent/bam-portal/api/offers/setup-status.js` (academy block +
`evaluateChunks`). Compute the same way from the queried data. Supporting
queries: the academy's `offers` row(s) (pricing/policy/schedule presence),
counts from `contacts` (total + `tags @> '["cancelled"]'`), `members` (total +
`billing_portal_owned`), `cancellations` (`source = 'import'`).

Render:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏀 DETAIL MIAMI - onboarding scorecard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WIZARD (owner side)
  Academy   ▓▓▓▓░  4/5   missing: legal name
  Brand     ▓▓▓▓▓  done
  Wired     ▓▓░░░  2/5   contacts in · texting untouched
  Offer     ▓▓▓▓░  4/5   policy saved · pricing missing
  Launch    ░░░░░  waiting on build

BUILD CHUNKS (our side)
  deck ✅ published   core 🔨 building   templates 🟡 ready
  sales ⬜ waiting    onboarding ⬜      agreement 🟡 ready

SIGN-OFFS   brand_ok ✅ · site_accepted ⬜
IMPORTS     412 contacts · 38 members (31 billing attached) ·
            47 cancelled (44 in churn history)
WIRED       Stripe ✅ · GHL linked/none · Slack ✅ · phone ⬜
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Use exactly the owner's wizard section names (Academy / Brand / Wired /
Offer / Launch) so the scorecard matches what the owner sees.

## Step 3 - What needs doing (the point of the skill)

From the scorecard, derive and present a SHORT ranked list:

1. **🟡 Ready chunks nobody started** → name the runbook and where it runs
   (`/branding-deck`, `/site-build --phase <x>`, `/email-templates`,
   `/agreement` run in the **bam-client-sites repo**; `/ghl-pipeline-import`
   runs here). Offer to start it in this session if it's portal-side, or to
   set up the sites-repo session if not.
2. **⬜ Waiting chunks** → say which OWNER step unlocks each one ("agreement
   goes ready when policy + legal name are in").
3. **Stalled owner steps** (untouched for days with things blocked behind
   them) → offer to draft a nudge for their Slack channel. Draft only -
   Zoran approves before anything posts.
4. **Reds** (failed pings, missing wiring, contradictory data) → propose the
   fix.

Popup: which item do we work? Then go build it, following that work's own
rules (design system for portal UI, cancellations contract for churn writes,
V1 hard rule, etc.).

## Step 4 - Keep the thread

While working, end every message with a mini progress line:

```
📍 /academy · DETAIL Miami · working: agreement chunk · next up: sales pages
```

When a piece of work completes, refresh the relevant scorecard rows (re-query,
do not assume), show the delta ("agreement 🟡 → ✅"), and return to the Step 3
list for the same academy.
