---
name: AI pricing-change assistant (future)
description: Future requirement — an AI that figures out how future payments should work from staff/parent text input + existing member/price/sub data, because price changes in this industry are a nightmare to reason through manually.
metadata:
  type: project
---

# AI pricing-change assistant (future requirement)

Zoran (2026-06-19): changing prices/plans for sports academies is a nightmare —
proration, commitment terms, credits, mid-cycle changes, "what happens after the
term," Stripe schedules, CoachIQ credit refresh, etc. We need an **AI layer** that,
given **free-text intent** ("move this kid to 2x/wk starting next month, keep their
current credits") **plus the info already in the system** (member, current sub,
offer prices, term, credits, billing mode), figures out **how future payments +
credits should actually work** and proposes the concrete change (Stripe schedule
edit, credit grant, effective date) for staff to approve.

**Why:** the rules are too tangled for staff to get right by hand; this is exactly
where an AI "think it through" step adds safety.

**Where it fits:** the member-management buttons (change plan / pause / upgrade) +
the [[project_pricing_sorter_wizard]] / commitment-schedule logic
([[project_coachiq_integration]] create-sub + Stripe Subscription Schedules).

**Status:** idea only, not built. Build after member import + the member-management
buttons land.
