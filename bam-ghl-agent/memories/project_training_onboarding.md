---
name: Training Onboarding Flow
description: 3-step standalone onboarding flow for academy operators to set up training — classes, offers, and parent fields
type: project
originSessionId: 06a91b2b-6978-45ac-9d3c-92974fc626f4
---
## Overview
A separate 3-step onboarding flow (not the client portal). Operators fill this in once to configure their training setup.

## Files (all in `/Users/zoransavic/bam-ghl-agent/`)
- `class-setup.html` — Step 1: create training classes (multi-record builder)
- `offer-setup.html` — Step 2: create pricing offers (single session / package / membership)
- `parent-onboarding.html` — Step 3: choose parent intake fields (Check Many + Add another field)

## Navigation
class-setup.html → offer-setup.html → parent-onboarding.html → completion screen

## Supabase Places Asked values
- `Class` — 10 questions + 3 Block Builder sub-fields (schedule: day/start/end)
- `Offer` — 31 questions + 5 sub-fields (package tiers: sessions/cost/expiry; membership tiers: duration/price)
  - Page 1: offer type picker (Single session / Package / Membership)
  - Page 2: common questions + type-specific conditional sections
- `Parent Onboarding` — 1 Check Many question, 14 options including "Add another field"

## Key design patterns
- Multi-record builder: saved-items list + "+ Add" button + inline form panel
- Offer form is 2-page: type picker on Page 1, conditionals on Page 2 (Dependent On cross-page works because answers persist)
- Same CSS design system as client-portal.html (dark ink, gold accent)
- Step bar fills in (done/active/inactive) correctly across all 3 pages
