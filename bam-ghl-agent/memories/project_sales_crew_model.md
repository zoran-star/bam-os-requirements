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

## BUILD PLAN — sequenced + decided 2026-06-25 (Zoran)
Decisions: **whole crew, sequenced** · **email + text** (build Resend) · **GTA-first, product-shaped** ·
**Zoran adds the Lead Nurture stage + `unqualified` tag in GHL**, portal maps by name. Goal = **run sales
touching ONLY Hawkeye**. ALL agents = hawkeye mode (Zoran's rule).

Phase order:
- **P0** — ✅ DONE 2026-06-25: BAM GTA `confirm_agent_mode`='hawkeye' (booking already hawkeye). Confirm
  detector cron now drafts into the `_acx` queue; nothing auto-sends.
- **P1** — 🚫 Unqualified taxonomy. nurture stage named **`Lead Nurture`** in GHL (anchor `/nurtur/i`);
  Unqualified = a GHL **`unqualified` tag** mirrored by a portal switch (bidirectional). ✅ SHIPPED
  (branch `session/sales-crew`):
  - `api/agent/_tags.js` (NEW) — `UNQUALIFIED_TAG`, add/remove contact tags (`POST`/`DELETE /contacts/{id}/tags`),
    `markUnqualified`/`unmarkUnqualified`/`isUnqualified`.
  - `api/agent/_stage.js` — `nurtureStage()` finder (`/nurtur/i`); null until Zoran makes the stage (dormant, no error).
  - `api/agent-approvals.js` — `confirm-abandoned` now ALSO stamps the `unqualified` tag (best-effort);
    NEW `set-qualification` action toggles the tag (portal ⟷ GHL).
  - `client-portal.html` — drawer "Abandoned" button → **🚫 Unqualified** (`_plMarkUnqualified` → GHL
    `abandoned` + stamps tag via `_plStampUnqualified`). Plain abandon / duplicate-cleanup does NOT tag.
  - ⏸ DEFERRED to P6 (deliberate): do NOT reroute live "Lost" into the Nurture stage yet — nurture automation
    doesn't exist; Lost keeps current behavior until P6.
- **P2** — 🎯 Closing agent (mirror Confirm) **+ the close runs through Hawkeye**: Closing sends a Stripe
  payment link → human ✓ → parent self-pays → Stripe webhook auto-creates the member (kills the "Won" stub;
  wire to `[[project_stripe_app_created_subs]]`). Own switch `closing_agent_mode`, `_aclx*` queue.
- **P2.5** — 📋 post-trial form → a card in the unified approval inbox ("🏁 Trial done — log outcome").
- **P3** — ✉️ Resend foundation (Resend ALREADY wired in `api/clients.js`; formalize `api/_email.js`).
  **FROM = `info@byanymeanstoronto.com`** (verify DNS in Resend). **Email templates LIVE IN THE PORTAL,
  designed by Zoran + Claude on the portal** — NOT in bam-client-sites, NOT the GTA marketing site
  (Zoran corrected this). Brand tokens INLINED (gold `#E2DD9F`, black, Anton + Inter Tight).
- **P4** — 🧱 Automation engine + step-builder, built EMPTY. Adopt the Phase-0 design in
  `[[project_portal_automations_plan]]` (`automation_jobs` queue, `automation_events`, `automation_templates`,
  `email_events`+suppression, `_send.js`). Approve-sequence-once.
- **P5** — 📥 IMPORT SESSION. STRICT ORDER: P3+P4 built FIRST so the UI shows EMPTY automations, THEN Zoran
  pastes GHL text/email screenshots → AI extracts {text, channel, timing} → POPULATES content/sequences.
  Import populates; it does NOT design emails (that's a separate portal+Claude task). Screenshots = the cadence spec.
- **P6** — 👻 Ghosted (retire GHL workflow) + 💔 Lead Nurture go live; flip "Lost" → Nurture stage here.
- **P7** — 🛡️ guardrails + observability (see `[[project_sales_crew_guardrails]]`).

## Hawkeye-only verdict (end-to-end code trace 2026-06-25)
Today TWO things force Zoran out of Hawkeye regularly: (1) **post-trial form** — a human must mark
showed-up/good-fit after EVERY trial; NO auto attendance detection (only a 15-min reminder SMS via
`cron-post-trial-escalate`). (2) **the close = payment** — the "Won" button is a STUB (status flip; no member
link, no Stripe). P2 + P2.5 fold BOTH into Hawkeye. Edge cases left manual: merging duplicate GHL contacts;
a social (IG/FB) lead past Meta's 24h window (agents are SMS-only — hard-coded `type:"SMS"`).

## Notify-on-inbound (guardrail #1) — basically DONE
`api/ghl/inbound-webhook.js`: (A) `notifyOwners(inbox_message)` fires on ALL inbound, any stage (V1.5/V2),
gated only on a recipient subscribed to `inbox_message` in `clients.notification_prefs`. (B) the
"🤖 new chat to approve" SMS is the EXTRA nudge, gated to Responded + agent on + `agent_notify_phone`.
