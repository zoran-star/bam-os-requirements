# San Jose (Lij) onboarding: build queue

Live queue of everything the San Jose onboarding surfaces. Onboarding spans days and sessions, so this file is the memory, not the session task list.

**Started 2026-07-25.**

---

Team roster, spawn prompts and gate mechanics: [lij-onboarding-team-playbook.md](lij-onboarding-team-playbook.md).

---

## The triage rule

Every gap found during onboarding gets exactly one severity BEFORE anyone proposes work:

| Severity | Meaning | Action |
|---|---|---|
| **BLOCKER** | San Jose cannot onboard correctly, or GTA content leaks to SJ leads | Build now |
| **FRICTION** | SJ can onboard, but a human does something manual or ugly | Queue, batch later |
| **SCALE** | Only bites at academy #3 or later | Backlog note only |

Without this, every find feels urgent and the academy never actually gets onboarded.

## The guardrail on every fix

Sales systems are **shared**. Never fork one academy's structure. If one client needs X, either every academy gets X, or X is a runtime fact (domain, owner, program names, prices, age ranges, location). An `if academy == gta` branch is always the wrong answer.

## How work moves

```
gap found -> triage -> [BLOCKER only] -> planner (mockup + diagram)
  -> GATE 1: Zoran workshops and approves
  -> builder (own worktree)  <-> tester (bounces fixes back)
  -> GATE 2: Zoran runs the plain-English test script
  -> merge -> back to onboarding
```

Fable plans. Opus builds and tests.

## Prior art: read before proposing anything preset-shaped

- [sales-preset-entity-handoff.md](../bam-ghl-agent/docs/sales-preset-entity-handoff.md) - the plan to make presets ONE shared entity instead of per-academy stamping
- [project_preset_sweep_2026_07_21.md](../bam-ghl-agent/memories/project_preset_sweep_2026_07_21.md) - Zoran's locked preset rules, plus the standing warning not to build preset-shaped work separately

---

## Queue

Scout sweep completed 2026-07-25. Every row has file:line evidence in the Scout report (session 153b68ad).

**CORRECTION (session poll, 2026-07-25):** the fix handoff `preset-automations-canonical-no-hardcode.md` EXISTS - it is committed on branch `claude/san-jose-v2-onboarding-a65e05` (Scout searched this worktree, which branched before it landed). The "BAM V2 preset automation seeding" session is actively building it. Ownership below reflects the poll replies.

**OWNED ELSEWHERE - do not build here, do not touch their files:**
- Items **1, 2, 7, 8** → session "BAM V2 preset automation seeding" (branch `claude/bam-v2-preset-automations-5148eb`). Their do-not-touch list: `form-intro-automations.js`, `email-shells.js`, `nurture-emails.js`, `automations.js` (vars block + seed actions), `presets.js` applyPreset, `offers/apply-preset.js`, `scripts/apply-preset.mjs`. Also: do NOT hand-seed San Jose's automations, their build seeds them dormant (approved:false) until Lij goes live.
- Item **9** → session "Enrollment agreement population" (branches `claude/enrollment-agreement-build-cc809c` + bam-client-sites `feat/agreement-engine`). Broader than the sweep found: `buildClauses()` only ever replaced clauses 1 and 6, the rest stayed GTA-worded even with a filled Policy step. Their do-not-touch: `agreement-pdf.js`, `agreement-version.js`, the agreement path in `website/checkout.js`, `publish-agreement.mjs`, the 3 agreement tables, `bam-client-sites/system/agreement/*` + per-client `agreement.terms.json`/`agreement.html`. Note: `sampleClauses()` stays on purpose (renders pre-engine + historical signed records) - future sweeps must not re-flag it.
- Item **3** (FROM address, `_email.js`/`_send.js`) → **OURS** (preset session answered no-yours, 2026-07-26). Constraints: build AFTER PR #1601 merges and rebase on it (their PR modifies `_send.js` + `agent-confirm.js`). Head start: #1601 exports `clientVars(client)` from `email-shells.js` deriving per-academy identity from the client row; `clients.email_domain` is likely the right from-domain source.
- **PR #1601 is UP** (canonical no-hardcode preset build, branch `claude/bam-v2-preset-automations-5148eb`), mergeable pending Zoran's review. Agreed post-merge sequence: merge → re-run apply-preset for SJ (auto-seeds all 6 drips dormant) → our tester renders every seeded SJ step asserting zero "Toronto/byanymeanstoronto/Zoran/Oakville/GTA", domain = byanymeanssanjose.com, owner = Elijah, AND the blank-domain case drops link lines to empty (no fallback). FROM address excluded from that pass (item 3, ours). QA helper in the PR: `scripts/check-automation-divergence.mjs <clientId>`, SJ should be all MATCH after seeding.
- Item **5** (agent brain) → files (`prompt-structure.js`, `fact-render.js`, `api/agent/*`) are claimed by BOTH the SIGN UP FEE branch (PR #1587, unmerged) and the engineering-build session. DO NOT build until #1587 merges. Also: the spec'd Google Reviews build (Build 5, not started) is the proper fix for `social_proof`. The no-Training-offer fallback hole matters less for SJ (their offer is filled), stays open for academy #4+.
- Item **6** (funnel form) → must branch off / rebase on **bam-client-sites PR #116**: it fixes `system/pages/` which was hardcoding GTA's pixel ids into every copied site (SJ would have reported into GTA's ad account). Never hand-paste a pixel snippet into an SJ page; pixel ids go in `client.json` `tracking.meta_pixels`.
- **GHL token warmth** → owned by the BUILD GHL TOKENS session (mid-flight with Zoran on the FC2 marketplace app config). SJ IS on GHL (messaging/pipeline/contact providers all 'ghl'); its token stays warm only once the agency re-mint works. Do not touch `agency-connect.js`, `ghl/_agency.js`, `pickGhlToken`/`refreshGhlToken` in `ghl/_core.js`, or the `ghl_agency_tokens` row.

| # | Item | Severity | Status | Notes |
|---|---|---|---|---|
| 1 | Outbound identity seam: `LOCATIONS` map in `email-shells.js:79-95` falls back to GTA (site, Oakville, instagram, email) for every other academy | BLOCKER | queued | One build with #2 and #3. Fix = derive identity from the client row, fail loud instead of falling back to GTA |
| 2 | "coach Zoran" + Oakville merge-token leak; empty domain resolves to byanymeanstoronto.ca (`email-shells.js:118-121`, `automations.js:501-507`) | BLOCKER | queued | Part of the #1 build |
| 3 | All automation emails send FROM `info@byanymeanstoronto.ca` (`_email.js:18`, `_send.js:33-35`); only the human 1:1 lane uses per-academy from | BLOCKER | queued | Part of the #1 build |
| 4 | Trial confirmations render times in `America/Toronto` for every academy; SJ 5pm PT trial reads 8pm | BLOCKER | **at gate 2** | Built + adversarially tested (zero bounces outstanding). Uncommitted edits in worktree `agent-aba9284fbf79708c3`; test room spawned for Zoran. Ship steps after his pass: apply migration `20260726090000`, backfill `clients.time_zone` for all academies, commit, PR, rebase-check vs #1587/#1601 (never drop the `loadMergedOverrides` second arg) |
| 5 | UNBLOCKED (#1587 merged). Agent brain GTA fallbacks: `social_proof` = GTA reviews link; no Training offer = whole brain (Oakville address, GTA schedule/prices) falls back to GTA text (`prompt-structure.js:85-127`, `fact-render.js:277-279`) | BLOCKER | queued | Mechanism partly covered by entity handoff §5; the no-offer hole is in neither doc. Check if SJ has an `agent_prompt_sections` override for social_proof before building |
| 6 | Funnel form is a per-site GTA copy: GTA client_id baked as fallback (`freetrial.jsx:475,557,576`), "close to Oakville?" field, ages 5-19, GTA email in copy. Lives in bam-client-sites | BLOCKER | queued | A copied site missing config silently pumps leads into GTA's pipeline. No SJ folder exists yet |
| 7 | Seeded drip copy diverges from GTA's proven copy; API/script preset apply doesn't seed drips at all (wizard chain does) | FRICTION | queued | `form-intro-automations.js:32-136`, `apply-preset.js` |
| 8 | Designed nurture + onboarding email templates are hard-baked GTA HTML, not tokenized (`nurture-emails.js`, `onboarding-emails.js:47-133`) | FRICTION | queued | Blocks "promote GTA copy into defaults" until tokenized |
| 9 | Signed legal agreement falls back to GTA wording when offer's Policy step empty (`agreement-pdf.js:25,30`) | FRICTION | queued | `buildClauses()` is parameterized, only the fallback leaks |
| 10 | Quiet-hours default tz = Toronto when `clients.time_zone` unset (`agent/_quiet.js:9,44-47`) | FRICTION | queued | Per-academy override works; null default only |
| 11 | GTA is `DEFAULT_CLIENT_ID` in 5 agent endpoints (approvals, confirm, closing, followups, sandbox) | SCALE | backlog | Fallback-only today, foot-gun at academy #3+ |
| 12 | `members/intake.js` hardwired to GTA (`:23,79,93,103,144`) | SCALE | backlog | Adjacent to, not inside, the preset |
| 13 | Stage positions still copied per-academy at apply time; master reorder needs re-apply | SCALE | backlog | Labels solved 07-24 via `masterStageLabels`; positions flagged in plug-and-play memory |
| 14 | SJ agreement asks DOB / grade / school but the funnel never collects them, so they print blank in the signed PDF | FRICTION | queued | Reported by the enrollment-agreement session. Intake gap on OUR side of the boundary (funnel form), adjacent to item 6 |
| 15 | Remove `sampleClauses()`/`buildClauses()` once every academy site deploys the new enroll code (they stay for now to re-render historical signed agreements) | SCALE | backlog | Do NOT delete early, breaks re-rendering old records |
| 16 | Signed-agreement record assembly (pre-fill parent data, photo opt-in, version stamp, immutable PDF) - handoff `populate-version-store-signed-agreement.md` on the SJ branch | BLOCKER | verify owner | Looks like exactly what the enrollment-agreement session already built. Confirm with them, then close as covered or fold the delta into their PR |
| 17 | Emergency contact as REQUIRED core fields in the shared preset - handoff `emergency-contact-required-in-preset.md` on the SJ branch | FRICTION | queued | Zoran's locked decision. Touches `presets.js` which the preset-seeding + engineering sessions claim: coordinate or wait for their merges |
| 18 | GHL import reconcile gate always fails (`ghl_stage_id` never populated), blocks the pipeline-shadow flip - handoff `ghl-import-reconcile-gate.md` | SCALE | backlog | Nice-to-have for Lij per the SJ session |
| 19 | CLI apply-preset doesn't stamp `preset_key` (API does) - handoff `apply-preset-cli-stamp.md` | SCALE | backlog | Minor |
| 20 | Slack team group chats + ticket-routed notifications (general staff-side, NOT Lij-blocking; Zoran queued 2026-07-26). Route each ticket type to its team channel. Teams: **content** = Cam, Eli, Zoran &middot; **marketing** = Ximena, Zoran, Mike, Cam &middot; **systems** = Rosano, Jenny, Chris, Zoran, Mike &middot; **admin** (client info + higher-level) = Zoran, Mike, Cam, Coleman. Existing Slack notification infra already shipped for the marketing/content flow - reuse it, don't invent a second Slack path | GENERAL | queued | Open design Qs for the plan stage: one workspace with 4 channels vs group DMs; which ticket sources map to which team (client V2 tickets, website_change, staff bug reports); does admin get a digest or realtime |
| 21 | BAM NY has a broken half-seed: ghosted/nurture automation rows exist with ZERO steps - re-seed after PR #1601 merges | FRICTION | **parked (Zoran 2026-07-26: San Jose fully onboarded first, no BAM NY work until then)** | Found by the preset session's divergence data. Same re-seed motion as SJ's post-merge apply, so it'll be cheap to do later |
| 22 | Remaining Toronto hardcodes in the AI booking lane: `agent-approvals.js:294,364` (timezone passed into runAgent/runOpener) + `agent/booking.js:138,160` (default param) - the AI thinks in Toronto time when booking SJ trials. QUIET_TZ dispute SETTLED with evidence (tester, 2026-07-26): it is a parameter default only; every confirm/approvals/closing/automations call site passes the client tz explicitly, so SJ's quiet window IS computed in PT. | BLOCKER | UNBLOCKED, queued | Files are on the SIGN UP FEE session's do-not-touch list; coordinate with them before touching. Same class of bug as item 4, next in the tz series |

| 23 | TWO quiet-hours no-arg leaks: `agent-followups.js:345,460,461` and `automations.js:104` call `withinQuietHours()`/`nextSendableTime()` with NO tz argument, so follow-ups + drips respect Toronto's night, not the academy's (SJ parents could get texts at 6am PT) | BLOCKER | queued | Tester-proven with line refs. `automations.js` belongs to PR #1601's session: hand them that half; `agent-followups.js` is unclaimed, ours |
| 24 | Em-dash sweep of all agent prompt contexts (6 in the confirm agent alone) + add an explicit no-em-dash output rule to agent prompts; the AI can style-bleed them into person-facing replies since no output sanitizer exists | FRICTION | queued | Tester's ruling: fixing one of six buys nothing, needs its own ticket |

**Rebase warning for whoever ships the tz build:** the SIGN UP FEE branch changes `loadMergedOverrides(clientId)` to `loadMergedOverrides(clientId, "confirm")` at ~line 95 of `agent-confirm.js`. That second argument is LOAD-BEARING (resolves the academy's agent template + pricing-disclosure policy) and fails SILENT if dropped. Never resolve a conflict by reverting it.

**SJ session decisions a fresh session must not re-litigate:** pricing $175/$250/$300 per 4 weeks (the agreement PDF was STALE, never copy prices from it); 3mo repeats per 12 weeks, 6mo per 24; $40 signup on 4-weekly only; NO tax (leave Blueprint Sales tax empty); cancel anytime, no lock-in; public pricing removed from Programs page; CA compliance applied EXCEPT annual renewal reminder + auto-renew consent (deliberately deferred, still legally required under ARL); 10-Sessions package discontinued; all SJ automations dormant (approved:false) until go-live; 65+ imported leads have NO import quarantine - never mass-enable automations on them without Zoran naming who may be contacted.

## Zoran manual to-dos surfaced by the session poll (not builds)

| What | From session | Order matters? |
|---|---|---|
| Run Cole's SQL in Supabase (clients.payment_model + commission tables), THEN merge PR #1596 | Client Profile | YES: SQL first or the 7 call steps vanish for every client |
| Publish the 3 agreement terms docs via `scripts/publish-agreement.mjs` BEFORE any academy site deploys new enroll code | Enrollment agreement | YES: deploy-before-publish = checkout 409s |
| SJ agreement carries a draft banner that prints into the PDF; remove when counsel signs off | Enrollment agreement | blocks Lij taking real signatures |
| Delete the dead `whiteboard` Vercel project; relocate NOTION_TOKEN out of `whiteboard/.env.production` | Context engineering | no |
| **Send Lij the ask-list** (REVISED 2026-07-26, EIN demoted): Stripe connect, coaches (title+bio), photos, group size / coach ratio, member count, testimonials + Google Business link, gym address, privacy-policy + terms content, create his own Twilio account, opt-in language + 2 sample texts. EIN is no longer critical-path (he enters it into his OWN Twilio profile). Number-type question CLOSED, do not ask. Warn him: one-time outbound-texting gap of hours to ~2 days on Twilio cutover day, weeks AFTER launch; voice zero downtime, inbound SMS gap is minutes | SAN JOSE ONBOARDING | biggest Lij unblock |
| Get lawyer sign-off on the SJ agreement, then remove the draft banner + decide on the 6 italic "counsel confirms" notes (Zoran leaned remove) | SAN JOSE ONBOARDING | blocks real signatures |
| Confirm byanymeanssanjose.com is actually registered + pointed (set in client row, unverified) | SAN JOSE ONBOARDING | blocks any sends |
| Finish the FC2 GHL marketplace app config (distribution "Agency & Sub-Account" + oauth scopes) - in flight with the GHL TOKENS session | BUILD GHL TOKENS | 14 academies token-cold until done; SJ's token goes cold at next expiry without it |
| Review + merge PR #1587 (money model); then SJ's $40 signup fee can be entered once SJ's price catalog is seeded | SIGN UP FEE | unblocks queue item 5 files too |
| Flip Vercel toggle on bam-gta project ("Include source files outside Root Directory"), paste Meta CAPI token into `clients.meta_capi`; then merge bam-client-sites #116 + #1600 | GTA loading rate | #116 also unblocks queue item 6 (SJ funnel form) |
| GTA offer description still says "Regular training" and the agent quotes it verbatim - 30s edit in the offer wizard | engineering build | no |
| Ask Luka for fc-core-srvc repo access for zoran-star | engineering build | core parity review stuck since Jul 10 |

**Already done properly, do not rebuild:** preset stages/edges runtime-read from master; `seed-entry-points.js` fully manifest-driven; the 8 agent facts render live (incl. qualification values, "near Oakville" default already killed); quiet hours per-academy when tz set; master stage labels propagate.

**San Jose runtime values already captured:** owner "Elijah De Guzman", domain byanymeanssanjose.com (confirm registration before sends).

## SJ launch state (DB-verified 2026-07-26 by the gate-2 test room)

| Fact | Value |
|---|---|
| Client | BAM San Jose `5576acf0`, active, v2_access, tz America/Los_Angeles ✓ |
| Rails | ALL FIVE still GHL (contact/email/booking/messaging/pipeline); not on portal spine; 0 schedule_slots / 0 trial_bookings by design |
| Contacts | 536 synced, last sync today ✓ |
| GHL token | valid but expires 2026-07-27 07:24 UTC (TOMORROW) - confirm refresh fires |
| Stripe | not_connected (no payments possible) |
| Website | staging only (bam-client-sites.vercel.app/clients/bam-san-jose); domain NOT published; onboarding chunk "waiting" |
| Checklist | done: staff/brand/offers/locations/kpi/general/ghl_signup/slack · NOT done: meta_ads, athlete_map |
| **Gotcha** | `confirm_initial_automations` NULL → SJ sends ZERO trial confirmations even once live, until approved. Dormant-by-design today, but it becomes a "confirmations are broken" mystery at launch if forgotten |
| Data correction | GTA's stored time_zone is **America/New_York**, not America/Toronto (same clock; fix docs/scripts that assert otherwise) |

| # | Item | Severity | Status | Notes |
|---|---|---|---|---|
| 25 | GO-LIVE SWITCH LIST for SJ: approve `confirm_initial_automations` + enable drips (seeded, dormant) + re-enable nurture step 3 once real testimonials land + publish website + Stripe connect + verify domain + **set `clients.email_domain`** (else every SJ email HOLDS) + **set owner phone numbers** (else every guardrail alert is silent) + seed price catalog then enter the $40 signup fee | BLOCKER at launch | checklist | Each dormant-by-design thing must be flipped ON launch day; owner = orchestrator to walk Zoran through it |
| 26 | Verify SJ GHL token refresh actually fires before 2026-07-27 07:24 UTC expiry | BLOCKER | watch | Meta-token precedent: tokens have quietly died before. GHL TOKENS session owns the machinery |

**ALL FOUR PRs MERGED 2026-07-26:** #1601 (canonical no-hardcode preset), #1587 (pricing truth + money model T/S/C), #1602 (per-academy confirmation timezones), #1603 (memory notes). Main now carries the whole identity + pricing wave.

**LIVE NOW as of #1587:** GTA's agent quotes tax-inclusive truth ($226 / $315.27 / $850.89, exactly +13% HST, verified not a price rise) and has started volunteering the 2SIBLING 50%-off code (Zoran explicitly approved this). SJ's agent stays SILENT on price until its catalog is seeded, by design. `loadMergedOverrides` second arg verified surviving at all 6 call sites post-rebase; the `AGENT_TEMPLATES` disclosure mechanism is unchanged, which is the foundation item 34 builds on.

**Items 5 and 22 are now UNBLOCKED** (their `api/agent/*` files are no longer held by an unmerged branch).

**Timezone build (item 4): SHIPPED as [PR #1602](https://github.com/zoran-star/bam-os-requirements/pull/1602)** (2026-07-26). Migration applied, 33 null-tz clients backfilled to America/Toronto. Awaiting merge review.

## LAUNCH STRATEGY (Zoran's decisions, 2026-07-26 - do not re-litigate)

1. **San Jose launches ON THE PORTAL SPINE**, not GHL. Rails flip is now on the launch critical path.
2. **Phone is the undecided piece**: planning room spawned to verify Rosano's research (`bam-ghl-agent/docs/twilio-a2p-ghl-migration.md`) and decide. Critical-path fact: A2P Campaign approval = 10-15 days and needs Lij's EIN, so the phone likely gates the launch date. **EIN just became the most urgent item on Lij's ask-list.**
3. **Finish line = EVERYTHING on, including AI agents.**
4. **Big-bang launch**: website publishes and everything switches on at once, only after Zoran reviews all of it with Lij and all builds land. Item 25 is the switch list for that day.

| # | Item | Severity | Status | Notes |
|---|---|---|---|---|
| 27 | SJ portal-spine migration: flip all 5 rails off GHL (contact/email/booking/messaging/pipeline), pipeline shadow -> live, bookings to schedule_slots/trial_bookings | BLOCKER | queued | Calendar-off-GHL machinery exists (PR #1424) + Detail Miami handoff is prior art. Needs its own plan + rooms |
| 28 | SJ phone / Twilio | **NOT a launch blocker** | DECIDED 2026-07-26 | See the phone decisions block below. Launch runs on GHL transport; Twilio flips later |
| 39 | **SJ has NO phone numbers on ANY user** (all 4 `client_users` rows null, incl. owner Lij), and `staff_notify_phone` is null. Every owner-notification guardrail we build is INOPERATIVE for SJ: `notifyOwners` returns sent:0, so the tz alert and the domain-hold alert silently never reach Lij. Same for BAM NY | BLOCKER at launch | switch-list item | Data fix, not code. Both guardrails correctly roll back their stamp, so nothing is muted, but nobody is told either |
| 40 | **Lij's email mismatch**: `client_users.email` = elijah@3dsportsprep.com vs `clients.email` = elijah@byanymeanssanjose.com. **Zoran: byanymeanssanjose.com is CANONICAL.** NOT changed yet - that row has a linked auth user (`user_id` set), so changing the email may be his portal login. Confirm the auth path before updating, or he gets locked out | FRICTION | needs safe change | Phone now set on that row: +1 (408) 425-7251 (Zoran supplied for the record; do NOT fire test SMS at Lij mid-onboarding) |
| 42 | Resend has NOT verified byanymeanssanjose.com. Until it does, every SJ email correctly HOLDS under the new guardrail | BLOCKER at launch | switch-list item | Independently blocks the auto-release half of the gate-2 test |
| 41 | Lij has NO title and NO bio in `client_users` (has_title false, has_bio false), so the agent speaks generically about coaches by design | FRICTION | on his ask-list | Filling title + bio turns it into real credentials |
| 35 | `register-a2p.js:240` sends NO privacy-policy URL and NO terms URL - required by Twilio since 2026-06-30, so every campaign it submits today is REJECTED. Needs both, sourced per client (each academy has its own site) = schema touch, route via `align-core-data-model` | BLOCKER for any academy phone | queued | Found by the phone room |
| 36 | Wire the "connect existing Twilio account" path (paste Account SID + token) end to end - this is the path San Jose actually uses | BLOCKER for SJ phone flip | queued | Post-launch tail, not launch-gating |
| 37 | BAM's TrustHub primary profile is `twilio-rejected` (error 18602, EIN/legal-name mismatch). Blocks EVERY future academy under the subaccount model. SJ unaffected (Lij owns his own account) | BLOCKER for academy #3+ phone | planning room spawned | Timing risk: a fresh EIN takes 30-90 days to propagate; manual verification via trusthub-verify@twilio.com is 5-7 business days |
| 38 | Fix the stale LC Phone claim in `project_twilio_messaging_spine.md` (says LOA port-out 1-3 weeks; actually GHL's internal Number Migration Tool, 1-2 business days, no LOA) | FRICTION | queued | Memory hygiene |

## SJ PHONE DECISIONS (2026-07-26, do not re-litigate)

1. **SJ's number is LC Phone native** (Zoran confirmed first-hand). Exit = one GHL support ticket, 1-2 business days, no LOA.
2. **Lij owns his own Twilio account, PERMANENTLY** - not a bridge. BAM's TrustHub profile is rejected so a subaccount is blocked, and a temporary bridge would cost a SECOND full 10-15 day campaign review since A2P never transfers between Twilio accounts. Scenario A (BAM master + per-academy subaccount) remains the model for every OTHER academy.
3. **THE PHONE DOES NOT GATE THE SJ LAUNCH.** Big-bang launches when site/Stripe/drips/agents are ready, with texting and calling live day 1 via GHL transport inside the portal inbox. Twilio flips later via the existing staff Phone tab switch.
4. **Hard constraint:** SJ's GHL sub-account and contact sync must STAY ALIVE until the flip. Never cancel GHL mid-migration.
5. **The phone clock starts when SJ's SITE PUBLISHES**, not at EIN - Twilio has required live privacy-policy + terms URLs on every campaign since 2026-06-30, and SJ's site is staging-only. Site publish to Twilio live is ~3-4 weeks, dominated by the 10-15 day campaign review. A post-launch tail.
6. **Do NOT build** (all already exist, Rosano's doc premise is 3+ weeks stale): `client_twilio_numbers` table, `api/twilio/send-message.js`, `api/twilio/inbound-webhook.js`, merged-thread inbox UI.
| 29 | SJ nurture-3 quotes GTA's REAL testimonials re-attributed to San Jose | BLOCKER before approve | **HELD - Zoran's call executed 2026-07-26**: SJ's nurture step 3 (`automation_steps` id 9654a2d5, template:nurture-3) set enabled:false. Re-enable ON the launch switch list (item 25) once Lij's real testimonials are in. NOTE: divergence checker will now show SJ nurture as diverged - that's this hold, not drift | Toronto in nurture-1's global-camps list: KEEP (Zoran, brand-level fact) |
| 34 | **Agents state core price, tax, and added fees as SEPARATE LINES** (Zoran 2026-07-26). Must live on the sales-system preset + agent templates, NOT per academy: new academies inherit with zero code. Depends on #1587's Builds 3-4 (disclosure declared on AGENT_TEMPLATES) | BLOCKER for SJ launch | planning room spawned | Today the agent says "$200 to $279" and never mentions tax; #1587 swings to the tax-inclusive total ($226) as one number; Zoran wants the breakdown. SJ has NO tax + a $40 signup fee, so SJ is the proof case |
| 33 | GTA has a stale saved pricing note (`agent_prompt_sections` section_key=pricing, updated 2026-06-19) reading "$185 to $565 per month" - the archived Accelerate/Dominate ladder. INERT today (derived facts win via `Object.assign(overrides, derived)` in `_sections.js:69`) but it is the agent's script the moment `renderPricing` returns null | FRICTION | queued | Delete the row, or leave and rely on precedence. Found verifying PR #1587's blast radius |
| 32 | Google Reviews import (engineering wave "Build 5", spec exists, NOT started): sync + curate in Blueprint + feed agent social proof + display on sites. The durable source for SJ testimonials AND the proper fix for agent social_proof (item 5's content side) | GENERAL, launch-relevant | queued | Quick path meanwhile: add "your Google Business profile link" to Lij's ask-list; store as SJ's social_proof override so the agent cites HIS reviews, not GTA's |
| 30 | Blank-domain render traps (next unwired academy, not SJ): missed_trial#0 renders to EMPTY SMS that silently burns 3 attempts -> failed; ghosted#1 loses its whole value-prop sentence when the lead-in shares the dropped line | FRICTION | queued | Preset session's files (form-intro defaults); route to them. Leak-check 2026-07-26 |
| 31 | GTA survives on its LOCATIONS hardcode, not data: GTA's website_setup has NO domain, so clientVars returns empty for it. Backfill GTA's domain into the client row, then the LOCATIONS entry can retire | FRICTION | queued | Until then, deleting LOCATIONS kills every GTA link |

**Leak-check result (2026-07-26): 26 SJ renders, ZERO hits on byanymeanstoronto/zoran/oakville/gta.** Identity positive: byanymeanssanjose.com everywhere, Coach Elijah, BAM San Jose branding. One judgment call open: nurture-1's global-camps city list includes "Toronto" alongside Belgrade/Paris/etc (brand-level credentialing, byanymeansbball.com) - intentional per tester, Zoran to confirm. GTA sanity intact on all 13. FROM address still Toronto (item 3, planner working).

## Done

_nothing yet_
