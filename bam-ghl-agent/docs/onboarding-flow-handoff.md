# Onboarding Flow - handoff (2026-07-15)

THE tie-everything project: one resumable flow takes any academy to BAM GTA's
V2 state (off GHL, text/call flip last). This doc is the resume point - read it
with [`memories/project_v2_onboarding_model.md`](../memories/project_v2_onboarding_model.md)
(the canonical model) + [`docs/v2-onboarding-spec.md`](v2-onboarding-spec.md)
(the master source list).

## Where everything stands (all merged, all live)

**Owner flow (`_obf`, client portal)** - 20 steps, auto-detected, resumable:
- Your academy (11): basics · tax ID · brand · **Tell your story** (new copy
  step → brand_data.story/mission/vibe_words) · locations · coaches · Stripe ·
  email · website (shows build sub-state) · contacts (team, GHL-only) ·
  Instagram (optional)
- Training offer (9): define → schedule (booking sub-state) → pricing (launch,
  + Stripe match note) → policy → [Sales] **Apply Free Trial preset** (launch,
  one click = pipeline + automations + agent facts + lead forms + welcome
  drip) + leads import (team) → [Onboarding] onboarding form → members →
  cancelled (button → AI buckets → human cleanup)
- Launch banner names remaining must-haves. GHL-optional sweep hides GHL UI
  for born-on-V2 academies.

**Sales preset (station model)** - `api/agent/presets.js`: stages declare
entry/engine/exits; seeders read the manifest; `postConversion` welcome drip;
offer stamped with preset key+version. Compile verified byte-for-byte vs GTA.

**Staff side** - Activation tab (`src/views/ActivationTab.jsx` +
`api/admin/activation-status.js`): tier/Slack/invite/Stripe/website/phone/
booking + the GHL migration ladder + the **Website build card** (state machine
+ readiness + sign-offs). Runbooks: `/ghl-pipeline-import` (dump → Claude
sorts cards → import → reconcile → flip), `/brand-scan`, `/site-build`.

**Site-build machine (4 PRs, 2026-07-15)**:
1. Copy collection: Brand card "Your story" + offer Sales site_headline/
   site_subline/site_selling_points (#1440)
2. Templates from GTA: bam-client-sites `system/pages/` + `enroll-flow`
   component (ONE funnel - intake is enroll's final step; standalone
   onboarding pages are dead, per the GTA-uniform decision) (#82)
3. `/site-build`: scripts/site-build.mjs (+ --data offline mode) drafts the
   whole site from templates + BUILD-DATA; workshop runbook (#83)
4. Readiness gate: `api/website/build-state.js` (queued→building→
   staging_ready→verified; auto checks + manual sign-offs), domain-setup
   REFUSES flip until verified, generic `api/website/intake.js` (#1441,
   + fixes #1443 origin, #1444 purchasable key)

**bam-client-sites repo** - 3-bucket structure (system/brands/clients),
registry + client.json manifests, brand cascade (core → brand → client),
brand board (brands/bam/preview + neutral template in system/preview),
sync-design/sync-registry/sync-tracking/new-client scripts, metrics tie-back
(site_pages + funnel_events.page_key/component_key).

**DETAIL Miami (the live test)** - staging_ready:
- Staging: https://bam-client-sites.vercel.app/clients/detail-miami (serves
  the new site; detail-mia.com still = old GHL funnel, correct)
- Auto readiness recorded PASSING (9 pages 200 · 9 purchasable prices · live
  booking slots)
- Onboarding made GTA-uniform: orphan onboarding.html removed (#84), offer
  sales.signup_url = detail-mia.com/enroll
- Mike's one launch must-have (his flow says it): Apply the Free Trial preset
- Remaining to go live: sign-offs → verified → DNS flip with Mike

## DONE 2026-07-15 (same day): the three sign-off redesigns

All three shipped + merged (portal PRs #1448/#1449/#1450, sites PR #85):

1. **agent_ok DROPPED** from website readiness. Manual sign-offs are now
   `brand_ok` + `site_accepted` + `copy_ok` (staff copy-proof kept). Staff
   'sign' stamps `<key>_by:'staff'`; the owner path stamps `by:'owner'`.
   Activation card shows attribution ("Accepted by the owner - Jul 15" vs
   "Recorded by staff"); owner keys get a Record (proxy) button.
2. **Owner Accept in the flow.** `action=owner-sign` on build-state.js
   (client_users auth). Website step at staging_ready → "Review & accept"
   modal (staging preview + Accept). Accepted = green note.
3. **Per-client brand boards.** bam-client-sites `scripts/brand-board.mjs`
   (+ auto-run in new-client.mjs, 8/8 backfilled). Flow step "Approve your
   brand board" (hidden until staging_url exists) + Blueprint > Brand top
   block with live iframe + Approve. Approval = owner-sign brand_ok. Board
   URL = `staging_url + '/brand-board.html'`.

## NEXT SESSION

1. **DETAIL go-live walk.** Mike: approve the brand board + accept the
   staging site (both in his flow now) → staff copy_ok → set verified →
   DNS flip with Mike. Everything is wired; this is pure operating.
2. GTA alignment pass (regenerate GTA from system/pages, zero-diff goal).
3. Repoint DETAIL enroll intake when enroll-flow gains its intake step
   (endpoint `api/website/intake.js` is ready).
4. Born-on-V2 contacts design · discovery preset prompt sections.
5. bam-portal/.env.local SUPABASE_SERVICE_KEY is STALE (rotated - scripts
   needing it must use --data mode or a fresh key).

## Quick resume
1. Read this + project_v2_onboarding_model.md.
2. Work in a worktree; PR + squash-merge per repo's rules.
3. DETAIL is the running test client - keep it green while changing the gate.
