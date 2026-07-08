---
description: Resume the DETAIL Miami V2 / off-GHL setup exactly where it was paused
---

Continue the DETAIL Miami V2 setup.

**Goal:** everything tie-able is tied to the Training offer, and DETAIL Miami runs fully in the portal - except texting + calling, which stay on GHL until Twilio (contacts flip together with messaging on the Twilio cutover, never before).

**Load state first (in this order):**
1. Read [`bam-ghl-agent/docs/detail-miami-v2-handoff.md`](../../bam-ghl-agent/docs/detail-miami-v2-handoff.md) - the frozen handoff (state table, activation checklist, PR list, gotchas).
2. Read [`bam-ghl-agent/memories/project_detail_portal_native_plan.md`](../../bam-ghl-agent/memories/project_detail_portal_native_plan.md) - the living log (newer than the handoff if they disagree).
3. Live-check the activation state via the Supabase MCP:
   ```sql
   select
    (select count(*) from bookable_programs where tenant_id='4708a68d-5365-48bf-a404-72a69fadd34d') as programs,
    (select count(*) from offer_prices where tenant_id='4708a68d-5365-48bf-a404-72a69fadd34d') as typed_prices,
    (select count(*) from members where client_id='4708a68d-5365-48bf-a404-72a69fadd34d') as members,
    (select booking_provider from clients where id='4708a68d-5365-48bf-a404-72a69fadd34d') as booking,
    (select email_provider from clients where id='4708a68d-5365-48bf-a404-72a69fadd34d') as email;
   ```

**Then:** give Zoran a short visual catch-up (state table + what changed since the handoff), and continue down the handoff's activation checklist from the first unchecked step. If `programs = 0`, the make-sellable activation hasn't fired yet - someone needs to open Detail's Blueprint → Offers once, then re-check.

**Working rules:** git worktree, PR + squash-merge to main (expect the merge-origin/main + `checkout --ours` conflict dance; verify other sessions' commits survive), update the memory note in the same commits, tour verifier after any client-portal.html edit, no em dashes in person-facing output.
