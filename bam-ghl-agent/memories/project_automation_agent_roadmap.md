# Automation + Sales Agent Roadmap (decided 2026-06-11)

Goal: replace GHL-native automations with portal-native ones; an AI sales
agent handles replies. GHL shrinks to the messaging pipe + inbox.

## V1 — SHIPPED 2026-06-12: portal enrolls into EXISTING GHL workflows
`entry_points.ghl_workflow_id/_name`: website-form rows enroll the contact on
form submission (booking-step skipped); calendar rows enroll on successful
booking. GTA mapping: contact → "contact form filled in", free-trial →
"trial form filled in", calendars → "free trial booked" (published; a draft
duplicate exists in GHL). The GHL workflow steps (texts/waits) keep running;
only the trigger moved to the portal. The native engine (phases below)
replaces them later.

## Manual "Summer special" enroll button (shipped 2026-06-19, PR #499)
V2 Sales pipeline (client-portal.html, #view-pipelines) — each early-funnel card
(not done, not trial-started) shows a "📨 Summer special" button (V2_ACCESS-gated)
→ `_plEnrollSpecial()` → POST /api/ghl/pipelines?action=enroll-workflow → GHL
`POST /contacts/{id}/workflow/{wfId}` (eventStartTime with +00:00, NOT Z). Target
workflow id is read server-side from `clients.ghl_kpi_config.summer_special_workflow_id`
(NOT clients.v15_config — that column doesn't exist; the jsonb config col is
ghl_kpi_config). BAM GTA's is set to 1319f52a-2784-4d29-992c-639b2417b5ac. The
GHL workflow needs NO trigger (manual add) but MUST be Published. Plan: when a
lead replies, GHL moves them to Responded and the sales agent takes over.

## Per-academy setup process (repeat for every academy)
1. Site from template → wire submitLead() with their client_id
2. `clients.allowed_domains` += their domain(s)
3. Seed `entry_points` rows (website forms / calendars / GHL forms) with offer_id
4. Map pipeline + stage per entry point (portal wizard, Sales page)
5. Optional: field_map (GHL custom field ids per form field)
6. Set ghl_workflow_id per entry point (list via GET /workflows/?locationId)
7. Academy edits availability in Calendar Setup (Calendar tab)
8. THEIR GHL workflows: re-point triggers to tags, REMOVE stage-move steps
   (the portal moves the pipeline card now — duplicate moves otherwise)
9. KPI era flip at domain-live (website_lead_forms in ghl_kpi_config)

## Build phases
1. **Spine** — GHL inbound-message webhook → portal (instant reply events).
   Shared by nudges + agent. **✅ LIVE + PROVEN END-TO-END 2026-06-18** (PRs
   #459/#464/#465, on main + deployed). Table `ghl_inbound_messages` (migration
   20260618130000) + endpoint `api/ghl/inbound-webhook.js`. Auth: shared-secret
   header `X-Webhook-Secret`, env `GHL_WEBHOOK_SECRET` (set in Vercel
   production). Gated to v15/v2 academies. GHL side: a Workflow named
   "agent trigger" on BAM GTA (location `Le9phlhqKyjLyd0JTECv`) with trigger
   "Customer Replied" → Webhook POST to
   `https://portal.byanymeansbusiness.com/api/ghl/inbound-webhook`, header
   `X-Webhook-Secret`, custom data `locationId={{location.id}}`,
   `contactId={{contact.id}}`, `body={{message.body}}`, `direction=inbound`.
   GOTCHAS LEARNED: (a) GHL's "contact's details" webhook puts the location id
   in `customData.locationId` AND nested `location.id` — NOT top-level; the
   endpoint reads all those paths. (b) `{{message.body}}` is empty on the
   contact-detail trigger (no real message text) — that's fine, P1 only needs
   the EVENT (who/which academy replied); the agent (P3) fetches the full
   thread from the inbox. (c) GHL "Test workflow" DOES fire the webhook (shows
   in Enrollment history). Consumers (nudge cancel / agent wake) read
   `ghl_inbound_messages` in later phases. Per-academy rollout: add the same
   workflow to each v15/v2 academy's GHL.
2. **Nudge engine** ("sms ghosted" first): enroll when a website lead lands
   at the ghosted stage; strict-schedule texts/emails; instant exits (reply via
   webhook, booking via our endpoint, stage-leave). BLOCKED ON: Zoran's
   message copy + timings. Owner-flag ledger: ENGINE → AGENT → HUMAN; flip
   cancels pending sends atomically; fire-time recheck kills races.
3. **Agent (co-pilot)** — on first reply the agent owns the thread: full
   convo history + lead context, tools = check availability, book slot,
   move pipeline card, schedule_followup (reschedules on every event),
   escalate. Sends via GHL so replies stay in the team inbox.
4. **Agent auto + retire GHL workflows** (escalation rails stay).

## Agent Sandbox — BUILT 2026-06-18 (PR #469, live)
Step 1 of the brain. Staff-only `/sandbox` page (portal.byanymeansbusiness.com/
sandbox) — trainer role-plays as a parent, the Claude agent proposes replies.
TRAINING ONLY: zero GHL/SMS side effects. Pieces:
- `api/agent/bam-gta-prompt.js` — BAM GTA booking prompt vendored into the portal
  (source of truth stays sales-conversation-agents/...-bam-gta.txt; regenerate
  the .js if it changes).
- `api/agent-sandbox.js` — staff-gated; action `chat` → Claude `claude-sonnet-4-6`
  via forced `propose_reply` tool → {reply, reasoning, confidence, escalate};
  `teach`/`lessons`/`forget` manage training lessons. ACTIVE LESSONS ARE
  INJECTED into the system prompt at reply time → a correction takes effect on
  the next message. Defaults to BAM GTA client.
- `agent_lessons` table (migration 20260618160000) — per-academy corrections.
- `src/sandbox/SandboxApp.jsx` + `/sandbox` lazy route in main.jsx.
- BRAIN EDITOR (PR #471): `api/agent/prompt-structure.js` = the prompt parsed
  into 20 ordered, grouped sections (identity/academy/behavior/guardrails) +
  `assemblePrompt(overrides)`. `agent_prompt_sections` table (migration
  20260618170000) holds per-academy per-section overrides (only edited sections
  get a row). Sandbox builds the system prompt = section defaults + overrides +
  active lessons. Endpoint actions: sections / update-section / reset-section.
  UI: 💬 Chat / 📝 Brain tab; Brain = collapsible editable section cards with
  Save / Reset-to-default. To change DEFAULTS, edit the source .txt and
  regenerate prompt-structure.js.
NOT YET BUILT (next): tools (check availability / book / move card), reading the
P1 spine to wake on a real reply, sending via GHL. Base-prompt editor (Playbook)
+ lesson promotion-to-global also later.

## Bot takeover — human-approved (building 2026-06-19)
Agent's job here = book a free trial for leads in the "responded" stage; EVERY
send is human-approved (no autonomy yet). Phase A SHIPPED (PRs #504 backend,
#505 inbox UI):
- `api/agent-approvals.js` (staff-gated): `list` (responded-stage contacts whose
  last GHL msg is inbound) · `draft` (pulls real GHL thread, runs the same brain
  as the sandbox — assemblePrompt + lessons + examples — returns reply +
  reasoning + confidence + reply_count + booking_asks) · `send` (fires the
  human-approved reply via GHL conversations/messages, logs `agent_approvals`,
  optional learning). Reuses pickGhlToken/ghl from ghl/_core.js.
- Inbox "🤖 Bot" tab in client-portal.html (`_botRenderQueue`/`_botOpenApproval`/
  `_botRenderApproval`/`_botSend`): approval drawer, Confirm&send / Adjust(+save
  learning) / Skip, auto-advance. Confirm = LIVE real SMS (Zoran's choice).
- `agent_approvals` table + `agent_lessons.scope` ('academy' default = stays
  local, never auto-promoted; 'general' = promotable). Migration 20260619160000.
- Learnings model (decided): ONE source (agent_lessons), TWO views — client
  portal "Agent learnings" tab (read-only, builds trust) + staff portal manage/
  promote panel. Academy-specific (offer/pricing/local) learnings NEVER promoted.
Phase B SHIPPED (PR #515): `api/agent-learnings.js` (list — academy owners see
own, staff see all; staff set-scope/archive/edit). Client: Business Blueprint →
"Agent learnings" tab (`_bbRenderAgentLearnings` in client-portal.html, card id
'agent-learnings'). Staff: `src/views/AgentTrainingView.jsx` + App.jsx nav key
"training" (gated by canSeeFeedback) — manage lessons across academies, mark a
lesson 'general' (promotable) vs 'academy' (local), archive/edit.
Phase C SHIPPED (PR #515): 2-hourly digest cron (vercel.json
`/api/agent-approvals?action=cron-digest`, Bearer CRON_SECRET → runDigest texts
each enabled academy's `ghl_kpi_config.agent_notify_phone` the count waiting,
only when >0) + instant per-new-chat text from `api/ghl/inbound-webhook.js`
(when a Responded-stage lead replies). BAM GTA config: ghl_kpi_config
.agent_notify_phone=4165733718, agent_approvals_enabled=true. Shared stage logic
extracted to `api/agent/_stage.js` (respondedStage/contactInRespondedStage/
computeQueue), reused by approvals + cron + webhook. Hard guard: draft+send only
for Responded-stage contacts (PR #511). Shareable HTML guide at
`/agent-training-guide.html` (PR #508, updated #515).

## Training rollout (Zoran's 5 steps)
1. Draft the shared system prompt together (seed: sales-conversation-agents/
   conversation-ai-booking-agent-bam-gta.txt, versioned).
2. Sandbox: Zoran texts it as a fake parent; corrections → first lessons.
3. Live for GTA: agent self-rates confidence; unsure → escalation queue
   (Slack ping + portal queue; final UI spot TBD). Zoran's answer + "why"
   is sent AND saved as a lesson.
4. Trusted trainers (Mike + chosen clients) get the same queue via a
   trainer role flag.
5. All academies.

## Agent config = 3 layers
1. Shared brain (one versioned template, all academies inherit upgrades)
2. Academy variables (auto-filled from clients/entry_points/calendars/
   onboarding data — {{PLACEHOLDER}} style)
3. Local lessons (never copied across academies)

## Brain layering (decided 2026-06-19) — Sandbox sections grouped by OWNER
The prompt sections (api/agent/prompt-structure.js) each carry a `layer` =
who owns/trains them, shown as groups in the Brain editor:
- 🌐 GENERAL — shared sales craft (role, tone, core_behavior, qualification
  approach, objection_handling, conversation_flow, follow_up_logic, guardrails,
  boundaries, examples). BAM-owned; every academy inherits. This is the future
  "shared brain."
- 📍 LOCATION — this academy (business_info, schedule, coaches, social_proof,
  selling_points). Auto-fillable from `clients` later.
- 🎁 OFFER — the product (program, pricing, policies, qualification_config /
  "who qualifies"). Auto-fillable from `offers` later.
- 🎯 GOAL — objective & cadence (follow_up_config).
IMPORTANT: assembly order in assemblePrompt() is FIXED and DECOUPLED from the
`layer` grouping (ACADEMY_ORDER / INSTRUCTIONS_ORDER) — regrouping the UI never
scrambles the actual prompt. Lead/user context (who they are, funnel stage,
client?) is NOT a layer — it's LIVE runtime data fed via the Lead-info panel
(<lead_context>), pulled from CRM later. Multi-academy inheritance + per-layer
ownership + lesson promotion-to-global = build when academy #2 onboards.

## Local vs global lessons: "born local, earns global"
Every lesson is local by default. Weekly promotion queue: AI clusters
similar lessons across academies → BAM approves promotion into the shared
brain (new version). BAM staff can mark global at write time when obvious.

## Success metric
Agent conversations → booked-trial rate (we own the booking event), per
academy and per brain version; plus escalation rate and trainer edit rate.

## Related GHL facts discovered
- GHL API can list workflows (76 at GTA) and add/remove a contact to/from a
  workflow, but CANNOT read which workflows a contact is in — visibility
  needs status tags or our own ledger.
- Agent training UI = Playbook (3 layers) / Review (lessons) / Sandbox tabs.

## When to update
- Any phase ships → update status here
- The local/global promotion mechanism changes
- Trainer roles or metric definitions change
