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

## NEXT SESSION - Zoran's three sign-off redesigns (agreed 2026-07-15)

1. **Brand board per client, owner-facing.** Generate the brand board (like
   `brands/bam/preview/brand-board.html`, from `system/preview/
   brand-board-template.html` + the client's cascade) for EVERY client at
   onboarding. Surface it INSIDE Business Blueprint → Branding section
   (client portal), plus a check/step in the onboarding flow for it.
   This becomes the brand_ok sign-off (a real reviewed artifact, not a
   staff prompt-click).
2. **Website acceptance in the flow.** The owner's Website step: when
   build_status=staging_ready, show the staging (Vercel) link → owner opens
   the site → clicks **Accept** right in the flow. That acceptance feeds
   the readiness gate (replaces copy_ok-style prompt sign-offs).
3. **Drop agent_ok from website readiness.** The agent is NOT a website
   concern (agent go-live = the Hawkeye operating toggle, deliberately not
   an onboarding step). Redesign MANUAL sign-offs in
   `api/website/build-state.js` to: brand approval (from #1) + owner site
   acceptance (from #2) (+ keep a staff copy-proof if wanted). Update the
   Activation tab card + `can_verify` accordingly.

Also open (older list): GTA alignment pass (regenerate GTA from
system/pages, zero-diff goal) · repoint DETAIL enroll intake when enroll-flow
gains its intake step (endpoint `api/website/intake.js` is ready) · born-on-V2
contacts design · discovery preset prompt sections · bam-portal/.env.local
SUPABASE_SERVICE_KEY is STALE (rotated - scripts needing it must use --data
mode or a fresh key).

## Quick resume
1. Read this + project_v2_onboarding_model.md.
2. Work in a worktree; PR + squash-merge per repo's rules.
3. Start with redesign #3 (small: build-state.js + ActivationTab), then #2
   (flow Website step Accept → new build-state action), then #1 (board
   generation per client + Blueprint Branding embed + flow check).
4. DETAIL is the running test client - keep it green while changing the gate.
