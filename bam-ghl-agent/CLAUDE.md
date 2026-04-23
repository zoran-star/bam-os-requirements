# BAM Business — GHL Agent Build

## What This Project Is

BAM Business is a white-labeled GoHighLevel agency product. Clients are sports businesses (academies, clubs, trainers, AAU teams) and home services companies. BAM OS handles their CRM, automations, websites, funnels, pipelines, and communication systems inside GHL sub-accounts.

The end goal of this folder is to build a **fully autonomous GHL agent** that can:
1. Receive a support ticket or onboarding form submission
2. Read the Notion knowledge base via MCP
3. Diagnose errors / plan builds / generate assets
4. Output everything a human needs to execute in GHL (HTML, copy, embed codes, custom values)
5. Learn from team feedback to improve over time

---

## Who's Working Here

- **Zoran** — founder, product direction, final decisions
- **Cameron (Rosano)** — systems/build side, works from this same repo

Both of you work from this CLAUDE.md. If you have personal preferences, add them to `CLAUDE.local.md` (gitignored).

---

## The Two Agent Modes

### Mode 1 — Support Ticket Agent
Triggered when an existing client submits a ticket.

Three ticket types:
- **Error ticket** — something is broken, diagnose and fix
- **Change ticket** — modify something that already exists
- **Add item ticket** — add one of 9 menu items to the site

For each ticket the agent outputs:
1. Where the error is / what needs to change
2. Proposed fix steps (ordered by likelihood)
3. Proposed assets (copy, code, embed codes)
4. Proposed user guide (send to client after fix)

### Mode 2 — Onboarding Build Agent
Triggered when a new client completes their onboarding form.

The agent:
1. Reads all client onboarding inputs
2. Decides which pages/funnels the site needs
3. Pulls matching sections from TEMPLATE SECTIONS in Notion
4. Assembles sections in correct order
5. Injects copy, custom values, and embed codes
6. Outputs complete HTML per page ready for a human to paste into GHL

---

## The Knowledge Base (Notion)

Everything the agent reads lives here:
**https://www.notion.so/33a5aca8ac0f81f38881d3f7003294ec**

### Structure
```
SUPPORT TICKET AGENT KNOWLEDGE BASE
├── BUILD GUIDES          — one per menu item, full funnel flow + automations
├── USER GUIDES           — AI-generated, team-reviewed client guides
├── MENU ITEM FORMS       — intake form questions per menu item
├── TEMPLATES/
│   ├── TEMPLATE SECTIONS — HTML sections with copy instructions
│   ├── TEMPLATE PAGES    — page assemblies (sections list)
│   ├── FUNNELS           — funnel structures (pages list)
│   ├── TEMPLATE FORMS    — GHL forms with fields, tags, automations
│   ├── TEMPLATE CUSTOM VALUES — GHL custom value keys + formats
│   ├── TEMPLATE TAGS
│   ├── TEMPLATE PIPELINES
│   ├── TEMPLATE CUSTOM FIELDS
│   ├── TEMPLATE EMAILS
│   ├── TEMPLATE TEXTS
│   ├── CALENDARS
│   └── SERVICES
├── QUESTIONS DATABASE    — all onboarding/intake questions, input types, menu items
└── ONBOARDING            — onboarding flow documentation
```

### TEMPLATE SECTIONS schema
Each section record has:
- **Name** — human-readable identifier (should be the title field)
- **Code** — raw HTML with `{{COPY:field_name}}` placeholders for AI-written copy
- **Copy Instructions** — mandatory creative brief for writing the copy
- **Custom Values** — links to TEMPLATE CUSTOM VALUES (GHL keys to inject)
- **Items to Embed** — links to TEMPLATE FORMS or free trial calendar
- **Inputs Required** — links to QUESTIONS DATABASE fields needed
- **Trying to Communicate** — what this section does psychologically
- **Section Type** — Hero, Social Proof, CTA, Features, FAQ, Form, etc. (to add)
- **Page Types** — which page types use this section (to add)

### Copy convention
Code field uses `{{COPY:field_name}}` for copy placeholders.
Custom values use GHL syntax: `{{custom_values.key_name}}`
Embeds are marked: `<!-- EMBED: [Form/Calendar Name] -->`

---

## The Support Ticket Flow (Client-Facing)

```
Client opens ticket
→ Do you have an error?
  ├── YES → Error ticket (where is error + how should it work)
  └── NO  → What do you want to do?
            ├── Add something → Menu selector (9 items, pick one) → Menu item form
            └── Change something → Change ticket form

All paths → Confirmation screen
```

**9 menu items:** Branding, Gym Rental, Player Intake, New Hire, Youth Academy, Internal Tournament, Sponsor Inquiry, Camps/Clinics, Upsells

---

## Files In This Folder

```
bam-ghl-agent/
├── CLAUDE.md                     ← you are here
├── CLAUDE.local.md               ← personal prefs (gitignored)
├── agent-prompt.md               ← full Claude API system prompt
├── dashboard.html                ← internal team dashboard (home, action items, image tagging)
├── support-ticket.html           ← client-facing ticket submission form
├── error-ticket-internal.html    ← internal team view (error tickets)
├── change-ticket-internal.html   ← internal team view (change tickets)
├── build-mode.html               ← timer + notes for builder's second monitor
├── docs/
│   ├── flow-diagram.md           ← support ticket flow documentation
│   ├── notion-schema.md          ← full Notion database schema reference
│   ├── ghl-technical-notes.md    ← GHL quirks, API notes, known limitations
│   ├── copy-convention.md        ← how copy placeholders and custom values work
│   ├── fullcontrol-brand.md      ← Full Control design system: colors, type, components, UX principles, light mode
│   └── style-guide.md            ← BAM OS internal tooling style guide (mirrors fullcontrol-brand.md)
├── sections/                     ← HTML section templates (source of truth)
│   └── README.md
└── builds/                       ← client build outputs (gitignored)
    └── .gitkeep
```

---

## Design Standards

All frontend work — HTML files, components, forms — follows the **Full Control design system** documented in `docs/fullcontrol-brand.md`. Key rules:
- Dark-first (ink surfaces), light mode via `data-theme="light"` toggle
- Space Grotesk for display, Inter for body, JetBrains Mono for labels
- Gold (`#E8C547`) is the only accent — one moment per screen
- No shadows, no gradients, no rounded corners > 6px
- UX principles: guiding info belongs at the point of action; minimize eye travel

---

## Technical Standards

- Websites are built as HTML files
- GHL forms embedded via iframe embed code
- GHL calendars embedded via embed code (free trial calendar only)
- Custom values injected using `{{custom_values.key_name}}` syntax
- No third-party page builders — HTML is written directly
- Images hosted on Cloudinary, URLs stored as GHL custom values
- Agent outputs HTML + build checklist — human pastes into GHL

---

## How to Work Here

### If given a support ticket
1. Read the ticket type and client inputs
2. Search Notion for the relevant Build Guide
3. Pull the relevant TEMPLATE SECTIONS
4. Output: diagnosis → fix steps → assets → user guide

### If given an onboarding form submission
1. Read all client inputs
2. Decide site structure (pages/funnels) based on business type
3. Pull matching TEMPLATE SECTIONS for each page
4. Assemble in correct order (Hero first, CTA near bottom)
5. Inject `{{COPY:field}}` with written copy following Copy Instructions
6. Inject `{{custom_values.key_name}}` as-is for GHL to resolve
7. Mark embed points with `<!-- EMBED: [name] -->`
8. Output page-by-page HTML + build checklist

### Agent rules
- Never guess a custom value key — always pull from Notion
- Never guess a form name — always pull from Notion
- Never skip Copy Instructions — treat them as mandatory creative brief
- If Inputs Required aren't satisfied by onboarding answers, flag in Open Items
- Only GHL-native embeds: forms and the free trial calendar
- Default copy tone: direct, athletic, results-focused

---

## What's Still Being Built

- [ ] TEMPLATE SECTIONS database — needs records populated (HTML + copy instructions)
- [ ] TEMPLATE PAGES — needs relation fields (not just text)
- [ ] FUNNELS — needs relation fields
- [ ] Sections schema fixes: Name should be title field, Code should be page body
- [ ] Section Type and Page Type fields to add
- [ ] Onboarding form (HTML) — collects client data, uploads images to Cloudinary
- [ ] Make/n8n automation: GHL webhook → Claude API → output to Notion/Slack
- [ ] Improvement ticket system — captures team feedback on Claude's output quality
- [ ] Change ticket internal view (HTML)
- [ ] Menu item internal view (HTML)

---

## Next Immediate Steps

1. Fix TEMPLATE SECTIONS schema in Notion (Name as title, proper relations)
2. Populate first 5–10 section records with real HTML + copy instructions
3. Build onboarding form HTML with Cloudinary image upload
4. Wire up Claude API call in Make/n8n
5. Build change ticket + menu item internal views
