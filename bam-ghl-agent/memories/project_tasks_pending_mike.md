---
name: Tasks system — waiting on Mike
description: Task management design is on hold pending Mike's preferences on how he wants to work tasks in the portal
type: project
originSessionId: 8ad1de9a-293d-4f2c-8592-9ea7741d04d6
---
The portal has three task sources:
- Notion action items (per client, from calls — already live)
- Asana (internal BAM ops only, not per-client)
- Supabase support tickets (future — from client portal submissions)

Decision on how to unify these in the UnifiedTasksView is blocked on Mike's preferences.

Zoran noted (2026-04-24): "I really do see a world where we don't need Asana anymore." Direction is toward Supabase tickets as the primary task source, with Notion action items alongside it. Asana may be phased out.

**Why:** Mike is the primary staff user of tasks day-to-day. Zoran wants to design around how Mike actually works, not guess.

**How to apply:** Don't design or build the task unification layer until Zoran confirms Mike's preferences. When he does, come back to this and define how Notion action items + future Supabase tickets surface together in the portal.
