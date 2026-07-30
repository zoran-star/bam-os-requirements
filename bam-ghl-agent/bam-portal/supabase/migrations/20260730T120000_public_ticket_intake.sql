-- The PUBLIC support form at /ticket can finally create a ticket.
--
-- ⚠️ NOT APPLIED YET. Ledger row is in supabase/PENDING_SQL.md. Until this
-- runs, api/public-ticket.js returns 500 on every submit (`source` fails its
-- CHECK, `public_token` does not exist) and the form shows its honest
-- "Your request was not submitted" screen with the email fallback. Nothing
-- lies and nothing is lost - but nothing is saved either, which is the state
-- this migration ends.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────
-- 213 tickets exist. NONE came from this form: 185 are source='portal'
-- (authenticated, via api/tickets.js) and 28 are source='asana_import'.
-- Verified against production 2026-07-30. Three walls stood in front of it,
-- and only one of them was a payload bug:
--
--   1. The payload named 7 columns `tickets` does not have, so an anon POST
--      returned 400 PGRST204 before the status was ever evaluated.
--   2. RLS is on and `tickets` has exactly ONE insert policy, for role
--      `authenticated`. A logged-out visitor could not insert at all.
--   3. status "New", which tickets_status_check has never permitted. Fixed
--      in #1652 without a migration.
--
-- ── WHAT THIS MIGRATION DOES NOT DO, DELIBERATELY ───────────────────────
-- It adds NO anon RLS policy. Wall 2 is not knocked down, it is walked
-- around: api/public-ticket.js holds the service key and is the only door.
-- An `anon` insert policy would let anyone write any row its WITH CHECK
-- failed to think of, forever, invisibly. A route is code we can read, test
-- and rate-limit.
--
-- It creates NO `ticket_messages` table. src/PublicTicket.jsx read one; it
-- has never existed (to_regclass('public.ticket_messages') is null). The
-- conversation it wanted is already `tickets.messages` (jsonb), which
-- api/tickets.js and the client portal both use. A second thread store for
-- the same tickets is the kind of thing that ends up half-synced.
--
-- ALL ADDITIVE. Nothing renamed, dropped or rewritten. Existing rows are
-- untouched: public_token lands NULL on all 213 of them, and none of them
-- carries a source outside the widened list.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. `public_form` becomes a source a ticket may have
-- ─────────────────────────────────────────────────────────────────────────
-- This is how a ticket from a stranger is represented. Every existing ticket
-- has a client_id; a public submitter may map to no academy, and NOTHING
-- verifies the name and email they typed. So client_id stays NULL (the
-- column is already nullable) and the source carries the identity instead.
--
-- Auto-linking by matching the typed email to clients.email was considered
-- and REJECTED: it would let anyone who knows an academy's address push an
-- unverified ticket into that academy's authenticated portal view, which
-- api/tickets.js serves by client_id. A NULL client_id is also exactly what
-- keeps these tickets out of every client's portal.
--
-- NULL must not mean invisible. The row also carries fields.owner_name,
-- fields.email, fields.unverified_contact and a "Public form: ..." title, and
-- src/views/SystemsView.jsx renders all four.
alter table public.tickets drop constraint if exists tickets_source_check;
alter table public.tickets add constraint tickets_source_check
  check (source in ('portal', 'asana_import', 'public_form'));

comment on column public.tickets.source is
  'Where the ticket came from. portal = authenticated staff or client via api/tickets.js. asana_import = the one-off historical import. public_form = the logged-out form at /ticket via api/public-ticket.js; these carry client_id NULL on purpose and their contact details are SELF-REPORTED and unverified (fields.owner_name, fields.email, fields.unverified_contact).';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. The tracking token behind /ticket/<token>
-- ─────────────────────────────────────────────────────────────────────────
-- Minted SERVER-SIDE only (24 random bytes, base64url). The browser cannot
-- choose it: the old form generated its own with Math.random and posted it,
-- which would have let a submitter pick a token, or collide with someone
-- else's. Unique so a collision is a failed insert rather than two people
-- reading one ticket.
--
-- Partial index: only public-form tickets ever have one, and a NULL is not
-- a value that needs to be unique.
alter table public.tickets add column if not exists public_token text;

create unique index if not exists tickets_public_token_key
  on public.tickets (public_token)
  where public_token is not null;

comment on column public.tickets.public_token is
  'Unguessable server-minted token for the logged-out tracking page /ticket/<token>. NULL on every ticket that did not come from the public form. Anyone holding it can read a REDACTED view of the ticket (api/_public-ticket-intake.js publicTicketView - an allow-list, never staff_notes or denial_notes), so treat it as a bearer credential and never log it.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Indexes the rate limiter needs
-- ─────────────────────────────────────────────────────────────────────────
-- api/public-ticket.js counts recent public-form rows on every submit: per
-- IP hash per hour, per email per day, and globally per hour. Without these
-- the throttle is three sequential scans of `tickets` on an endpoint anyone
-- can call, which turns the anti-abuse measure into the abuse.
--
-- All three are partial on source='public_form', so they cost nothing for
-- the 213 rows that are not.
create index if not exists tickets_public_form_recent_idx
  on public.tickets (submitted_at desc)
  where source = 'public_form';

create index if not exists tickets_public_form_ip_idx
  on public.tickets ((fields ->> 'ip_hash'))
  where source = 'public_form';

create index if not exists tickets_public_form_email_idx
  on public.tickets ((fields ->> 'email'))
  where source = 'public_form';

-- The raw IP is NEVER stored. fields.ip_hash is a salted SHA-256 truncated to
-- 32 hex chars (PUBLIC_TICKET_IP_SALT, falling back to the service key), which
-- is enough to count repeat submitters within an hour and not enough to be a
-- log of visitors' addresses.

-- ─────────────────────────────────────────────────────────────────────────
-- AFTER APPLYING
-- ─────────────────────────────────────────────────────────────────────────
-- 1. Submit the form at /ticket once and confirm a row appears with
--    source='public_form', client_id NULL, status 'open' and a public_token.
-- 2. Open the /ticket/<token> link it hands back and confirm the tracking
--    page renders that ticket rather than "Ticket not found".
-- 3. Submit four times in an hour from one machine; the fourth must be
--    refused with a 429 and the honest not-submitted screen.
-- Until step 1 passes, treat the public form as still non-functional - it has
-- never worked, so an untested "it should work now" is worth nothing here.
