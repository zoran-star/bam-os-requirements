# Per-Academy Asset Library

2026-06-15. One image library per academy, in the client portal. Each image can
be tagged to an **offer**, **staff member**, or **location** (or left as a brand
asset). Replaces ad-hoc per-offer-only assets + hardcoded site images. Pairs
with the unified site design system (tokens live in git `bam-client-sites`;
images live here in Supabase, fed by the Business Blueprint).

## Schema (migration `20260615120000_client_assets_library.sql`)
- Table **`client_assets`**: `client_id` → clients; `label`, `category`
  (logo|wordmark|hero|photo|**video**|crest|icon|og|favicon|other), `alt`, `storage_path`,
  `mime_type`, `size_bytes`, `width`, `height`; **`folder`** (text, nullable — single-level
  group from a folder upload, migration `20260621140000`); **tags** (all nullable):
  `offer_id` → offers, `staff_id` → client_users, `location_id` → locations;
  `sort_order`, `uploaded_by`, timestamps.

## Video + folder uploads (added 2026-06-21)
A client reported the Assets picker wouldn't let them select videos — the file input was
`accept="image/*"`. Now the main Assets tab accepts **images + videos** and supports
**folder uploads**:
- Inputs: `accept="image/*,video/*"`; a second `<input webkitdirectory>` "Upload a folder".
- `_uploadAssets(inputEl, fromFolder)` derives `folder` from `webkitRelativePath`'s top dir,
  and `category` from mime (`video/*` → 'video', else 'photo').
- `_renderAssets` groups by `folder` (ungrouped first, then a collapsible `<details>` per folder).
- `_assetCard` renders a `<video controls>` tile for video mime, else `<img>`.
- The `client-assets` bucket has **no MIME/size restriction** (confirmed 2026-06-21), so videos
  upload fine; only the project-wide Storage upload limit applies (raise it if big videos 400).
- The secondary per-offer/staff/location "asset bank" picker (`_assetBankUpload`) stays
  **image-only** on purpose (headshots/logos).

**Large-file link fallback.** Project-wide Storage upload limit was 50MB, **raised to 500MB
2026-06-21**. Migration `20260621140000` also adds **`client_assets.link_url`** + drops the
`storage_path` NOT NULL constraint:
- `_uploadAssets` pre-checks `file.size` against **`MAX_DIRECT_UPLOAD_BYTES`** (= 500MB, the
  SAME constant the content/creative flow uses — single source of truth; the message follows it).
  Over-limit files are skipped + a one-shot `_assetUploadNudge` points them to the link field.
- ⚠️ If the Supabase project Storage limit changes again, update `MAX_DIRECT_UPLOAD_BYTES` in
  `client-portal.html` to match (both Assets + the content flow read it).
- Toolbar has a "Paste a share link" input + `_addAssetLink()` (reuses `_isValidAssetLink`),
  with a note to set sharing to **"Anyone with the link can view."** Link assets have
  `link_url` set, `storage_path` null; `_assetCard` renders an "Open link" tile; `_assetRemove`
  skips the bucket delete. To raise the cap instead: Supabase Settings → Storage upload limit.
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

## Ticket uploads mirror in (Option B, 2026-07-09)
Every client-submitted ticket file (content-ticket create, edit additions, action-response attachments) now write-throughs into `client_assets` as a LINK row: `link_url` = the ticket-files URL (no object copy), `source='ticket'`, `source_ticket_id`, category video/photo/other from mime, folder = the client's upload label. Dedupe = partial unique index `(client_id, link_url)`. Migration `20260709184749` (applied) + one-time MCP backfill (152 historical files incl. response-attachment bullets). **View-only for clients** (RLS delete/update exclude source='ticket'; Cam's call - the ticket owns the file). **Client Assets tab currently EXCLUDES source='ticket'** (`.neq` in the load) until the grouped "From your requests" section ships (B3) - staff + website surfaces can read them now. Write-through lives in `api/marketing.js mirrorFilesToAssets()` (fire-and-forget, never blocks tickets).
