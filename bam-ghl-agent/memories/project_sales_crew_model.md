# Sales crew — the model (agents + automations + terminal taxonomy)

2026-06-25. The "sales crew" design Zoran is shaping (planning, NOT built). Visual + live
notes: `docs/sales-crew-model.html`. Pairs with `[[project_sales_crew_guardrails]]` +
`[[project_confirm_agent]]`.

## The spine (pipeline stages, top → down)
👻 Ghosted → 💔 Lead Nurture → 📞 Booking → ✅ Confirm → 🎯 Closing → 🎉 Member.
New leads enter at Booking. Each agent/automation OWNS a pipeline stage (so it glows + is visible).

## Agents (live conversation — Hawkeye = approve each message)
- **📞 Booking** (Responded) — books the free trial. Also re-receives EVERY re-entry WITH context so it
  never opens cold: can't-make-it · no-show · ghosted-reply · nurture-reply ("won back").
- **✅ Confirm** (Scheduled Trial) — confirm + help them get to the trial; can't-make-it → Booking. LIVE today.
- **🎯 Closing** (Attended/Done Trial, LATER) — convert good-fit attendee → member.

## Automations (one-way nudges — Hawkeye = approve the SEQUENCE once)
- **👻 Ghosted** — AGGRESSIVE + short (e.g. day 1/3/7). Reply → Booking. Still silent → 💔 Lead Nurture.
- **💔 Lead Nurture** — SPARSE + long-term, mixes **email + text**. The catch-all (see taxonomy). Reply →
  Booking with context. **Cadence: Zoran will spec the first one** (don't assume).

## Initial automation per agent (2026-06-25)
The scheduled-trial (Confirm) and Closing agents each have a **fixed initial automation attached**: the
same templated first touch fires for everyone (e.g. Confirm = the same confirmation texts/emails on
booking; Closing = a fixed post-trial follow-up), THEN the live agent takes over for replies/objections.
So those stages are hybrid: automation (consistent first touch) → agent (live conversation).

## Visual scheme (sales-crew-model.html)
Lead temperature by colour: 💔 Lead Nurture = **cold / deep blue** · 👻 Ghosted = **warm / yellow** ·
✅ Confirm = **hot / green** · 🎉 Member = **pink**. Booking = blue, Closing = purple, 🚫 Unqualified = orange.
Dashed outline = automation; thick glowing solid = agent.

## Terminal taxonomy (REVISED 2026-06-25 — Zoran's call)
Only ONE true dead end now:
- **🚫 Unqualified** = the dead end. opt-out · invalid · spam · hard no · clearly not-a-fit. Silent removal, no nurture. (Replaces the old "Abandoned".)
- **💔 Lead Nurture** = EVERYONE ELSE marked Lost at ANY stage (Booking/Confirm/Closing) + ghosted-out.
  i.e. "Lost" is no longer terminal — it flows INTO Lead Nurture unless the lead is Unqualified.

## Build implications (the redesign)
- New `unqualified` tag/status.
- Redesign each agent's "end the lead" step: choose **Unqualified** (dead) vs **Lead Nurture** (keep), not just "Lost".
- Route non-unqualified Lost (any stage) + ghosted-out into the Lead Nurture stage.
- Build the Lead Nurture automation (cadence TBD by Zoran).
- (Already separately needed) no-show detector cron + a Booking-brain "no-showed before" note.

## GTA specifics + GHL mirroring (2026-06-25)
- **GTA qualification:** qualified lead = lives near Oakville **and** athlete age 9+. Unqualified = fails
  that (too far / under 9) or opt-out / invalid / spam. This is the GTA definition of the `unqualified` tag.
- **GHL pipeline mirror:** when built for GTA it must tie into GTA's existing **GoHighLevel pipeline**. The
  agents already operate on the real GHL pipeline (read stages + move opportunities via GHL API — e.g.
  `respondedStage` / `scheduledTrialStage` in `_stage.js`). To add this model: create the **💔 Lead Nurture**
  stage + `unqualified` tag **in GHL**, the portal maps to them by name, and portal ↔ GHL stay in sync both
  ways. Zoran may add the nurture stage to GHL himself.

## Rule throughline
agents = approve each message · automations = approve the sequence once · every bot/automation owns a
pipeline stage. Conversational = agent; one-way nudges = automation. Reply to any automation → Booking.
