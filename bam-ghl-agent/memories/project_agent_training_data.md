# Agent training-data strategy (the data flywheel)

**2026-06-30.** With conversations now owned in the portal (sms_threads/sms_messages,
see [[project_twilio_messaging_spine]]), the goal is to collect the data that
optimizes training of all sales agents (booking/confirm/closing) AND bootstraps new
ones (rebooking, reactivation, referral, win-back, email, site-chat, call).

## The 3 things every agent learns from
1. 💬 **Raw conversations** — every message in/out across channels (SMS, email, GHL,
   future calls), tagged with sender type (agent / human / automation) + timestamps.
2. ✏️ **Corrections (highest leverage)** — every agent DRAFT + whether a human
   approved / edited / rejected it, and the EDIT DIFF (draft vs what actually sent),
   plus skip reasons + lessons. "Agent said X, human changed to Y" = direct
   supervised signal. (Partly captured today: agent_lessons, agent_examples,
   agent_approvals — gap is the draft-vs-sent diff on every Hawkeye action.)
3. 🎯 **Outcomes (the labels)** — each conversation joined to its result: booked →
   attended → ENROLLED ($) / lost / ghosted, + revenue. Turns a chat into "a chat
   that WON." Lets agents copy winners. (Gap: outcome not joined to the conversation.)

## Other high-value signals
- 🧍 Lead attributes/segments: age/grade, source (ad/form/funnel), location, parent
  type, price sensitivity, objections → personalize + analyze what converts by segment.
- ⏱️ Timing/cadence: lead + agent response times, #follow-ups before reply, time-of-day,
  days-to-book → optimize when + how many touches.
- 🌐 Website behavior: pages viewed, pricing visits, form start vs complete, video
  watch %, scroll depth, drop-off → agent context + funnel fixes + future site-chat agent.
- 📧 Email engagement: opens/clicks/replies/bounces/unsubs (some logged in email_events/
  email_suppressions) → winning subject lines/sequences; email agent.
- 📞 Calls (future): transcripts + outcome → call agent.
- 🧠 Mined objections/FAQs: auto-extract recurring questions/objections from convos →
  knowledge base + new objection-handling/FAQ agents.
- 📊 Agent scorecards: reply→book, book→attend, attend→enroll, escalation rate,
  human-edit rate → measure + A/B test agent versions.

## New-agent creation
A labeled corpus of winning conversations + human edits + an objection taxonomy lets a
NEW agent start from real proven examples (clone what works) instead of cold.

## Have vs biggest gaps (priority order to build)
Have: SMS conversation store, email events, lessons/examples, approvals, pipeline
stages, website_leads, ad KPIs (ghl_funnel_events).
Biggest missing leverage, in order:
  1. Outcome labels joined to each conversation (did this chat → enrollment + $?).
  2. Human-edit diff (draft vs sent) captured on every Hawkeye action.
  3. Objection/topic tagging auto-mined from conversations.
  4. Website-behavior depth (beyond "form submitted").

NOT YET DECIDED/BUILT — this is a strategy note to act on in a future session. Start
with #1 and #2 (cheapest + highest-leverage). Consider also saving to Notion as the
agent-data strategy.
