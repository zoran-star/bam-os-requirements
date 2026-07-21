# Shared brand model - brand is an entity, academies belong to it (PLANNED)

**Decision (2026-07-21, Zoran):** a brand is a SHARED thing that multiple
academies live under, each with ONE brand deck per brand. The real goal is the
future case: **multi-location under one brand + one brand deck.**

## The associations (real, today)
- **"By Any Means"** brand ⊃ **BAM GTA** (and future BAM locations)
- **"Detail"** brand ⊃ **DETAIL Miami** (and other clients that share the Detail brand)
- GTA and DETAIL are DIFFERENT brands - two separate branding decks, not shared.

## Current state = NOT built this way (the gap, verified 2026-07-21)
Brand is per-academy in two disconnected places:
- Portal: `clients.brand_data` jsonb, strictly per-client (GTA's is empty, DETAIL's
  holds the aqua set on 2026-07-20). No `brand_id` / `parent_brand` / shared-brand
  entity anywhere (grepped bam-portal - zero hits).
- `bam-client-sites`: a SHARED design-SYSTEM (`design-system/bam-design-system.css`,
  structure/components) + PER-SILO brand under `clients/<slug>/` (colors/logo/copy).
  Silos already exist for `by-any-means`, `bam-gta`, `detail-miami`, etc. -
  `bam-gta` is its own silo, not linked to `by-any-means`.
So "GTA = same brand as X" today means copy-pasting values into each silo. There
is no one-definition-many-academies link.

## Target model (when built)
- A `brands` entity: name + brand_data (colors/fonts/logos/story) + the brand deck.
- `clients.brand_id` FK → brands (many academies → one brand).
- Brand deck lives at the BRAND level (one deck per brand), not per client silo.
- `bam-client-sites`: academy silos reference their brand's shared tokens
  (e.g. `bam-gta` → `by-any-means` brand) instead of hardcoding; per-location
  overrides allowed but the brand is the source of truth.
- This is a persistent-data / backend-architecture change → run
  `align-core-data-model` (align with fc-core-srvc + update the core handoff)
  when we build it. See [[project_design_system]] + [[project_client_onboarding_flow]].

## Status
PLANNED / future goal, NOT built. Parked while finishing Mike/GTA onboarding.

## Related edge found same session: own ad account, BAM-managed
`clients.uses_own_ad_account` boolean exists (GTA=true, DETAIL=false). Code comment:
`true = own account (extra onboarding steps, TBD)`. The reads work because the
owner's account sits under BAM's Business Manager, so BAM's Meta token pulls it
(`marketing.js` does NOT branch on the flag). GAP: the onboarding Ads step only
offers managed / I-run-my-own / later - there's no clean path for the (common)
hybrid "my own account, but BAM runs it under BAM's BM". Worth a 4th path later.
