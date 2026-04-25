---
name: BAM Onboarding Checkpoints (current sheet version)
description: The 14-step onboarding checklist BAM is currently using in the Google Sheet — to be redefined and migrated to Supabase later
type: project
originSessionId: 8ad1de9a-293d-4f2c-8592-9ea7741d04d6
---
These are the 14 onboarding checkpoints currently tracked in the **Google Sheet "Onboarding Tracker" → CLIENT TRACKER tab** (sheet ID `1qajlcDA4yGOMWGQAQ6jjujMNfgZmiKFCKchOmVEtzyw`). Will be redefined and rebuilt natively in Supabase later — for now, kept here as the working reference so we don't lose them when the sheet goes away.

**5 stages, 14 checkpoints:**

1. **Sales Handover** (3)
   - Contract
   - Asana Created
   - Software Setup

2. **SM Intro** (1)
   - SM Intro Call

3. **Systems** (6)
   - Systems Intro Call
   - Phone Number
   - Domain Added
   - Initial Systems Draft
   - Final Systems Draft
   - Additional Systems

4. **Content** (1)
   - Content Plan Reviewed

5. **Paid Ads** (3)
   - Initial Ads Draft
   - Final Ads Draft
   - Ads Running

**Other client-level fields tracked in the same sheet row:**
- Location (client name)
- Manager (Mike, Silva, Graham, Zoran, etc.)
- Start Date
- Renewal Date
- Onboarding Status (Done / In Progress)
- Overall Progress (calculated %)

**Auto-derived alerts (currently in /api/sheets/onboarding.js):**
- "SM intro call not booked" → Sales Handover done but SM Intro not done
- "No systems work started" → SM Intro done but no systems checks complete
- "Systems final draft overdue" → Initial draft done but Final not done
- "No checkpoints completed" → all 14 false
- "Ads not yet running" → Final Ads Draft done but Ads Running not done

**Why this lives here:** Zoran wants the onboarding flow redefined as part of the broader portal rebuild — these 14 are the *baseline* to design from, not the final list. When the redesign starts, pull this memory + recent ticket patterns to refine.

**How to apply:**
- Don't migrate the sheet — Zoran will manually re-enter / screenshot any rows we need.
- When designing the Supabase replacement, structure the table as `client_onboarding_checks` (one row per client per checkpoint) so checkpoints can be added/removed without schema changes.
- Don't treat these 14 as locked — the redesign is expected to add, remove, or reorganize them.
