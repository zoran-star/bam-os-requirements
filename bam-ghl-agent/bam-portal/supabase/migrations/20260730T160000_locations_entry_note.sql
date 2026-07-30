-- locations.entry_note - how a family gets IN the door, owned by the VENUE.
--
-- WHY. The morning-of trial confirmation ended with this hardcoded sentence in
-- api/agent/confirm-automations.js:
--
--     "F.Y.I the gym entrance we use is at the front of the building, on the
--      left side."
--
-- That is one literal inside a SHARED automation, so EVERY academy's parents were
-- told, on the morning of their trial, about a door at a building in Oakville they
-- have never been to. It fires on the money path: any academy with a booked trial.
--
-- The sharp part is the line above it. "Location: {{appointment.meeting_location}}"
-- DROPS OUT when the token resolves empty, and the door sentence had no such rule,
-- so an academy with no address on file sent a parent nothing at all about where to
-- go and then one confident sentence about somebody else's entrance.
--
-- Even for BAM GTA the literal is wrong at the academy level: GTA runs TWO venues
-- (Linbrook and Mildred's, both on Linbrook Rd). One of those doors is the one the
-- sentence describes. This column puts the fact where it is true: on the venue.
--
-- WHY NOT locations.notes. notes is already spoken for as the AGENT's general venue
-- note - api/agent/fact-render.js renders it as a parenthetical on the business_info
-- "Location:" line the sales agent reads on every reply. Different audience (a parent
-- walking up on the day vs the agent quoting facts mid-conversation), different fact,
-- and overloading it would push entry directions into sales prose. Several academies
-- also already use notes for something else entirely: BAM San Jose stores CLASS TIMES
-- in it, so a repurpose would have texted parents a schedule as if it were a door.
--
-- EMPTY IS A REAL STATE. Nullable on purpose. No note means no sentence at all - not
-- a blank line, not a dangling lead-in. Enforced in code by the DROP_WHEN_EMPTY rule
-- in api/agent/confirm-automations.js.

ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS entry_note text;

COMMENT ON COLUMN public.locations.entry_note IS
  'Parent-facing entry directions for THIS venue, sent in the morning-of trial confirmation. NULL means the academy has not written one, and no sentence is sent.';

-- Seed the ONE venue the retired literal actually described: BAM GTA's Linbrook
-- gym, 1079 Linbrook Rd. GTA's training offer points its primary location at this
-- row, so this is the venue a GTA free trial is booked into.
--
-- Everything else stays NULL on purpose, including GTA's second venue (Mildred's,
-- 1080 Linbrook Rd) and both of BAM San Jose's venues. San Jose has no entry note
-- on file, has never had one, and must render nothing until its owner writes one.
--
-- RE-RUN SAFE. Guarded on entry_note IS NULL, so an owner edit made after this runs
-- survives a replay untouched. Matched on the academy name plus the street address
-- rather than a hardcoded uuid, so it degrades to touching nothing rather than
-- writing the sentence onto the wrong row in a database where the ids differ.
UPDATE public.locations AS l
   SET entry_note = 'The gym entrance we use is at the front of the building, on the left side.'
  FROM public.clients AS c
 WHERE c.id = l.client_id
   AND c.business_name = 'BAM GTA'
   AND l.address ILIKE '1079 Linbrook Rd%'
   AND l.entry_note IS NULL;
