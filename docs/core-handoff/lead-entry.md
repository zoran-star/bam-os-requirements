---
domain: lead-entry
review_state: ready-for-review
prototype_status: built
core_parity: not-reviewed
last_reviewed: "2026-07-08"
prototype_commit: working-tree
core_commit_reviewed: unavailable
---

# Domain: Lead Entry (funnels + entry points) — Prototype-to-Core Handoff

## Summary

- **What the prototype implements:** the lead-acquisition surface model. A
  **direct entry point** (a form or a booking calendar) always lives inside a
  **funnel** = one page on the academy's website (free-trial landing page,
  contact page, enrollment page). `entry_points` (existing) rows route leads
  into a pipeline/stage; the new `funnels` table groups them by page and is the
  unit the V2 portal exposes for configuration (page URL, preview/annotate,
  entry point list).
- **Intended production direction:** a `funnel` (or `landing_page`) entity in
  the core marketing/sales-acquisition domain owning `entry_point` children,
  keyed to funnel analytics events by a stable `key`.
- **Suggested core owner:** marketing / lead-acquisition domain (adjacent to
  the sales-flow pipeline domain).

## References

- Migration: `bam-ghl-agent/bam-portal/supabase/migrations/20260708180000_funnels.sql`
  (+ seeds `15_bam_gta_funnels.sql`, funnel_id link in `20_bam_gta_entry_points.sql`).
- API: `bam-ghl-agent/bam-portal/api/website/funnels.js` (GET nested list +
  `url_resolved`; PATCH label/url/enabled).
- UI: `client-portal.html` `_fn*` functions ("Configure other entry point
  funnels" dropdown on the V2 Marketing page + funnel focus config view).
- Analytics: `funnel_events.funnel` (text key) joins `funnels.key`.
- **Core reviewed: NONE — `fc-core-srvc` is inaccessible from this
  environment** (same access gap recorded in `sales-flow.md`). Parity is
  UNVERIFIED until the core checkout is available.

## Intended Model

| Concept | Purpose | Relationships and scope |
|---|---|---|
| `funnel` (table `funnels`) | One academy-site page hosting direct entry points | `id` pk · `client_id` tenant scope · `offer_id` (the offer the page sells) · `key` (stable, joins `funnel_events.funnel`) · `label` · `url` (nullable; beacon-derived when null) · `is_primary` (the offer's main landing page) · `enabled` · audit fields · unique `(client_id, key)` |
| `entry_point.funnel_id` | Which page an entry point lives on | nullable FK → `funnels`, `on delete set null`. Direct entry points (website-form, calendar) get a funnel; non-page entries may stay null |
| `funnel_events.funnel` | Step analytics per funnel | joins by `key` (kept text, not FK, so beacons never break on config edits) |

## Parity

| Prototype concept | Core mapping | Status | Next action |
|---|---|---|---|
| `funnels` table | core landing-page/funnel entity | `decision-needed` | Review core marketing domain once accessible |
| `entry_points` + `funnel_id` | core entry-point child of funnel | `decision-needed` | Same review |
| `key` join to `funnel_events` | core analytics event stream | `decision-needed` | Confirm core wants key-join vs FK |

## Decisions And Shortcuts

| Item | Reason | Core impact / replacement |
|---|---|---|
| `url` nullable + read-time derivation from `funnel_events` page_view paths | beacons are the live truth for the main page; owner sets URL for pages without beacons (contact) | Core can store a required URL once pages are core-managed |
| Analytics joins by `key` (text), not FK | funnel_events is written by a public beacon; renames must not orphan events | Keep stable keys in core too |
| GTA backfill includes `enroll` funnel with zero entry points | it is a real funnel (payment funnel) even though nothing routes leads from it | UI filters the config dropdown to funnels WITH entry points |
| 2 legacy GHL-form entry points deleted (same day, `20260708170000`) | never connected; V2 landing pages bypass GHL forms | none |

## Open Decisions

- Core review blocked on `fc-core-srvc` access (see sales-flow.md note).
- Per-campaign → per-funnel routing: `api/marketing.js` meta-machine still
  hardcodes `sends_to: "free-trial"`; the funnels table is the intended source
  for that mapping when campaigns get per-funnel routing.
