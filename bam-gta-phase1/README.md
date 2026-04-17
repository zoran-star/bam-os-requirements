# BAM GTA Phase 1

## What it's for
The first front end design of FullControl to serve BAM GTA. Contains the staff dashboard, parent app, and all documentation for the GHL automation layer that connects them.

## Who's working on it
Zoran (product owner), Dev team (backend integration)

## Current status
Prototype complete for both staff dashboard and parent app. The dev team is currently integrating the backend — connecting GHL for automations and messaging, and Stripe for billing.

## End goal
The first fully integrated, paying FullControl customer live at BAM GTA. Real operators using the staff dashboard daily. Parents and athletes booking and messaging through the parent app. BAM GTA is satisfied with this version of Full Control.

## Core blockers
- Backend integration in progress — GHL and Stripe connections pending
- GHL workflows need final QA with Danny before go-live
- Decision on where to build workflows (GHL or FC native)

## How it connects to other projects
- **prototype/** — the staff dashboard and parent app are location-specific implementations of the prototype
- **sales-conversation-agents/** — the booking AI agent runs inside GHL automations for this location
- **GoHighLevel** — all messaging, automation triggers, and CRM data flow through GHL
- **Stripe** — billing and payment processing
