# Agent Academy Rollout Checklist

Goal: **every academy on Hawkeye, every edit flowing back as a lesson.** Today
only BAM GTA is live. This is the ordered checklist to stand up the sales agents
(booking / confirm / closing) for a new academy. Do the steps in order - the
mode switch is LAST.

The current agents implement the **training offer + free trial sales system
presets only**. If the academy does not run free trials or sells differently, do
NOT roll out yet - that needs a new preset (see
`memories/project_client_agent_training.md`).

## 1. Access

- [ ] `clients.v2_access = true` (staff V2 toggle) - the agents are V2-only.
- [ ] Academy owner has a `client_users` row with `role='owner'` (owners can
      approve in Hawkeye AND teach automatically).
- [ ] Grant `can_train_agent = true` to every non-owner person who will work the
      Hawkeye deck (SQL today - no staff toggle UI yet):
      `update client_users set can_train_agent = true where ...`

## 2. Fill the brain (the agent is only as smart as this step)

- [ ] Fill ALL 9 fact sections in Train Agent > Knowledge:
      `business_info`, `schedule`, `coaches`, `social_proof`, `selling_points`,
      `program`, `pricing`, `policies`, `qualification_config`.
- [ ] **Verify no BAM GTA defaults remain** - the template defaults are GTA's
      real address, prices, and booking link. Read every section back.
- [ ] Booking link + trial calendars exist in GHL and are listed for the academy
      (the Hawkeye book card only shows this academy's trial calendars).
- [ ] Quiet-hours timezone set for the academy (V2 settings) - sends clamp to
      8:00am-9:30pm in THAT timezone.

## 3. GHL side

- [ ] Ghosted workflow is wired on the offer (ghosted routing depends on it).
- [ ] Turn OFF the academy's old GHL follow-up workflow steps BEFORE approving
      any agent follow-up, or the lead gets double-texted.

## 4. Flip it on

- [ ] Set `agent_mode = 'hawkeye'` (Train Agent > Autonomy tab - the academy
      owner can also flip Off/Hawkeye themselves; `self_drive` is staff-gated).
      Never start an academy on `self_drive`.

## 5. Verify the training loop (do not skip)

- [ ] Send a test lead through; confirm a draft appears in the Hawkeye deck.
- [ ] Edit the draft, type a teach-why, send. Confirm an `agent_lessons` row
      landed with the right `client_id` AND the right `agent`.
- [ ] Tell the academy's team the operating rule: **reply through the portal
      Hawkeye deck, never directly in GHL** - GHL-direct replies bypass the
      training loop entirely (no draft diff, no lesson).

## 6. Aftercare

- [ ] The academy inherits all shared general lessons automatically (client_id
      NULL rows) - nothing to copy.
- [ ] Add the academy to the `/consolidate-lessons` rotation: run it when any
      agent hits 15+ raw lessons or every 2 weeks.
- [ ] Check the mined intake candidates ledger
      (`docs/onboarding-intake-candidates.md`) - collect any accepted data
      points from THIS academy during its onboarding, so its agent starts
      smarter than GTA's did.
