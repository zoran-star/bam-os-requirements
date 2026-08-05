---
domain: owner-workbooks
review_state: ready-for-review
prototype_status: schema-written-not-applied
core_parity: not-reviewed
last_reviewed: "2026-08-04"
prototype_commit: working-tree
core_commit_reviewed: unavailable
---

# Owner Workbooks: Prototype-to-Core Handoff

> **Core parity was NOT verified.** `https://github.com/Full-Control/fc-core-srvc.git`
> returned `Repository not found` from this machine, so no core model, module
> contract, or architecture test was read. Everything below is designed to the
> production-data guardrails and to prototype conventions only. **A developer with
> core access must review the Parity table before this is treated as aligned.**

## Summary

- **What the prototype implements:** a tokenized, no-login surface where an academy
  owner confirms facts we inferred about their business, and a staff review step
  before any of it becomes live configuration. Two kinds share one schema: the
  PRICE workbook (what the academy sells) and the MEMBER workbook (who is enrolled
  and on what).
- **Intended production direction:** a general "owner attests to inferred
  configuration" primitive. Onboarding infers, the owner confirms, staff applies.
  Nothing an owner touches is live until a human on our side applies it.
- **Suggested core owner:** whichever domain owns academy configuration and
  onboarding. It spans pricing and membership, so it likely belongs with
  onboarding rather than inside either.

## References

- **Prototype:** `bam-ghl-agent/bam-portal/supabase/migrations/20260804T230000_workbooks.sql`
- **Design + rulings:** `docs/plans/sj-price-match-log.md`, `docs/plans/lij-workbook-decisions.md`
- **Mockup:** `docs/plans/sj-price-workbook-mockup-v1.html`
- **Core reviewed:** none - repository inaccessible

## Intended Model

| Concept | Purpose | Relationships and scope |
|---|---|---|
| `workbooks` | One send to one owner | Tenant-scoped by `client_id`. `token` is the credential; `status` is the lifecycle draft → sent → submitted → reviewed → applied, with `void` as revocation |
| `workbook_cards` | **The unit of confirmation** | Belongs to a workbook. Holds `state` (untouched / confirmed / changed) and nothing else does |
| `workbook_answers` | The structured decisions | Belongs to a card. Carries the envelope: `target_kind`, `target_table`, `target_id`, `target_field`, plus the `proposed` / `answered` pair |

**Why the card is the unit and not the row.** Zoran ruled confirmation is
card-level: a commitment rung is part of one plan's answer, not a separate
decision. `state` therefore lives only on the card. Denormalizing it onto answers
would let the two disagree, and the entire point is that "confirmed" cannot be
faked.

**Why `target_kind` is its own column** rather than inferred from `target_table`:
blast radius differs by an order of magnitude. A wrong price row costs one plan; a
wrong tax rate re-prices every athlete in the academy. Staff review must sort on it
and surface `academy_setting` first, visually separated, never buried among price
rows where a tax change reads like a typo fix.

## Parity

| Prototype concept or behavior | Core mapping | Status | Next action |
|---|---|---|---|
| `workbooks` as an owner-attestation record | unknown | `decision-needed` | Does core have an owner-confirmation or attestation primitive? If not this is a new concept |
| `workbook_answers.target_table` / `target_id` as a soft pointer | unknown | `decision-needed` | Core may prefer typed FKs per target. Soft pointer chosen because one table serves three unrelated targets |
| `token` as the sole credential, no login | unknown | `decision-needed` | **Security review needed.** Accepted risk with a date, not a permanent design |
| `state` = untouched / confirmed / changed | unknown | `missing` | The distinction is the product requirement, not an implementation detail. Must survive any core mapping |
| was/now pair as the audit record for a pricing change | unknown | `partial` | Core may want a separate append-only event table. Today the pair plus `applied_at` is the record |
| Tenant scope via `client_id` | `academy_id` or equivalent | `partial` | Straight rename if core uses `academy_id` |

## Decisions And Shortcuts

| Item | Reason | Core impact or replacement |
|---|---|---|
| **Core parity unverified** | Core repo returned `Repository not found` | Everything in Parity is an open question, not an assertion |
| RLS enabled with **no policies**, service-role only | The owner's browser never talks to Supabase; it calls an API route that resolves the token server-side. A leaked token buys one workbook through one route, not table access | Core should keep the same shape: token resolution server-side, never a client-side row filter |
| `expires_at` nullable and **unenforced** | The no-login link was accepted *with a date*. Column exists so expiry becomes config rather than a migration. **No shipped code reads it - do not claim the link expires** | Core should enforce it |
| Soft pointer (`target_table` + `target_id`) instead of three typed FK columns | One table serves academy settings, price rows and member rows. Typed columns would mean three mostly-null FKs and a new column per future target | If core prefers typed FKs, this is a mechanical split |
| No-partial-submit enforced in the **submit route**, not by a constraint | A half-filled workbook must still be saveable; the owner comes back to it. Only the transition to `submitted` requires every card confirmed | Core must keep the rule enforced somewhere real, and not only in the UI |
| Provider ids deliberately **absent** | The referenced row already carries `stripe_price_id` etc. Copying them here lets them drift | Resolve provider ids at apply time from the target row |
| `client_id` denormalized onto `workbook_answers` | A staff review query that forgets the join becomes a cross-academy leak | Keep the tenant column on every academy-scoped table |

## Open Decisions

- **Core parity, all of it.** Nothing here has been checked against the real core.
- **Does an applied answer need a separate append-only event row?** The guardrail
  asks plan-change workflows to leave an append-only record. Today the immutable
  was/now pair plus `applied_at` serves that. Core may disagree.
- **Token strength, rotation and revocation policy.** `void` exists; no rotation is
  designed, and no expiry is enforced.
- **Who owns apply failures?** `apply_error` is per answer so one bad row does not
  discard the owner's whole workbook, but nothing yet retries or escalates them.
