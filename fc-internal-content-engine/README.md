# FC Internal Content Engine

## What it's for
An AI-powered content generation pipeline for FullControl. Academy owners brief content through Notion; the engine generates reels, carousels, and threads; the output syncs back to Notion and is used for the content team of FC to brainstorm content.

## Who's working on it
Zoran, Cole

## Current status
Built.

## End goal
Academy owners can generate all their social content — reels, carousels, captions — directly through FullControl, with no external tools needed. Zero content bottleneck.

## Core blockers
- Schema must stay in sync with prototype/src/pages/Content.jsx — changes to either side need to be coordinated

## How it connects to other projects
- **prototype/** — the Content page is the UI layer for this engine; they share a data schema
- **Notion** — content briefs come in from Notion; generated content is pushed back
- **Supabase** — content is stored here (schema: content_engine_schema.sql)
