---
name: Local Dev Workflow (bam-portal)
description: How local development hits prod Supabase, with the test_business client for safe testing
type: project
---

## Setup (Level 1 + Level 2 from session 2026-04-27)

```
Frontend  →  localhost:5173 (Vite dev, live reload)
API /api  →  proxied to PRODUCTION Vercel (vite.config.js)
Database  →  PRODUCTION Supabase (jnojmfmpnsfmtqmwhopz)
Auth      →  PRODUCTION Google OAuth
```

⚠️ **Every DB write hits prod data.** No local DB isolation.

## Safe testing pattern

When testing flows that mutate data (submitting tickets, importing, etc.), scope to the **test_business** client:

```
Client name:  test business
Client ID:    71d01c0f-2580-472b-b0c2-7d1746233967

Client portal URL (test business preloaded):
http://localhost:5173/client-portal.html?client_id=71d01c0f-2580-472b-b0c2-7d1746233967

Staff portal:
http://localhost:5173/
```

## Cleanup query

```sql
delete from tickets where client_id = '71d01c0f-2580-472b-b0c2-7d1746233967';
```

Run this anytime to wipe test tickets.

## Workflow

1. Edit code → save → localhost reloads instantly
2. Test on localhost:5173 (writes hit prod Supabase, scoped to test_business)
3. When happy → git commit → git push (any branch)
4. Vercel auto-builds preview URL → final smoke test
5. PR → merge → live on prod

## Why not local Supabase / Vercel dev?

Considered "Level 3" (Docker + Supabase CLI + vercel dev for true prod parity, zero risk). Skipped because:
- Solo on this side of the stack — nobody else accidentally writes to prod from another machine
- ~30 min setup cost not worth it for current iteration speed
- Should revisit if (a) teammate joins this codebase, or (b) doing migrations that risk corrupting prod data
