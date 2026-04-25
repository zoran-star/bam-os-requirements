---
name: Onboarding Data Points — Open Items
description: List of onboarding sections that need detailed data point definition before implementation
type: project
---

Session goal (2026-03-28): finalize all data points collected during academy owner onboarding.

**Why:** The onboarding review v2 established 8 functional domain sections, but several need deeper scoping to define exact fields, input types, and logic.

**How to apply:** Work through each section below to define every field the owner fills in, the input type, whether it's required, and where the data flows.

## Sections to Detail

1. **Strategy & Positioning** — Selling Points was flagged as needing to be part of a bigger strategy section that understands the problem, the offer, and more. Need to define what "strategy understanding" means in terms of concrete data points.

2. **Locations** — Open question: what data belongs under the umbrella of a location? (schedule, coaches, directions, capacity, facilities?) Need to scope the full location data model.

3. **Staff** — Flagged as "staff understanding section." Need to define: what do we collect per coach/staff member? Credentials, bio, photo, certifications, availability?

4. **Product & Pricing** — Largest section (13 items). Need to clarify overlap between Offer Builder (PRD-001), Subscription Plans (PRD-002), and Membership Plans (SET-003). Are these the same thing or distinct?

5. **Policy** — Flagged as its own section. Need to define all policy fields: cancel terms, pause rules, dunning, flexibility areas, makeup policy, refund policy.

6. **Conversation AI** — Tone Preference was the only unapproved item from v1. "Do Not Say" list is new. Need to define: what exactly does the owner configure for the AI? Tone, boundaries, do-not-say, and what else?

7. **Integrations & Launch** — Onboarding Links could live in the scheduling app. Need to decide where it goes.

8. **Identity** — Mostly settled. May need to confirm exact profile fields.

## Already Decided
- Reorganized from collection-phase grouping to functional-domain grouping (8 sections)
- Review doc lives at `onboarding-review.html` in bam-os-requirements repo
- Decision saved to Notion Working Memory (2026-03-28)
