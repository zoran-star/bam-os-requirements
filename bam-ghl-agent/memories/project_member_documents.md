---
name: Per-member documents (waivers etc)
description: Signed waivers / media releases / medical / intake stored per member in a PRIVATE Supabase bucket + member_files table, shown in the Members popup Documents section. Mirrors offer_files but private (signed URLs).
type: project
---

## TL;DR (2026-06-09)

Each member can have documents (waiver, media release, medical, intake, other)
attached, viewable/uploadable from the **Members popup → Documents** section in
`client-portal.html`. Built to mirror `offer_files`, but the bucket is **PRIVATE**
(waivers hold health + minor PII) so files are read via **signed URLs**.

## Storage + schema

- **Table `member_files`** (migration `supabase/member_files.sql`, in the /apply-sql list):
  `id, member_id (FK→members, on delete cascade), client_id, kind, filename,
  storage_path, mime_type, size_bytes, signed_at, uploaded_by, metadata, created_at`.
  RLS: `client_id in (select my_client_ids()) or is_staff()` for select/insert/update/delete.
- **Bucket `member-files`** — PRIVATE. Storage path: `<client_id>/<member_id>/<kind>/<stamp>-<name>`
  so the first path segment = client_id; storage RLS scopes on it
  (`split_part(name,'/',1)::uuid in my_client_ids() or is_staff()`), same idea as the
  `offers` bucket but NOT public (no public SELECT).
- `kind` ∈ `waiver | media | medical | intake | document`.

## Frontend (`client-portal.html`)

All client-side via the authed `_sb` Supabase client (RLS enforced), no serverless route:
- `_renderMemberModalBody` renders a **Documents** section (`#member-docs-section`) before
  Actions, then calls `_loadMemberDocs(m.id, m.client_id || CLIENT_ID)`.
- `_loadMemberDocs` → `member_files` select by member_id → `_renderMemberDocs` (creates a
  `createSignedUrl(path, 3600)` per file).
- `_uploadMemberDoc(memberId, clientId, inputEl)` — kind dropdown + file → uploads to
  `member-files` bucket + inserts `member_files` row.
- `_deleteMemberDoc(fileId, …)` — removes storage object + row.
- `_memberDocsCache` is the per-open cache.

## Next / not built

- **Vercel intake form → auto-drop the signed PDF here** (the planned public waiver page
  posts the signed PDF into `member-files` + a `member_files` row with `signed_at`). This is
  the "step 5" follow-up.
- `signed_at` is currently null on manual upload (set it from the e-sign flow later).
- ⚠️ Waiver **wording** must be lawyer-reviewed (Ontario, minor consent) — tech only here.

## Related

- [[project_offer_architecture]] — the `offer_files` pattern this mirrors.
- [[project_multi_user_portal]] — `my_client_ids()` / `client_users` model the RLS uses.
