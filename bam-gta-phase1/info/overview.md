# BAM GTA Phase 1 — Project Overview

## What This Phase Is
Phase 1 of the BAM GTA (Greater Toronto Area) deployment. This folder contains all prototypes,
reference docs, and automation specs for the first live location rollout.

---

## Sub-Projects

### 1. `bam-gta-staff/` — Staff Dashboard
**What it is:** The internal-facing web app used by BAM coaches and admin staff.
**Who uses it:** Coaches, admin, Zoran.
**What it does:**
- Pipeline — manage leads from inquiry through trial to membership
- Trials — track active trials, attendance, outcome
- Post-Trial — conversion flow after trial ends
- Member Profiles — full member history, billing status, attendance
- Sessions — class management, capacity, attendance marking
- Inbox — staff ↔ lead/member messaging (powered by GHL)
- Automations — trigger and monitor GHL automation workflows
- Failed Payments — dunning recovery workflow
- Analysis — business performance, retention, revenue metrics
- Onboarding — new member onboarding checklist
- Admin — settings, team, integrations

**Connects to:**
- GHL (GoHighLevel) — all messaging, automations, and CRM data flows through GHL
- Stripe — billing and payment status
- `bam-gta-parent/` — staff actions (booking, messages) surface in the parent app
- `fc-internal-content-engine/` — content generated for BAM GTA feeds into staff marketing view
- `app/` (FC Prototype) — staff dashboard is the GTA-specific implementation of the FC OS vision

---

### 2. `bam-gta-parent/` — Parent App
**What it is:** The member/parent-facing mobile web app.
**Who uses it:** Parents of athletes, adult athletes.
**What it does:**
- Schedule — view upcoming classes and session times
- Book Classes — self-serve class booking
- Messages — direct messaging with staff
- Profile — athlete profile, attendance history, billing

**Connects to:**
- `bam-gta-staff/` — bookings made here appear in staff Sessions view; messages go to staff Inbox
- GHL — messages are routed through GHL automation
- Stripe — billing/payment visible in Profile

---

### 3. `info/ghl-workflows-for-danny.html` + `v2`
**What it is:** Reference documentation for the GoHighLevel automation workflows.
**Who uses it:** Danny (GHL admin), Zoran (oversight).
**What it does:** Documents every GHL workflow — triggers, actions, timing, and conditions
for automations like trial booking confirmations, follow-up sequences, failed payment recovery,
post-trial conversion nudges, and more.

**Connects to:**
- `bam-gta-staff/` — automations triggered by staff actions in the dashboard
- `bam-gta-parent/` — automations triggered by parent/member actions (booking, messaging)

---

## How They Connect

```
Parent App  ←──────────────────────────────────────────────────────→  Staff Dashboard
(bam-gta-parent)                                                       (bam-gta-staff)
      │                                                                       │
      └──────────────────────── GoHighLevel (GHL) ────────────────────────────┘
                                      │
                              Automations & CRM
                              (ghl-workflows-for-danny)
                                      │
                                    Stripe
                               (billing / payments)
```

**Data flow:**
1. Parent books a class → GHL fires confirmation automation → Staff sees booking in Sessions
2. Trial ends → Staff marks outcome in Post-Trial → GHL fires conversion sequence
3. Payment fails → Stripe webhook → GHL dunning sequence → Staff sees in Failed Payments
4. Staff sends message → GHL routes to parent → Parent sees in Messages

---

## Status (as of April 2026)
- Phase 1 target location: BAM GTA
- Staff dashboard: prototype complete, pending live integration
- Parent app: prototype complete, pending live integration
- GHL workflows: v2 documented, pending final QA with Danny
