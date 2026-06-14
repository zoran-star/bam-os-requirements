# Sales page + Communications tab (client portal)

The old "Pipelines" view is now **Sales** (`#view-pipelines`). It's the
Training offer's sales board. Everything here is offer-scoped (training only
for now). See [[project_website_leads]] for the lead-capture/entry-points
half and [[project_automation_agent_roadmap]] for the agent plan.

## Shipped (as of 2026-06-14)
- **Sales page = full-width pipeline board.** (Entry Points used to be a left
  rail here; moved into the Training offer editor's Sales step 2026-06-14.)
  Cards show **Parent + Athlete** only; click opens a rich drawer.
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
  - **Lead tags** (multi-select) + **Member tag** are now set **inside the
    Training offer editor** — Lead tags atop the **Sales** step (5), Member tag
    atop the **Onboarding** step (6). (The old standalone bars on the Sales /
    Member-Onboarding pages were removed 2026-06-14.) Stored top-level in
    `offers.data.lead_tags` (array) / `offers.data.client_tag` (string).
  - **Member tag defaults to `liveclient`** — added when GHL connects + by the
    website onboarding flow. Editable in case an academy uses a different tag.
  - Rule: **MEMBER wins** (liveclient), not lead tags — someone tagged
    liveclient is a member even if they still carry an old lead tag. A contact
    is a lead if they carry ANY lead tag and are not a member.
- v1 sending: **reply on SMS + email**; other channels read-only.
- Channels live for GTA: SMS, Email, Call, Instagram (show all the academy has
  connected; detected from `lastMessageType`).

**Phase 1 shipped:**
- `api/ghl/comms-config` (GET tags+recommend; still used by the offer editor's
  `_bbLoadTags` to list location tags + AI suggestion). PATCH path is now
  vestigial — the offer editor writes tags via its own autosave.
- Tag pickers live in the **offer editor** (`ghl_tags_multi` for Lead tags,
  `ghl_tag` for Member tag) — see `_bbLoadTags`, `_bbUpdateOfferTopKey`,
  `_bbToggleOfferTopArray`. Write top-level `offers.data.lead_tags`/`client_tag`.
- `api/ghl/inbox` GET returns per-conversation `trainer` + `channel`, plus
  `trainers` list + `tagConfig` ({lead_tags[], client_tag}). `contact_trainers`
  table (post-trial mirrors into it).

**Messaging + entry-points relocation — DONE (2026-06-14, part 2):**
- **New message to any GHL contact**: Inbox "✏️ New" button → compose drawer
  with a contact search (`/api/ghl/contacts-search` GET `?client_id=&q=`) →
  pick → SMS/Email + text + file attachments → `/api/ghl/send-message`.
- **Pipeline card drawer messaging**: `_plOpenCard` drawer has a Messages
  section (thread + reply + attachments). Loads the contact's thread via
  `api/ghl/inbox?contact_id=` (new Mode C — finds the contact's conversation,
  returns its messages). Sends via `/api/ghl/send-message`.
- **Entry points moved into the Training offer editor Sales step** (new
  `entry_points` field type → `_epCardHtml`/`_epEnsureLoaded`; the Set-Up
  wizard `_epOpenWizard` renders in the global `#pl-drawer` overlay, so it
  works from any view). Training-only.
- **Entry points REMOVED from the Sales tab entirely** (Zoran: "it does not
  belong on the sales tab"). The Sales tab is now just the full-width pipeline
  board — no left rail / divider. Entry points live ONLY in the offer editor.
  (`_epGotoOfferSales`/`_renderEntryRail`/`plToggleRail` are now dead but
  harmless no-ops.)

**Tag-based classification — DONE (2026-06-14):**
- `api/ghl/inbox` classifies member/lead/other by GHL tags. It resolves
  contactIds carrying the member tag + each lead tag via `POST /contacts/search`
  (filtered by tag), then: **member if** members-table match OR member-tag set
  OR inline `c.tags`; **lead if** (not member AND) carries any lead tag; else
  **other**. Member WINS. Degrades to members-table match if search fails.

**Phase 2 TODO (the actual comms UI):**
1. Revamp `#view-inbox` render (`fetchAndRenderInbox`/`_renderInboxList`) into:
   trainer tabs + Business → Leads/Clients sub-tabs → conversation list → thread.
2. Per-conversation inline controls: **assign trainer** (writes `contact_trainers`)
   + **add the lead/member GHL tag** to the contact.
3. Reply on SMS + email — **DONE** (reuse `api/ghl/send-message`, now with file
   attachments via the `ticket-files` bucket).
4. Trainer-restricted views later (trainers see only their tab) — owner-all now.

## When to update
- Phase 2 ships → mark done, note the new endpoints/UI.
- Won-button gets wired to member linking → update.
- A second offer goes live → Sales/Onboarding stop being training-only; add an
  offer switcher.
