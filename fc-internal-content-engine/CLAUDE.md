# FC Internal Content Engine

AI-powered content generation pipeline for Full Control.

## Structure
- src/ — React/Vite frontend (chessboard content planning view)
- api/content/ — content generation serverless functions
- api/notion-read.js — reads content briefs from Notion
- api/sync-notion.js — syncs generated content back to Notion
- content_engine_schema.sql — Supabase table structure
- content_engine_seed.sql — seed data

## Content flow
Notion brief → api/notion-read.js fetches it → generation runs → api/sync-notion.js pushes result back → shows in prototype Content page

## Integrations
- Supabase — content storage (schema in content_engine_schema.sql)
- Notion — brief input and generated content output
- prototype/ — the Content page in the prototype is the UI layer for this engine

## Key rule
The engine and the prototype Content page must stay in sync on what data fields they expect. If the schema changes here, check the Content page in prototype/src/pages/Content.jsx.
