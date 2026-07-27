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
| 3 | **SHIPPED [PR #1604](https://github.com/zoran-star/bam-os-requirements/pull/1604)** 2026-07-26. Zoran skipped gate 2 on the 86/86 machine test. All automation emails send FROM `info@byanymeanstoronto.ca` (`_email.js:18`, `_send.js:33-35`); only the human 1:1 lane uses per-academy from | BLOCKER | queued | Part of the #1 build |
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
| Run Cole's commissions SQL | Client Profile | **DONE 2026-07-26.** Both migrations applied to prod (onboarding_calls + commission_calculator), 8 new `clients` columns, 4 RLS policies live, APIs deployed. State is live but DORMANT: 46 clients, 0 with `payment_model` set, so nothing changes for any academy incl. SJ until Mike sets terms. Merged: #1596, #1609, #1612, #1614. Staff guide live with mockups. Migrations are idempotent, nothing is locked |
| ~~superseded~~ | **Order no longer matters.** PR #1596 merged 2026-07-26 (commit d0b48bd) plus #1609. Zoran made the whole scaling program STAFF-ONLY: `sm_call_1..7` carry `staff_only:true`, all client-side Business Profile UI removed, `client-portal.html` restored to main. Staff guide live at portal.byanymeansbusiness.com/guides/scaling-program.html. The SQL is the only remaining step and that session owns running it, so nobody double-applies |
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
| 62 | SJ has **0 entry_points and 0 funnels**: the one-click entry-point seeding leg never ran for it (mechanism exists and is idempotent, `client-portal.html:18904-18914`). One button press, not a structural hole | FRICTION | switch-list item | Found by the parity scout |
| 25 | GO-LIVE SWITCH LIST for SJ: approve `confirm_initial_automations` + enable drips (seeded, dormant) + re-enable nurture step 3 once real testimonials land + publish website + Stripe connect + verify domain + **set `clients.email_domain`** (else every SJ email HOLDS) + **set owner phone numbers** (else every guardrail alert is silent) + seed price catalog then enter the $40 signup fee + **re-run the one-click entry-point seed (item 62)** + **re-seed onboarding from the corrected master once #58/#59/#53 land (owned by the orchestrator, NOT the workshop room)** | BLOCKER at launch | checklist | Each dormant-by-design thing must be flipped ON launch day; owner = orchestrator to walk Zoran through it |
| 26 | **GHL token warmth: SJ launches ON GHL transport, so this is now LAUNCH-CRITICAL, not just hygiene.** Stored "agency" token is really a LOCATION token so it cannot mint sub-account tokens; 14 of ~30 academies already cold. Human-only fix: reconfigure the FC2 marketplace app (distribution Agency AND Sub-Account, add oauth.write + oauth.readonly, drop the junk scopes) then run agency connect once, choosing the AGENCY on the consent screen. Code (PR #1555, #1591) already automates re-minting once a valid agency token exists | BLOCKER at launch | Zoran, checklist on the board (HOLD until FC2 distribution unknown resolves) | **SJ token status 2026-07-26 16:56 UTC: HEALTHY, not cold.** 14.5h left, refresh token present, no error, contact sync ran 2 min prior, and it already self-refreshed once today, proving the refresh grant works for SJ. It should self-renew again tonight even if FC2 is never fixed. **But the refresh grant is SINGLE-USE: if any one refresh response is ever lost, SJ's refresh token dies and it goes cold with NO recovery.** That is precisely what killed the other 14. FC2 agency-mint is the durable fix that removes the single point of failure | Meta-token precedent: tokens have quietly died before. GHL TOKENS session owns the machinery |

**ALL FOUR PRs MERGED 2026-07-26:** #1601 (canonical no-hardcode preset), #1587 (pricing truth + money model T/S/C), #1602 (per-academy confirmation timezones), #1603 (memory notes). Main now carries the whole identity + pricing wave.

**LIVE NOW as of #1587:** GTA's agent quotes tax-inclusive truth ($226 / $315.27 / $850.89, exactly +13% HST, verified not a price rise) and has started volunteering the 2SIBLING 50%-off code (Zoran explicitly approved this). SJ's agent stays SILENT on price until its catalog is seeded, by design. `loadMergedOverrides` second arg verified surviving at all 6 call sites post-rebase; the `AGENT_TEMPLATES` disclosure mechanism is unchanged, which is the foundation item 34 builds on.

**Items 5 and 22 are now UNBLOCKED** (their `api/agent/*` files are no longer held by an unmerged branch).

**SJ EMAIL IS LIVE (2026-07-26 17:58).** Resend domain `byanymeanssanjose.com` verified on all 3 records, `clients.email_domain` set AFTER verification. From-address proved by extracting the real `fromFor` source and running it against live prod: SJ renders `BAM San Jose <info@byanymeanssanjose.com>`, GTA renders the byte-identical legacy string (no header drift for Toronto parents), and an unknown client still holds. No mail sent. SJ automations remain `approved:false` for launch day. Lij's Gmail re-confirmed at the authoritative nameserver: root MX still Google, no root SPF present, no collision with `google._domainkey`. Root cause of the 90-minute delay was the invisible-tab-from-a-table SPF paste, now a hard rule (item 52).

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
| 37 | TrustHub primary profile | LOW urgency, DECIDED | plan: `docs/plans/trusthub-profile-fix-plan.md` on `claude/vibrant-bhabha-f699ae` | See the TrustHub decisions block below. NOT blocking: every academy runs texting + calling on GHL transport meanwhile. Must NOT preempt San Jose work |
| 43 | **FullControl website must be LIVE** (reachable, not parked, not login-gated, names the legal entity visibly) - required at Twilio profile submission. This is the REAL long pole, not Twilio | BLOCKER for the 07-30 submission | Zoran's | Room's finding: Privacy Policy + Terms are campaign-time, not profile-time, which shortens the critical path a lot |
| 44 | Privacy Policy URL (with a no-sharing statement, not login-gated) + Terms of Service URL for FullControl - needed for every academy CAMPAIGN later, not for the profile submission | FRICTION | queued | Same content SJ needs for its own site |
| 45 | **Post-approval env swap (gate E):** `TWILIO_MASTER_ACCOUNT_SID`, `TWILIO_MASTER_API_KEY_SID`, `TWILIO_MASTER_API_KEY_SECRET` on Vercel prod AND preview (use `printf`, never `echo`), then set `TWILIO_PRIMARY_PROFILE_SID` to the approved SID - that flag un-gates the whole A2P chain. Verify `TWILIO_A2P_POLICY_SID` on first live run. Smoke test the subaccount chain on one academy | BLOCKER after approval | queued | |
| 46 | **Build an onboarding intake step for academy A2P data.** Every academy needs its OWN Secondary Profile + brand under its OWN EIN (one ISV brand cannot cover unrelated businesses). Each owner must supply legal name, EIN, CP 575-accurate details, live site, privacy policy, terms, and a rep on their own domain. Collect it at onboarding rather than chasing per academy | SCALE, high value | queued | Exactly the plug-and-play pattern Zoran wants |

## TESTIMONIALS TABLE: ONE TABLE RULING + 5 FIXES (TESTIMONIAL CONNECTION, 2026-07-27)

**Verdict: ONE TABLE. Do NOT create `google_reviews`; extend `testimonials`.** It is well shaped for manual quotes and already anticipates sync via `external_id` + the unique index on `(client_id, source, external_id)`. Two tables feeding the same render slots would be two sources of truth for the same quote, the exact bug class this workstream exists to kill.

## ⚠️ SECURITY VERIFICATION: 7 CLAIMS HOLD (EXECUTED), 2 REAL DEFECTS FOUND (2026-07-27)

Run against a throwaway local Postgres with faithful `authenticated`/`service_role` roles and the real `my_client_ids()`/`is_staff()` bodies. **Executed, not reasoned.**

**HOLDS:** google insert blocked (trigger fires before RLS), laundering blocked, per-column guard holds on quote/author/rating/review_created_at/external_id, starred-only update succeeds, manual CRUD works, google delete is a silent 0-row no-op, cross-tenant read returns 0 rows, service_role + staff both write google rows, index is rating-first, trigger order is `guard_source` before `updated_at`. Already covered: NULL source, `'Google'`, `' google '`, foreign `client_id` on insert and update, `ON CONFLICT (id)` upsert, flip-to-manual-then-delete. Migration genuinely UNAPPLIED, zero seed rows, zero academy literals. Render claims correct: `public_name || business_name` fallback, whole community line drops (same-line AND own-line lead-in), entire gold CTA `<table>` vanishes with no dead anchor.

**⛔ BOUNCE 1, BLOCKING - THE FABRICATED-RATING HOLE.** The migration STATES manual quotes carry no rating and "must never be shown as if it did", but nothing enforces it. **Executed:** an academy inserted `source='manual', rating=5, author='Sarah K.'` with forged `external_id`/`review_created_at`/`synced_at` and produced **4 rows, avg_rating 5.0**. The `source` LABEL is locked; the **SUBSTANCE of the Miami failure - invented names plus a fabricated 5.0 aggregate - is still fully reachable, just badged `manual`.** It also contradicts Zoran's hierarchy ruling, which currently lives only in prose. **Fix (written and regression-checked by the verifier):** extend `testimonials_guard_source` (INSERT branch `:289`, else branch `:314`) to RAISE when a NON-STAFF caller sets `rating`, `external_id`, `review_created_at` or `synced_at` on a manual row. Trigger-level, not a CHECK, so staff/service can still seed. **Ship no reader aggregate until this lands.**

**⚠️ BOUNCE 2, advisory.** The guard short-circuits on `current_user in ('service_role','postgres','supabase_admin')` (`:282`), so a **`SECURITY DEFINER` RPC owned by postgres bypasses BOTH RLS and the trigger** - proven by executing one. None exists today, but **this repo writes SECURITY DEFINER RPCs as a habit** (`update_client_basics` is one, in this very migration). Needs a comment at `:274`: no SECURITY DEFINER function may ever write `testimonials`.

**Nits:** `relforcerowsecurity` false (table owner bypasses RLS, normal for Supabase); `anon` gets 0 rows rather than an error, fine now but **the future public free-trial cards will need a read policy.** **No collision** with the `CLIENT_SELECT_COLS` fix (hunks at 26317-33795 vs the constant at 60790). Open question: `public_name` is hydrated via the `_bbGenHydrateTax` side-channel because it sits outside `CLIENT_SELECT_COLS`; now that the fix adds three columns to that constant, does `public_name` belong there too?

**Five gaps sent back to the builder while the migration is still UNAPPLIED** (cheap now, expensive after it ships):
1. **NO `rating`** - the blocker. "Starred first, then highest-to-lowest, below 4 never displays" and the aggregate header are all uncomputable without it. `rating smallint check (rating is null or rating between 1 and 5)`, null for manual.
2. **NO `review_created_at`** - `created_at` is when OUR row was written. On first sync every review would look like it arrived today, and the free-trial cards display review dates.
3. **Render-order index is wrong**: `(client_id, starred desc, created_at desc)` is newest-first; the confirmed rule is rating-first. Wants `(client_id, starred desc, rating desc nulls last, review_created_at desc)`.
4. **NO `synced_at`** - no way to reconcile edits or deletions on Google's side.
5. **⚠️ RLS LETS AN ACADEMY WRITE ITS OWN `source='google'` ROWS.** The four policies allow insert/update/delete on any row regardless of source, so an academy could edit a real Google review's text or insert a fabricated one stamped `google`. **That is precisely the fabrication this workstream exists to prevent.** Google rows must be service-role written and read-only to the academy EXCEPT toggling `starred`; manual rows stay academy-writable. **This one must not ship as written even if the others slipped.**

**TWO REFINEMENTS from AUTOMATION TEMPLATING, sent to the builder:**
- **The RLS fix must PIN the value, not check it.** Not an application check, and not a policy that merely inspects `source`: the academy-facing insert policy should pin `source = 'manual'` (WITH CHECK style), so an academy literally cannot write a google-sourced row no matter what the client sends. **The whole reason this hole matters is that the application is exactly what we do not trust.** An academy able to insert a fabricated `source='google'` row is the Miami failure with a database blessing on it.
- **Zero rows must be distinguishable from rows-but-none-starred.** Both mean "do not send the testimonials email", but zero rows means **we never asked**, while rows-but-none-starred means **they gave us quotes and chose not to feature any**. The onboarding completion detector needs that difference, so nothing may collapse the two states. `starred` must also be readable per academy, since starred decides which quotes render.

**⚠️ AN EARLY WIN NOBODY PLANNED, needs Zoran's re-ruling.** The same migration adds `clients.google_review_url`, a per-academy public Google review link. **That fixes the `social_proof` leak with NO Business Profile API, NO OAuth and NO Google approval**: populate the column, point `renderSocialProof()` at it, move GTA's hardcoded link into GTA's row, and the leak closes in DAYS instead of after a weeks-long approval. Zoran ruled "leave it until we connect" when connecting meant full Build 5; this is a much cheaper kind of connected, so the ruling is worth re-asking on that basis.

**⚠️ A TENSION FOR ZORAN.** `source='manual'` is by definition a testimonial with no Google review behind it, so the table permits what his directive ("no testimonials anywhere unless Google reviews are connected") prohibits. The room's read, which I share: the real target was borrowed and fabricated quotes, not an academy's own honest ones. Its recommendation, to be mocked up for him: **manual quotes are allowed, must be that academy's own, and NEVER get review framing** - no star rating, no "Google review" label, no contribution to the aggregate. **Stars and review badges become things only synced Google rows can earn.**

## #69 FIXED, AND IT IS BIGGER THAN FIRST FOUND (2026-07-27)

**The mechanism is two halves, not one.** (a) `CLIENT_SELECT_COLS` omits the columns so the card reads `undefined` and renders blank; (b) the `update_client_basics` RPC treats those columns as `CASE WHEN patch ? key THEN NULLIF(val,'')`, so key-present-plus-empty-string writes NULL. `business_name`/`owner_name`/`email` survive only because the RPC gives THEM `COALESCE(NULLIF(...),col)`, which ignores blanks. **The SELECT is the root cause; the RPC's asymmetry is why it destroys rather than merely blanks.**

**Fixed:** `legal_name`, `address`, `ein` added to the select, plus a `_bbGuardBlanks(patch, keys)` guard wrapping `_bbGenChanged` and `_bbStaffOwnerChanged` so an unhydrated field is never written at all. **Plus a fourth victim the builder found: `phone` on the Staff card owner block, 5 academies exposed, same mechanism, fixed.**

**⚠️ TWO MORE VICTIMS, NOT FIXED, and this CORRECTS an orchestrator error.** I asserted `brand_data` hydrates async "by design". **That is wrong**, and I verified the correction myself: the only assignment to `row.brand_data` is inside the PATCH path (`:26271`), and the one async read (`_bbLoadSitePages`) returns `site_pages` locally and never writes back to the row. So **`brand_data` (11 academies) and `kpi_data` (7) also render blank**, and `_bbBrandChanged`/`_bbKpisChanged` post a full object of empty strings which the RPC's `COALESCE(patch->'brand_data', col)` writes wholesale. `_bbGuardBlanks` CANNOT cover them, since the patch value is a non-blank object. **The real fix is async hydration of the Brand and KPI cards: a separate build.** `tax_config` and `public_name` genuinely DO hydrate async and are fine.

**⛔ VERIFICATION ROUND 2: 40/44 pass, ONE BLOCKER - the fix reintroduced the bug through its own guard.** `:26308` `missing.forEach(k => { row[k] = data[k] })` assigns **unconditionally**, so an in-flight response clobbers keys the save-mirror (`:26272`) wrote during the window. **Proven end to end on the TrustHub fields:** on a slow fetch a user types their legal name and EIN off the IRS letter, it saves correctly, the stale response resets the cache to NULL, the card re-renders blank, and the next keystroke NULLs both. Fix is one line: `if (!(k in row))`. The builder tested the race it designed for (save before hydration) and not the inverse one (hydration lands after a save succeeded). Also: **B2** `_BB_COL_INFLIGHT` stores a lazy PostgREST thenable that issues a fresh request per `then()`, so the dedup does nothing and two callers fired 2 selects; store a settled promise. **B3 latent:** the save-mirror creates `row.brand_data` for any patch, so presence-equals-loaded is held by call-site discipline, not by the loader.

**⚠️ MERGE ORDER IS NOT OPTIONAL:** migration `20260727140000` must land BEFORE this HTML. Folding `public_name` into the single `_BB_GEN_COLS` select means an early HTML ship 400s PostgREST and takes **the whole General card plus the Staff card's phone** unhydrated and unsaveable - strictly worse than the foundation's separate flag, which failed only `public_name`. Also, "delete the conditional spread" taken literally removes `public_name` from the patch so it never saves: it must become an unconditional key AND be added to the `_bbGuardBlanks` array, not only to `_BB_GEN_COLS`.

**✅ DECIDED (Zoran, 2026-07-27): CARD-SCOPED HYDRATION, not a wider login payload.** `CLIENT_SELECT_COLS` runs at every login and fetches for **every academy the user can access** - Zoran's own login covers **38 academies, 7 with an EIN on file**. RLS scopes it correctly so nothing leaks, but federal tax IDs should not sit in a browser payload every session for a card that is rarely opened. So `legal_name`, `address`, `ein`, `phone` and `public_name` all hydrate on the Business Basics card via the existing `_bbGenHydrateTax` side-channel (which already carries `tax_config`), **one path for all five**. The `_bbGuardBlanks` guard becomes load-bearing rather than belt-and-braces, since a save firing before the fetch returns is now the exact failure case.

**⚠️ SEQUENCING TRAP:** `public_name` is gated by `_bbGenPublicNameLoaded`. If the hydration shape changes without the flag changing in the same commit, **the field silently stops saving** - a quiet failure, not a visible one. One owner must hold the flag and the hydration together: extend it across all five, or replace per-field flags with a single "basics hydrated" signal. No half-migrated mix.

| 72 | **SECOND unguarded writer of `legal_name`/`ein`/`address`: the onboarding wizard's registration page** (`client-portal.html:18617`). `_OBF_STATE` initialises those three to `''` at `:18136`, so **a failed state fetch plus a click on "Save registration details" NULLs all three.** Pre-existing, separate from #69, same three columns and same blast radius. **Note: the #69 builder explicitly reported this page was "not a victim"; the verifier proved otherwise** | BLOCKER | queued | Found only because the tester was told to look for what the builder did not think to try |
| 70 | Async-hydrate the Brand and KPI cards. Same data-loss class as #69 but needs hydration, not a blank guard: `brand_data` (11 academies) and `kpi_data` (7) render blank and are written back wholesale as empty objects | BLOCKER | queued | Do not attempt with `_bbGuardBlanks`; the patch value is a non-blank object |

**⚠️ COLLISION, resolution already worked out:** the fix and the foundation build both edit `_bbGenChanged`. Keep the foundation's `public_name` spread INSIDE the fix's `_bbGuardBlanks({...}, [...])` wrapper, and leave `public_name` OUT of the guarded key list so its own loaded-flag stays the sole authority and a deliberate clear still works.

**No repair of already-NULLed rows was attempted.** Assessing and repairing existing data loss is a separate decision for Zoran.

## ⚠️ #69 LIVE DATA-LOSS BUG, orchestrator-verified 2026-07-27

`CLIENT_SELECT_COLS` in `public/client-portal.html` **omits `legal_name`, `address` and `ein`** (confirmed: only `business_name` of the four is present). They therefore render blank on the Business Basics card, and **every keystroke on that card NULLs them via the RPC.** Prod exposure confirmed by query: **10 academies have a legal name, 12 have an address, 7 have an EIN.**

**Why this is worse than it sounds:** legal name, address and EIN are exactly the three fields the Twilio TrustHub submission must copy character-for-character off the IRS CP 575. Losing them silently would break the submission that gates every academy's phone number, and there are only 3 free resubmissions.

**INTERIM: do not edit the Business Basics card until this is fixed.** Pre-existing, not introduced by the foundation build; that build added a hydration guard so its own new `public_name` field cannot repeat the pattern.

## ⛔ ITEMS B AND C ARE CANCELLED (Zoran, 2026-07-27)

"We don't need that weekly check since our goal is to set up the sales system in a way where it's either the preset or custom stuff that gets edited."

**A structural fix replacing a detective one, and it is the stronger of the two.** If `sync_class` makes every row explicitly preset-owned or academy-owned at WRITE time, and owners have no free-text override, the drift class cannot silently form. The weekly check was always a workaround for an ambiguous boundary; removing the ambiguity is better than detecting its consequences.

**Deleted:** item B (override-tracing reverse check), item C (weekly GitHub Action + "Preset drift" issue), **the CI credentials decision** (he had chosen a read-only key in Actions secrets; now moot, nobody provisions that role), and **the seven-day governance window question** (evaporates with the check).

**NOT deleted, and now more load-bearing:**
1. **`sync_class` is now the ONLY mechanism**, not belt-and-braces beside a safety net. The strictest-wins rule (`attributed > local > shared`, template beats step) IS the enforcement.
2. **Item G matters MORE.** GTA is currently drifted (4 hardcoded sales steps, 2 orphan sequences). The structural model only holds once GTA actually IS the clean reference, so cleaning it is what makes the model true on day one rather than housekeeping.
3. **The override-tracing METHOD survives as design guidance**, not as a build item: "does anything override this value on the path to output, and does that override fail open or closed" is exactly what a builder needs when wiring blocks and resolvers.

**⚠️ MANDATORY IN THE BUILDER CONTRACT (added 2026-07-27):** dropping the check also removed the only thing that would have caught **a builder getting `sync_class` wrong**. Under the old plan a mis-marked row surfaced in a weekly issue; under the new one, **a row marked `shared` that should have been `local` is indistinguishable from a correct one until it has already propagated.** That is not an argument to bring the check back, it is an argument that the `sync_class` write path is now a single point of failure with no detection behind it and therefore **needs a TEST, not just a code review**.

**The specific assertion that must exist:** a step whose body is `template:<key>` resolves to the TEMPLATE's class **even when the step row says `shared`**. That is the exact case where a wrong answer is invisible and expensive, because it is how real people's words would silently start travelling between academies.

**⚠️ HONEST RESIDUAL:** the structural model assumes nobody edits GTA's rows as a special case any more. The weekly issue would have caught that; nothing does now. Fine while GTA's rows ARE the preset, but **a genuine GTA one-off must be marked `local` at the moment it is written or it silently becomes everyone's.**

## THE 13 ANSWERS (AUTOMATION TEMPLATING, 2026-07-27). These are the builder contract.

**MARKING.** (1) Template vs step conflict: **THE STRICTEST WINS**, `attributed > local > shared`. A step marked `shared` pointing at an `attributed` template resolves `attributed`. Reason: the marking protects content, content lives in the template, and a step-level loosening would let someone un-protect real people's words by editing a row they thought was about timing. (2) Column DEFAULT `'shared'`, **no backfill needed** for the ~46 existing academies: resolution reads the template first and the column is only an override, so absent means inherit. (3) `attributed` means BOTH, at different layers: **the CONTENT never travels; the STEP still seeds so the sequence keeps its shape, but `enabled:false`.**

**BLOCKS.** (4) **CODE, no migration.** Blocks are a declarative array in the template module. Per-academy block rows would only be needed if owners edited blocks directly, and owner copy routes through support tickets instead. (5) Order is fixed in the template array; blocks are independent siblings so middle ones vanishing is fine. The zero-facts welcome email renders 5 of 9 blocks and still reads correctly. (6) Each block declares `needs: [field paths]`; a resolver checks them against the assembled vars **BEFORE** render - same principle as `dropEmptyShellLinks` but decided up front rather than stripped after.

**CHECKER.** (7) Compares master defaults in CODE against the reference academy's LIVE rows. **⚠️ CREDENTIALS ARE AN OPEN DECISION**, deliberately not left to a builder: a dedicated READ-ONLY key in Actions secrets (never the service role; the script never writes), or fall back to a Vercel cron that already holds creds posting to the issue with a GitHub token. (8) **The verdict describes THE REFERENCE ACADEMY'S position relative to the master.** AHEAD = GTA has something the master lacks (8 onboarding steps vs 3) -> promote into the master. BEHIND = GTA lags the master (a hardcoded literal where the master has a token) -> fix the academy row. (9) Only the reference is listed key by key; every other academy is ONE collapsed line unless genuinely MISSING or EMPTY, so 46 academies stay readable.

**SAN JOSE.** (10) **DIFF-AND-PATCH, always.** SJ's `nurture-3` is `enabled:false` deliberately and a naive re-seed re-enables it. Keep the seeder's edit-safe zero-steps check; add-if-absent by key and position; **NEVER touch an existing row's `enabled` flag.** Verify nurture-3 is still disabled before AND after seeding. (11) **Same code path as a new academy: MANDATORY.** `applyPreset` + `seedAutomations`, not a one-off script, or San Jose is not a test of the standard.

**REVIEWS.** (12) **⚠️ THE QUOTE-FREE VARIANT IS SUPERSEDED.** Zoran ruled that an **empty testimonials store means the email is DROPPED, not shortened.** No variant gets built. Empty store, no email; it returns when real testimonials are typed in. **This removes the Build-5 dependency from the critical path entirely** and means manually typed testimonials are the near-term unblock, with Google sync as enrichment.

**GOVERNANCE.** (13) Who finds out first when someone edits GTA: **the weekly issue, so up to SEVEN DAYS of an unreviewed change that is implicitly a claim on every academy.** The room's view: acceptable **only because promotion is manual** - a seven-day detection lag costs nothing while nothing propagates without a human deciding to promote it. **It becomes unacceptable the moment anyone automates promotion**, so that is a standing constraint, not a preference. Zoran accepted "GTA becomes a governed instance" with the trade named, but **the seven-day window specifically was never put to him.**

**ITEM 11 DONE:** `scripts/render-messages.mjs`, parameterised by `--client <uuid>` / `--name "BAM San Jose"` / `--data <snapshot.json>` for no-database runs. It IS phase 6's review page: switcher across automations, every message in send order through the real path, **stable refs (CON1, GHO1, NUR3, ONB2) so notes point at something exactly**, disabled steps visibly marked, and a **"did not render, and why"** block. Verified against a GTA fixture: 4 automations, 4 SMS, 7 emails, all three render paths, and it correctly reported "the coach contact line did not render, `clients.phone` is empty". **⚠️ THREE RENDERERS NOW EXIST**: this one, `render-gta-emails.mjs` (local), and `sj-message-preview.mjs` (MERGED TO MAIN, PR #1615). `render-messages.mjs` supersedes both; the other two should be folded in or deleted rather than left to rot.

## FINAL BUILD BRIEF (Zoran confirmed 2026-07-27: "let's build it"). Supersedes the earlier item list.

**⚠️ HEADLINE CHANGE FROM EVERYTHING ABOVE: the preset is NOT "copy GTA's emails to everyone".** Structure travels; **five designed emails are AUTHORED PER ACADEMY.** That is a RECURRING per-academy cost, not a one-time promotion.

**⚠️ ONBOARDING IS OUT OF THE SALES PRESET.** Zoran moved it: it is post-conversion, and the code already models it as `postConversion` rather than a stage engine. With onboarding out, **the sales preset is 93% photocopyable.**

**Final classification:** Contact Form / Trial Form / Missed Trial = 100% photocopyable (Missed Trial already is, zero changes). Ghosted = 100% after 3 domain swaps + **DELETE the owner first name from step 3** (templated reads "It's coach from <academy>", no owner name; it appears in exactly ONE place across all 11 emails, so a single removal not a sweep). Nurture: nurture-4 travels as-is; **nurture-1 + nurture-2 are FULLY CUSTOM including the frame**; nurture-3 templated pending testimonials. Onboarding: welcome is now FULLY PHOTOCOPYABLE (online-programs and bring-a-friend lines DROPPED from the master entirely); training/story/era fully custom, and story+era are the same two designs as nurture-1/2 with the trial button stripped, so they are **authored ONCE at academy level and both skills read them**. Summer Special = GTA-only, parked against the reignition flow. Trial Follow-up = DELETE. **"Fully custom" means the ENTIRE email including the frame** (Zoran was explicit twice).

**The two skills.** A = "free-trial sales system": 5 automations, builds 4 alone, proposes 2 emails. B = "member onboarding": 1 automation, 8 steps, proposes 1 email, reuses what A settled. **Operator = INTERNAL BAM STAFF, not owners.** Phases: READ / CHECK READINESS / PROPOSE IN CHAT / CONFIRM / BUILD / RENDER+REVIEW / INSTALL DORMANT. **Phase 3 covers FULLY CUSTOM EMAILS ONLY**; everything photocopyable builds silently and never reaches the chat. Phase 3 output is PLAIN TEXT IN CHAT: the angle, full copy, sources quoted back, and what it refused to claim. Guardrail wording: **the skill will not INVENT a fact, but staff CAN supply one** - it is not a block on humans. **Staff edits are the academy's own and NEVER propagate**; GTA's setup is not changed by any of this.

**Readiness check replaced the diagnose step.** The 9-type selling-point taxonomy was deleted: it never decided anything and 4 of 9 types had no slot to fill. Replaced with a null check plus a length heuristic keyed to the exact field each email reads: READY / THIN / EMPTY, and EMPTY drops the slot.

**BUILD ITEMS, IN ORDER:**
1. ✅ **DONE 2026-07-27 by the orchestrator.** Backfill `website_setup.domain` from `brand_data.domain`. Verified first: GTA's was NULL while brand_data held it, so dropping the "duplicate" first would have stripped GTA's website from live messages. 10 clients backfilled incl. GTA + Miami; 2 empty strings cleaned to absent. `brand_data.domain` untouched until its readers move.
2. Parent-facing name field beside legal name in Business Basics. `business_name` is the INTERNAL label ("BAM GTA") and is what `{{location.name}}` renders today, so parents read internal shorthand. **Its hint must change too** - it currently claims to be "how customers know you".
3. New `testimonials` table (id, client_id, quote, author, source manual|google, starred, created_at). **Nothing exists today.** Do NOT wire to `onboarding_feedback.testimonial` (that is the OWNER reviewing BAM, opposite direction). GTA preset with its own real parents; **SAN JOSE STAYS EMPTY** - presetting it recreates the Miami fabrication exactly. Also feeds the free-trial page cards, which is where Miami happened.
4. Community group link + platform label, in Training offer setup -> Onboarding section. Whole line drops with no link.
5. Google review link. No link = no button, not a dead one.
6. **Two new wizard steps: "Approve your follow-ups"** (Offer->sales, after Apply the Free Trial preset) and **"Approve your welcome messages"** (Offer->onboarding, after the onboarding form). The preset step's own subtitle already promises "Nothing texts anyone until you approve it" **and that approval has never existed as a step.** Full wizard rule: `_OBF_STEPS` row + `_obfFetchState` detector + `_OBF_SECTIONS` key, all three.
7. `brand_data` cleanup: keep 12, drop 3 (stats, domain, website_url), move 3 (site_pages, website_status, references), decide on 1 (proof). Readers to adapt: `MarketingView.clientWebsiteFrom` and `action-items.js` both read domain+website_url; ContentView BrandCard renders a "Stats" row. Replace stats with DERIVED values.
8. Re-shell onboarding-welcome/-training/-review onto the tokenized shell (they draw their own header/footer with GTA's wordmark, OAKVILLE, domain, Instagram typed in).
9. Emails must wear `brand_data`: they hardcode gold `#E2DD9F` while the brand token is `#D4B65C`. Both academies' logo URLs are still placehold.co, so the frame needs a real-logo check.
10. Delete `trial_followup`. Detokenize GTA's 4 sales steps. Record `summer_special` as an accepted divergence.
11. Parameterise `scripts/render-gta-emails.mjs` by client id (it IS phase 6's review page).
12. The override-tracing reverse checker + weekly drift issue.

**⚠️ ORCHESTRATOR-VERIFIED, and worse than reported:** `brand_data.stats` for GTA claims "Mon/Wed/Fri evening training". Live `schedule_slots` are **Mon, Tue, Wed, Thu, Sat - GTA has NEVER trained on a Friday.** It also claims "43+ active members" against a real 47. San Jose's stats claim "Tue, Wed and Fri evening training" for an academy with ZERO slots that has not launched. This is not merely stale prose, it is **currently-wrong content**, and it is the argument for deriving stats rather than typing them.

**OPEN DECISIONS SURFACED, needing Zoran:**
- **(a) THE SALES AGENT READS ZERO `brand_data`.** `fact-render.js` and `prompt-structure.js` touch none of it. The agent has no idea the academy has a story or a why-us; its selling points come only from `offer.data.value`. A gap of omission, separate from the cleanup. **Escalated to Zoran.**
- (c) `wants_about_page` is read by `api/website/team.js` and is stored for neither academy: a field the code expects that nobody ever set.
- (d) Owner copy changes route through SUPPORT TICKETS with no free-text override, so **each such ticket is now a master-vs-local decision.** Whoever owns the ticket queue needs to know.
- (e) **Nothing re-syncs when `brand_data` changes**; the skills are one-shot. Zoran's call: handle as a support ticket. Named rather than left implicit.

**SAFE, checked:** `bam-client-sites` reads none of `brand_data`. Nothing in item 7 can break a live academy site.

**✅ PUSHED 2026-07-27.** `claude/optimistic-leavitt-db0107`, 8 commits, 36 files, +4975/-381. Builders can now read: `scripts/render-messages.mjs` (the one renderer, parameterised), `scripts/lib/annotate.mjs`, `scripts/annotations/bam-gta.mjs`, `scripts/snapshots/{bam-gta,bam-san-jose}.json`, `docs/plans/gta-automation-map.html`, `email-skill-rework.html`, `skill-run-example.html`, `docs/plans/emails/*.html` (11 annotated), `docs/plans/review/` (a live phase-6 review page), and the rewritten `docs/automation-message-harness.md`.

**⚠️ NO PR IS OPEN, and the branch DELETES a file that is on main.** The consolidation removes `scripts/sj-message-preview.mjs` + `.sh` + `.data.json` (-357 lines), which merged to main as PR #1615. Intended, and the doc explains it in place. **But while the branch stays unmerged, main keeps the old renderer and the two diverge.** Worth a PR once the wave completes rather than leaving it open-ended.

## PRESET SYNC PLAN: ZORAN'S 7 DECISIONS (2026-07-27, locked). Plan doc `docs/plans/preset-two-way-sync-plan.html`

1. **GTA is the REFERENCE IMPLEMENTATION**, and he took this knowing the trade: **GTA is now a GOVERNED INSTANCE.** Every edit to GTA's rows is a claim on every academy, and GTA's 4 hardcoded sales steps become bugs to fix, not GTA's business.
2. **Delivery = a weekly GitHub Action** opening/updating ONE issue titled "Preset drift". Not a portal view, not Slack.
3. **Marking = `sync_class` (shared | local | attributed)** set on the TEMPLATE so steps inherit, plus a column on `automation_steps` defaulting to `shared`. Attached to the smallest addressable unit so it generalises to stages/offers/agents/calendars.
4. The 3 GTA-shelled emails: **re-shell all 3**, collect the missing facts in onboarding.
5. **Emails become ordered BLOCKS.** A block renders when its fact exists, vanishes when it does not (same fail-to-empty rule as the website link). His condition: **onboarding MUST actually ask for the facts**, or auto-on silently means auto-off.
6. **No free-text owner copy override.** Copy changes route through the support ticket system, so every word stays staff-authored and therefore promotable; the ticket becomes the master-vs-local decision point.
7. **Orphans: DELETE `trial_followup`** (zero enrollments ever, duplicate of `trial_form` which has run 30x). **Summer Special stays GTA-only, PARKED, recorded as an ACCEPTED divergence** (armed but never fired, so unproven not battle-tested). Future workstream in his words: "standardizing a reignition flow for sales presets".

**CORRECTION (sync room, orchestrator-verified 2026-07-27):** the claim that "the nurture default is 3 plain SMS vs GTA's 4 designed emails" is **WRONG** and came from the parity scout. `NURTURE_DEFAULT` at `form-intro-automations.js:117-131` is ALREADY 4 designed email steps (`template:nurture-1..4`), tokenized, spread over ~8 weeks. Verified on origin/main. The 3-plain-SMS sequence is `ONBOARDING_DEFAULT`, which is item 53/D. **Nothing extra folds in, and nobody should re-tokenize `nurture-emails.js`; #1601 already cleaned it.** Nurture's only difference from GTA is the step-3 testimonials hold, handled as `attributed`.

**REVISED BUILD ORDER (two waves).** H first: it is the only item leaking with NO seed step between the default and a parent. Everything else needs a seed or a send to do damage; H is already doing it. Wave 2 lands after wave 1 so the first checker run is a real baseline rather than a list of things already in flight.

| Wave | Item | What | Severity |
|---|---|---|---|
| 1 | **H** | Neutralize agent-brain defaults + give `social_proof` a renderer | BLOCKER, **do first** |
| 1 | **G** | Clean GTA's rows: delete `trial_followup`, detokenize the 4 hardcoded sales steps, record `summer_special` as an accepted divergence | **BLOCKER** (promoted from SCALE 2026-07-27: the structural model is only TRUE once GTA actually IS the clean reference, so this is a precondition, not housekeeping) |
| 1 | F | Onboarding wizard collects the 4 new facts (gates E, **shares the review-link field with H**) | FRICTION |
| 1 | E | Re-shell + block-ify the 3 GTA-shelled onboarding emails | FRICTION, largest |
| 1 | D | Promote `ONBOARDING_DEFAULT` 3 -> 8 (needs A) | FRICTION |
| 2 | **A** | `sync_class` + testimonials brake (gates D) | BLOCKER |
| 2 | B | Override-tracing reverse check | SCALE |
| 2 | C | Weekly GH Action -> one "Preset drift" issue | SCALE |

**~~ROUTE ONCE, NOT TWICE~~ RETRACTED by the sync room 2026-07-27:** the review-link field closes **ONE** leak, not two. It feeds `onboarding-review`'s CTA only. `social_proof` stays as-is because Zoran ruled LEAVE on it until Google is genuinely connected. **Do not brief a builder on the two-leak framing.**

**THE GATE MOVED (Zoran, 2026-07-27).** He did not want the 4 user stories. He wants **every automation GTA runs, one per screen, with a switcher, colour-coded by whether it is in the free-trial preset, every message annotated with what the academy must configure.** His words: "from there I can plan out where we're gonna collect information and how we're gonna set up the master sales system preset for the automations, and derive it from GTAs." He is not reviewing the plan; he is **using GTA's live set as the worksheet to author the master from.** Better sequence: the master gets designed off what actually runs, not off a description of it.

Artifacts, both pushed on `claude/optimistic-leavitt-db0107`:
- **`docs/plans/gta-automation-map.html`** (73b58db) - the one he is working from. All 8 GTA automations, live bodies from prod, 6 gold (in the free-trial preset: contact_form, trial_form, missed_trial, ghosted, nurture, onboarding) and 2 grey (summer_special, trial_followup). Every message annotated with one of six sources, literals highlighted **inline in the copy**: `AUTO` we hold it · `ASK` academy supplies at onboarding · `LEAK` GTA literal hardcoded today · `NEVER` belongs to real people, does not travel · `BRAND` same for every academy · `DROP` GTA carries it, the master will not.
- `docs/plans/preset-convergence-mockup.html` (8aa374d) - the 4 user stories, still valid, superseded as the gate.

**FIELD DECISIONS (Zoran, these shrink item F from 4 fields to 2):**
1. **Coach contact number -> comes from the BUSINESS NUMBER.** Not a question. Field removed.
2. **Community group link -> KEPT**, and he placed it: the onboarding section of the **TRAINING OFFER SETUP** part of the client onboarding wizard. Not a standalone new section, so the builder does not choose placement.
3. **Online programs URL -> DROPPED.** His reasoning: do not assume academies have online programs.
4. **Refer-a-friend perk -> PARKED**, not dropped.
5. **Google review link -> still needed**, for `onboarding-review`'s button.

**Q13 going back to Zoran, not answered by the room:** who finds out first when someone edits GTA's rows, given a weekly check means GTA can carry an unreviewed change for up to seven days that is implicitly a claim on every academy. Correct handling; that is a decision, not an answer.

**The other 12 answers land with the finalised plan.** The room is deliberately not answering against a master design Zoran is actively rewriting. **His pass through the map IS the master spec, and that is what the builder gets briefed from, not the earlier item list.**

**ZORAN'S CALL on the fail-open fork:** defaults go **neutral-or-empty, and the fail-open STAYS.** His reasoning: an agent with no fallback improvises, which is worse than a gap. The bug is what it falls back TO, not that it falls back. Once no default carries a real academy fact, failing open is harmless. Plus **a test asserting no default body contains an identity value**, drawing the identity set from where `email-shells.js` already resolves it. That test is what stops recurrence; cleanup alone would not. This unified both surfaces under one rule: **no fact, no output** - in an email the block does not render, in the agent brain the section is absent from the prompt.

**⚠️ WIDER THAN A LEAK, ADD TO #59:** `fact-render` fails open TWICE (`if (!data) return {}` at :567 AND the bottom catch also returns `{}`). An academy with no training offer inherits GTA's program (ages 9+, groups of 6-12), schedule, pricing, policies, AND a coaches line claiming every coach "played at the college or professional level". **That last one is a FALSE CLAIM for a new academy, not merely a leak.**

**Checker design (constraint landed, item B rewritten):** the original spec would have detected BEHIND by scanning step bodies for known identity values - exactly the literal-grep that produced three false positives. Now it traces the override path: no override on the path to output -> LEAK; override that fails OPEN -> LEAK; override that replaces unconditionally -> DEAD; override that fails CLOSED -> SAFE. AHEAD stays a pure structural diff (step counts, template refs, channels, timings), needing no literal scanning. **DEAD is a REPORTED verdict, not silence** - if the checker omits dead literals, the next human to grep re-raises the same false positive.
| Item | What | Severity |
|---|---|---|
| A | Testimonials brake: `sync_class` + attributed marking + seed disabled + **the quote-free variant folded in from the guardrail room** | BLOCKER, before/with D |
| B | Reverse pass in `check-automation-divergence.mjs`: MATCH / AHEAD / BEHIND / HELD / ACCEPTED / MISSING / EMPTY | SCALE |
| C | Weekly GH Action keeping one "Preset drift" issue current | SCALE |
| D | Promote `ONBOARDING_DEFAULT` 3 steps -> 8 | FRICTION |
| E | Re-shell + block-ify onboarding-welcome / -training / -review | FRICTION, largest |
| F | Collect 4 new facts in the onboarding wizard | FRICTION |
| G | Clean GTA's rows (delete trial_followup, detokenize 4 sales steps, record summer_special) | SCALE, small, first |

**⚠️ BUILDER GOTCHA:** `clients.address` for GTA is "2205 Rosemount Cres" - that is the BUSINESS address. The gym in the welcome email is 1079 Linbrook Rd, Oakville. **Venue must come from `schedule_slots.location_label`**, which is also correct for an academy training in multiple places. Weekly schedule + venue come FREE from `schedule_slots` (GTA 86 rows, Miami 157); coach phone = `clients.phone` (column exists, empty for GTA). Only 4 genuinely new fields: review link, community group link + platform, online programs URL, refer-a-friend perk.

**PROCESS GATE (Zoran, 2026-07-27):** the sync room must show him a **MOCKUP of the user stories** and get his confirmation BEFORE any build. Sequence is fixed: mockup -> his confirmation -> plan to the orchestrator -> builder subagent -> then seed San Jose in that chat.

## ⛔ #71 LIVE ONE-CLICK PATH TO THE MIAMI FAILURE (found 2026-07-27, fix in flight)

**Editing a step's COPY in the portal silently RE-ENABLES a step a human deliberately turned off.** `api/automations.js:819` builds a full row with `enabled: b.enabled === undefined ? true : !!b.enabled` and PATCHes the whole row; `client-portal.html` calls upsert-step in two places and **neither sends `enabled`**. The edit is about wording; the side effect is switching a message back on.

**Orchestrator-verified against prod:** **BAM San Jose's `nurture` step at position 2 is THE ONLY DISABLED STEP IN THE ENTIRE SYSTEM**, across all 46 academies. It is `template:nurture-3`, which carries BAM GTA's real parents' testimonials attributed via `{{location.city}}`. **Anyone opening it to tweak wording turns it back on and San Jose starts sending another academy's real customers' words as its own.** One click, no warning, no audit trail.

Pre-existing, not introduced by this workstream. **It also silently defeats `sync_class`**: the seeder correctly seeds attributed steps disabled, and this hands that guarantee straight back. Server-side fix in flight (preserve `enabled` on update unless explicitly supplied) plus a regression test, deliberately not touching `client-portal.html` to avoid colliding with the Business Basics work.

**Orchestrator survey of the pattern class, done:** `enabled: b.enabled === undefined ? true` at `:819` is the **only** instance of reassert-a-default-on-PATCH in the whole `api/` tree. Every other PATCH in `automations.js` sends a narrow explicit patch object. **The foundation builder's change to that file is a SELECT-list widening only** (adding `public_name`, `community_group_*`, `google_review_url` to `loadClient`), so it does not repeat the shape.

## ⛔ ITEM G IS DROPPED (Zoran, 2026-07-27): "wait i dont want to change anything that GTA has"

And his follow-on hard rule: **"GTA's automations must never actually change throughout this process, only the structural stuff behind it."**

**Item G does not survive its own justification.** It existed because the ORIGINAL plan had a weekly drift checker that would flag GTA-vs-master differences forever. Zoran killed the checker; nothing compares them now, so the reason went with it.

**The middle piece was actively harmful.** "Detokenize GTA's 4 sales steps" meant replacing the literal "By Any Means Basketball" with `{{location.name}}` - which renders **"BAM GTA"** today. It would have taken a live message reading "It's coach from By Any Means Basketball" and made it read "It's coach from BAM GTA": **worse copy, to real parents, to satisfy a check that no longer exists.** The other two pieces were litter removal with zero functional gain and a written note.

**What replaces it:** write down that GTA's rows deliberately differ from the master, same shape as the 7-vs-8 record, so a future session does not "fix" the difference. "GTA is the reference" becomes descriptive rather than literal, which costs nothing once nothing compares them. **This also unblocks San Jose seeding earlier**, since G was gating it.

**Already-caught regression from this rule:** three of GTA's rendered emails HAD changed today from the re-shell - a footer reading "because you enquired about" to people who have PAID and joined, plus two dropped content sections. Resolution: **GTA keeps them, the master ships without them**, which is exactly what marking those templates `local` means. A builder is restoring GTA's output byte-for-byte and adding a permanent **golden-snapshot guard** so "GTA does not change" stops depending on anyone remembering.

## ⚠️⚠️ ACCEPTED DIVERGENCE: THE MASTER SHIPS 7 ONBOARDING STEPS, GTA RUNS 8. THIS IS DELIBERATE.

**Read this before "fixing" the gap.** `ONBOARDING_DEFAULT` ships with **SEVEN** steps. GTA's live sequence has **EIGHT**. The missing one is the **testimonials step**, and it is ABSENT rather than present-and-disabled, on purpose.

**Why it looks like a bug and is not:** under GTA-as-reference, master-lagging-GTA is exactly the failure this whole workstream exists to fix. So a future session will see the gap, promote the testimonials step to close it, and **ship GTA's real parents' quotes to every academy.** That is the original Miami failure with extra steps.

**What closes it, and the ONLY thing that closes it:** the testimonial connection build. It inserts one step between `era` (position 6) and `review` (position 8). Nothing else may close this gap.

`NURTURE_DEFAULT` keeps its 4 steps, because `nurture-3` already exists and is already held `enabled:false` per academy. The connection changes what fills it, not whether it is there.

**The seam contract the connection must satisfy** (documented, deliberately unimplemented): ONE function answering "which testimonials should this academy's emails show", honouring `starred`, returning manual and google rows together, with the drop rule (empty store means the step does not ship) enforced **at seed time, not render time**.

**Nothing is stubbed.** No resolver exists, not even one returning empty: a function answering "none on file" looks harmless but gets unpicked, because the real one needs a different shape once google-sourced starred rows exist.

## ✅ DECIDED: THE TESTIMONIAL HIERARCHY (Zoran, 2026-07-27). Tier 1, locked, auto-propagating.
**Real reviews always outrank typed ones.** Order: pinned Google reviews -> pinned typed quotes -> remaining Google reviews highest-rating-down -> remaining typed quotes newest-first. Under 4 stars stays owner-card-only. **A pinned typed quote still sits BEHIND a pinned real review.** A typed quote **never wears a star rating, never wears a "Google review" badge or a date, and never moves the aggregate.** The hierarchy is tier 1 (locked, no per-academy reordering); the quotes themselves are tier 3.

**⚠️ THIS RULE MUST BE ENFORCED IN THE DATABASE, NOT PROSE.** Verification proved an academy can currently insert `source='manual', rating=5, author='Sarah K.'` with forged `external_id`/`review_created_at`/`synced_at` and produce a 4-row, avg 5.0 aggregate. See the bounce below.

## ✅ DECIDED: `brand_data` ownership (Zoran, 2026-07-27)
**ONE builder owns both** the #70 hydration fix and the templating wave's `brand_data` cleanup (item 1c), so a single agent owns that column's read path, write path and shape together. Splitting them means two builders reasoning about the same hydration.

## ORIGINAL, superseded: the hierarchy was open
Proposed by the reviews chat, put to Zoran, popup dismissed, so **NOT decided and deliberately not propagated.** It matters to the active templating track because it governs which quote leads in the testimonials email:
- Pinned Google reviews -> pinned typed-in quotes -> remaining Google reviews highest-rating-down -> remaining typed quotes newest-first. Under 4 stars stays owner-card-only.
- A pinned typed quote still sits BEHIND a pinned real review.
- A typed quote never wears a star rating, a "Google review" badge or a date, and never moves the aggregate.
- The hierarchy is tier 1 (locked, auto-propagating, no per-academy reordering); the quotes themselves are tier 3.

## ⏸ SERIALIZED: ONE TRACK AT A TIME (Zoran, 2026-07-27)

Two parallel design processes were overstimulating. **AUTOMATION TEMPLATING runs alone; TESTIMONIAL CONNECTION is parked and surfaces nothing until it finishes.**

Order: templating wave completes -> then the reviews chat reads **what was actually built, not what was planned** -> updates its plan against that reality -> builds the connection and ties it in.

**Templating holds off on testimonial-dependent parts.** The rule stands (empty store = the email does not ship) but the wiring is not built now. **Park blocked items rather than stubbing them**, since a stub that must be unpicked is worse than a gap, and design the seam deliberately as an attachment point for the later build.

**Parking costs nothing**: the empty-store rule already took Google Business Profile work off the critical path, so nothing waits on the reviews chat. Its highest-value output is already banked in the migration (the one-table ruling and all five gaps, including the RLS hole).

## BUILD 5 / GOOGLE REVIEWS NOW HAS AN OWNER: the **TESTIMONIAL CONNECTION** chat (2026-07-27)

Spec'd twice, never started, and the handoff's own audience line ("a NEW chat building this end to end") was never acted on. That chat now exists. Its sequence, set by Zoran: scan -> visual mockup for him -> **WAIT for the automation templating build** -> verify that build against its plan -> report to the orchestrator -> Zoran confirms -> then read what was actually built and update its plan against reality.

**⚠️ LIVE TABLE COLLISION handed to it to resolve.** The automation foundation builder is creating `testimonials (id, client_id, quote, author, source manual|google, starred, created_at)` RIGHT NOW, while the Build 5 handoff specifies `google_reviews (google_review_id UNIQUE per client, author_name, rating, text, review_created_at, starred, synced_at...)`. `testimonials.source` already accepts `'google'` and both carry `starred`. **Nobody reconciled them.** Open question for its plan: is `testimonials` the unified surface Google reviews sync INTO, are they two tables with a join, or should one absorb the other? Two sources of truth for the same quotes is the exact bug class this workstream exists to kill. If the in-flight table is shaped wrong, redirect the builder before it lands.

**⚠️ The long pole remains unfiled:** the Google Business Profile API application. Days to weeks, and every fabricated 5-star card and borrowed testimonial stays live until it clears. Now on Zoran's action list via that chat's card.

## TESTIMONIAL GUARDRAIL: ZORAN'S RULINGS (2026-07-27). Plan doc `docs/plans/testimonial-guardrail-plan.html`

1. **nurture-3 + onboarding-testimonials -> QUOTE-FREE VARIANT.** Drip still sends on schedule; the quote block drops out until the academy has reviews connected. **The only build item from that room**, folded into sync item A. Rationale: approving a drip is a routine click that would otherwise newly switch on re-attributed GTA quotes.
2. **CH3 minors' full names on the public URL -> KEEP AS IS.** Flagged, considered, closed. No build item. (Item 65 closed by decision.)
3. **"Google review" labels on GTA + Miami free-trial pages -> LEAVE** until Google is connected, then replace with real synced reviews.
4. **Agent `social_proof` leak -> LEAVE** until connected. (Item 63 deliberately deferred, not rejected.)
5. Build 5 + the Google API access request -> routed to the "ORCHESTRATOR" session (worktree `bam-v2-engineering-build-fc4f9d`).

**⚠️ BUILD 5 READINESS IS 0%**, not partially wired: no `google_reviews` table, no Business Profile OAuth (`api/google-oauth.js` is per-staff CALENDAR connect), no sync cron, no `api/website/reviews.js`, no Blueprint card, no `renderSocialProof()`, zero place ids stored. Reusable: the Google Cloud project with `GOOGLE_CLIENT_ID/SECRET` in prod plus the login/callback pattern.

**⚠️ THE LONG POLE IS NOT OUR CODE: the Google Business Profile API application HAS NOT BEEN FILED.** Days to weeks for approval, and nothing per-academy syncs until it clears. Second prerequisite: each academy's Google Business Profile must be manageable by an account we can OAuth as. San Jose cannot be usefully connected at all yet: unlaunched, no review history.

**⚠️ THE CONVERGENCE RISK, already proven once:** Miami's free-trial cards are GTA's three quotes rewritten with Miami names, badged "Google review" with a fabricated "5.0 Average across Google reviews" aggregate (`clients/detail-miami/detail/freetrial.jsx:532-565`). **The clone path ALREADY carried review-shaped content to a second academy.** The convergence wave is a clone path at scale, so attributed-marking must catch this class BEFORE the wave runs. Also corrected: `templates/academy-starter` has ZERO testimonials, so scaffolding does not fail open; the clone risk is GTA's own client folder.

## THE AUTOMATIONS DIRECTIVE (Zoran, 2026-07-26, locked - supersedes open questions)

"The free trial sales system preset should have a DEFAULT PRESET OF AUTOMATIONS in the preset pipelines similar to BAM GTA's, just more templatized. When I onboard new academies onto that sales system preset, they get the SAME automations, templatized to them."

What this settles:
1. **GTA is the reference implementation.** The master defaults = GTA's live automation system with identity templatized (name, owner, city, domain, links as tokens). Not a separately-authored lighter version.
2. The two-way sync room's design question ("is GTA the reference or is the master authored?") is ANSWERED; it now plans the CONVERGENCE (one build wave to GTA-parity templatized) plus the mechanism that keeps it there.
3. Items 53 (onboarding 8 steps), the nurture default (4 designed emails, not 3 SMS), 56 (GTA's 4 hardcoded sales steps come UP to token parity), and 57 (orphans get a preset-or-exception ruling) all fold under this directive.
4. The exception class stands: attributed content (real parents' quotes, testimonials) NEVER auto-propagates (#55). Identity is always a runtime fact.
5. Copy review default: improvements Zoran requests go to the MASTER unless identity or an explicit, recorded divergence.

## PRICE-BREAKDOWN DECISIONS (Zoran, 2026-07-26, do not re-litigate)

1. **Shape = stacked receipt**, total LAST and bolded, never total-first, never a sentence:
   `Plan: $279.00` / `HST (13%): $36.27` / `Total: $315.27 every 4 weeks`. A skimming parent cannot leave holding only the small number.
2. **RANGE mode says ONE all-in band**: "$226.00 to $315.27 every 4 weeks, HST included" and nothing more. No pre-tax band in a first-touch text. The breakout appears the instant they ask "is that before tax", because the agent HOLDS all three components in every mode. **RANGE governs what it volunteers, never what it knows.**
3. **A one-time sign-up fee is ALWAYS named with the price**, in every mode including RANGE. Deliberate change to the old "do not volunteer added fees" rule: SJ's $40 moves the first payment from $150 to $190, which is a price, not a footnote. The waiver on 3/6-month becomes the nudge to the longer term.

**Derivation: RECONCILE, NEVER DIVIDE.** `total` = `offer_prices.amount_cents` (what Stripe charges, never derived); `base` = the owner's typed offer price via `source_offer_price_key`; `tax` = `total - base` in integer cents, so the lines ALWAYS sum to the charged amount. Before printing, re-run the same `_fees.js` call `match-prices` used to build the Stripe price; a mismatch to the cent prints the TOTAL ALONE plus an admin flag. Division (total / 1.13) was REJECTED: it assumes the fee was a percent, invents a base nobody typed, and can never fail, so a mis-flagged row would emit a confident fake tax line. Verified live: GTA's three routable rows reconcile exactly.

**NO SCHEMA CHANGE**, explicitly: adding `base_cents` to `offer_prices` would be a second copy of a number the offer already holds, and copies drift, which is the exact fault this whole workstream exists to fix.

**Ownership = preset, not academy.** ONE new property beside the existing one on `AGENT_TEMPLATES` in `presets.js`: `{ runtime:"booking", disclosure:"range", breakdown:"itemized" }`. Extends #1587's Builds 3-4 rather than a parallel mechanism. All templates ship "itemized", so academy #5 inherits via `resolvePresetKey -> templateForRuntime -> breakdownForTemplate` with zero code, and a master edit to that one line reverts GTA + Miami + SJ together with no academy row touched.

**6 files, no migration, no wizard change:** (1) `fact-render.js` `derivedFactOverrides` must add `tax_config` to the clients select - it is NOT fetched today and without this the whole build is inert; (2) `renderPricing` signature to `(data, prices, taxConfig)` + reconciliation; (3) `presets.js` breakdown + `breakdownForTemplate()`; (4) `prompt-structure.js` extend the three `PRICING_DISCLOSURE` bodies; (5) `preset-master.js` carry breakdown beside disclosure; (6) brain view in both portals, second read-only badge.

**Degradation:** no `tax_config` = no tax line and NEVER the words "no tax". Empty catalog (SJ today) = `PRICING_NOT_CONFIGURED`, unchanged. Reconciliation failure = total only + flag. Tax-exclusive jurisdictions explicitly OUT of scope, flagged not pre-built.

**Fee half is only testable** against a scratch config until SJ's $40 is entered, and SJ's `offer_prices` catalog must be seeded first regardless.

## TRUSTHUB DECISIONS (2026-07-26, do not re-litigate)

1. **New Twilio master account under FullControl.** FullControl is a registered legal entity with its own EIN, so it becomes the ISV/Reseller filer and academies become subaccounts. The old rejected profile `BU3557...f0bd` and old master account are ABANDONED, not repaired.
2. **A new account does NOT fix error 18602.** The rejection is an EIN + legal-name records lookup, not an account-level flag. The entity correction is the fix; the new account is for architecture. Both happen at once.
3. **Doing it now is nearly free**: `TWILIO_PRIMARY_PROFILE_SID` was never set, so the A2P chain has never run. Zero brands/campaigns/numbers to lose, only 3 env vars point at the old master. Switching AFTER brands exist would be expensive, since A2P never transfers between accounts.
4. **Submit immediately, do NOT wait for the EIN to age.** FullControl's EIN is ~2-3 months old, inside Twilio's 30-90 day propagation window. Counterintuitive but correct: a rejection is free AND it is the required first step of the manual-verification fallback, because Twilio support needs a failed submission to act on. Waiting has cost and no benefit.
5. **Target: Thursday 2026-07-30.** Mon 07-27 Zoran pulls CP 575 + sets up a rep email on the FullControl domain; Mon-Wed the FullControl site goes live; Thu 07-30 create account + submit; Sat 08-01 the 48h result. If 18602 again: Mon 08-03 open a Twilio ticket with the CP 575 attached, 5-7 business days, approved ~Wed 08-12. Plan for the fallback branch.

**CORRECTIONS (approval-odds scan, 2026-07-26):**
- **Resubmission is NOT unlimited: THREE free resubmissions, then paid Support.** Earlier note said "no documented retry limit" - wrong. Documented at the brand stage but treat 3 as the working budget everywhere. This is NOT a guess-and-retry loop; submit once, copying off the CP 575.
- **The fallback is a named, paid appeal**: routes to manual vetting by Twilio's ecosystem partner, costs **$10**, takes the CP 575 as a **PDF**, 5-7 business days. Twilio explicitly names newly issued tax IDs as a valid appeal reason, which is exactly our situation.
- **The date is unchanged**: submit Thu 07-30, worst case approved ~08-12.
- EIN age ~60-90 days clears EVERY stated minimum (Twilio 30-90 day propagation, GoHighLevel warns under 45, practitioner guides say 15), sitting at the optimistic end. Strengthens "submit now, do not wait".
- **New rejection causes folded in:** never abbreviate the legal name and no DBA (LLC vs L.L.C. is its own rejection); entity line only, not member names printed on the CP 575; official registered address not a branch, and USPS-deliverable because Twilio validates against the USPS database; the website needs a custom domain plus visible business name AND logo, since a bare landing page is what fires error 18601; register the minimum brands per EIN.
- **Consistency feeds a Trust Score that governs message throughput**, so a sloppy approval still costs daily send volume.

**Zoran must personally gather:** IRS CP 575 for FullControl (if lost, request a 147C by phone, adds lead time) · exact legal name character-for-character OFF THE CP 575 (not a W2/W9, formatting differs) · EIN as `00-0000000`, never a DUNS for a US entity · physical address matching tax records, no PO box, entered via Console autocomplete · authorized rep with real title + job position, E.164 phone, email ON the FullControl domain (gmail/info@ fail the brand) · Twilio account created, upgraded off trial, billing added.
| 38 | Fix the stale LC Phone claim in `project_twilio_messaging_spine.md` (says LOA port-out 1-3 weeks; actually GHL's internal Number Migration Tool, 1-2 business days, no LOA) | FRICTION | queued | Memory hygiene |

## SJ PHONE DECISIONS (2026-07-26, do not re-litigate)

1. **SJ's number is LC Phone native** (Zoran confirmed first-hand). Exit = one GHL support ticket, 1-2 business days, no LOA.
2. **Lij owns his own Twilio account, PERMANENTLY** - not a bridge. BAM's TrustHub profile is rejected so a subaccount is blocked, and a temporary bridge would cost a SECOND full 10-15 day campaign review since A2P never transfers between Twilio accounts. Scenario A (BAM master + per-academy subaccount) remains the model for every OTHER academy.
3. **THE PHONE DOES NOT GATE THE SJ LAUNCH.** Big-bang launches when site/Stripe/drips/agents are ready, with texting and calling live day 1 via GHL transport inside the portal inbox. Twilio flips later via the existing staff Phone tab switch.
4. **Hard constraint:** SJ's GHL sub-account and contact sync must STAY ALIVE until the flip. Never cancel GHL mid-migration.
5. **The phone clock starts when SJ's SITE PUBLISHES**, not at EIN - Twilio has required live privacy-policy + terms URLs on every campaign since 2026-06-30, and SJ's site is staging-only. Site publish to Twilio live is ~3-4 weeks, dominated by the 10-15 day campaign review. A post-launch tail.
6. **Do NOT build** (all already exist, Rosano's doc premise is 3+ weeks stale): `client_twilio_numbers` table, `api/twilio/send-message.js`, `api/twilio/inbound-webhook.js`, merged-thread inbox UI.
| 29 | SJ nurture-3 quotes GTA's REAL testimonials re-attributed to San Jose | BLOCKER before approve | **HELD - Zoran's call executed 2026-07-26**: SJ's nurture step 3 (`automation_steps` id 9654a2d5, template:nurture-3) set enabled:false. Re-enable ON the launch switch list (item 25) once Lij's real testimonials are in. NOTE: divergence checker will now show SJ nurture as diverged - that's this hold, not drift | Toronto in nurture-1's global-camps list: KEEP (Zoran, brand-level fact) |
| 34 | **SHIPPED [PR #1606](https://github.com/zoran-star/bam-os-requirements/pull/1606)** 2026-07-26. Agents state core price, tax, and fees as SEPARATE LINES | BLOCKER for SJ launch | **SPEC DONE, UNBLOCKED** (#1587 merged 14:36; the room's "blocked on #1587" note is stale). Plan: `docs/plans/agent-price-breakdown-plan.html` on `claude/quirky-lichterman-3569d2`. Ready for a builder | Today the agent says "$200 to $279" and never mentions tax; #1587 swings to the tax-inclusive total ($226) as one number; Zoran wants the breakdown. SJ has NO tax + a $40 signup fee, so SJ is the proof case |
| 33 | GTA has a stale saved pricing note (`agent_prompt_sections` section_key=pricing, updated 2026-06-19) reading "$185 to $565 per month" - the archived Accelerate/Dominate ladder. INERT today (derived facts win via `Object.assign(overrides, derived)` in `_sections.js:69`) but it is the agent's script the moment `renderPricing` returns null | FRICTION | queued | Delete the row, or leave and rely on precedence. Found verifying PR #1587's blast radius |
| 32 | Google Reviews import (engineering wave "Build 5", spec exists, NOT started): sync + curate in Blueprint + feed agent social proof + display on sites. The durable source for SJ testimonials AND the proper fix for agent social_proof (item 5's content side) | GENERAL, launch-relevant | queued | Quick path meanwhile: add "your Google Business profile link" to Lij's ask-list; store as SJ's social_proof override so the agent cites HIS reviews, not GTA's |
| 30 | Blank-domain render traps (next unwired academy, not SJ): missed_trial#0 renders to EMPTY SMS that silently burns 3 attempts -> failed; ghosted#1 loses its whole value-prop sentence when the lead-in shares the dropped line | FRICTION | queued | Preset session's files (form-intro defaults); route to them. Leak-check 2026-07-26 |
| 31 | GTA survives on its LOCATIONS hardcode, not data: GTA's website_setup has NO domain, so clientVars returns empty for it. Backfill GTA's domain into the client row, then the LOCATIONS entry can retire | FRICTION | queued | Until then, deleting LOCATIONS kills every GTA link |

**Leak-check result (2026-07-26): 26 SJ renders, ZERO hits on byanymeanstoronto/zoran/oakville/gta.** Identity positive: byanymeanssanjose.com everywhere, Coach Elijah, BAM San Jose branding. One judgment call open: nurture-1's global-camps city list includes "Toronto" alongside Belgrade/Paris/etc (brand-level credentialing, byanymeansbball.com) - intentional per tester, Zoran to confirm. GTA sanity intact on all 13. FROM address still Toronto (item 3, planner working).

## Done

_nothing yet_
