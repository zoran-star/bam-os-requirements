-- THE THREE STEP ROWS THAT HAND-TYPED THE BRAND NAME NOW MERGE IT.
--
-- ⚠️ NOT APPLIED YET. Ledger row is in supabase/PENDING_SQL.md. Read "WHAT THIS
-- CHANGES IN A PARENT'S INBOX" at the bottom before applying: this one is visible.
--
-- WHAT THIS FINISHES
-- 20260729T235000 moved BAM GTA's email identity onto its own clients row, and its
-- public_name became "By Any Means Toronto". Three of GTA's automation_steps rows did
-- not follow, because the name is TYPED INTO THE ROW rather than merged from the
-- clients row at send time. So since that migration went live GTA has been sending
-- messages whose shell says "By Any Means Toronto" while the copy inside says
-- "By Any Means Basketball". Onboarding step 2 is the worst of the three: its email
-- BODY header reads TORONTO while its SUBJECT LINE says Basketball, in the same
-- message, in the same inbox.
--
-- That disagreement was recorded rather than fixed at the time (section 9 of
-- api/_email-identity-from-the-row.test.mjs) because editing live copy is an
-- owner-visible change and needed Zoran's call. He asked for it on 2026-07-30.
--
--   automation       position  channel  where the name was typed
--   ---------------  --------  -------  -----------------------------------------
--   onboarding       1         sms      body, "welcome to ...!"
--   onboarding       2         email    SUBJECT, "Welcome to ... 🏀"
--   summer_special   0         sms      body, "It's coach from ... - we're just"
--
-- ALL DATA. No column is added, renamed or dropped, and no other academy's rows are
-- touched. A read-only cross-join of every automation_steps row against every
-- clients.business_name and clients.public_name (2026-07-30) found these three and
-- no others - see "WHAT WAS CHECKED AND LEFT ALONE" at the bottom.
--
-- WHY {{location.name}} AND NOT {{ACADEMY_FULL}}
-- Two different substitution layers. {{ACADEMY_FULL}} is a TEMPLATE token, filled by
-- renderEmail() inside the HTML shell. {{location.name}} is the MESSAGE-COPY token,
-- filled by resolveMergeVars() in api/email-shells.js, and it is the one that reaches
-- a step's stored body and subject. Both resolve from the same public_name, so they
-- cannot disagree; only {{location.name}} works here.
--
-- The SUBJECT path was verified before this file was written, not assumed. Subjects
-- are merged: renderStepMessage() in api/email-shells.js resolves the subject through
-- resolveMergeVars() and api/_send.js sendOn() sends that resolved string, so
-- "Welcome to {{location.name}} 🏀" renders "Welcome to By Any Means Toronto 🏀".
-- A subject is NOT a body and does not have to behave like one, which is why it was
-- checked separately: a raw {{location.name}} in a parent's inbox would be worse than
-- a stale name.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE GUARD, AND WHAT IT IS FOR
-- ─────────────────────────────────────────────────────────────────────────────
-- Each update is matched on md5() OF THE EXACT CURRENT FIELD VALUE, captured from
-- production on 2026-07-30. Two properties come out of that, both of them the point:
--
--   A RE-RUN IS INERT. After the first apply the value has changed, so the hash no
--   longer matches and the statement updates zero rows. Applying this file twice is
--   the same as applying it once.
--
--   A LATER OWNER EDIT SURVIVES. These are live messages an academy owner can edit
--   in the Sales step editor. If anyone has touched one of these fields - even by a
--   character, even somewhere unrelated in the same body - the hash misses and that
--   row is left exactly as they wrote it. The failure mode is a stale name, never
--   somebody's edit silently reverted.
--
-- A hash rather than the literal text spelled out again, because these bodies are up
-- to 826 characters with newlines, apostrophes and URLs in them, and a migration that
-- re-types live copy in order to compare against it can introduce the very drift it
-- is trying to prevent. The hashes were computed BY production over its own values.
--
-- The replace() is safe to scope this way because each field contains the phrase
-- exactly ONCE (counted in the same query that produced the hashes), so there is no
-- second occurrence to catch or miss.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. onboarding step 1 - the welcome SMS
-- ─────────────────────────────────────────────────────────────────────────────
-- "Hi {{contact.first_name}} welcome to By Any Means Basketball! A couple things..."
-- The first message a paying member receives. It already merges the parent's first
-- name one word earlier, so the academy's name is the odd one out in its own sentence.
update public.automation_steps s
   set body = replace(s.body, 'By Any Means Basketball', '{{location.name}}')
  from public.automations a
 where a.id = s.automation_id
   and a.client_id = '39875f07-0a4b-4429-a201-2249bc1f24df'
   and a.automation_key = 'onboarding'
   and s.position = 1
   and md5(s.body) = 'aecafcaea20c632f2067b73ee1c40a10';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. onboarding step 2 - the welcome EMAIL's subject line
-- ─────────────────────────────────────────────────────────────────────────────
-- "Welcome to By Any Means Basketball 🏀". The body is 'template:onboarding-welcome',
-- whose shell already renders "By Any Means Toronto" from the row - so this subject is
-- the single line making one message call the academy two different things. The emoji
-- is part of the stored value and is preserved: only the name is replaced.
update public.automation_steps s
   set subject = replace(s.subject, 'By Any Means Basketball', '{{location.name}}')
  from public.automations a
 where a.id = s.automation_id
   and a.client_id = '39875f07-0a4b-4429-a201-2249bc1f24df'
   and a.automation_key = 'onboarding'
   and s.position = 2
   and md5(coalesce(s.subject, '')) = 'c7d1240de486110f3c1ac5500b1dc4f9';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. summer_special step 0 - the promo SMS
-- ─────────────────────────────────────────────────────────────────────────────
-- "Hi! It's coach from By Any Means Basketball - we're just sending out this message
-- to everyone...". A broadcast to the whole list, so it is the one with the widest
-- reach of the three.
update public.automation_steps s
   set body = replace(s.body, 'By Any Means Basketball', '{{location.name}}')
  from public.automations a
 where a.id = s.automation_id
   and a.client_id = '39875f07-0a4b-4429-a201-2249bc1f24df'
   and a.automation_key = 'summer_special'
   and s.position = 0
   and md5(s.body) = '429bafd0844f4d3f2d82291f521f1fdb';

-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS CHANGES IN A PARENT'S INBOX
-- ─────────────────────────────────────────────────────────────────────────────
-- Three lines, one word each, all of them a name correction:
--
--   1. onboarding SMS:      "welcome to By Any Means Basketball!"
--                        -> "welcome to By Any Means Toronto!"
--   2. onboarding subject:  "Welcome to By Any Means Basketball 🏀"
--                        -> "Welcome to By Any Means Toronto 🏀"
--   3. summer_special SMS:  "It's coach from By Any Means Basketball - we're just"
--                        -> "It's coach from By Any Means Toronto - we're just"
--
-- Nothing else in any of the three messages moves: no link, no phone number, no
-- WhatsApp invite, no emoji. api/__goldens__/bam-gta-steps (27 steps) was re-taken and
-- the BEFORE/AFTER was read line by line, not re-captured on faith - exactly three
-- lines in three files changed.
--
-- WHY IT WILL NOW FOLLOW THE ROW. After this, renaming the academy in Business Basics
-- moves all three messages with it, because none of them stores the name any more.
-- That is the actual repair; the three corrected strings are just today's output of it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT WAS CHECKED AND LEFT ALONE
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) EVERY academy, not just GTA. Every automation_steps row's subject and body was
--    matched against every clients.business_name and clients.public_name of 5+
--    characters. Exactly these three rows came back. No other academy hand-types its
--    own name into a step, so this migration is correctly GTA-only.
-- 2) onboarding step 5's subject, "Where By Any Means came from", is DELIBERATELY NOT
--    TOUCHED. That is the bare brand family, not the academy - the email is the brand
--    origin story (founder, the YouTube channel, the global camps). Tokenising it would
--    produce "Where By Any Means Toronto came from", which is a different and false
--    claim: Toronto is not where By Any Means came from.
-- 3) No other academy's rows are seeded or normalised. An academy with no public_name
--    falls back to its internal business_name, and that fallback is deliberate - see
--    api/_email-identity-from-the-row.test.mjs section 4.
--
-- AFTER APPLYING, section 9 of api/_email-identity-from-the-row.test.mjs is what proves
-- it landed: it asserted the three rows still hand-typed the name, and it has been
-- rewritten in the same commit to assert the opposite - that they now merge it, and
-- that a rename of the row moves all three. It was written to fail when somebody
-- templated them, which is exactly what happened.
