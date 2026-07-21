# Client onboarding flow (V2 portal side page)

**Decision (2026-07-08, Zoran):** academy onboarding lives OUTSIDE the regular V2 pages as its own side page. Owners can leave any time (it never blocks the portal), and the navigation orb (the bottom-left circle, from now on called **navigation**) pops a "Finish your onboarding" entry with a live progress ring.

## Where it lives
All in `bam-portal/public/client-portal.html`, `_obf*` prefix (next to the domains wizard code):
- `_OBF_STEPS` - the step registry (key, title, sub, cta, `go` deep link)
- `_obfFetchState()` - auto-detects completion from LIVE data, never hand-checked:
  - `members` -> `/api/members?scope=client` roster non-empty
  - `email` -> `/api/email/domain-setup` status === 'live'
  - `website` -> `/api/website/domain-setup` status === 'live'
  - `ein` -> `ein_set` boolean added to the email domain-setup status response (rides that call - one fewer roundtrip)
- `_obfOpen()` - the flow page (24px-radius modal overlay, progress ring + step rows, gold check when done, CTA button when not, "Back to home" always visible)
- `_obfPopItem()` / `_obfPopRefresh()` - the navigation pop entry (both pop kinds, settings + info), 15px ring + "· n/N" count; hidden for non-V2 and when complete; refreshes in the background (2 min cache)
- Deep links are command-center aware (`_ccOpenClassic` vs `switchView`); member import goes Blueprint -> `_bbNavigate('member_onboarding')`

## Grouped structure (2026-07-09, Zoran: separate general from the training offer)
Steps carry a `group`; `_OBF_GROUPS` renders them in sections with a per-group n/N:
- **Academy setup (general)**: business tax ID, email domain, website domain
- **Training offer**: member import (lives under the offer - it maps the roster onto the offer's plans; reuses the Member Onboarding card UI)
As more offer types come online each gets its own group; general steps stay shared. Detectors unchanged (live-data), still deep-link to the real UIs.

## Steps live today
1. **Add your business tax ID** (general) -> Blueprint General. Auto-completes when `clients.ein` is set. **Skippable** (`skippable:true`): Canadian businesses without an EIN/BN click "Not applicable - skip for now" (localStorage `bam_obf_skip_<clientId>`, cleared automatically once a real EIN lands) so the flow can still reach 100%.
2. **Connect your email domain** (general) -> Domains wizard
3. **Launch your new website** (general) -> Domains wizard. Detector also recognizes **pre-wizard hand-wired sites** (GTA): when `website_setup` is empty it probes `clients.allowed_domains` against the sites Vercel project. **Staging/system hosts are excluded** (2026-07-20): `*.vercel.app` (the shared `bam-client-sites.vercel.app` staging host) and `portal.byanymeansbusiness.com` ride in `allowed_domains` too, so `api/website/domain-setup.js` status filters them out - only a REAL custom domain can read as "live on your new site" (else the staging URL showed as live). Website step correctly stays not-done until the real domain resolves.
4. **Import your members** (training offer) -> Blueprint Member Onboarding card

## Custom values tied end to end (offer.js, 2026-07-09)
The offer wizard writes lead/member custom questions to `custom_field_defs` (offer_id + `section` = sales|onboarding; academy-core defs have offer_id null). `api/website/offer.js` now reads them and returns:
- `intake_fields` = training defaults + legacy `offer.data.onboarding.intake_form_fields` + academy-core + **onboarding** defs (the join/enroll form - enroll.jsx already renders `intake_fields`, so member custom fields flow live; CORE_SKIP dedupes the contact basics)
- `lead_fields` = academy-core + **sales** defs (the lead-capture form; generated/future sites consume it - Detail's hardcoded miami-lead form does not yet)
`cfDefToField`/`cfDefType` map the owner's chosen type to the funnel vocab (text/email/tel/date/select/textarea). leads.js persists submitted values via `writePortalFieldValues` keyed by `custom_field_defs`.

## Steps to add (agreed backlog, academy-level vs per-offer split per Zoran)
Academy-level: locations · staff/team invites · branding/assets · Stripe Connect check · contact import · Meta/KPI wiring.
Per-offer (repeat per offer; Training is ONE type): offer wizard done · pricing matched/sellable · entry points · landing page · pipeline tied · automations/agent copy.
Later: Twilio number (GHL until then).

## Navigation cascade (2026-07-08, same day)
Zoran: the navigation orb's CASCADE (the fan that springs up from the circle) is the home for these entries, not floating buttons:
- **Academy switcher moved into the cascade** (`#cc-fan-acct`, layers icon + count badge). The old standalone `#cc-acct-btn` circle above the orb is GONE; `#cc-acct` now only anchors the pop list. Still Zoran/Mike-only + multi-academy-only (`_ccAcctSync` drives the fan button).
- **Onboarding circle in the cascade** (`#cc-fan-obf`): the progress ring IS the icon, label shows "Finish onboarding · n/N", hides when complete or non-V2 (`_obfFanSync`, called from `_obfFetchState` + dock build).
- Fan cascade delays extended to 5 children; `.cc-fan-count` badge style added.
- Gotcha: the acct pop's click-outside closer must ignore `#cc-fan-acct` or the fan click instantly re-closes it.

## Gotchas
- The pop only exists in command-center mode (the orb is `cc-mode` only); classic mode has no entry yet - add a sidebar nav item when non-CC academies reach V2.
- Completion is data-derived: a step can UN-complete if the underlying state regresses (that is intentional).
- When adding a step, THREE places or it won't show: (1) registry row in `_OBF_STEPS`, (2) a detector in `_obfFetchState()`, (3) the step `key` in the right section's `keys` in `_OBF_SECTIONS` (Academy/Brand/Wired/Offer/Launch). The new paged wizard renders only keys listed in `_OBF_SECTIONS` (`_obfWizSections` filters on it) - a step in `_OBF_STEPS` alone is defined + detected but INVISIBLE. This bit the Gmail inbox step (2026-07-20): added to `_OBF_STEPS` but not `_OBF_SECTIONS.wired.keys`, so it never rendered until the key was added. Keep detectors to existing endpoints where possible.

## Onboarding architecture & roadmap (thoughts to continue - Zoran, 2026-07-09)

**The mental model: GENERAL (once per academy) vs PER-OFFER (repeats; Training is ONE offer type).**
The whole onboarding is being built around this split. Other offer types coming (the `bookable_programs.program_type` enum already allows: TRAINING, TEAM, CAMP_CLINIC, LEAGUE, TOURNAMENT, GYM_RENTAL). Each offer type will have its own block; general stuff stays shared.

### Full action-item list (the target flow)
**GENERAL (academy-level, once):**
1. Business info: name, legal name, address, **tax ID (EIN US / Business Number Canada - see below)**, time zone
2. Locations
3. Staff + team invites (roles)
4. Branding / assets (logo, colors, photos)
5. Stripe Connect
6. Contact import (GHL sub-account for now; portal-native after Twilio)
7. Email domain (→ Resend)
8. Website domain (→ Vercel, retires GHL site)
9. Meta ads + KPI wiring

**PER-OFFER (repeat for each offer; Training = first type):**
- a. Offer wizard (general info, schedule, capacity)
- b. Sales setup: pricing plans, **lead custom fields**, entry points/funnels
- c. Onboarding setup: waiver, **member custom fields**, welcome messaging
- d. Pricing matched → make-sellable (program + typed prices) *(auto via cron)*
- e. Calendar live *(auto via cron-activate-booking once approved)*
- f. **Member import** (substep under the offer - maps roster onto the offer's plans)
- g. Landing page live

**LATER:** automations/agent copy (gated on Hawkeye/GTA pattern + Mike's message copy), Twilio number (GHL until then).

### EIN / tax ID - Canada research (2026-07-09)
Canadian academies do NOT have an EIN. The equivalent is the CRA **Business Number (BN)**, 9 digits, and it's only mandatory once they register for GST/HST, payroll, or incorporate. Stripe Canada already collects the tax ID during Connect verification. So the field is relabeled "business tax ID - EIN (US) / Business Number (Canada)" and the onboarding step is **skippable** (leave empty for now for CA businesses without one). Sources: Stripe verification-requirements-canada, canada.ca BN "when you need a BN".

### Custom values (custom_field_defs) - the model, now COMPLETE end to end
- Authored **per offer** in the offer wizard's Sales + Onboarding sections. `section` = 'sales' (lead form) | 'onboarding' (member/join form); academy-core defs have offer_id null + section null (always collected).
- **Multi-offer:** a def can apply to many offers via the `custom_field_def_offers` join table (migration `20260709140000` - NEEDS `supabase db push` to reach prod). `offer_id` is the authoring anchor; wizard "Also collect on other offers" multi-select adds the rest.
- **Role-scoped drawers:** lead drawer shows sales fields; member drawer shows onboarding fields (both + academy-core). `?action=values&section=...`.
- **Funnel tie:** `api/website/offer.js` returns `intake_fields` (onboarding) + `lead_fields` (sales); enroll.jsx renders `intake_fields`.
- **Write-back CLOSED:** `writePortalFieldValues` matches submitted keys by the def's portal key (tolerating `__<index>`) then the ghl bridge; enroll (`checkout.js`) + lead (`leads.js`) forms both persist. Full detail in [[project_contacts_store.md]] under "P4c".

### What's BUILT vs PENDING (as of 2026-07-09)
Built into the flow: tax ID, email domain, website domain, member import (all with live detectors). Automation exists for: make-sellable (cron), calendar activation (cron-activate-booking ACTIVATIONS list), the whole custom-values loop.
Pending / to add as steps: locations, staff invites, branding, Stripe Connect check, contact import, Meta/KPI, and the per-offer substeps (offer wizard done, pricing matched, entry points, landing page, pipeline tied). The `_OBF_GROUPS`/`_OBF_STEPS` registry is where new steps + detectors get added.

### Detail Miami status (the live proving ground)
Steps 1+2 of the activation checklist DONE (sellable + booking flipped to portal, tested end to end). Remaining for Detail = Mike's manual work: member import (Sorter), email+website DNS pastes, EIN, sales-workflow copy (gated on Hawkeye/GTA). See [[project_detail_portal_native_plan.md]] + the handoff doc.

## Step completion detectors (the EXACT source per step - 2026-07-21)
`_obfFetchState` merges 5 calls: `_edwApi('status')` (email domain-setup), `_wdwApi('status')` (website domain-setup), `/api/offers/setup-status` (`v`), the `get_onboarding_progress` RPC (`p`), `/api/email/mailbox-status` (inbox). Don't guess - a step greens ONLY when its exact source flips:

**Academy/Brand come from the RPC (`clients.*_marked_done_at` stamp columns), NOT raw data:**
- basics = `general_done` = `general_marked_done_at` set OR (business_name+owner_name+email all present, so it auto-greens)
- coaches(Team) = `staff_marked_done_at` · locations = `locations_marked_done_at` · brand(Look) = `brand_marked_done_at` (these three are MANUAL stamps - having real location/brand rows does NOT green them; stamp the column)

**Brand extras + Wired from setup-status `v` / others:**
- sitecopy(Story) = `brand_data.story` non-empty · brandboard = `website_setup.readiness.manual.brand_ok` · stripe = stripe_connect_status='connected' · email(Auto email) = domain-setup status='live' · inbox = mailbox connected · contacts = contacts>0 (or `onboarding_setup.contacts_source` for non-GHL) · ads = `onboarding_setup.ads_choice` set · instagram = ig_live (optional/skip)
- **texting = `onboarding_setup.texting_choice` AND `legal_name` AND ein** where **ein = `clients.ein` set** OR localStorage skip. So a Canadian academy with no EIN can't green texting server-side - owner enters BN or clicks skip (localStorage `bam_obf_skip_<clientId>`, NOT settable from DB).

**Offer(training) from setup-status, all read `offers.data` of the PUBLISHED offer:**
- define = `data.general_info.age_range && .capacity` (NOT `data.general`!) · schedule = `data.schedule.classes[]` len>0 · pricing = matched `offer_prices` (source_offer_id=offer) >0 · policy = `data.policy` has keys · preset = `data.sales.preset_key` set · leads = has_ghl? pipeline_provider='portal' : true · onboardingform = `custom_field_defs` section='onboarding' count>0 · members = members>0 · cancelled = cancelled_contacts>0 or skip
- Launch: build&review = `website_setup.readiness.manual.site_accepted` · go-live = website domain-setup status='live'

**Prefill recipe (used for GTA + DETAIL):** stamp `{general,brand,locations,staff}_marked_done_at`; brand_data look+story; `onboarding_setup.brief_submitted_at`; `readiness.manual.{brand_ok,site_accepted}=true`; offer `data.general_info.{age_range,capacity}` + `data.sales.preset_key`; one onboarding `custom_field_defs` row; pre-stamp `website_setup.chunks.*='published'` to suppress the setup-status Slack pings. EIN/texting stays owner-action for CA academies.

## When to update this note
New steps, detector changes, moving the flow off the modal onto a routed view, a classic-mode entry point, a new offer type joining the per-offer block, or any change to the general-vs-per-offer model.
