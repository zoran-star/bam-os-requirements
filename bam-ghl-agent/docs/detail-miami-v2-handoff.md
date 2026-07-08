# DETAIL Miami V2 - handoff (2026-07-08)

**The goal (Zoran):** everything tie-able is tied to an offer, and DETAIL Miami runs
fully in the portal - **except texting + calling, which stay on GHL** until Twilio
(and contacts stay GHL-backed with them: GHL can only message contacts it holds -
they flip together on the Twilio cutover, never before).

Living memory note (update it, don't fork): [`memories/project_detail_portal_native_plan.md`](../memories/project_detail_portal_native_plan.md)
Client id `4708a68d-5365-48bf-a404-72a69fadd34d` · GHL location `RBnlVgmXNMbFpgFGPGcv` · Training offer `7d82f15e-db2e-45e5-9f22-9de86ff88254`.

## Where DETAIL is right now

| System | State |
|---|---|
| Tier | 🟢 **V2** (`v2_access=true`, 2nd V2 client after GTA) |
| Pipeline | 🟢 **portal-native** (`pipeline_provider='portal'`, 49 opps + 4 stages, all offer-tied) + **GHL mirror bridge** (`pipeline_ghl_mirror=true`, cron every 10 min - because Detail's ~17 GHL sales workflows still create/move cards AND send the nurture texts) |
| Pricing | 🟢 Mike's Stripe match done: 17 confirmed rows, **all USD, exact base amounts** (the no-HST + account-currency fix verified live) |
| Sellable program / typed prices | 🟡 **one page-visit away**: open Blueprint → Offers once - `_msFire()` auto-runs the new make-sellable bridge (entitlements derived: 1x/week→1 credit/wk, 2x→2, Unlimited→unlimited) |
| Calendar | 🟡 machinery deployed + dormant (`api/schedule/sync-offer.js`); dry-run the moment the program exists, then `booking_provider='portal'` |
| Members | 🔴 0 - import via the Sorter after the program lands |
| Email | 🟡 wizard live (Settings → Domains): type `detail-mia.com` → paste DNS → auto-flips to Resend. `RESEND_INBOUND_SECRET` verified SET |
| Website | 🟡 rebuilt GHL-free site ALREADY STAGED (`bam-client-sites/clients/detail-miami/` - Home/ADAPT/FreeTrial/Rentals/VirtualAcademy/enroll, offer-driven). Cutover wizard live but **needs one-time env: `VERCEL_TOKEN` + `VERCEL_SITES_PROJECT_ID`** |
| Entry points | 🟢 1 (MS/HS calendar, offer+stage tied). Elementary DELETED (Zoran). ⏳ a `form` entry point still needed for the staged site's lead form |
| Calls in the portal | 🟢 audited: every call surface shows "Call in GHL" (member-drawer bug fixed) |
| Texting/calling + contacts | 🔒 GHL **by design** until Twilio (Phase 2: master account + TrustHub - not started) |
| EIN | 🔴 still missing - gates offer publish + systems buildout only |

## Offer-tie audit (2026-07-08)

**DETAIL: 100% of what exists is tied** (prices 17/17, stages 4/4, cards 49/49, entry point 1/1, landing pages levels 1+2 staged). **GTA reference:** machine fully tied (automations 8/8, kpi_events 32/32, typed prices 31/31, funnel_events 202/225 offer-tagged); untied = legacy data + by-design academy-level rows; small cleanup candidates: 8 legacy members, 1 entry point.

## The activation checklist (in order)

1. **Open Blueprint → Offers on Detail** (anyone, once) → toast "Plans are now bookable and sellable." → verify: `bookable_programs` = 1, `offer_prices` ≈ 9 for the Training offer.
2. **Calendar:** POST `/api/schedule/sync-offer` `{ client_id, offer_id, dry_run:true }` (staff JWT) → eyeball templates (DETAIL Academy Mon/We/Fr 18:00-20:00 cap 25, credit_cost 0) → real run → flip `booking_provider='portal'` → re-run the test booking (proves webhook + card → Schedule Trial + KPI).
3. **Members:** Sorter import (Stripe + CSV) → cleanup/promote → link GHL contacts (`_moRunGhlLink`).
4. **Form entry point:** create for the staged site's FreeTrial form → route Interested + Training offer.
5. **Email:** run the Domains wizard with `detail-mia.com`; DNS paste = Mike or whoever holds the registrar.
6. **Website:** add `VERCEL_TOKEN` + `VERCEL_SITES_PROJECT_ID` (+`VERCEL_TEAM_ID` if team) to the bam-portal Vercel env → run the website wizard → DNS flip retires the GHL funnel. Do both DNS changes in one sitting.
7. **Automations (retires the mirror bridge):** rebuild Detail's ~17 GHL sales workflows as portal automations - **needs Mike's message copy** (same gate GTA had). Until then GHL workflows keep texting (fine - texting stays GHL) and the mirror keeps the board synced.
8. **EIN** from Mike → publish the Training offer (buildout gate).
9. **Phase 2 (later): Twilio** master + TrustHub + A2P → port the LC number → `messaging_provider='twilio'` → THEN `contact_provider='portal'` → GHL fully retired.

## Built this session (all merged to main)

| PR | What |
|---|---|
| #1251 | Max-capacity field on Training offers · Path B transformation + spec · pricing fixes (no auto-HST, account currency, added-fees wired via `api/_fees.js`) |
| #1255 | Transformation reads the real wizard shape (`data.schedule.classes`, `data.general_info.capacity`) + dormant `api/schedule/sync-offer.js` |
| #1257 | miami-lead mints the portal store card (provider-gated - the pipeline flip-stopper fix) |
| #1260 | `api/ghl/cron-sync-pipeline.js` mirror bridge (+ `clients.pipeline_ghl_mirror`) |
| #1264 | Member-drawer Call → "Call in GHL" fallback (call audit fix) |
| #1265 | Email domain wizard (`api/email/domain-setup.js` + `clients.email_setup`) |
| #1266 | Wizard in the CC dock Settings pop |
| #1268 | Website domain wizard (`api/website/domain-setup.js` + `clients.website_setup`) |
| #1270 | make-sellable auto-tie (`api/offers/make-sellable.js` + `_msFire()`) |

## Gotchas (bitten once already)

- **Never SQL-write `offers.data` while someone has the wizard open** - `_bbAutoSave` writes the whole blob from client memory (use jsonb_set merge if unavoidable).
- Wizard fields live at `offer.data[sectionId][key]` (classes = `data.schedule.classes`, capacity = `data.general_info.capacity`).
- The mirror bridge: NEWER-WINS + portal-close-is-final guards protect Mike's drags; accepted gap = portal drags don't write back to GHL (stage-conditional workflow steps see stale stages).
- Squash-merges desync the working branch → every PR needs the merge-origin/main + `checkout --ours` dance (verify other sessions' commits survive - #1261-63 did).
- Runtime endpoints (`/api/runtime/*`) are staff-JWT only; owner-triggered flows use the temp-staff mint pattern (`withStaffToken` in sync-offer.js / make-sellable.js).
- Detail's GHL token in `clients` auto-refreshes via `pickGhlToken`; usable for direct GHL API reads/backfills.

## Future (parked, decided)

- Entitlement rules become an explicit field in the offer wizard's pricing section when academies turn on the parent app (name-derivation is the interim).
- Offer Map level 3 (offers auto-create their funnel pages) - endgame, enroll proves the pattern.
- GTA cleanup: 8 legacy members + 1 entry point unlinked.
- Detail kpi_events: 2 early lead events untagged (cosmetic).

## Next-session prompt (paste this, or run /detail-continue)

> Continue the DETAIL Miami V2 setup. Read `bam-ghl-agent/docs/detail-miami-v2-handoff.md` and `bam-ghl-agent/memories/project_detail_portal_native_plan.md` first. Goal: everything tie-able tied to the Training offer, Detail fully in the portal except texting/calling (GHL until Twilio). Start by checking whether the make-sellable activation happened (bookable_programs + offer_prices for client 4708a68d-5365-48bf-a404-72a69fadd34d) - if yes, dry-run `api/schedule/sync-offer` and continue down the activation checklist; if no, get someone to open Detail's Blueprint → Offers once, then proceed. Work in a git worktree, PR + squash-merge to main, update the memory note in the same commits.
