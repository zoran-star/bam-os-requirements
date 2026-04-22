# Add Question to Database

You are helping the user add a new question to the FullControl support portal's `Questions Database` in Supabase (project: `yoepbpwajszopxzzyzzk`).

## Step 1 — Load context

Before doing anything else, load these two sources:

1. **Memory doc** — `supabase_questions_db.md` in persistent memory (`~/.claude/projects/-Users-zoransavic/memory/`). Has the full schema, all 14 valid Input Type enum values, valid Places Asked strings, and insert rules.
2. **Style guide** — `prototype/docs/style-guide.md` Section 10. Has writing rules, multi-page flow logic, sub-field rules, and the Gym Rental worked example.

Then fetch existing questions so you can avoid duplicates:

```sql
SELECT "Question", "Input Type", "Places Asked", "Page", "Mandatory", "Dependent On Value", "Options", "Parent Question", "sort_order"
FROM "Questions Database"
ORDER BY "Places Asked", "sort_order";
```

## Step 2 — Gather requirements

Ask the user (in a single message) for everything you need:

- **What menu item** is this question for? (Gym Rental, Branding, Player Intake, etc.)
- **What is the question** asking? (describe in plain language — you'll format it)
- **What kind of input** do they expect? (free text, pick one, pick many, file, time, repeating rows, etc.)
- **Is it mandatory?**
- **Is it conditional?** (Only shows if the user answered something specific earlier?)
- **Which page?** (Always shown = page 1, conditional page = 2+)
- **Any helper text or internal note?**
- **Any options to choose from?** (for Check One / Check Many)
- **Is it a sub-field inside a Block Builder?** If so, which parent question?

If the user gives you enough information upfront (e.g. "Add a question asking for the gym size, text input, mandatory, Gym Rental page 1"), skip straight to Step 3.

## Step 3 — Draft the row

Using the style guide rules, produce the exact values for each column:

- `Question` — Sentence case, ≤12 words, ends with `?` or `.`
- `Input Type` — Must be one of the exact enum values
- `Placeholder` — Starts with `e.g.,` or a short instruction. Never restates the question.
- `Note to Client` — ALL CAPS, short, internal context only (what the system does with the answer)
- `Mandatory` — true / false
- `Places Asked` — Array with the exact menu item name(s) as they appear in the portal
- `Page` — Integer (1 = always shown)
- `Dependent On` — UUID of the controlling question, or null
- `Dependent On Value` — Array of trigger values, or null
- `Options` — Array of sentence-case options (for Check One / Check Many / Dropdown)
- `Parent Question` — UUID of the parent row (for sub-fields only)
- `sort_order` — Integer; check existing sort_orders for this menu item and place accordingly

Show the draft to the user and confirm before inserting.

## Step 4 — Confirm

Show the user a clean summary table of the values you'll insert. Ask: "Does this look right? I'll insert it once you confirm."

Wait for explicit confirmation ("yes", "go", "looks good", etc.) before running any SQL.

## Step 5 — Insert

Run the INSERT via Supabase `execute_sql`. Use `ON CONFLICT DO NOTHING` to avoid duplicate PK errors.

If `Dependent On` references another question by name (not UUID), first run a SELECT to resolve the UUID:
```sql
SELECT id FROM "Questions Database" WHERE "Question" = '<question text>';
```

Example INSERT shape:
```sql
INSERT INTO "Questions Database" (
  "Question", "Input Type", "Placeholder", "Note to Client",
  "Mandatory", "Places Asked", "Page",
  "Dependent On", "Dependent On Value", "Options",
  "Parent Question", "sort_order"
) VALUES (
  'What is the gym size?', 'Text Input', 'e.g., 5,000 sq ft', null,
  true, ARRAY['Gym Rental'], 1,
  null, null, null,
  null, 99
) ON CONFLICT DO NOTHING;
```

## Step 6 — Confirm and suggest next steps

After inserting, confirm it was successful and tell the user:
- The question will appear in the portal next time the form is loaded (no deploy needed — it reads live from Supabase)
- If the question is conditional, remind them to verify the `Dependent On` question is on an earlier page
- Suggest any follow-up: adding options, setting a sort_order, or creating a sub-field

## Rules

- Never insert without explicit user confirmation in Step 4
- Always validate Input Type is a valid enum value before inserting
- If the user describes something that sounds like two questions, flag it and ask which to add first
- If a similar question already exists in the database, point it out before proceeding
- Keep question labels concise — if the user's phrasing is too long, propose a shorter version and explain why
