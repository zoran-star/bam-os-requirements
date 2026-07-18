# Enroll-form starters are LEADS, not members (signup_origin model)

**Locked decision (Zoran 2026-07-18):** someone who fills the enroll form but does
not pay is a LEAD in the pipeline (Done Trial), never a Members-roster row. The
old "Signup in progress" group in Members is gone. Members = paying members only,
plus real members whose card is being collected.

## The model

`members.signup_origin` (text, CHECK) marks how a `payment_method_required` row was born
(migration `bam-portal/supabase/migrations/20260718150000_members_signup_origin.sql`,
backfills from `member_audit_log` action types):

| Value | Born by | Roster |
|---|---|---|
| `website_enroll` | public enroll checkout (`api/website/checkout.js`), onboarding funnel checkout (`api/onboarding/checkout.js`), GHL intake webhook (`api/members/intake.js`) | **hidden** |
| `convert` | staff pipeline-convert (`api/ghl/pipelines.js` action=convert) | **hidden** |
| `wizard` | historical returning-client Door B shells (no longer created) | **hidden** |
| `collecting` | a REAL member flipped while staff collect a card (`api/members.js` card-setup-link mark_collecting, `api/sorter/take-over.js`) | **visible** |
| NULL | legacy/unknown (incl. wizard Door A rows) | visible (safe default) |

Shells stay in `members` (not a separate table) ON PURPOSE: checkout retry
idempotency + the Stripe webhook flip-to-live path are unchanged. Filters:
`api/members.js` roster GET + `api/members-agent.js` (HIDDEN_SIGNUP_ORIGINS set).

## What changed with it

- **Members UI** (`client-portal.html`): pill/group relabeled "Collecting card"
  (`_isCollectingCard`, `_pendingGroupHeader`); enroll shells never arrive.
- **Wizard no-card door** (`api/members/enroll.js` Door B): creates NOTHING, returns
  `mode:'enroll_link'` (the academy's signup_url + client_id/contact_id params) for
  staff to send. 409 if no signup_url is set on the training offer.
- **Lead timeline** (contact drawer Journey): `agent-contact-notes` action=get now
  returns `enroll {link_sent_at, form_filled_at, paid_at}` (matches members by
  contact_id/opp_id/email) → "Signup link sent / Enroll form filled / Payment
  pending / Paid" steps.
- **Hawkeye**: `agent-approvals` list-ready stamps `enroll_form_filled_at` on cards
  (banner "Enroll form filled … - payment not finished"); the closing agent's
  contact memory (`api/agent/contact-memory.js`) tells it to nudge the FINISH,
  not re-pitch.
- **checkout.js** now also persists `ghl_contact_id` from the enroll link's
  `?contact_id` (buildEnrollUrl already appends it).
- Dead `_plConvert` UI removed (API endpoint kept).

## Gotchas

- NEVER filter the roster by status alone - `payment_method_required` includes
  real collecting-card members. Always pair with `signup_origin`.
- New creators of `payment_method_required` rows MUST stamp a `signup_origin`.
- Hawkeye's banner matches shells by `ghl_contact_id` only, so pre-2026-07-18
  shells (no contact id) won't banner; the drawer timeline still finds them via
  opp_id/email.
