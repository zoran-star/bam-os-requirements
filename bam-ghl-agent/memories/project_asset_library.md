# Per-Academy Asset Library

2026-06-15. One image library per academy, in the client portal. Each image can
be tagged to an **offer**, **staff member**, or **location** (or left as a brand
asset). Replaces ad-hoc per-offer-only assets + hardcoded site images. Pairs
with the unified site design system (tokens live in git `bam-client-sites`;
images live here in Supabase, fed by the Business Blueprint).

## Schema (migration `20260615120000_client_assets_library.sql`)
- Table **`client_assets`**: `client_id` → clients; `label`, `category`
  (logo|wordmark|hero|photo|crest|icon|og|favicon|other), `alt`, `storage_path`,
  `mime_type`, `size_bytes`, `width`, `height`; **tags** (all nullable):
  `offer_id` → offers, `staff_id` → client_users, `location_id` → locations;
  `sort_order`, `uploaded_by`, timestamps.
- Bucket **`client-assets`** (public). Path: `<client_id>/<stamp>-<name>`.
- RLS mirrors the `offers` table/bucket: table policies = `is_staff() or
  client_id in (select my_client_ids())`; storage policies = public read +
  client-scoped writes by path prefix (`split_part(name,'/',1)::uuid`).

## Client portal "Assets" tab (Phase 1 — DONE)
- New left-nav item + `#view-assets` + `openAssetsView()` in `client-portal.html`.
- Upload (multi) → `client-assets` bucket + `client_assets` row. Grid of cards
  (thumbnail, editable label, tag chip, category + offer/staff/location selects,
  alt text, remove). Filter pills: All / Brand / Offers / Staff / Locations.
- Functions: `_ASSETS`, `openAssetsView`, `_renderAssets`, `_assetCard`,
  `_uploadAssets`, `_assetSetTag`, `_assetRemove`, `_assetUrl`. Always-visible
  tab (not feature-gated). Uses `_sb` directly (supabase-js), `CLIENT_ID`.

## Model decisions (Zoran, 2026-06-15)
- Offers still collect their OWN assets (each offer has its own website page +
  funnel). Staff + locations get images too. The Assets tab is the central
  place to view/add/remove/**tag** everything.

## Pending (Phases 2–3, not built)
- **Phase 2:** `GET /api/website/assets?client_id=` (clone `offer-media.js` CORS
  pattern) so sites pull by tag; wire the offer-builder `assets` field + staff +
  location editors to write INTO `client_assets` (one store, no double-entry).
- **Phase 3:** sites reference assets by key/tag (`<img data-asset>` + fallback);
  migrate GTA's `clients/bam-gta/gta-assets/*` (git) + the 49MB Claude Design
  photo library into BAM's bank. Image optimization via Supabase transforms.

Related: [[project_offer_architecture]] (per-offer files in `offer_files`/`offers`
bucket — separate from this academy-level library).
