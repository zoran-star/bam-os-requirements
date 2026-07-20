# Staff onboarding tracker page + staff-to-do skill (PARKED - build after Mike)

**Decision (2026-07-20, Zoran):** build a staff-side onboarding tracker, but
NOT yet - do it AFTER onboarding Mike (DETAIL Miami) end to end, so we set it up
from real experience instead of guessing the shape.

## What to build (when unparked)
1. **New staff-portal page, onboarding-only** - a dedicated page (not a tab
   buried in a client), structured like the live-status widget we built in the
   2026-07-20 chat: left column = one card per wizard screen (the owner's
   steps), right column = what each screen triggers on our side (team/auto),
   with per-card live status (done / in progress / gap) pulled from real data.
   It is the staff mirror of the owner's "Finish your onboarding" flow.
2. **Claude skill that lists staff to-dos** - reads every onboarding academy and
   surfaces what staff need to act on right now (the A-list jobs whose
   preconditions are met).

## The first concrete to-do it must surface: pipeline sort
Auto-surface `/ghl-pipeline-import` as a staff to-do when an academy is READY:
- gate = `ghl_location_id` set (GHL connected) AND Free Trial preset applied
  (`offers.data.sales.preset_key` or `pipeline_stages` rows exist) AND
  `pipeline_provider != 'portal'` (not yet flipped).
- clears itself once flipped to portal.
- today this is only a PASSIVE ladder inside the per-academy Activation tab
  (`ActivationTab.jsx` "Bring their GHL over" card, data from
  `api/admin/activation-status.js` -> `ghl_migration`). Nothing tells staff
  across all academies "these are ready to sort NOW" - that gap is the point of
  the tracker.
- planned but NOT built: `GET /api/admin/pipeline-todos` (all ready academies in
  one call) feeding a roster-level to-do card + an Activation action state.

## Why pipeline sort is a staff skill, not an auto-fire chunk
The 6 build chunks (deck/core/templates/sales/onboarding/agreement) fire
server-side in `setup-status.js evaluateChunks`. Pipeline sort is NOT one of
them - it is job #7 on the staff A-list, a Claude co-working runbook
(`/ghl-pipeline-import`, WS4) because it needs human judgment to classify each
GHL card onto a preset stage. It runs AFTER the owner applies the preset (preset
is the target the cards sort onto), and needs contacts imported too.

See [[project_client_onboarding_flow]] + [[project_v2_onboarding_model]] +
`.claude/commands/ghl-pipeline-import.md`.

## When to unpark
Right after Mike / DETAIL Miami is fully onboarded (its 4 gaps closed: email
domain, texting/A2P, member import, legal name).
