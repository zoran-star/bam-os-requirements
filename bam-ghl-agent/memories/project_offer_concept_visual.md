---
name: Offer concept — customer-facing visual
description: The simplified hub-and-spoke explainer of "what is an Offer" — to be surfaced inside the BB > Offers card in the portal once the editor ships. Six spokes around a central OFFER node.
metadata:
  type: project
---

## The visual

Hub-and-spoke diagram with `OFFER` at the center and 6 satellites:

```
              sales              schedule
       (sales process)         (when it is)
              ↘                    ↙
                ╲                ╱
                  ┌─ OFFER ─┐
       ────────  │          │  ────────
   onboarding    │          │      price
   (how we get   │          │   (how much
   people        │          │    it costs)
   started)      └──────────┘
                  ╱                ╲
                ↙                    ↘
           tracking                  value
      (how we track              (what they get)
        success)
```

Asset path: [`bam-portal/public/offer-concept.png`](../bam-portal/public/offer-concept.png)
Live URL (after Vercel deploys): `https://portal.byanymeansbusiness.com/offer-concept.png`

## What this is for

This is the **customer-facing explainer** of the Offer concept — to be shown inside the BB > Offers card the first time an academy owner lands there, so they understand the mental model before being asked questions.

Probably surfaced as:
- A small "What is an offer?" expand on top of the offers list, OR
- A one-time onboarding step when the academy first opens the Offers card, OR
- A help/info button next to the "+ Add offer" CTA

## Why this differs from the form spec

The image has **6 spokes**: sales · schedule · price · value · tracking · onboarding.
The form (in `offer-architecture.html`) has **6 sections**: General Info · Schedule · Value · Pricing · Sales · Onboarding.

The differences:
- **Image has Tracking, form doesn't.** The form's Tracking section is deferred until after Member Management lands ([[project_resources_library]] is shipped; member-mgmt → tracking spec → comes next). Tracking is conceptually part of the offer; the form just doesn't ask the questions yet.
- **Form has General Info, image doesn't.** Name, age, gender, location, skill level are taken as obvious in the marketing-style visual. In the form they need explicit fields.
- The image uses **price** (singular). The form uses **Pricing** (the section name, which includes tiers + add-ons). Same concept.

## Hard rule

**Do not redesign the image without Zoran's sign-off.** This is his sketch — the simplicity is the point. If we add or rename a spoke, the conceptual model people learn changes. Treat as a sealed asset.

## Related

- [[project_resources_library]] — pattern for adding visual/asset content to the client portal
- The unified Offer architecture spec is at `bam-portal/public/offer-architecture.html` (the operational/form view, not the customer-facing view this image represents)
