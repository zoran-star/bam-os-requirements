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

## Phase 2 — DONE
- **`GET /api/website/assets?client_id=&offer_id=?`** (`api/website/assets.js`,
  public, CORS-gated): full asset list (public URLs + tags) + `byCategory` map
  (first per category; offer-tagged wins over brand when `offer_id` passed).
- **Upload buttons everywhere** (Zoran chose "buttons everywhere"): one reusable
  in-context widget `_assetBankHtml(field,id,{category})` (+ `_assetBankLoad`/
  `_assetBankUpload`/`_assetBankRemove`) dropped into 3 editors, all writing to
  `client_assets` tagged: the offer builder's `assets` field (now field type
  **`asset_bank`** → tagged `offer_id`; the 4 offer `assets` configs converted
  from `files`), each **location** card (`location_id`), each **staff** row
  (`staff_id`). The offer `assets` field NO LONGER uses offer_files.

## Phase 3 — pending (human-driven, per Zoran)
- Sites reference assets by tag/category (`<img data-asset>` + fallback) via
  `/api/website/assets`. Migrate GTA's `clients/bam-gta/gta-assets/*` (git) + the
  49MB Claude Design photo library into BAM's bank. Image optimization via
  Supabase transforms. Site create/edit flow stays human-driven (Claude Design →
  Claude Code → preview → human approve → ship).

Related: [[project_offer_architecture]] (per-offer files in `offer_files`/`offers`
bucket — separate from this academy-level library).
