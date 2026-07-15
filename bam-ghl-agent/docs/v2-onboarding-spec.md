# V2 Academy Onboarding Spec

**Goal:** Onboard a brand-new training academy to the exact state BAM GTA runs on today (portal-native "V2"). This doc is the master source list, reverse-engineered from GTA's live setup (Supabase config tables + portal UI + GHL workflows + AI sales-agent config). From this list we build the actual onboarding flow.

**Reference client:** BAM GTA (`clients.id = 39875f07-0a4b-4429-a201-2249bc1f24df`, GHL location `Le9phlhqKyjLyd0JTECv`).

---

## What "V2" means (the flip)

An academy is "V2" when its `clients` row provider columns flip off GHL and onto portal-native services, and the config tables below are populated:

| Provider column | V2 (GTA) | V1.5 (others) |
|---|---|---|
| `messaging_provider` | `twilio` | `ghl` |
| `pipeline_provider` | `portal` | `ghl` |
| `contact_provider` | `portal` | `ghl` |
| `email_provider` | `resend` | `ghl` |
| `booking_provider` | `portal` | `ghl` |
| `credit_engine_enabled` | `true` | `false` |
| access flags | `v2_access=true` | `v15_access=true` |

**Tenancy gotcha:** most tables key on `client_id`; the newer offer/scheduling/entitlement stack keys on `tenant_id`. Same value, different column name. Encrypted secrets live in `*_enc` columns (service-role only).

---

## The existing skeleton (already built in portal)

The `clients` table already has 8 "section done" timestamp flags, so a partial onboarding flow exists today:

- `general_marked_done_at` · `brand_marked_done_at` · `staff_marked_done_at` · `locations_marked_done_at`
- `offers_marked_done_at` · `meta_ads_marked_done_at` · `ghl_signup_done_at` · `slack_join_done_at`

Plus onboarding state: `status` (onboarding/active/paused/churned), `onboarding_in_progress`, `onboarding_method` (call/send_link), `onboarding_completed_at`, `kpi_marked_done_at`.

We extend this skeleton to cover everything below.

Status legend: 🟢 built · 🟡 partial · 🔴 not built yet

---

## Bucket A — BAM wires it (integrations / back-office)

| # | Setup | Configures (table/column) | Status |
|---|---|---|---|
| A1 | Create client + flip providers to portal/twilio/resend, set access flags | `clients` row | 🟡 |
| A2 | GHL sub-account + OAuth | `clients.ghl_location_id`, `ghl_access_token/refresh_token/expires_at`, `ghl_company_id` | 🟢 |
| A3 | Stripe Connect | `clients.stripe_connect_account_id`, `stripe_connect_status`, `stripe_customer_id` | 🟡 |
| A4 | **Twilio number + A2P registration** | `client_twilio_config` (account_sid, auth_token_enc, from_number, messaging_service_sid, a2p_* SIDs+status, port_status, auto_cutover, missed_call_text) | 🔴 |
| A5 | Meta ad account + CAPI access | `clients.meta_ad_account_id`, `meta_campaign_ids`, `uses_own_ad_account`, `ads_connected_at` | 🟢 |
| A6 | Slack channel | `clients.slack_channel_id` | 🟢 |
| A7 | Client portal login (auth user) + visibility | `clients.auth_user_id`, `allowed_tabs`, `allowed_stages`, `allowed_kpis` | 🟡 |
| A8 | (optional) IG/FB Messenger DMs | `client_meta_messaging_config` (page_id, ig_user_id, page_token_enc, inbox_live) | 🔴 |
| A9 | Notion academy page | `clients.notion_page_id` | 🟢 |
| A10 | Scaling manager + content owners | `clients.scaling_manager_id`, `content_assignee_organic_id`, `content_assignee_ads_id` | 🟢 |

---

## Bucket B — Owner answers questions (the interview)

### B1 — Business basics 🟢
name, legal_name, owner_name, email, phone, address, entity_type, EIN, time_zone, years running.
→ `clients` identity columns.

### B2 — Brand 🟢
logo, wordmark, hero, crest, icon, favicon, OG image, brand colors, website URL.
→ `client_assets` (categories: logo/wordmark/hero/photo/crest/icon/og/favicon/other), `clients.brand_data.website_url`.

### B3 — Coaches / Team 🟡
coach names, photos, bios, credentials, specialties, coach-per-session ratio, which trainer owns which contact.
→ `contact_trainers`, plus sales-agent facts `{{COACH_CREDENTIALS}}`, `{{COACH_RATIO}}`.

### B4 — Locations 🟡
per location: title, address, directions ("doors on the front, to the left"), notes, hours, indoor/outdoor.
→ `locations` (title, address, notes, sort_order). Sales-agent `{{LOCATION_ADDRESS}}`, `{{LOCATION_DIRECTIONS}}`.

### B5 — The Offer(s) 🟡
per offer: title, format (group/private/semi-private/camp), target age range, skill levels, session duration, sessions/week, group size, what's included (one per line), co-ed vs gendered, private-training availability, camps/clinics, adult classes.
→ `offers` → `offer_options`, plus sales-agent `{{AGE_RANGE}}`, `{{SKILL_LEVELS}}`, `{{GROUP_SIZES}}`, `{{CO_ED_OR_GENDERED}}`, `{{PRIVATE_TRAINING}}`, `{{CAMPS_CLINICS}}`, `{{ADULT_CLASSES}}`.

### B6 — Pricing 🟡
per option: pricing model (monthly/per-session/package/seasonal), price, billing intervals, prepayment options (3mo/6mo), sibling discount, referral discount, minimum commitment, payment methods, pricing-transparency mode (RANGE/EXACT/HIDDEN), public price range.
→ `offer_prices` (amount_cents, billing_interval, stripe_price_id/product_id, is_routable, show_on_onboarding), `pricing_catalog` (Stripe mirror, hst_mode). Sales-agent `{{PRICING_*}}`, `{{PREPAYMENT_OPTIONS}}`, `{{SIBLING_DISCOUNT}}`, `{{REFERRAL_DISCOUNT}}`, `{{PAYMENT_METHODS}}`.

### B7 — Trial 🔴
trial booking link, availability, age-group split (younger vs older calendars), weekly schedule, holiday policy, what-to-bring, second-free-trial policy.
→ feeds `slot_templates`, `entry_points` (booking calendars), sales-agent `{{TRIAL_BOOKING_LINK}}`, `{{SCHEDULE}}`, `{{HOLIDAY_SCHEDULE}}`, `{{POLICY_FLEXIBILITY}}`.

### B8 — Policies 🔴
cancel/pause policy, makeup/reschedule policy, parent-watching policy, under-18 policy (parent must book, drop-off ok), holiday schedule.
→ sales-agent `{{CANCEL_PAUSE_POLICY}}`, `{{MAKEUP_RESCHEDULE_POLICY}}`, `{{PARENT_WATCHING_POLICY}}`, `{{UNDER_18_POLICY}}`.

### B9 — Sales-agent FACT fields (31) 🔴
The AI booking + confirm agents share one FACT set. Fill all 31 per academy; BEHAVIOR sections (tone, guardrails, objection handling) are shared/global.
→ `agent_prompt_sections` (per-academy overrides), `agent_examples`, `agent_lessons` (grows over time).

Full field list (with GTA values as examples):

| Placeholder | Meaning | GTA value |
|---|---|---|
| BUSINESS_NAME | Academy name | By Any Means Basketball (BAM GTA) |
| LOCATION_ADDRESS | Address | 1079 Linbrook Rd, Oakville, ON L6J 2L2 |
| LOCATION_DIRECTIONS | Find the door | Doors on front of building, to the left |
| YEARS_RUNNING | Time in business | 2 years |
| TRIAL_BOOKING_LINK | Free-trial URL | byanymeanstoronto.ca/free-trial |
| SCHEDULE | Weekly schedule | Mon-Thu younger 7-8pm/older 8-9pm; Sat younger 11:30-12:30/older 12:30-1:30 |
| HOLIDAY_SCHEDULE | Holiday policy | We run on holidays |
| AGE_RANGE | Ages served | 9 and up |
| SKILL_LEVELS | Levels accepted | All levels (beginners welcome) |
| GROUP_SIZES | Players/session | 6-12 players |
| COACH_RATIO | Coaches/session | At least 2 |
| CO_ED_OR_GENDERED | Co-ed vs gendered | Co-ed only |
| PRIVATE_TRAINING | 1-on-1 | Current members only |
| CAMPS_CLINICS | Camps/clinics | None currently |
| ADULT_CLASSES | Adult classes | Older group only |
| COACH_CREDENTIALS | Coach bio/certs | Certified by BAM, played college/pro |
| SELLING_POINTS | Differentiators | Science-based; positive env; small groups; time-on-task; individual skill focus |
| PRICING_TRANSPARENCY_MODE | RANGE/EXACT/HIDDEN | RANGE |
| PRICING_RANGE | Public range | $185-$565/month |
| PRICING_DETAILS | Full internal pricing | Steady $200/mo … Dominate $565/mo (4 tiers × 1/3/6mo) |
| PREPAYMENT_OPTIONS | Prepay | 3mo + 6mo plans |
| SIBLING_DISCOUNT | Sibling | 50% off lifetime per sibling |
| REFERRAL_DISCOUNT | Referral | One free month per referral |
| PAYMENT_METHODS | Accepted | Credit card only |
| CANCEL_PAUSE_POLICY | Cancel/pause | Pause and cancel anytime |
| MAKEUP_RESCHEDULE_POLICY | Reschedule | Through the booking app |
| PARENT_WATCHING_POLICY | Parents watch | Welcome to watch |
| UNDER_18_POLICY | Minors | Parent books; drop-off ok |
| POLICY_FLEXIBILITY | Goodwill | Can offer 2nd free trial |
| REVIEW_PLATFORMS | Social proof | Google Reviews link |
| QUALIFICATION_DIMENSIONS | Qualify leads | Location, age, skill, interest level |

### B10 — KPI / marketing baseline 🟡
CPL goal, monthly ad budget, uses-own-ad-account, CAC, LTV, churn, revenue goals, active clients, ad spend, expenses; content credits/month (organic video/graphic).
→ `clients.meta_cpl_goal`, `meta_monthly_budget`, `kpi_data` (JSON), `organic_*_credits_per_month`, `notification_prefs` (which staff gets which event).

---

## Bucket C — System auto-builds (derived from Bucket B)

The hard engineering: take owner answers and generate the operational rows.

| # | Config | Built from | Tables | Status |
|---|---|---|---|---|
| C1 | Offers → options → prices → **entitlements** (+ create Stripe products/prices) | B5, B6 | `offers`, `offer_options`, `offer_prices`, `entitlement_templates`, `pricing_catalog` | 🔴 |
| C2 | Bookable programs → **slot templates** (recurring schedule) | B5, B7 | `bookable_programs`, `slot_templates` | 🔴 |
| C3 | **Pipeline stages** + tag taxonomy | canonical | `pipeline_stages` | 🔴 |
| C4 | Funnels + entry points + custom contact fields | B5, B7 | `funnels`, `entry_points`, `custom_field_defs` | 🟡 |
| C5 | **Automations + steps** (sequences below) | templates + B copy | `automations`, `automation_steps` | 🔴 |
| C6 | Agent prompt sections + examples | B9 | `agent_prompt_sections`, `agent_examples` | 🔴 |
| C7 | **Member intake form** (parent/child/medical/emergency) | canonical | intake config + `custom_field_defs` | 🟡 |
| C8 | Wire KPIs to offers/forms/calendars | B10 + C1/C2 | `kpi_offer_links`, `kpi_exclusions` | 🟡 |

### C3 — canonical pipeline stages
```
Interested → Responded → Scheduled Trial → Done Trial → Won
                                                    ↘ Lost
```
Roles used by GTA: `nurture, interested, responded, scheduled_trial, done_trial`.
Tag glue: `free trial booked`, `sentfreetrialconfirmation`, `smsghosted`, `posttrial`, `currentlyinposttrial`, `lostaftertrial`, `lost`, `liveclient`, `missed trial`, `glueguyresponsible`.
AI agents map to stages: booking agent runs on **Responded**, confirm agent runs on **Scheduled Trial**.

### C5 — automation sequences to seed (from GTA's ~24 GHL workflows)
GTA automations (portal-native `automations` table): Ghosted, Lead Nurture, Onboarding, Contact intro, Trial intro, Summer Special, Missed Trial, Trial Follow-up. Each has message steps (wait_amount/unit, channel, subject, body).

Sales lifecycle these replace (GHL side, for reference):
- **contact form filled** → tag, Interested, notify, opening SMS, 1-day ghost timeout
- **trial form filled** (abandoned booking) → 40-min wait, notify, SMS with link, ghost timeout
- **free trial booked** → confirm SMS+email, notify, referral check, Scheduled Trial, 6h/2h pre-session reminder, post-session form
- **sms ghosted** (6-day drip) → SMS #1/#2/#3 + Day-4 email → mark lost → lead nurture
- **Done Trial** → route by coach assessment (good fit / not fit / no-show)
- **Missed Trial** → "we missed you" SMS+email, rebook link, reset Interested
- **lead nurture (lost)** → long-term email drip (recognition, development, testimonials, FOMO, 6mo pause, repeat)
- **Coach IQ payment (Won)** → 18 plan segments, remove from sales flows, `liveclient`, welcome SMS → schedule/location SMS → onboarding email drip
- **failed payment** → dunning
- Every core workflow has a **"responded" circuit breaker** that stops the drip → Responded stage

Each has a "responded/replied" circuit breaker.

### C7 — member intake (post-conversion, the parent-facing 5-step)
From GTA staff onboarding page: (1) Parent info (name/phone/email/emergency contact) → (2) Child info (name, age, medical notes) → (3) Plan selection (tier + billing) → (4) Payment (Stripe) → (5) Confirmation + first session booking. Also PDP form (goals, experience, position) → coach summary.

---

## The gaps (today → onboard tomorrow)

Standing between current state and a full V2 onboard:

1. **A4 Twilio + A2P registration** — messaging can't send without it
2. **B9 sales-agent 31-field interview** — the AI's entire brain
3. **B7/B8 trial + policies capture**
4. **C1/C2/C3/C5/C6 auto-build engine** — the hard part: turning answers into offers/prices/entitlements/slots/pipeline/automations/agent rows

Bucket B is "just questions." Bucket C is the engineering.

---

## Runtime tables (do NOT seed at onboarding)

People: contacts, ghl_contacts, customer_profiles, students, academy_memberships, members, customer_entitlements, credit_ledger, opportunities, website_leads, cancellations, refunds, referrals.
Events: sms_/email_/dm_ threads+messages, conversations, agent_* replies/approvals/followups, automation_enrollments/jobs/events, funnel_events, kpi_events, stage_transitions, trial_bookings, post_trial_reviews/escalations, action_items, tickets.

## Global reference (shared, NOT per-academy)
resource_categories/resources, guide_cards, content_themes, Questions Database, sm_scenarios/sm_units, and the `staff` table (BAM internal team). New academy does not populate these.
