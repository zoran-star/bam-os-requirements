# Setup Menu Item

You are setting up a new menu item in the FullControl support portal. This is a 6-phase workflow. Work through each phase with the user — do not skip ahead or batch phases without their input.

**At the end of every message during this workflow, show the progress tracker:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧭 MENU ITEM SETUP — [ITEM NAME]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 1: Discovery              ✅ / ⬅️ YOU ARE HERE / ⬜
Phase 2: Structure design       ✅ / ⬅️ YOU ARE HERE / ⬜
Phase 3: Supabase audit         ✅ / ⬅️ YOU ARE HERE / ⬜
Phase 4: Confirm & insert       ✅ / ⬅️ YOU ARE HERE / ⬜
Phase 5: Front end verification ✅ / ⬅️ YOU ARE HERE / ⬜
Phase 6: Wrap-up                ✅ / ⬅️ YOU ARE HERE / ⬜
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👉 [What the user needs to do next]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Phase 1 · Discovery

**Goal:** Understand what this menu item collects and why.

Read `prototype/docs/style-guide.md` section 10 before starting so you know the schema and writing rules.

Ask the user:

1. Which menu item are we setting up? (Branding, Player Intake, New Hire, Youth Academy, Internal Tournament, Sponsor Inquiry, Camps / Clinics, Upsells)
2. What does this flow need to collect? Describe it in plain language — what does the operator need to provide for the team to build this thing?
3. Are there different "modes" or paths? (e.g. Gym Rental had short-term vs long-term — does this item branch based on any answer?)

Listen carefully. The user may give you a lot of context at once or just a few words. Either way, ask follow-ups until you have a clear picture of:
- The end goal (what gets built from this data)
- The major topic areas the questions will cover
- Any branching paths

Do NOT jump to structuring questions yet. Just understand what this is.

---

## Phase 2 · Structure Design

**Goal:** Design the page/question structure together with the user before touching the database.

### 2a — Draft the question list

Based on Phase 1, propose a candidate list of questions. For each one, note:
- The question text (draft — user will approve)
- Suggested input type
- Whether it's mandatory
- Which "topic area" it belongs to

Present as a flat list first. Example:
```
1. What is the business name? (Text Input, mandatory)
2. Upload your logo. (File Upload, mandatory)
3. What are your brand colors? (Open-Ended, optional)
4. Do you have brand fonts? (Check One — Yes / No, mandatory)
5. Upload your font files. (File Upload, optional — only if Q4 = Yes)
```

Ask the user: "Does this cover everything? Anything missing, wrong, or that should be removed?"

Iterate until the question list is agreed.

### 2b — Design the page structure

Once questions are agreed, organize them into pages:
- **Page 1** = questions always shown to everyone
- **Page 2+** = questions that only appear based on a Page 1 answer (conditional pages)

Rules:
- If a question is conditional on another question's answer AND belongs to a different "section" of the form, it should be on a separate page
- Simple show/hide within a page (e.g. "upload logo" only if "yes I have a logo") stays on the same page using `Dependent On` logic
- Block Builders and their sub-fields are always on the same page as the parent

Present the page structure as a tree:

```
PAGE 1 — Always shown
├── Q1: What is the business name? (Text Input, mandatory)
├── Q2: Upload your logo. (File Upload, mandatory)
├── Q3: What are your brand colors? (Open-Ended, optional)
└── Q4: Do you have brand fonts? (Check One — Yes / No, mandatory)
    └── Q5: Upload your font files. (File Upload — only if Q4 = Yes) [same page, conditional]

PAGE 2 — [condition: only if Q4 = Yes]  ← example of a full page conditional
(or leave on page 1 as a conditional question)
```

For each Block Builder, list the sub-fields with their order:
```
Q8: Add your availability. (Block Builder, mandatory)
  Sub-field 1: Day (Check One — Mon/Tue/Wed/Thu/Fri/Sat/Sun, sort_order 1)
  Sub-field 2: Start Time (Time Picker, sort_order 2)
  Sub-field 3: End Time (Time Picker, sort_order 3)
```

Ask the user to confirm the page structure before moving to Phase 3. This is the most important design decision — get it right before writing any SQL.

### 2c — Assign input types and options

For every `Check One`, `Check Many`, or `Dropdown` question, confirm the exact options with the user. Write them in sentence case.

For every conditional question, confirm:
- Which question it depends on (`Dependent On`)
- Which answer triggers it (`Dependent On Value` — can be multiple values)

---

## Phase 3 · Supabase Audit

**Goal:** Check what's already in the database and identify exactly what needs to be inserted or fixed.

Run this query to see existing questions for the menu item:
```sql
SELECT id, "Question", "Input Type", "Places Asked", "Page", "Mandatory",
       "Placeholder", "Options", "Dependent On", "Dependent On Value",
       "Parent Question", "sort_order"
FROM "Questions Database"
WHERE "Places Asked" @> ARRAY['<menu item name>']
   OR "Parent Question" IS NOT NULL
ORDER BY "Page", "sort_order";
```

Also run this to see all sub-fields (parent questions might belong to this menu item even if already inserted):
```sql
SELECT id, "Question", "Input Type", "Parent Question", "sort_order"
FROM "Questions Database"
WHERE "Parent Question" IS NOT NULL
ORDER BY "Parent Question", "sort_order";
```

### Audit checks — flag any of these:

| Issue | What to do |
|---|---|
| Question exists but has wrong Input Type | Flag for UPDATE |
| Question exists but missing Options | Flag for UPDATE |
| Question exists but Placeholder is blank | Flag for UPDATE |
| Question exists but wrong Page number | Flag for UPDATE |
| Dependent On is set but Dependent On Value is null | Flag for UPDATE |
| Sub-field exists but sort_order is null | Flag for UPDATE |
| Question in agreed structure is missing entirely | Flag for INSERT |
| Question in database is NOT in the agreed structure | Flag as orphan — ask user if it should be deleted or kept |
| Duplicate question text | Flag for resolution |

Present the audit as a two-column summary:
```
✅ Already correct (n questions)
⚠️  Needs update (n questions) — list them
➕  Needs insert (n questions) — list them
❓  Orphan / unexpected (n questions) — list them
```

Ask the user to confirm the plan before executing anything.

---

## Phase 4 · Confirm & Insert

**Goal:** Show the exact SQL, get confirmation, then execute.

### 4a — Resolve UUIDs for Dependent On references

If any question has `Dependent On` set, run a SELECT first to get the UUID:
```sql
SELECT id, "Question" FROM "Questions Database"
WHERE "Question" IN ('<question 1>', '<question 2>');
```

### 4b — Show the full SQL plan

Present every INSERT and UPDATE you're about to run. Group by type:

```
INSERTS (n):
  • "What is the business name?" — Text Input, Page 1, mandatory
  • "Upload your logo." — File Upload, Page 1, mandatory
  ...

UPDATES (n):
  • "Do you have brand fonts?" — adding Options: ['Yes', 'No']
  ...
```

Wait for explicit user confirmation ("go", "confirmed", "do it") before running anything.

### 4c — Execute

Run INSERTs using `ON CONFLICT DO NOTHING` on the `Question` PK.
Run UPDATEs one at a time by UUID.

After all SQL runs, verify with a SELECT:
```sql
SELECT "Question", "Input Type", "Page", "Mandatory", "Options", "sort_order"
FROM "Questions Database"
WHERE "Places Asked" @> ARRAY['<menu item name>']
ORDER BY "Page", "sort_order";
```

Confirm to the user: "All n questions are in the database."

---

## Phase 5 · Front End Verification

**Goal:** Make sure every question type used in this menu item renders correctly in `client-portal.html`.

### 5a — Check the renderer

Read `client-portal.html` and find the `_dformRenderQuestion` function. Check that every Input Type used in this menu item has a `case` in the switch statement.

Valid types that already have renderers (as of Gym Rental build):
- Text Input, Open-Ended, Link Input, Phone Number, E-Mail
- Check One, Check Many, Dropdown
- File Upload
- Time Picker
- Block Builder, Discount Builder
- Staff Selector, Staff Notification Block

**If a new Input Type is being used that doesn't have a renderer**, build it now:
1. Add the CSS to the `/* ── Dynamic form UI ──` section
2. Add the `case` to `_dformRenderQuestion`
3. Add any supporting JS functions (add/remove/update handlers)
4. Verify in the preview

### 5b — Test the flow in the preview

Use the preview server at port 5184. Open the portal and navigate: Build something new → [menu item]. Step through the form. Check:

- [ ] Page 1 loads and shows the right questions
- [ ] Any Check One / Check Many shows all expected options
- [ ] Conditional questions appear/disappear correctly when their trigger answer is selected
- [ ] Page 2 (if exists) appears after the correct answer on page 1
- [ ] Block Builders add/remove rows correctly with sub-fields in the right order
- [ ] File upload zones render as full-width dashed boxes
- [ ] Staff Selector adds/removes rows with Name, Phone, and notification method toggle
- [ ] "Continue →" appears when multiple pages exist; "Submit request →" on the last page
- [ ] Back button appears on pages 2+

Report what you see. If anything looks broken, fix it before marking Phase 5 complete.

### 5c — Branding check per question type

For each question rendered, verify it follows style guide rules:
- Question label: sentence case, Inter 500 15px
- Placeholder: muted text (`--text-mute`), shows as `e.g., ...`
- Note to Client: gold mono, ALL CAPS, small tracking
- Required asterisk: gold, smaller than label
- Options: bordered rows with dot/checkbox, gold border + ghost bg when selected
- Continue/Submit button: solid gold, ink text, mono uppercase

Flag anything that looks off-brand.

---

## Phase 6 · Wrap-up

Summarise what was done:
- How many questions inserted / updated
- Page structure (e.g. "2 pages — page 1 always shown, page 2 for [condition]")
- Any new input type renderers built
- Any branding issues fixed

Then suggest what's next:
- Which menu items are still not set up?
- Are there any open questions about this item's logic that should go into Notion Open Loops?
- Should the style guide be updated with any new input type?

---

## Important rules

- **Never run SQL without explicit user confirmation in Phase 4**
- **Never skip Phase 2 structure design** — the Gym Rental workflow took several iterations to get the page/conditional structure right; that conversation is the whole point
- **Phase 2 is a conversation, not a monologue** — propose, listen, adjust, confirm
- If the user says an input type that doesn't exist in the enum, propose the closest valid one and explain why
- If the user isn't sure about page structure, default to: one page if ≤6 questions and no branching; two pages if there's a major conditional split
- Commit and push `client-portal.html` changes after Phase 5 so the live portal gets updated
