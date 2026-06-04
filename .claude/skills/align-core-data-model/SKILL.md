---
name: align-core-data-model
description: Reviews and guides persistent data-model changes in bam-os-requirements against the canonical Full-Control/fc-core-srvc backend architecture. Use before or during work that creates or changes tables, Supabase SQL or migrations, stored entities, relationships, identifiers, status enums, API data shapes, RLS or tenant rules, or module and domain ownership.
---

# Align Core Data Model

## Goal

Keep prototype work fast while shaping its data so it can move into the core service cleanly later.

- Treat `fc-core-srvc` as the target architecture and domain vocabulary, not a backward-compatibility constraint.
- Expect the prototype to introduce valid new concepts and tables before the core service has them.
- Never modify the core service unless the user explicitly asks.
- Do not block a non-technical user with implementation questions that the agent can answer from the repositories.

## Resolve The Core Service

Use the current canonical repository:

`https://github.com/Full-Control/fc-core-srvc.git`

1. From the `bam-os-requirements` repository root, prefer a sibling checkout at `../fc-core-srvc`.
2. Accept sibling `../bam-os-srvc` as the legacy local folder name after confirming it represents the canonical repository.
3. Verify the checkout is current when practical. Do not pull, overwrite, or clean a dirty core-service checkout.
4. If no checkout is available, inspect the GitHub repository read-only. State clearly if access is unavailable.
5. Never clone the core service inside `bam-os-requirements`.

## Review Before Designing

Read only the relevant core-service context:

- `CLAUDE.md` and `docs/architecture.md`
- `app/models/base.py`, `app/models/ownership.py`, and `app/models/enums.py`
- Relevant files under `app/models/`
- The relevant `app/modules/<domain>/module.md` and public API
- Relevant Alembic migrations and architecture tests when the change affects constraints, ownership, or layering

Before implementation, write a brief working note:

```text
Core match: existing concepts this maps to
New future-core concept: concepts the core service does not have yet
Prototype implementation: proposed tables, fields, relationships, and owner
Deliberate deviations: differences kept for prototype speed and why
```

Do not wait for user approval unless the review exposes conflicting product meaning, a destructive data operation, or a security or tenant-isolation risk.

## Apply These Rules

- Model permanent product concepts as provider-agnostic canonical records. Keep GHL, Stripe, Meta, Supabase, and other provider IDs or raw payloads in integration or mapping records unless the core service already establishes a justified exception.
- Put `tenant_id` on academy-owned records. Add `location_id` where the concept can vary by physical or operating location. Never trust a client-supplied tenant identifier.
- Reuse core naming, meanings, relationships, and status values when they truly match. Do not create aliases or duplicate entities just to move faster.
- Keep identities distinct. Auth users, platform users, customer profiles, students or trainees, contacts, leads, and academy memberships are different concepts unless the domain proves otherwise.
- Prefer UUID primary keys, explicit foreign keys and cardinality, scoped uniqueness, useful indexes, audit timestamps, and explicit lifecycle states.
- Give every table one domain owner. Keep cross-domain behavior behind a public service boundary or workflow instead of letting unrelated features freely write the same tables.
- Separate UI or transport code, business rules, and database access when the prototype area contains backend logic. Validate data at system boundaries using the current stack.
- Track schema changes in version-controlled SQL or migrations and update the relevant project memory in the same change.
- Keep the prototype's current stack. Do not recreate FastAPI or SQLAlchemy architecture in a React or Supabase prototype merely for similarity.
- Protect secrets, enforce RLS and tenant isolation, use idempotency for external events, and prefer append-only ledgers or audit records where history matters.
- Do not blindly copy legacy paths, compatibility shims, or incomplete core-service patterns. Call out conflicts and follow the durable architecture.

## Example

For a new marketing campaign feature, first inspect `Academy`, `Location`, and the existing integration model. If the core has no canonical campaign yet, create a provider-neutral prototype concept with a clear future module owner and keep `meta_campaign_id` in an integration or mapping record.

## Implement And Verify

1. Implement the prototype change after the alignment review.
2. Review the final schema and code against the rules above.
3. Update affected memory notes and schema documentation.
4. Finish with a short **Core alignment** report containing:
   - Core-service files inspected
   - Decisions aligned with the core
   - New concepts the core will eventually need
   - Deliberate deviations or migration debt

When the prototype is ahead, choose the clean future model and document which core module should eventually own it. Do not add adapters or backward-compatibility work unless the prototype itself needs them.
