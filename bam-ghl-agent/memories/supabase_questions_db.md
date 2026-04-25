---
name: Questions Database Schema
description: Supabase schema, enum values, and insert rules for the FullControl portal Questions Database
type: reference
originSessionId: 8ec70af4-b33d-4257-b78b-d8943bfc9426
---
## Connection
- Project ref: `jnojmfmpnsfmtqmwhopz`
- Table: `Questions Database`
- Anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impub2ptZm1wbnNmbXRxbXdob3B6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjI1ODQsImV4cCI6MjA5MDE5ODU4NH0.8vUj-MHg73yUtQR5i3VAbgrTyjvmTCMM6-U3mGxbGGo`
- Access via: Supabase MCP (`execute_sql`, `apply_migration`) or Supabase JS CDN in client-portal.html

## Full Column Schema

| Column | Postgres Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | Auto-generated — never set manually in INSERT |
| `Question` | text | NO | Natural key — must be unique. Sentence case, ≤12 words |
| `Input Type` | input_type_enum | YES | Must be one of the 14 enum values exactly |
| `Placeholder` | text | YES | Helper text shown in/below the input |
| `Mandatory` | boolean | NO | true / false — no nulls |
| `Note to Client` | text | YES | Internal context shown in gold mono. No ALL CAPS requirement — write naturally. |
| `Places Asked` | text[] | YES | Array of menu item names. NULL for sub-fields |
| `Page` | integer | NO | 1 = always shown, 2+ = conditional page |
| `Options` | text[] | YES | For Check One / Check Many / Dropdown only |
| `Dependent On` | uuid | YES | FK → `id` of the controlling question |
| `Dependent On Value` | text[] | YES | Answer value(s) that trigger this question to show |
| `Parent Question` | uuid | YES | FK → `id` of Block Builder / Discount Builder parent |
| `sort_order` | integer | YES | Display order. Sub-fields MUST have this set |

## Valid Input Types (input_type_enum — exact strings)

```
Text Input        — short single-line free text
Open-Ended        — multi-line textarea
Link Input        — URL / Google Drive link
Phone Number      — tel input
E-Mail            — email input
Check One         — pick exactly one (radio rows)
Check Many        — pick multiple (checkbox rows)
Dropdown          — pick one from long list (renders same as Check One)
File Upload       — dashed-border click zone
Time Picker       — native time input (HH:MM)
Block Builder     — repeating rows of sub-fields (e.g. Day + Start + End)
Discount Builder  — repeating Quantity + Discount rows
Staff Selector    — repeating Name + Phone + notification method rows
Staff Notification Block — informational only, no input (gold banner)
```

All 14 types have renderers in `client-portal.html` as of Gym Rental build.

## Valid Places Asked values (exact strings)

**On portal (10 tiles — render in `client-portal.html`):**
```
Gym Rental · Player Intake · New Hire · Youth Academy · Internal Tournament
Sponsor Inquiry · Camps / Clinics · Upsells · Promo · Staff Member
```

**Onboarding flow (standalone pages — class-setup.html → offer-setup.html → parent-onboarding.html):**
```
Class · Offer · Parent Onboarding
```

**Off portal (kept in DB, not yet placed):**
```
Branding · General Onboarding · Main Site · Training
```

Leave off-portal items alone unless explicitly asked — they'll be placed in their own flows later.

## Key insert rules

- Use `ON CONFLICT DO NOTHING` to avoid duplicate PK errors on `Question`
- Always resolve `Dependent On` and `Parent Question` to UUIDs before inserting (SELECT by Question text first)
- Sub-fields: set `Parent Question` UUID + `sort_order`. Do NOT set `Places Asked`.
- `Page` must be an integer — never null
- `Mandatory` must be a boolean — never null
- **One question per menu item** — when a question applies to multiple menu items with different phrasing/context, split it. `Places Asked` arrays with >1 portal value are rare; use menu-item-specific wording (e.g. "What is the gym location?" not a shared generic).
- **Yes/No follow-up rule** — every follow-up to a Yes/No Check One MUST be wired as a conditional via `Dependent On` + `Dependent On Value`. No exceptions.
- **Question text is the natural key** — must be unique across the whole table. Menu-item-specific phrasing is how splits avoid collision.
- **Check/Dropdown must have Options** — currently 6 off-portal rows violate this (Branding, Training, General Onboarding); safe until those tiles activate.

## Example INSERT

```sql
INSERT INTO "Questions Database" (
  "Question", "Input Type", "Placeholder", "Note to Client",
  "Mandatory", "Places Asked", "Page",
  "Dependent On", "Dependent On Value", "Options",
  "Parent Question", "sort_order"
) VALUES (
  'What is the gym size?',
  'Text Input',
  'e.g., 5,000 sq ft',
  null,
  true,
  ARRAY['Gym Rental'],
  1,
  null, null, null, null,
  10
) ON CONFLICT DO NOTHING;
```

## Useful queries

Fetch all questions for a menu item:
```sql
SELECT id, "Question", "Input Type", "Page", "Mandatory", "Options", "sort_order"
FROM "Questions Database"
WHERE "Places Asked" @> ARRAY['Gym Rental']
ORDER BY "Page", "sort_order";
```

Fetch all sub-fields:
```sql
SELECT id, "Question", "Input Type", "Parent Question", "sort_order"
FROM "Questions Database"
WHERE "Parent Question" IS NOT NULL
ORDER BY "Parent Question", "sort_order";
```

Resolve UUID from question text:
```sql
SELECT id, "Question" FROM "Questions Database"
WHERE "Question" IN ('Question text here');
```
