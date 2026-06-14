# Sales page + Communications tab (client portal)

The old "Pipelines" view is now **Sales** (`#view-pipelines`). It's the
Training offer's sales board. Everything here is offer-scoped (training only
for now). See [[project_website_leads]] for the lead-capture/entry-points
half and [[project_automation_agent_roadmap]] for the agent plan.

## Shipped (as of 2026-06-14)
- **Sales page = pipeline board + Entry Points arrow rail** (green dotted
  collapsible divider). Cards show **Parent + Athlete** only; click opens a
  rich drawer.
- **Card drawer** (`_plOpenCard`): identity (clickable phone/email, coach),
  **Journey timeline** (form filled → trial booked → showed up → good fit/coach
  → won/lost), **Lead details** (every populated GHL custom field via
  `api/ghl/contact-detail`), post-trial notes, stage-aware actions.
- **Trial dates** resolved 3 ways (GHL appointment > website_leads booked_slot >
  "Free Trial Date" field). Cards in a trial-booking stage with no date show an
  orange "⚠ No trial date" flag.
- **Scheduled-trial cards**: "Post trial form" button appears the moment the
  trial STARTS. **Done-trial cards**: "Won" / "Lost" instead (Lost sets GHL
  opportunity status=lost via PATCH; **Won is still a stub** — needs member link).
- **Post-trial form** (`api/ghl/post-trial`): shows full lead detail + asks
  did-they-show-up + good-fit + trainer + notes. Good fit → moves opp to Done
  Trial, writes trainer to "Lead Sales Person" field + `contact_trainers`,
  queues a signup-link text (`signup_text_status='queued'` — NOT sent, gated on
  the comms tab). Tables: `post_trial_reviews`, `contact_trainers`.
- **Pricing Sorter create-price**: now offers **Match an existing Stripe price**
  (modes `search`+`link` on `api/offers/create-price`) OR Create new (AI). Match
  links an existing price as canonical, mints nothing.
- **"Won in done trial" was NOT us** — GHL's own opportunity.status (17 of 24
  done-trial cards were won in GHL). Our board just mirrors GHL status.

## Communications tab — Phase 1 DONE, Phase 2 PENDING
Revamp of the Inbox tab into a tabbed comms hub.

**Decisions (from Zoran):**
- Top tabs = one **per trainer** + a **Business** tab (all messages); academy
  owner sees all trainers. Trainer source = **the post-trial form** AND must be
  **inline-assignable on any conversation**.
- Each tab has **Leads / Clients** sub-tabs, split by GHL tag:
  - **Lead tag** selected atop the **Sales** page; **Client tag** atop the
    **Member Onboarding** page. Training-offer scoped, stored in
    `offers.data.lead_tag` / `offers.data.client_tag`. AI recommends a tag.
  - Rule: **lead wins**; untagged → Leads. (Member import will add the client
    tag; GHL automations add the lead tag.)
- v1 sending: **reply on SMS + email**; other channels read-only.
- Channels live for GTA: SMS, Email, Call, Instagram (show all the academy has
  connected; detected from `lastMessageType`).

**Phase 1 shipped:**
- `api/ghl/comms-config` (GET tags+recommend+current, PATCH save lead/client tag).
- Sales + Member-Onboarding pages have the tag dropdowns (`_loadTagCfg`/`_saveTagCfg`).
- `api/ghl/inbox` GET now returns per-conversation `trainer` + `channel`, plus
  `trainers` list + `tagConfig`. `contact_trainers` table (post-trial mirrors into it).

**Phase 2 TODO (the actual comms UI):**
1. Revamp `#view-inbox` render (`fetchAndRenderInbox`/`_renderInboxList`) into:
   trainer tabs + Business → Leads/Clients sub-tabs → conversation list → thread.
2. Classify Leads vs Clients by the configured tags. Currently inbox classifies
   member(=client)/lead via the members table; switch to tag-based (fetch
   contactIds carrying lead_tag / client_tag via GHL contact search, lead-wins).
3. Per-conversation inline controls: **assign trainer** (writes `contact_trainers`)
   + **select/add the lead or client GHL tag** (adds the GHL tag to the contact).
4. Reply on SMS + email (reuse `api/ghl/send-message`).
5. Trainer-restricted views later (trainers see only their tab) — owner-all now.

## When to update
- Phase 2 ships → mark done, note the new endpoints/UI.
- Won-button gets wired to member linking → update.
- A second offer goes live → Sales/Onboarding stop being training-only; add an
  offer switcher.
