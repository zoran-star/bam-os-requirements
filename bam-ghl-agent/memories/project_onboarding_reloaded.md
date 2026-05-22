---
name: Onboarding Reloaded
description: The reworked BAM Business client onboarding flow — onboarding-reloaded.html, 6 sections, Supabase-synced. Resume with /onboarding.
metadata:
  type: project
---

**Onboarding Reloaded** is the reworked full client-onboarding experience for a new BAM Business academy. Built this session (started from the orphaned 3-step training prototype). Resume with the `/onboarding` command.

## Files
- **`bam-ghl-agent/bam-portal/public/onboarding-reloaded.html`** — THE deliverable: the client onboarding flow. Canonical + deployed (Vercel serves `bam-portal/public/`). Standalone HTML, no build step, FullControl dark design. **Edit this copy** — do not re-create one at `bam-ghl-agent/` root (drift rule, see CLAUDE.md).
- `bam-ghl-agent/onboarding-reloaded-editor.html` — early question-editor tool. Secondary; Zoran gives questions directly in chat.
- `bam-ghl-agent/onboarding-reloaded-schema.sql` — the Supabase table DDL (already applied 2026-05-21).

## The flow — 6 sections
1. **Business Basics** — display/legal name, business address, entity type, EIN, phone, email + a **Locations table** + a **Staff table** (name/phone/email/role/bio/show-on-website).
2. **Branding** — logo upload (multi-file).
3. **Website** — existing site?, new-vs-improve (conditional improve box), domain provider, key stats, photos/videos.
4. **Training Setup** — a repeating **offers** builder; each offer is a 6-part conditional form (basic info → scheduling → pricing [membership/package/single session/other] → sales flow → client onboarding → assets).
5. **Team Programs** — org-wide info (name, what sets you apart, logo+assets, coaches/directors, selling points) + a repeating **teams** builder; each team has its own block (info, schedule, tryouts, competition, pricing, agreements, onboarding, welcome, assets).
6. **Connect Accounts** — payment processor, Stripe connect, GoHighLevel signup link (→ Stripe checkout), "CSV of all contacts" + client/member CSV (file drops). Meta/ad-account connect was removed 2026-05-21 — it moved to the Marketing page (see Leadsie flow below).

Every section ends with an "Extra notes for our team" box.

## Key mechanics
- Generic **records engine** powers both offers and teams (repeating conditional record builders — `type:'records'` with a `form`).
- Staff + locations defined once in Business Basics, reusable everywhere (schedule location dropdowns, "who gets notified" staff pickers; staff_select can add new staff inline).
- Question types: short_text, long_text, email/phone/url, number, currency, yes_no, single_choice, multi_choice, files (multi-upload + paste Drive link), builder (typed sub-fields: text/textarea/checkbox/combo/time/location), confirm checkbox, connect, link, staff_select, records, heading.
- Auto **"Other → specify"** box on any choice with an "Other" option (`otherBig` flag → big textarea).
- **Voice input** (mic, Web Speech API) on every long-text box. **Progress bars** throughout (overall + per-section, tracks required completion). **Free navigation** — every section clickable in the stepper. **Pause/resume** via localStorage.

## Supabase sync — STATUS: live, table created + verified end-to-end
- Every save upserts the submission to the `onboarding_reloaded` table (project `jnojmfmpnsfmtqmwhopz`), keyed by a localStorage `submission_key`. Null-guarded — flow works with or without the table.
- ✅ **Table created 2026-05-21** via Supabase MCP migration `create_onboarding_reloaded_table` (DDL matches `onboarding-reloaded-schema.sql`).
- ✅ **End-to-end sync verified 2026-05-21** — anon-key insert (201) / upsert with merge-duplicates on `submission_key` (200) / select (200) all pass against the live RLS policies.
- Supabase MCP is connected (project `jnojmfmpnsfmtqmwhopz`).

## Testing
- 51 automated jsdom render/interaction checks pass. Harness: `/tmp/jsdomtest.cjs`, jsdom at `/tmp/onbtest` (re-install if gone: `npm install jsdom --prefix /tmp/onbtest`). To re-run: extract the `<script>` block to a `.js` file, `node --check` it, then `node /tmp/jsdomtest.cjs`.
- End-to-end Supabase sync test ✅ done 2026-05-21. Still pending: Zoran's final hands-on click-through approval.

## Marketing-page ad-account connect (Leadsie) — added 2026-05-21
Meta/ad-account connect was pulled out of onboarding Section 6 and rebuilt as a self-service step on the **Marketing page** of `bam-portal/public/client-portal.html`:
- Top of the Marketing view shows an "ad-connect gate" card (`#ad-connect-gate`).
- "Get started" → modal "Keep your current ad account?" (Yes / No).
  - **Yes** → Leadsie connect step — opens `app.leadsie.com/connect/2e577265b0ca5239/manage`, then a self-reported "I've connected" checkbox.
  - **No** → "start fresh" state, flagged as not recommended.
- State persists in localStorage `bam_ad_account_status` (`'' | leadsie | connected | skipped`). Prototype-grade — not wired to Supabase.
- Functions: `_renderAdConnectGate`, `openAdAccountModal`, `adAccountKeep`, `adAccountMarkConnected`, `adAccountReset`.

## Systems-page integration — added 2026-05-22
The setup flow is embedded into the **Systems page** of `client-portal.html` (per Zoran — "systems onboarding initiated on the systems page"):
- A progress card sits at the top of the Systems view (`#systems-onboarding-card`) with three states — not started / in-progress (% bar + sections done) / complete.
- "Start / Continue setup" opens `#systems-onboarding`, a sub-screen that iframes `onboarding-reloaded.html` (same origin).
- The flow persists `state.pct` into its localStorage progress (`onboarding_reloaded_progress_v2`); the portal reads that key directly to drive the card. `_renderSystemsOnboardingCard` runs on boot + on every switch to Systems.
- Functions in client-portal.html: `_renderSystemsOnboardingCard`, `openSystemsOnboarding`, `closeSystemsOnboarding`, `_onbProgress`.

## Open items
- [x] ~~Table created + end-to-end sync verified~~ — done 2026-05-21.
- [x] ~~GoHighLevel signup link~~ — set to Stripe checkout `buy.stripe.com/bJeaEZ1vC4NX6PvgM1gnK0z` (2026-05-21).
- [x] ~~Deploy to `bam-portal/public/`~~ — done 2026-05-21; Vercel serves it at `/onboarding-reloaded.html`.
- [x] ~~Embed into the client portal Systems page~~ — done 2026-05-22 (iframe sub-screen + progress card).
- [ ] Embedded copy is still the standalone flow — no per-`client_id` auth/RLS scoping; submissions keyed only by an anon `submission_key`.
- [ ] Decide whether onboarding-reloaded replaces the current `onboarding.html` public signup.
- [ ] Final click-through approval from Zoran.

## How to continue
Run `/onboarding` — it pulls latest, summarizes this note, and hands back the goal to set via `/goal`.
