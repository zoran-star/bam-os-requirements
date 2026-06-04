# Prototype-to-Core Architecture Handoff

This is the developer-facing handoff between fast-moving prototype work in `bam-os-requirements` and the production architecture in [`Full-Control/fc-core-srvc`](https://github.com/Full-Control/fc-core-srvc).

Use it to:

- Review the architecture being explored in the prototype.
- Understand which concepts already align with the core service.
- Identify new concepts the core service may eventually need.
- Plan and track future prototype-to-core parity work.

It is not a claim that prototype code is production-ready, and it is not a requirement for the core service to preserve prototype implementation details.

## How It Is Organized

Keep one handoff document per durable product domain or bounded capability:

```text
docs/core-handoff/
├── README.md
├── _template.md
├── sales.md
├── scheduling.md
└── marketing.md
```

Create a domain document only when persistent data, important workflows, integrations, or domain boundaries are implemented or materially changed. Extend an existing domain document instead of creating a document per ticket or screen.

## Handoff Index

| Domain | Handoff | Review state | Prototype status | Core parity | Last reviewed |
|---|---|---|---|---|---|
| Platform foundations | [`platform-foundations.md`](platform-foundations.md) | `ready-for-review` | `partial` | `partial` | 2026-06-04 |

Status vocabulary:

- **Review state:** `draft`, `ready-for-review`, `reviewed`, `superseded`
- **Prototype status:** `planned`, `partial`, `implemented`, `deprecated`
- **Core parity:** `not-reviewed`, `aligned`, `partial`, `missing`, `core-ahead`, `decision-needed`

## Cross-Cutting Architecture Direction

Unless a domain handoff records a deliberate exception, prototype data design should follow these intended production directions:

- Academy-owned data is tenant-scoped; location-specific data also identifies its location.
- Permanent product concepts are provider-neutral. GHL, Stripe, Meta, Supabase, and other provider-specific data stays in integration or mapping records.
- Every table or durable entity has one clear domain owner.
- Auth users, platform users, customers, students or trainees, contacts, leads, and memberships remain distinct identities.
- Important relationships, lifecycle states, uniqueness constraints, indexes, audit timestamps, tenant isolation, and RLS are explicit.
- External events are idempotent. History-sensitive operations use audit records or append-only ledgers where appropriate.
- Prototype shortcuts are allowed, but they must be documented as migration debt rather than presented as target architecture.

## Update Rules

The agent working in `bam-os-requirements` owns keeping these handoffs current.

Update the relevant domain handoff in the same commit whenever work changes:

- Persistent entities, tables, fields, relationships, or statuses
- Domain ownership or module boundaries
- Important API data shapes or backend workflows
- Tenant, location, permissions, RLS, or security behavior
- Integration mappings or source-of-truth decisions
- A previously documented shortcut, gap, or open decision

When updating a handoff:

1. Pull the latest `fc-core-srvc` `main`.
2. Record the prototype commit or working state and core commit reviewed.
3. Describe intent before implementation details.
4. Separate current prototype behavior, intended future architecture, and current core-service behavior.
5. Update the parity table and concrete next actions.
6. Link to migrations, schema files, or code instead of duplicating large schemas.
7. Update this index.

Mark a changed handoff `ready-for-review` when it is coherent enough to send. Only mark it `reviewed` after core-service developer feedback is incorporated and they confirm the architecture.

Do not maintain a manual change log inside handoffs. Git history is the change log.

## How Developers Should Review It

For an architecture review, the PM sends the relevant domain handoff directly, not this index. Core-service developers should focus on:

1. Whether the domain concepts and boundaries are correct.
2. Whether the proposed core mapping fits existing modules and canonical models.
3. Which deliberate prototype shortcuts are acceptable temporarily.
4. Which parity gaps should become core-service work.
5. Which open decisions need product or engineering agreement.

Paste-ready review request:

```text
Please review docs/core-handoff/<domain>.md against the current fc-core-srvc architecture. Focus on the proposed domain model and ownership, the core mapping and parity table, deliberate prototype shortcuts, and open decisions. Reply with decisions or required changes before we mark the handoff reviewed.
```

Use [`_template.md`](_template.md) when creating a domain handoff.
