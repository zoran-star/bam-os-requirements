---
name: Onboarding Reloaded
description: The reworked BAM Business client onboarding flow — onboarding-reloaded.html, 6 sections, Supabase-synced. Resume with /onboarding.
metadata:
  type: project
---

**Onboarding Reloaded** is the reworked full client-onboarding experience for a new BAM Business academy. Built this session (started from the orphaned 3-step training prototype). Resume with the `/onboarding` command.

## Files (all in `bam-ghl-agent/`)
- **`onboarding-reloaded.html`** — THE deliverable: the client onboarding flow. Standalone HTML, no build step, FullControl dark design system.
- `onboarding-reloaded-editor.html` — early question-editor tool. Zoran bypassed it by giving questions directly in chat; secondary now.
- `onboarding-reloaded-schema.sql` — the Supabase table DDL.

## The flow — 6 sections
1. **Business Basics** — display/legal name, business address, entity type, EIN, phone, email + a **Locations table** + a **Staff table** (name/phone/email/role/bio/show-on-website).
2. **Branding** — logo upload (multi-file).
3. **Website** — existing site?, new-vs-improve (conditional improve box), domain provider, key stats, photos/videos.
4. **Training Setup** — a repeating **offers** builder; each offer is a 6-part conditional form (basic info → scheduling → pricing [membership/package/single session/other] → sales flow → client onboarding → assets).
5. **Team Programs** — org-wide info (name, what sets you apart, logo+assets, coaches/directors, selling points) + a repeating **teams** builder; each team has its own block (info, schedule, tryouts, competition, pricing, agreements, onboarding, welcome, assets).
6. **Connect Accounts** — payment processor, Stripe + Meta connect, GoHighLevel signup link, "CSV of all contacts" + client/member CSV (file drops).

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
- Not yet done: end-to-end Supabase sync test (needs the table), Zoran's final hands-on click-through approval.

## Open items
- [x] ~~Table created + end-to-end sync verified~~ — done 2026-05-21.
- [ ] GoHighLevel signup link is a placeholder (`link.byanymeansbball.com/ghl-signup`) — needs the real URL.
- [ ] Flow is a standalone prototype — not deployed to `bam-portal/public/`, not wired into the authed client portal (no client_id/auth; RLS is prototype-grade anon-open).
- [ ] Final approval from Zoran.

## How to continue
Run `/onboarding` — it pulls latest, summarizes this note, and hands back the goal to set via `/goal`.
