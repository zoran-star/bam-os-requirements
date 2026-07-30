-- THE LAST FOUR PINNED FIELDS, ANSWERED WITH DATA INSTEAD OF A HARDCODE.
--
-- ⚠️ NOT APPLIED YET. Ledger row is in supabase/PENDING_SQL.md. Read "WHAT THIS
-- CHANGES IN A PARENT'S INBOX" at the bottom before applying: this one is visible.
--
-- WHAT THIS FINISHES
-- api/email-shells.js carried a LOCATIONS map keyed by client id with exactly ONE
-- entry, BAM GTA's, pinning its email identity. It was the last academy-specific
-- literal in the email layer. Every other academy already derived its identity from
-- its own clients row via locFromVars().
--
-- Six fields blocked deleting that entry. Two of them (tagline, instagram) became
-- columns in 20260729T230000. The other FOUR all trace to one cause:
--
--   suffix       the gold wordmark word. Derived by stripping the "By Any Means" /
--                "BAM " prefix off public_name. GTA's public_name was
--                "By Any Means Basketball", so the derived word was BASKETBALL.
--   full         the parent-facing name, {{ACADEMY_FULL}} + {{DOC_TITLE}}. Also
--                public_name. Pinned "By Any Means Toronto".
--   locationTag  the small line beside the wordmark. Derived as the uppercased city.
--                Pinned "OAKVILLE &middot; GTA", hand-composed.
--   city         cityFromAddress() returned "" for GTA's stored address
--                "2205 Rosemount Cres", which has no city in it.
--
-- suffix and full BOTH derive from public_name. Keeping today's look exactly - the
-- wordmark reading "GTA" while the full name reads "By Any Means Toronto" - would
-- need a pinned suffix column: a per-academy override, which is the hardcode again
-- wearing a database column. Zoran's ruling (2026-07-29): ONE field drives
-- everything, no overrides. So public_name becomes "By Any Means Toronto", the
-- wordmark reads TORONTO, and the location tag becomes the plain derived city.
--
-- ALL ADDITIVE, all data. No column is added, renamed or dropped: public_name and
-- address already exist in production (verified 2026-07-29 by read-only select).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. BAM GTA's parent-facing name
-- ─────────────────────────────────────────────────────────────────────────────
-- One field, two outputs: the full name parents read AND the gold wordmark word.
-- "By Any Means Toronto" is the string the LOCATIONS entry pinned as `full`, so the
-- full name a parent reads does not change at all - only the wordmark and the tag,
-- which is the visible cost Zoran accepted.
--
-- GUARDED ON THE CURRENT VALUE, not just the id, so a re-run cannot clobber a later
-- edit. If an owner has since typed a different public_name in Business Basics, this
-- matches nothing and does nothing rather than overwriting them.
update public.clients
   set public_name = 'By Any Means Toronto'
 where id = '39875f07-0a4b-4429-a201-2249bc1f24df'
   and public_name = 'By Any Means Basketball';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BAM GTA's address, so the city can be parsed out of it
-- ─────────────────────────────────────────────────────────────────────────────
-- cityFromAddress() in api/email-shells.js takes the comma part BEFORE the province
-- and rejects any candidate containing a digit (street lines and postal codes). The
-- stored "2205 Rosemount Cres" is one part, so it yields "" and GTA's four
-- city-carrying templates rendered no city at all - the pinned "Oakville" covered
-- for it. The city, province form parses:
--
--   '2205 Rosemount Cres'                -> ''         (one part, no city)
--   '2205 Rosemount Cres, Oakville, ON'  -> 'Oakville'  (verified by calling the
--                                                        real function, not assumed)
--
-- NO POSTAL CODE. None is on file anywhere in the repo and inventing one would be
-- putting a made-up fact in a production row. The province is enough: the parser
-- only needs a trailing part after the city.
--
-- THIS IS STILL THE REGISTERED BUSINESS ADDRESS, NOT THE GYM. Members train at 1079
-- Linbrook Rd; that venue lives on the schedule slot (api/_academy-facts.js) and is
-- deliberately a separate fact. Adding the city here does not make this column
-- parent-facing as an address - only as a city name.
--
-- Same guard as above: matched on the exact current value, so a re-run is inert and
-- an owner's later edit survives.
update public.clients
   set address = '2205 Rosemount Cres, Oakville, ON'
 where id = '39875f07-0a4b-4429-a201-2249bc1f24df'
   and address = '2205 Rosemount Cres';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BAM San Jose's parent-facing name - the SAME bug, not a GTA one
-- ─────────────────────────────────────────────────────────────────────────────
-- San Jose's public_name is the identical string, "By Any Means Basketball", so the
-- moment the pin is gone its emails would carry the gold wordmark BY ANY MEANS
-- BASKETBALL. It has no pinned entry and never did, so this was never GTA-specific:
-- it is what every academy that leaves public_name as the bare brand gets.
--
-- San Jose is not live yet (see memories/project_san_jose_launch_blockers.md), so
-- this is fixed before a parent ever sees it rather than after.
--
-- Its address already parses ('1051 W San Fernando St, San Jose, CA 95126' ->
-- 'San Jose'), so it needs nothing else.
update public.clients
   set public_name = 'By Any Means San Jose'
 where id = '5576acf0-acd3-4c05-9f9f-ebfde8618154'
   and public_name = 'By Any Means Basketball';

-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS CHANGES IN A PARENT'S INBOX
-- ─────────────────────────────────────────────────────────────────────────────
-- The code half deletes the LOCATIONS map outright, so from that commit GTA renders
-- from its row like everyone else. Applied together, BAM GTA's emails change in
-- exactly three visible ways and nothing else:
--
--   1. the gold wordmark word:        GTA        -> TORONTO
--   2. the line beside the wordmark:  OAKVILLE - GTA -> OAKVILLE
--   3. the <title> and footer reason sentence now read "By Any Means Toronto"
--      wherever the templates previously said nothing or said less
--
-- api/__goldens__/bam-gta (10 templates) and api/__goldens__/bam-gta-steps (27 steps)
-- were re-taken for exactly these, and the BEFORE/AFTER was read line by line rather
-- than re-captured on faith.
--
-- ORDER: this file is independent of 20260729T210000 and 20260729T230000 - it touches
-- no function and adds no column, so it cannot be dropped by either replaying its own
-- update_client_basics. Apply it in filename order like anything else.
--
-- DELIBERATELY NOT HERE
-- 1) No `suffix` / `location_tag` override column. That was the whole point: a pinned
--    per-academy string in a column is the hardcode with extra steps. If a future
--    academy genuinely needs a wordmark word that is not its name, that is a product
--    decision about naming, not a column.
-- 2) Nothing seeds any other academy's public_name. An academy that has not filled it
--    in falls back to business_name, which is the internal label - visible in
--    api/_email-identity-from-the-row.test.mjs and deliberately left alone here,
--    because guessing a parent-facing name for an academy nobody has asked is worse
--    than the fallback.
