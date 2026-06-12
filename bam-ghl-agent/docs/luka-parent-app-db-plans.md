# Parent App DB Boundary — Conflict Check Doc

**For agents:** before making schema changes (new tables, columns, RLS, functions, drops/renames),
diff your plan against the lists below. If anything overlaps → **stop and tell Zoran to message Luka.**

Owner: Luka (fc-mobile parent app backend). Last updated: 2026-06-12.
Full context: [`docs/core-handoff/platform-foundations.md`](../../docs/core-handoff/platform-foundations.md)

---

## 🔴 Luka's tables — do not create, modify, or build on these yet

**Exist now / arriving via `bam-portal/supabase/migrations/`:**

| Status | Tables |
|---|---|
| Coming next (identity) | `customer_profiles` · `students` · `academy_memberships` · `member_links` |
| Planned (billing/credits) | `membership_plans` · `credit_ledger` · `subscriptions` |
| Planned (scheduling) | `slot_templates` · `schedule_slots` · `reservations` · `waitlist_entries` |
| Planned (later) | `membership_change_requests` · parent messaging/notification tables (names TBD) |

⚠️ These names are **reserved even before the tables exist** — creating a table with one of
these names is itself a conflict.

All of them: deny-all RLS (no policies, service-role only). Don't add policies to them.

---

## 🟡 Shared tables — Luka reads/references these; changes here need a sync

| Table | How the parent app uses it | Conflict if you… |
|---|---|---|
| `clients` | Every parent table FKs `tenant_id → clients(id)` | change PK, archive/merge rows, rename table |
| `members` | Read-only; `member_links` FKs `members(id)`; matching uses `email_norm` + parent phone/email columns | rename/drop table or those columns, change `email_norm` semantics, re-import with new ids |
| `members_staging` → promote | Registration matching waits on Sorter Steps 3–4 promote | change what promote writes into `members` |
| `offers` | `membership_plans` and schedule templates read Offer identity + `data.pricing.pricing_offerings` / schedule classes as source lineage | reshape `data.pricing.pricing_offerings`, change archive semantics, regenerate ids, remove pricing/schedule sections |
| `offer_teams` | Future Team offers may link schedule/templates to specific team rows via soft lineage | reshape team row identity/data semantics, regenerate ids |
| `pricing_catalog` | `membership_plans` will be seeded from confirmed Offer-price mappings | change `match_status` values/semantics, remove `offer_id` / `offer_price_key`, change canonical price tier semantics |
| `locations` | Will be **additively extended** (new nullable columns) toward core `Location` | drop/rename existing columns |
| `device_tokens` | Reused as-is for parent push | schema change |
| **Auth (whole project)** | Parents will register as Supabase auth users; `app_metadata.role='parent'` stamped at registration | logic assuming every auth user is staff/client |

---

## 🛑 RLS rule that protects everything

Parents will hold real JWTs in this project. **Any new table with a policy like
`auth.role() = 'authenticated'` is readable by parents via PostgREST.**

→ New staff-side tables must use `is_staff()` / `my_client_ids()` predicates (or no policies +
service-role API access). Never plain `authenticated`.

(2026-06-12: `staff`, `website_leads`, `portal_feedback`, `sm_*`, `guide_cards` were already
swapped to `is_staff()` — migration `20260612012656`. Staff behavior unchanged.)

---

## ✅ Always fine — no sync needed

- New columns on PM-owned tables not listed above (tickets, marketing, content, training…)
- New tables with non-reserved names + proper staff RLS predicates
- Routine data changes outside Luka's tables that do not alter the shared-table semantics above
- Keep applying changes via MCP `apply_migration` as usual — Luka's tooling picks them up

## Offer fields needed before parent booking

Before `membership_plans` are generated from Business Blueprint Offers, each Offer pricing option needs structured fields that define what the parent can book.

Examples:
- 1x/week plan → 1 credit per week
- 2x/week plan → 2 credits per week
- Unlimited plan → unlimited bookings
- Session pack → fixed number of credits, with optional expiry

Marketing copy is not enough. The booking system needs exact values for credits, periods, unlimited access, and eligibility rules.

---

## When in doubt

Message Luka. A 2-minute sync beats a broken parent app or a blocked staff feature.
