---
name: align-core-data-model
description: Aligns persistent data and backend architecture changes in bam-os-requirements with Full-Control/fc-core-srvc. Use for tables, migrations, entities, relationships, statuses, backend workflows, integrations, APIs, tenancy, RLS, or domain ownership.
---

# Align Core Data Model

Keep the prototype fast, but make its architecture easy to move into `fc-core-srvc`.

## Workflow

1. Find the core checkout:
   - Prefer `../fc-core-srvc`.
   - Accept legacy `../bam-os-srvc` only if it represents the canonical repo.
   - If missing, follow [`core-service-reference-setup.md`](../../../core-service-reference-setup.md).
2. Before reviewing core files, verify the origin is `https://github.com/Full-Control/fc-core-srvc.git`, the checkout is clean, and update it:

```bash
git -C <core-path> switch main
git -C <core-path> pull --ff-only origin main
git -C <core-path> rev-parse --short HEAD
```

If this fails, stop. Do not stash, reset, merge, overwrite, or clean the core checkout.

3. Read only the relevant core files:
   - `CLAUDE.md`, `docs/architecture.md`
   - `app/models/base.py`, `ownership.py`, `enums.py`
   - Relevant models, module contract, migrations, and architecture tests
4. Before implementation, state briefly:

```text
Core match:
New core concept:
Prototype plan:
Production data guardrails:
Deliberate deviations:
Handoff:
```

5. Implement the prototype change.
6. Update the relevant [`docs/core-handoff/<domain>.md`](../../../docs/core-handoff/README.md), plus affected memory and schema docs.
7. Finish with the core commit reviewed, handoff link/state, new core concepts, and deviations.

## Production Data Guardrails

The prototype may move faster than core, but production facts must remain easy to
normalize into the core service later.

- Prefer additive schema changes. Do not rename/drop/rewrite production columns,
  tables, enums, or RLS policies without explicit review.
- Every durable table must have a stable primary key plus `created_at` and
  `updated_at` unless it is intentionally append-only.
- Do not use display names as durable identifiers. Names such as athlete,
  parent, plan, trainer, academy, or location names are labels only.
- Preserve auth linkage when a row is owned by a real user:
  `auth_user_id`, `user_id`, or an equivalent Supabase Auth UUID.
- Preserve tenant linkage on all academy-scoped data:
  `client_id`, `academy_id`, or an explicit legacy-to-core mapping.
- Preserve member/customer linkage on parent-facing data:
  `member_id`, `parent_email`, `parent_auth_user_id`, `customer_profile_id`,
  `student_id`, or an explicit join table.
- Preserve provider IDs instead of deriving them later:
  `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`,
  `stripe_product_id`, `stripe_account_id`, `ghl_contact_id`,
  `ghl_location_id`, `ghl_appointment_id`.
- Billing, membership, refund, pause, cancel, credit, and plan-change workflows
  must leave an append-only event/audit record or a clearly recoverable status
  transition.
- For new persisted concepts, include the future core mapping in the handoff:
  source table, target core table/model, owning domain, lifecycle statuses,
  provider IDs, and any known migration caveats.
- If a feature cannot satisfy these guardrails, stop and call out the migration
  risk before implementing it.

## Rules

- Treat the core service as direction, not a compatibility constraint. New prototype concepts are allowed.
- Never modify the core service unless explicitly asked.
- Keep permanent concepts provider-neutral; isolate provider IDs, tokens, and payloads.
- Tenant-scope academy data; add location scope when relevant.
- Keep users, customers, students, contacts, leads, and memberships distinct.
- Use explicit ownership, relationships, constraints, indexes, lifecycle states, audit fields, tenant isolation, and idempotency where relevant.
- Keep the prototype's current stack. Do not recreate FastAPI or SQLAlchemy patterns solely for similarity.
- Maintain one concise handoff per durable domain using [`_template.md`](../../../docs/core-handoff/_template.md). Mark it `ready-for-review`, never `reviewed` without developer confirmation.
- Do not pause for technical questions the repositories answer. Pause for conflicting product meaning, destructive changes, or security risks.
