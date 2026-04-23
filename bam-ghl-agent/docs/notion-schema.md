# Notion Schema Reference

> Reference for all databases in the BAM Business knowledge base.
> Keep this updated as the schema evolves.

Knowledge base root: https://www.notion.so/33a5aca8ac0f81f38881d3f7003294ec

---

## QUESTIONS DATABASE
`collection://f270e8c6-ae8b-4d5e-8e7d-154972ece7ee`

| Field | Type | Notes |
|-------|------|-------|
| Question | title | The question text shown to client |
| Input Type | select | Check One, Text Input, Link Input, Staff Notification Block, Open-Ended, File Upload, Dropdown |
| Mandatory | checkbox | Whether the question is required |
| Menu Items | multi-select | Gym Rental, New Hire, Internal Tournament, Sponsor Inquiry, Player Intake, Camps/Clinics, Upsell, Youth Academy, Branding |
| Helper Text | text | Guidance shown below the field |
| Note to Client | text | Additional context for the client |

---

## TEMPLATE SECTIONS
`collection://3435aca8-ac0f-801d-a100-000bb6dda9d0`

| Field | Type | Notes |
|-------|------|-------|
| Code | title | ⚠️ Should be Name (rename pending) |
| Name | text | Human-readable section name |
| Trying to Communicate | text | Psychological purpose of this section |
| Copy Instructions | text | Mandatory creative brief for AI copy generation |
| Custom Values | text | ⚠️ Should be relation to Custom Values DB |
| Items to Embed | text | ⚠️ Should be relation to Forms + Calendars |
| Inputs Required | text | ⚠️ Should be relation to Questions Database |

**Pending additions:**
- Section Type (select): Hero, Social Proof, CTA, Features, FAQ, Form, Pricing, Team, Gallery, Nav, Footer
- Page Types (multi-select): Home, About, Services, Landing Page, Thank You, Booking
- Position (select): Top, Middle, Bottom
- Required vs Optional (checkbox)

**Code field convention:**
```html
<h1>{{COPY:headline}}</h1>
<p>{{COPY:subheadline}}</p>
<a href="{{custom_values.booking_link}}">{{COPY:cta_text}}</a>
<!-- EMBED: Free Trial Calendar -->
```

---

## TEMPLATE PAGES
`collection://3435aca8-ac0f-809e-b2ab-000b5d89b2e1`

| Field | Type | Notes |
|-------|------|-------|
| Name | title | Page name |
| Sections | text | ⚠️ Should be relation to TEMPLATE SECTIONS |
| Slug | text | URL path (e.g. /booking) |

---

## FUNNELS
`collection://3435aca8-ac0f-8046-94bc-000b74142791`

| Field | Type | Notes |
|-------|------|-------|
| Name | title | Funnel name |
| Pages | select | ⚠️ Should be relation to TEMPLATE PAGES |
| Slug | select | URL path |

---

## TEMPLATE FORMS
`collection://282ab839-068d-4773-8719-c1c105b5431d`

| Field | Type | Notes |
|-------|------|-------|
| Form Name | title | |
| Purpose / Description | text | What the form is for |
| Fields Collected | text | All form fields and input types |
| GHL Fields Mapped | text | Which GHL contact/custom fields each field populates |
| Tags Applied on Submit | text | Tags applied on form submission |
| Connected Automations | text | Automations triggered by submission |
| Pipeline Action | text | Pipeline + stage on submission |
| Sections Displayed On | text | ⚠️ Should be relation to TEMPLATE SECTIONS |

---

## TEMPLATE CUSTOM VALUES
`collection://33d5aca8-ac0f-8008-b6d5-000b884a654f`

| Field | Type | Notes |
|-------|------|-------|
| Name | title | Human-readable name |
| Key | text | GHL key syntax (e.g. `business_name`) |
| Purpose | text | What this value is used for |
| Expected Value | text | What format the value should be in |
| Example Use Cases | text | Where it appears in sections/copy |

**Usage in code:**
```
{{custom_values.key_name}}
```

---

## Schema Issues To Fix

These are known issues that need to be resolved before the agent can navigate reliably:

1. **TEMPLATE SECTIONS.Code** should be renamed to Name (title field should be the human-readable identifier)
2. **TEMPLATE SECTIONS.Custom Values** should be a relation field → Custom Values DB
3. **TEMPLATE SECTIONS.Items to Embed** should be a relation field → Template Forms + Calendars
4. **TEMPLATE SECTIONS.Inputs Required** should be a relation field → Questions Database
5. **TEMPLATE PAGES.Sections** should be a relation field → Template Sections
6. **FUNNELS.Pages** should be a relation field → Template Pages
7. **TEMPLATE FORMS.Sections Displayed On** should be a relation field → Template Sections
