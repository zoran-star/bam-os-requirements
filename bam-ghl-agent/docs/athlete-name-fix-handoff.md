# Handoff: "Athlete name is required" 400 when booking a trial via the agent

> Context handoff written 2026-07-12 to continue in a local session with full
> connections (GitHub for both repos, Notion MCP, GHL MCP, Supabase).
> Branch: `claude/athlete-name-confirmation-nr0m2g`.

## ✅ RESOLVED 2026-07-12 - what actually shipped (read this first)
Investigation found the cause is **narrower** than the plan below assumed: the GTA
free-trial form (`bam-client-sites` `clients/bam-gta/gta/freetrial.jsx`) ALREADY collects
the player name and sends `fields.athlete`; `leads.js:544` already reads it for the direct
booking RPC. The one real gap: `portalNativeContact` in `leads.js` never wrote `athlete_name`
onto the **contacts** row, which is exactly what the agent Book-it path (`bookPortalTrial`)
reads. So NO bam-client-sites change was needed.

Zoran chose the **tight fix + card field** (not the full plan below - no new DB column, no
agent-captures-in-chat schema change). Shipped:
1. `bam-portal/api/website/leads.js` `portalNativeContact` -> persist `athlete_name` on the
   contact (`fields.athlete_name || fields.athlete || first+last`).
2. `bam-portal/api/agent/booking.js` `bookPortalTrial({..., athleteName})` -> resolve
   passed -> contact; clean human 400 if empty; backfill `contacts.athlete_name` on success.
3. `bam-portal/api/agent-approvals.js` confirm-book -> pass the card's `athlete_name` through.
4. `bam-portal/public/client-portal.html` Book-it card -> editable **Athlete** field
   (pre-filled from the deck's resolved name), client-side empty guard, sent in confirm-book.

See `memories/project_athlete_name_booking_fix.md`. The plan below is kept for reference only.

---

## The bug
Booking a lead (e.g. "Tara") from the Hawkeye **Book it** card throws:
`book: Supabase 400: {"code":"P0001",...,"message":"Athlete name is required."}`

## Root cause (traced)
- The RPC `book_trial_slot` HARD-requires an athlete name:
  - `bam-portal/supabase/migrations/20260709034404_parent_trial_app_identity.sql:121`
  - (also `20260702115748_parent_trial_bookings.sql:154`) -> `RAISE EXCEPTION 'Athlete name is required.'`
- Book path: `client-portal.html` `_hk2Confirm` (k==='book', ~line 33514) -> POST `confirm-book`
  -> `api/agent-approvals.js:1386` handler -> `bookPortalTrial(...)` at `:1402`
  -> `api/agent/booking.js:196`. It reads `contacts.athlete_name` (`:207`) and if empty
  sends `p_athlete_name: null` (`:224`) -> RPC 400, surfaced as `book: ...` at `agent-approvals.js:1403`.
- WHY it's blank: the lead came from **BAM's own site free-trial form** (the **bam sites repo**),
  which POSTs to `/api/website/leads` (`bam-portal/api/website/leads.js`). That endpoint already maps
  `fields.athlete_name` -> `p_athlete_name` (`leads.js:544`), but the site form isn't sending it, so
  `contacts.athlete_name` stays null. No GHL, no Meta - the form is on our own site.

## Decision (locked): Option 1
Capture in agent chat + editable Book-card field + never hard-fail.

## Fix plan - spans 2 repos

### Repo A - bam sites (the source fix)
1. Add **"Athlete's name"** as a **required** field to the free-trial lead form.
2. Make the submission send it to `/api/website/leads` inside `fields.athlete_name`.
3. Confirm the GTA site domain is in `clients.allowed_domains` and the correct `client_id` is posted.

### Repo B - bam-ghl-agent (this repo) - 3-layer safety net
- **Layer 1 - agent captures it in chat.** In `api/agent-approvals.js`, add `book_athlete_name`
  to the `propose_reply` tool schema (REPLY_TOOL, ~line 112-137, near `book`/`book_group`/`book_slot_at`).
  Update the `book` description + system prompt: the agent must have the athlete's name before booking -
  extract from the thread, and if unknown, ask the parent instead of setting book=true. Persist it on the
  `agent_ready_replies` row where book cards are created (migration `20260623023231_ready_replies_booking.sql`
  added the book_* cols). Likely needs an additive `book_athlete_name text` column -> **read
  `bam-portal/supabase/README.md` first** and use the `align-core-data-model` skill for the schema change.
- **Layer 2 - editable Book-card field.** In `bam-portal/public/client-portal.html`, book-card render is
  `_hk2CardHtml` where `r._kind === 'book'` (~line 33064-33082); the calendar/slot inputs are the
  `hk2-fields` block (~33078-33081). Add an **"Athlete"** text input there, pre-filled from
  `r.book_athlete_name` (agent's guess) or the known contact name, editable. Capture it in `_hk2Confirm`
  (~line 33476 alongside calV/slotV) and include it in the `confirm-book` POST (~line 33515). Decide whether
  the simpler `_apxBookConfirm` path (~line 36521) needs it too. Use design-system tokens, NO em dashes,
  then run `node bam-portal/scripts/verify-client-portal-ui.mjs`.
- **Layer 3 - backend never hard-fails + backfill.** In `api/agent-approvals.js` confirm-book (~1400),
  pass the card's `athlete_name` into `bookPortalTrial`. In `api/agent/booking.js` `bookPortalTrial`
  (~196-237) resolve the name as: passed value -> `contacts.athlete_name` -> if STILL empty, return a clean
  400 ("Enter the athlete's name to book this trial") instead of the raw Supabase P0001. On success,
  backfill `contacts.athlete_name` so it's saved for next time + agent personalization. (Same helper is
  used by `agent-confirm.js`; the website flow is `leads.js:544`.)

## Also audit - all BAM GTA intake forms collect athlete name
- Enrollment funnel `public/funnel/step1.jsx` - required OK
- Camp/checkout `api/website/camp-checkout.js` + `checkout.js` - required OK
- **Free-trial lead form (bam sites) - THE GAP -> fix above**
- Post-trial form (in deck) - already carries athlete_name from the booking

## Keep sources in sync (repo rules)
- **Notion** Business Requirements: add/update a requirement (Sales `SAL-` and/or Member Management)
  for "athlete name required on trial intake + agent booking."
- **Onboarding Data Points DB** (`49be4ce65ada4d45b736070e11452edb`): ensure "Athlete Name" is documented
  as a required collected intake field.
- Update `bam-ghl-agent/memories/` notes + `MEMORY.md`.

## First actions in the local session
1. Pull `bam-os-requirements`; checkout `claude/athlete-name-confirmation-nr0m2g`.
2. Add/clone the **bam sites** repo; open the free-trial form; confirm exactly what it POSTs to
   `/api/website/leads` (does it send `fields.athlete_name`?).
3. Optionally check Tara's contact row in Supabase (`contacts.athlete_name` is null) to confirm.
4. Implement Repo B layers 1-3, then Repo A form field. Commit + push each repo to its own branch.
