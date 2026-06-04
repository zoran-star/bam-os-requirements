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
Deliberate deviations:
Handoff:
```

5. Implement the prototype change.
6. Update the relevant [`docs/core-handoff/<domain>.md`](../../../docs/core-handoff/README.md), plus affected memory and schema docs.
7. Finish with the core commit reviewed, handoff link/state, new core concepts, and deviations.

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
