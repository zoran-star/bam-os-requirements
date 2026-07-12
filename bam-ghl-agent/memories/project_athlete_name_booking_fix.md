# Athlete name required - booking 400 fix

**2026-07-12** - Booking a lead from the Hawkeye Book-it card threw
`book: Supabase 400 {P0001 ... "Athlete name is required."}` (e.g. Tara, BAM GTA).
The `book_trial_slot` RPC hard-requires an athlete name.

## Root cause (narrower than first assumed)
The GTA free-trial form (`bam-client-sites` `clients/bam-gta/gta/freetrial.jsx`) **already
collects** the player name and sends `fields.athlete`. `leads.js:544` already reads it for
the direct-booking RPC. The gap: `portalNativeContact` in `leads.js` never wrote
`athlete_name` onto the **contacts** row, so `contacts.athlete_name` stayed null - and the
agent Book-it path (`bookPortalTrial`) reads exactly that column. So the name was on the
form the whole time, just never persisted where booking looks.

## Fix shipped (3 backend + 1 UI, no schema change)
1. `bam-portal/api/website/leads.js` `portalNativeContact` - derive `athlete_name` from
   `fields.athlete_name || fields.athlete || first+last` and pass it into
   `resolveOrMintPortalContact` so it lands on the contact row.
2. `bam-portal/api/agent/booking.js` `bookPortalTrial({..., athleteName})` - resolve name as
   passed value -> `contacts.athlete_name`; if STILL empty throw a clean human message
   ("Enter the athlete's name to book this trial") instead of raw P0001. On success,
   backfill `contacts.athlete_name` (best-effort) so it's saved for next time.
3. `bam-portal/api/agent-approvals.js` confirm-book - pass the card's `athlete_name` through.
4. `bam-portal/public/client-portal.html` Book-it card (`_hk2CardHtml` k==='book') - editable
   **Athlete** text input (id `hk2-athlete-in`), pre-filled from `r.athlete_name` (the deck
   already resolves it via `deck-names`, line ~32864). `_hk2Confirm` captures it, blocks an
   empty book client-side, and includes `athlete_name` in the confirm-book POST. When no name
   came through, an inline hint shows under the fields.

## Not touched / notes
- Secondary `_apxBookCard` "approve & book" surface has no editable field; it now surfaces the
  clean 400 instead of raw P0001 but can't fix inline (out of scope). Zoran can request a field
  there if that surface matters.
- Scope chosen by Zoran: tight fix + card field. NOT the full handoff plan (no `book_athlete_name`
  DB column, no agent-captures-name-in-chat tool-schema change).
- BAM GTA is a portal-provider academy (`booking_provider='portal'`), so it hits `bookPortalTrial`.
- Handoff doc: `docs/athlete-name-fix-handoff.md`. See [[project_website_leads]] +
  [[project_hawkeye_mission_control]].
