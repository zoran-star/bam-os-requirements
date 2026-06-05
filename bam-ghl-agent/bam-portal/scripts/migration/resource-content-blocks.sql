-- ─────────────────────────────────────────────────────────────────────────
-- Migration: resources.content_blocks for the interactive Resources display
-- Date: 2026-06-05
-- Purpose: let staff author a resource as ORDERED CONTENT BLOCKS (heading,
--          rich text, callout, checklist, accordion, image, video, divider)
--          rendered as a branded, interactive page in the client portal —
--          instead of just embedding a raw PDF. Uploaded files (resource_files)
--          stay as downloadable attachments shown below the content.
-- Run: paste into the Supabase SQL editor (project jnojmfmpnsfmtqmwhopz) → Run.
-- Safe + backward compatible: legacy resources have [] and render the old
--          files-only way; new resources render their blocks.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.resources
  add column if not exists content_blocks jsonb not null default '[]'::jsonb;

-- Block shape (authored by admin staff; rendered client-side). Array of:
--   { "type": "heading",   "text": "..." }
--   { "type": "text",      "text": "markdown-lite (**b** *i* [link](url) - bullets)" }
--   { "type": "callout",   "variant": "tip|warn|info", "text": "..." }
--   { "type": "checklist", "title": "...", "items": ["...", "..."] }
--   { "type": "accordion", "title": "...", "text": "markdown-lite body" }
--   { "type": "image",     "url": "...", "caption": "..." }
--   { "type": "video",     "url": "...(mp4 | youtube | vimeo)", "caption": "..." }
--   { "type": "divider" }

-- ── Verification (run after the statement above) ─────────────────────────
-- select column_name, data_type, column_default
--   from information_schema.columns
--  where table_name = 'resources' and column_name = 'content_blocks';
