---
name: align-core-data-model
description: Reviews and guides persistent data-model and backend-architecture changes in bam-os-requirements against the canonical Full-Control/fc-core-srvc architecture. Use before or during work that creates or changes tables, Supabase SQL or migrations, stored entities, relationships, identifiers, status enums, important backend workflows, integration boundaries, API data shapes, RLS or tenant rules, or module and domain ownership.
---

# Align Core Data Model

## Goal

Keep prototype work fast while shaping its data so it can move into the core service cleanly later.

- Treat `fc-core-srvc` as the target architecture and domain vocabulary, not a backward-compatibility constraint.
- Expect the prototype to introduce valid new concepts and tables before the core service has them.
- Maintain a concise developer handoff that explains the prototype's intended architecture and core-service parity gaps.
- Never modify the core service unless the user explicitly asks.
- Do not block a non-technical user with implementation questions that the agent can answer from the repositories.

## Resolve And Refresh The Core Service

Use the current canonical repository:

`https://github.com/Full-Control/fc-core-srvc.git`

1. From the `bam-os-requirements` repository root, prefer a sibling checkout at `../fc-core-srvc`.
2. Accept sibling `../bam-os-srvc` as the legacy local folder name after confirming it represents the canonical repository.
3. If no checkout is available, follow [`core-service-reference-setup.md`](../../../core-service-reference-setup.md) to create one before continuing.
4. Never clone the core service inside `bam-os-requirements`.

Before reading any core-service architecture, model, or migration files:

1. Confirm the checkout remote points to `https://github.com/Full-Control/fc-core-srvc.git`.
2. Confirm the worktree is clean with `git -C <core-path> status --short`.
3. Switch to `main` and update it:

```bash
git -C <core-path> switch main
git -C <core-path> pull --ff-only origin main
git -C <core-path> rev-parse --short HEAD
```

Do not begin the alignment review until the pull succeeds. If the checkout is dirty, the remote is wrong, or the pull fails, do not stash, reset, merge, overwrite, or clean it. Report the problem and use the setup guide to repair or create a clean reference checkout.

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
Handoff target: existing or new docs/core-handoff/<domain>.md
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

## Maintain The Developer Handoff

During the alignment review, update or create the relevant domain handoff under [`docs/core-handoff/`](../../../docs/core-handoff/README.md) so developers can review the intended architecture before implementation. Reconcile it with the final implementation in the same commit.

- Use one handoff per durable domain or bounded capability, not per ticket, screen, or table.
- Follow [`docs/core-handoff/_template.md`](../../../docs/core-handoff/_template.md).
- Record the core-service commit reviewed.
- Clearly separate intended architecture, current prototype implementation, current core behavior, parity gaps, and deliberate shortcuts.
- Keep the parity table and concrete core next actions current.
- Link to code and migrations rather than copying full schemas.
- Mark a coherent changed handoff `ready-for-review`; never mark it `reviewed` without core-developer confirmation.
- Update the handoff index in `docs/core-handoff/README.md`.

## Implement And Verify

1. Implement the prototype change after the alignment review.
2. Review the final schema and code against the rules above.
3. Update the relevant developer handoff, affected memory notes, and schema documentation.
4. Finish with a short **Core alignment** report containing:
   - Core-service commit and files inspected
   - Link and review state of the updated domain handoff
   - Decisions aligned with the core
   - New concepts the core will eventually need
   - Deliberate deviations or migration debt

When the prototype is ahead, choose the clean future model and document which core module should eventually own it. Do not add adapters or backward-compatibility work unless the prototype itself needs them.
