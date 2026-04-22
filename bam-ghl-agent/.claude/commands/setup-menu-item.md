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
Phase 7: Self-update            ✅ / ⬅️ YOU ARE HERE / ⬜
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👉 [What the user needs to do next]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Built-in knowledge — load this before starting

Before Phase 1, load two sources:
1. **Memory doc** — `supabase_questions_db.md` in your persistent memory (`~/.claude/projects/-Users-zoransavic/memory/`). Contains the full schema, all 14 enum values, valid Places Asked strings, insert rules, and useful queries.
2. **Style guide** — canonical path: `/Users/zoransavic/bam-ghl-agent/prototype/docs/style-guide.md` (GitHub: `prototype/docs/style-guide.md` on `main` of `bam-os-requirements`). Read Section 10 specifically (Questions Database Input Guide). This is the ONLY version to read or update — never use a worktree copy as the source of truth.

Both must be read before you start Phase 1. If either is unavailable, flag it. If the style guide is missing Section 10, flag it — Section 10 should exist (added April 2026); the worktree may need a `git pull`.

---

### Supabase
- Project ref: `yoepbpwajszopxzzyzzk`
- Table: `Questions Database`
- Connection: use the Supabase MCP tools (`execute_sql`, `apply_migration`)

### Full schema

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | NO | Auto-generated PK — never set manually |
| `Question` | text | NO | Unique question label — the natural key |
| `Input Type` | input_type_enum | YES | Must be one of the 14 valid values below |
| `Placeholder` | text | YES | Helper text shown in/below the input |
| `Mandatory` | boolean | NO | Defaults to false |
| `Note to Client` | text | YES | Internal context shown in gold mono — ALL CAPS |
| `Places Asked` | text[] | YES | Menu item name(s) exactly — null for sub-fields |
| `Page` | integer | NO | 1 = always shown, 2+ = conditional page |
| `Options` | text[] | YES | For Check One / Check Many / Dropdown |
| `Dependent On` | uuid | YES | FK → `id` of the controlling question |
| `Dependent On Value` | text[] | YES | Trigger values that make this question visible |
| `Parent Question` | uuid | YES | FK → `id` of Block/Discount Builder parent |
| `sort_order` | integer | YES | Display order — sub-fields must have this set |

### Valid Input Types (exact enum values — use these strings exactly)

| Value | Use when | Renders as |
|---|---|---|
| `Text Input` | Short single-line free text | Hairline bottom-border text field |
| `Open-Ended` | Longer free-form answer | Multi-line textarea |
| `Link Input` | URL or Google Drive link | Text field, url type |
| `Phone Number` | Phone number | Text field, tel type |
| `E-Mail` | Email address | Text field, email type |
| `Check One` | Pick exactly one option | Bordered radio rows |
| `Check Many` | Pick multiple options | Bordered checkbox rows |
| `Dropdown` | One from a long list | Bordered radio rows (same render as Check One) |
| `File Upload` | Documents, images, agreements | Dashed-border click zone |
| `Time Picker` | Specific time (hour/minute) | Native time input |
| `Block Builder` | Repeating rows with sub-fields (e.g. time blocks) | Add/remove rows |
| `Discount Builder` | Repeating quantity + discount tiers | Add/remove rows (Quantity + Discount columns) |
| `Staff Selector` | Staff member with notification method | Add/remove rows (Name + Phone + Text/In-App) |
| `Staff Notification Block` | Informational only, no input | Gold-tinted info banner |

All 14 types have renderers in `client-portal.html`. If the user needs a 15th type, you will need to build it in Phase 5.

### Valid menu item names (exact strings for `Places Asked`)

```
Gym Rental · Branding · Player Intake · New Hire · Youth Academy
Internal Tournament · Sponsor Inquiry · Camps / Clinics · Upsells
```

Sub-fields (rows with `Parent Question` set) do NOT get `Places Asked`.

### Key branding rules (from style-guide.md section 10)

**Question label (`Question` column)**
- Sentence case. Never all-caps.
- Ends with `?` for questions, `.` for instructions (`Add your time blocks.`)
- ≤12 words. If longer, split.
- Direct. `What is the cost per block?` not `Please provide the cost information for each rental block`

**Placeholder**
- `e.g., 1 hour, 30 minutes` for examples
- Short instruction for guidance: `Include street, city, state, ZIP`
- Never restates the question. Never says "Type your answer here."

**Note to Client**
- Internal context — what the system does with this answer. No ALL CAPS required.
- Not customer-facing — that's Placeholder's job.

**Options (for Check One / Check Many / Dropdown)**
- Sentence case. 1–4 words. No trailing punctuation.
- `Short term` `Long term` `Both` — not `Short-term rental` `Long-term rental` `Both options`

**Multi-page rules**
- Page 1 = always shown. Page 2+ = conditional AND has `Dependent On` + `Dependent On Value` set.
- Never put a major conditional section on the same page as its trigger — use a separate page.
- Simple show/hide (e.g. a follow-up to one answer) can stay on the same page using `Dependent On`.

**Sub-field rules**
- `sort_order` must be set. Left-to-right column order = ascending sort_order.
- `Parent Question` = UUID of the Block Builder / Discount Builder parent row.
- No `Places Asked` on sub-fields — they inherit through their parent.

---

## Phase 1 · Discovery

The specific questions to collect are already in the database and will be workshopped in Phase 2. Branching paths and conditional logic are also Phase 2 territory — they only become clear once the question structure is visible.

Phase 1 has one job: understand the north star purpose of this menu item.

Ask the user (one question only):
- What is this menu item for — what does the operator walk away able to build after submitting?

If the purpose is already obvious from the menu item name and context, state your understanding and move straight to Phase 2 without asking. Do NOT ask about branching, specific fields, or data collected.

---

## Phase 2 · Structure Design

### 2a — Draft the question list

Propose a candidate list of questions based on Phase 1 and the existing DB. For each:
- Draft question text (sentence case, ≤12 words)
- Suggested Input Type (from the 14 valid values)
- Mandatory or optional
- Topic area

Also identify any branching paths at this stage — if any question answer should open up a different section (e.g. "Are there brackets? → Yes → describe each bracket"), flag it here and design the conditional logic in 2b/2c.

Present as a flat numbered list. Example:
```
1. What is the business name? (Text Input, mandatory)
2. Upload your logo. (File Upload, mandatory)
3. What are your brand colors? (Open-Ended, optional)
4. Do you have brand fonts? (Check One — Yes / No, mandatory)
5. Upload your font files. (File Upload, optional — only if Q4 = Yes)
```

Ask: "Does this cover everything? Anything missing, wrong, or to remove?"

Iterate until the list is agreed.

### 2b — Design the page structure

Organize into pages and present as a tree:

```
PAGE 1 — Always shown
├── Q1: What is the business name? (Text Input, mandatory)
├── Q2: Upload your logo. (File Upload, mandatory)
└── Q4: Do you have brand fonts? (Check One — Yes / No, mandatory)
    └── Q5: Upload font files. (File Upload — only if Q4 = Yes) [same-page conditional]

PAGE 2 — Only shown if [condition]
└── Q6: ...
```

For Block Builders, show sub-fields:
```
Q8: Add your availability. (Block Builder, mandatory)
  Sub-field 1: Day (Check One — Mon/Tue/Wed/Thu/Fri/Sat/Sun, sort_order 1)
  Sub-field 2: Start Time (Time Picker, sort_order 2)
  Sub-field 3: End Time (Time Picker, sort_order 3)
```

**Confirm the page structure before touching the database.** This is the most critical design step.

### 2c — Lock in options and conditionals

For every `Check One`, `Check Many`, or `Dropdown`: confirm exact options (sentence case, 1–4 words).

For every conditional question: confirm which question it depends on and which answer(s) trigger it.

---

## Phase 3 · Supabase Audit

Fetch existing questions for this menu item:
```sql
SELECT id, "Question", "Input Type", "Page", "Mandatory", "Placeholder",
       "Options", "Dependent On", "Dependent On Value", "Parent Question", "sort_order"
FROM "Questions Database"
WHERE "Places Asked" @> ARRAY['<menu item>']
ORDER BY "Page", "sort_order";
```

Also fetch any existing sub-fields whose parent might belong to this menu item:
```sql
SELECT id, "Question", "Input Type", "Parent Question", "sort_order"
FROM "Questions Database"
WHERE "Parent Question" IS NOT NULL
ORDER BY "Parent Question", "sort_order";
```

### Structural improvement check (run first)

Before auditing this menu item's questions, run a global check for structural issues across the whole database:

```sql
SELECT unnest("Places Asked") AS place, COUNT(*) AS n
FROM "Questions Database"
WHERE "Places Asked" IS NOT NULL
GROUP BY place ORDER BY place;
```

Valid Places Asked values: `Gym Rental`, `Branding`, `Player Intake`, `New Hire`, `Youth Academy`, `Internal Tournament`, `Sponsor Inquiry`, `Camps / Clinics`, `Upsells`

Flag any values that don't match exactly (wrong casing, typos, deprecated names). Present these to the user **before** the per-item audit with a clear note: "⚠️ Structural issue found across the database — these Places Asked values don't match any portal menu item: [list]. Want to fix these now or track them as an open loop?"

Also flag:
- **Questions shared across multiple `Places Asked` values** — this is always a structural problem. `sort_order` is a global field, so a shared question's position cannot be controlled independently per menu item. The rule is: one question per menu item, no sharing. When a shared question is found, the fix is always to split it — remove the current menu item from `Places Asked` and insert a new menu-item-specific row with the correct sort_order. Never leave a shared question in place.
- Orphaned sub-fields (Parent Question set but parent no longer exists)
- Any Input Type value not in the valid 14-value enum

Run this query at the start of every Phase 3 to surface all shared questions globally:
```sql
SELECT "Question", "Places Asked", array_length("Places Asked", 1) as shared_count
FROM "Questions Database"
WHERE array_length("Places Asked", 1) > 1
ORDER BY shared_count DESC;
```

### Audit checklist

Flag each issue:

| Issue | Action |
|---|---|
| Question exists, wrong Input Type | UPDATE |
| Question exists, missing Options | UPDATE |
| Question exists, blank Placeholder when one is needed | UPDATE |
| Question exists, wrong Page | UPDATE |
| `Dependent On` set but `Dependent On Value` is null | UPDATE |
| Sub-field with null sort_order | UPDATE |
| Question in agreed structure but missing from DB | INSERT |
| Question in DB but not in agreed structure | Flag as orphan — ask user |
| Duplicate Question text | Flag for resolution |
| Question shared across multiple Places Asked but wording should differ | Flag for splitting |

Present summary:
```
✅ Already correct — n questions
⚠️  Needs update — n questions: [list]
➕  Needs insert — n questions: [list]
❓  Orphan / unexpected — n questions: [list]
```

Confirm the plan with the user before Phase 4.

---

## Phase 4 · Confirm & Insert

### 4a — Resolve UUIDs

Any `Dependent On` or `Parent Question` that references another question by name: resolve its UUID first.
```sql
SELECT id, "Question" FROM "Questions Database"
WHERE "Question" IN ('<q1>', '<q2>');
```

### 4b — Show the full SQL plan

List every INSERT and UPDATE clearly. Then ask: "Does this look right? Say go when ready."

**Do not run any SQL until the user explicitly confirms.**

### 4c — Execute

INSERTs: use `ON CONFLICT ("Question") DO NOTHING` — or `ON CONFLICT DO NOTHING` if `Question` is the natural key.
UPDATEs: target by `id` (UUID), not by Question text.

Verify after:
```sql
SELECT "Question", "Input Type", "Page", "Mandatory", "Options", "sort_order"
FROM "Questions Database"
WHERE "Places Asked" @> ARRAY['<menu item>']
ORDER BY "Page", "sort_order";
```

Confirm: "All n questions are in the database."

---

## Phase 5 · Front End Verification

### 5a — Check renderer coverage

Read `client-portal.html` and find `_dformRenderQuestion`. Confirm every Input Type used in this menu item has a `case` in the switch statement.

All 14 built-in types are already handled. If a new type is needed:
1. Add CSS to the `/* ── Dynamic form UI ──` block
2. Add the `case` to `_dformRenderQuestion`
3. Add supporting JS functions (add/remove/update handlers)
4. Test in preview

### 5b — Test in the preview

Navigate: Build something new → [menu item]. Step through:

- [ ] Page 1 shows correct questions in the right order
- [ ] Check One / Check Many shows all expected options
- [ ] Conditional questions appear/disappear when triggered
- [ ] Page 2 appears after the correct answer (Continue → button appears)
- [ ] Block Builder sub-fields show in the right column order
- [ ] File upload zones are full-width dashed boxes
- [ ] Back button appears on pages 2+
- [ ] Submit request → appears on the last page

Fix anything broken before marking Phase 5 complete.

### 5c — Branding spot-check

- Question label: sentence case, Inter 500 15px, white
- Placeholder: muted (`--text-mute`), `e.g., ...` format
- Note to Client: gold mono, small tracking
- Required asterisk: gold, smaller than label
- Selected option: gold border + ghost background
- Continue/Submit: solid gold, ink text, JetBrains Mono uppercase

Commit and push `client-portal.html` after Phase 5 so the live portal updates.

### 5d — Database improvement review

After verifying the front end, look at the full question set with fresh eyes and flag any opportunities to improve the database:

- **Missing Placeholders** — any Text Input or Open-Ended without a Placeholder that would benefit from one?
- **Mandatory vs optional** — is anything mandatory that shouldn't block submission, or optional that should be required?
- **Note to Client gaps** — any question where the operator might not understand what the system does with their answer?
- **Options quality** — for Check One / Check Many, are the options clear, mutually exclusive, and complete?
- **Sort order gaps** — are sort_orders sequential and logical now that the form is visible end-to-end?
- **Wording** — now that you've seen the form render, does any question label read awkwardly or need tightening?
- **Open-Ended catch-all questions** — look for vague "anything else?" or "list your fields" Open-Ended questions. These are opportunities to replace with a structured Check Many with an "Add another field" option (same pattern as Player Intake Q2 and Youth Academy Q12). The Check Many + Add another field pattern gives the AI agent structured data to work with and is always preferable to freeform catch-alls.

Present a short improvement list. Ask the user which ones to action before moving to Phase 6.

---

## Phase 6 · Wrap-up

Summarize:
- Questions inserted / updated
- Page structure used
- Any new input type renderers built
- Branding issues fixed

Then suggest:
- Which menu items are still unset up?
- Any unresolved logic that should go into Notion Open Loops?
- Does the style guide need updating for any new input type?

---

## Phase 7 · Self-update

After every session, update the skill itself and all knowledge sources it pulls from. This keeps the skill sharp for the next run.

### 7a — Update this skill file

Review the session for anything that should be baked into future runs:

- **New input type discovered or clarified?** Add it to the input types table and renderer checklist in Phase 5.
- **New question-writing rule learned?** Add it to the branding rules section.
- **Phase instructions were unclear or caused a bad question from the user?** Rewrite that phase's instructions.
- **A new valid `Places Asked` value was added to the portal?** Add it to the valid menu item names list.
- **Hard rule learned the hard way?** Add it to the Hard rules section at the bottom.

Edit: `/Users/zoransavic/bam-ghl-agent/.claude/commands/setup-menu-item.md`

### 7b — Update the style guide (Section 10)

If any new input types, writing rules, or structural patterns came out of this session, add them to Section 10 of the canonical style guide.

Edit: `prototype/docs/style-guide.md` in the worktree, then commit and push to `main` on `bam-os-requirements`.

### 7c — Update the memory doc

If the session revealed new schema details, new valid enum values, new `Places Asked` strings, or corrected any existing info in the memory doc — update it.

Edit: `~/.claude/projects/-Users-zoransavic/memory/supabase_questions_db.md`
Update the index: `~/.claude/projects/-Users-zoransavic/memory/MEMORY.md` if a new memory file was created.

### 7d — Commit everything

After all updates:
1. Commit `setup-menu-item.md` and any other `.claude/commands/` changes to `main`
2. Commit `prototype/docs/style-guide.md` to `main` if updated
3. Push both to `origin main`

Confirm: "Phase 7 complete — skill, style guide, and memory updated."

---

## Hard rules

- Never run SQL without explicit user confirmation in Phase 4
- Never skip Phase 2 — the structure conversation is the whole point
- Phase 2 is a conversation, not a monologue — propose, listen, adjust, confirm
- If the user proposes an Input Type not in the enum, flag it and suggest the closest valid one
- If ≤6 questions and no branching: single page. If major conditional split: two pages.
- Always commit and push after Phase 5
- Always run Phase 7 at the end of every session — never skip it
- Question text must be unique across the entire DB (it's the natural key). When splitting a shared question into a menu-item-specific row, always use menu-item-specific wording (e.g. "How do you want the youth academy sales system to go?" not "How do you want the sales system to go?"). Never rely on ON CONFLICT DO NOTHING to silently skip an insert — if it conflicts, the row didn't land.
