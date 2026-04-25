---
name: Whiteboard Session Handoff
description: Current state of onboarding whiteboard work — where we left off and what to do next
type: project
---

**Status (2026-04-01):** Prototype-to-Notion requirements sync in progress. Several pages too large for API updates.

## What was done previously
1. Whiteboard app at `bam-os-requirements/whiteboard/` — deployed to Vercel
2. Extracted all data points from 10 onboarding HTML review files into `whiteboard/session-data.json` (232 items)
3. Extracted Zoran's feedback from session log into `whiteboard/session-feedback.json`
4. Merged into `whiteboard/session-data-merged.json`
5. Populated SECTION Data in Notion Sessions DB for sessions 1-10
6. Fixed API chunking bug for rich_text fields
7. Built `onboarding-viewer.html` standalone viewer

## What was done this session (2026-04-01)
Full prototype audit vs Notion Business Requirements. Found 10+ gaps where prototype features weren't documented.

### Successfully added to Notion:
- **SET-011** — Product Builder (6-step wizard, renamed from Offer Builder per March 2026 review)
- **SET-012** — Global Location Filter (cross-cutting, persistent location selector)
- **CNT-010** — Content Research Insights (Reddit/community research framework)
- **AI-011** — Sage Challenge (contextual motivational CTA on home)
- **AI-012** — Milestone Celebrations (visual celebration on personal bests)
- **AI-013** — Quick Actions (per-page contextual action buttons)
- **AI-014** — Global Inbox (unified cross-page messaging panel with 7 filters)

### Could NOT add due to Notion page size timeouts:
These requirements are written and ready but the target pages are too large for the Notion API:

**Member Management page (too large):**
- **CLS-006** — Admin Schedule View (weekly calendar grid, session types, capacity)
- **CLS-007** — Session CRUD (create, edit, cancel, duplicate from admin schedule)
- **MEM-053** — Activity Stream (mixed-type chronological feed on Members page)

**Sales page (too large):**
- **SAL-014** — Structured Lead Notes (per-lead fields: childAge, goal, source, budget, availability)

**Strategy page (too large):**
- **STR-010** — KPI Picker (configurable 4-6 KPI dashboard with Sage consultation)

**Marketing page (too large):**
- March 2026 review notes (top bar redesign, improve ads flow, content elevation)

### March 2026 prototype review decisions status:
- Product Builder rename → **Done** (SET-011)
- Global location filter → **Done** (SET-012)
- Unified inbox click-to-chat → **Done** (AI-014)
- Marketing top bar redesign → Blocked (MKT page timeout)
- Improve Ads flow → Blocked (MKT page timeout)
- Content elevated to equal nav weight → Documented in CNT-004 already
- Churn/close/pause → rolling 30 days → Blocked (STR page timeout)
- Issue Credit (P1) → Blocked (MEM page timeout)
- QR check-in → P2 → Blocked (MEM page timeout)
- Trial period removed from P0/P1 → Not yet addressed

## What needs to happen next
1. **Resolve large page timeout issue** — Options: (a) manually add rows in Notion UI, (b) split large pages into sub-pages, (c) use Notion API directly with longer timeouts via Node script
2. **Verify Onboarding Data Points DB** — ~25-30 entries exist but 232 items were extracted. Gap needs reconciliation.
3. **Sessions 11-18** — No review data. Need to be scoped.
4. **Apply onboarding review feedback to Business Requirements** — Zoran's feedback from the review (e.g., "move Qualification Dimensions to Sales", "collect via LLM chat module") hasn't been actioned on the requirement pages.

## Whiteboard deployment
- Production URL: https://whiteboard-beta-indol.vercel.app
- Vercel project: whiteboard (under zoran-stars-projects)
- Deploy: `cd whiteboard && vercel --prod`

## Key file locations
- `bam-os-requirements/whiteboard/session-data-merged.json` — combined items + feedback
- `bam-os-requirements/onboarding-viewer.html` — standalone HTML viewer
- `bam-os-requirements/whiteboard/.env.local` — Vercel OIDC token

## Notion DB IDs
- Sessions DB: `4e5492be5027427cbbc8994bcd73905c`
- Backlog DB: `39c1f40a005c4c9ba50b0c7fe47b45bd`
- Onboarding Data Points DB: `49be4ce65ada4d45b736070e11452edb`
