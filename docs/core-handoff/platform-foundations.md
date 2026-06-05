---
domain: platform-foundations
review_state: ready-for-review
prototype_status: partial
core_parity: partial
last_reviewed: "2026-06-04"
prototype_commit: 552d1c6
core_commit_reviewed: 11c0ace
---

# Platform Foundations: Prototype-to-Core Handoff

## Summary

- The prototype contains several Supabase-backed surfaces built independently for speed.
- `fc-core-srvc` is the production direction: multi-tenant, modular, and provider-neutral.
- Prototype implementations are not target architecture. Each durable domain needs an owner and parity review.

## References

- **Prototype:** `bam-ghl-agent/bam-portal/supabase/`, `bam-ghl-agent/bam-portal/api/`, `fc-internal-content-engine/`, `prototype/src/`
- **Core reviewed:** `docs/architecture.md`, `app/models/base.py`, `ownership.py`, `academy.py`, `location.py`, `user.py`, `customer.py`

## Intended Model

| Concept | Purpose | Relationships and scope |
|---|---|---|
| Academy | Primary tenant | Owns locations and tenant-scoped data |
| Location | Operating site | Belongs to academy; scopes relevant records |
| Application identity | Real user or customer identity | Maps from auth; may relate to academies |
| Canonical domain record | Permanent product data | Provider-neutral; one domain owner |
| Integration record | Provider IDs, tokens, payloads, sync state | Maps providers to canonical records |

## Parity

| Prototype concept or behavior | Core mapping | Status | Next action |
|---|---|---|---|
| Client/business account | `Academy` / `core_tenancy` | `partial` | Define when `client` means academy |
| Multi-location data | `Location` / `core_tenancy` | `partial` | Mark location-scoped records per domain |
| Staff, client, member identities | Core users, customers, students, memberships | `decision-needed` | Agree identity mapping |
| Feature-created tables | Domain-owned models | `missing` | Assign each durable concept an owner |
| Direct Supabase access | Owning module service/API | `partial` | Define boundaries during parity work |
| Provider-specific product data | Canonical model plus integration mapping | `partial` | Separate during parity work |
| Manual SQL files | Alembic migrations | `partial` | Convert when implementing core parity |
| RLS and authorization | Core tenant and authorization controls | `decision-needed` | Agree enforcement boundary |

## Decisions And Shortcuts

| Item | Reason | Core impact or replacement |
|---|---|---|
| Core is direction, not compatibility target | Prototype is intentionally ahead | Adopt clean concepts, not implementation details |
| Keep current prototype stack | Faster product learning | Handoffs describe production boundaries |
| Direct Supabase access and separate SQL files | Fast iteration | Replace with owned services and migrations |

## Open Decisions

- When does prototype `client` mean core `Academy`?
- How do prototype staff, clients, parents, members, and students map to core identities?
- Which new core modules own marketing, content, training, and support?
- Where should production authorization be enforced?
