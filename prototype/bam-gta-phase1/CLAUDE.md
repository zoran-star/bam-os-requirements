# BAM GTA Phase 1

First live deployment of FullControl at BAM Basketball's Greater Toronto Area location. This folder contains all sub-projects for Phase 1.

## Sub-projects
- bam-gta-staff/ — staff dashboard for coaches and admin (React/Vite)
- bam-gta-parent/ — mobile app for parents and athletes (React/Vite)
- info/ — includes information to help support the knowledge of the design and build of Full Control for BAM GTA

## Design system
These GTA phase-1 apps use a **copy of the prototype design system** (`bam-gta-staff|bam-gta-parent/src/styles/theme.css`, prototype lineage, gold `#C8A84E`). They are **reference apps, not the live product**. The live product BAM GTA actually operates on is **V2**, styled by [`bam-ghl-agent/bam-portal/design-system/tokens.css`](../../bam-ghl-agent/bam-portal/design-system/tokens.css) (gold `#D4B65C`). Do not confuse the two, and do not apply the V2 portal system here. Full map: repo-root CLAUDE.md "Design systems".

## Status (April 2026)
- Staff dashboard: prototype complete, pending live integration with GHL and Stripe
- Parent app: prototype complete, pending live integration
- The Dev team is currently integrating the backend

## Core blockers
- Backend integration in progress (GHL + Stripe)
- Decision on where to build workflows (GHL or FC native)

## Goal
Phase 1 proves the product works in a real academy. Real operator interactions here are the evidence that justifies the acquisition multiple. This is the data flywheel.
