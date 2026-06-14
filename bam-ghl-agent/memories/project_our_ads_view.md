---
name: Our Ads (internal campaigns view)
description: Staff-only tab showing BAM's OWN ad campaigns (the ads we run to acquire academy clients), reusing the per-client MarketingTab. Email-gated to Zoran/Mike/Coleman. Internal "client" entry chosen via VITE_INTERNAL_ADS_CLIENT_ID.
type: project
---

## What it is

A standalone **"Our Ads"** tab in the staff portal that shows BAM's *own* ad
campaigns the same way clients see theirs — live Meta data, performance
dashboard, and a campaign picker. Built 2026-06-14.

Our internal acquisition campaigns live **mixed in on the same Meta ad account
as a client's**, so we don't try to auto-detect "ours." Instead we model BAM as
a **dedicated internal entry in the `clients` table** with its OWN
`meta_campaign_ids` filter. Picking our campaigns there is independent of any
real client's selection, so it never changes what a client sees.

## Design — pure reuse, no new Meta code

```
Same Meta ad account
  ├─ Client's campaigns ──► client portal (client's meta_campaign_ids)
  └─ OUR campaigns ───────► Our Ads tab (internal entry's meta_campaign_ids)  ← staff pick
```

- The tab renders **`MarketingTab`** (now exported from
  `src/views/ClientsCombinedView.jsx`) — the same component used per-client. It
  brings the ad-account picker + **campaign picker** (`staff_picker=1` mode +
  `POST /api/meta/adaccounts`) + the `MarketingDashboard` performance view.
- No new fetching/filtering code was written. We point existing machinery at our
  own entry.

## Files

| File | Role |
|---|---|
| `bam-portal/src/views/OurAdsView.jsx` | NEW. Loads the internal entry, renders `MarketingTab`. Shows setup instructions until configured. |
| `bam-portal/src/views/ClientsCombinedView.jsx` | `MarketingTab` is now `export function` (named export) so it can be reused. |
| `bam-portal/src/App.jsx` | Lazy import + `OUR_ADS_ALLOWLIST` email gate (`canSeeOurAds`) + nav item + title + icon + render block (`nav === "ourads"`). |

## Access

Email-gated (NOT role-gated) to the same internal-acquisition crew as the
dormant Channel Dashboard: `zoran@`, `mike@`, `coleman@` (byanymeansbball.com).
Allowlist lives in `OUR_ADS_ALLOWLIST` in `App.jsx`.

⚠️ **Editing the picker** still requires `ROLES.canEditMeta(role)`
(admin/scaling_manager/marketing) server- and client-side. Coleman/Zoran (admin)
can pick campaigns; if Mike's staff role isn't one of those, he can view but not
edit the selection. Widen `canEditMeta` if Mike needs to pick.

## Setup required (one-time, by Zoran)

The tab is wired but inert until the internal entry exists and is pointed to:

1. Create (or pick) a dedicated **Clients** entry for our own ads — e.g.
   "By Any Means — Internal Ads".
2. On that entry's Marketing tab, wire **our Meta ad account** + pick our
   campaigns.
3. Set **`VITE_INTERNAL_ADS_CLIENT_ID`** = that entry's UUID in Vercel, redeploy.

Until `VITE_INTERNAL_ADS_CLIENT_ID` is set, the tab shows setup instructions
instead of breaking.

## Open items / gotchas

- The internal entry will also appear in the normal **Clients** list (it's a real
  `clients` row). Acceptable for now; could be filtered out later if noisy.
- Config is a build-time Vite env var → changing it requires a redeploy.
- Reuses the staff Meta token model — same Standard-Access constraints as
  [[project_meta_api_integration]].
