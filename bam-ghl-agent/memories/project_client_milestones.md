# Client milestones table + /api/milestones (gotchas)

`client_milestones` (created in prod 2026-07-05) backs the client-portal milestones
/ personal-records UI (tier milestones like `rev_day_5000`, `members_100`; records
like `record_rev_day`). Schema file: `bam-portal/supabase/client_milestones_schema.sql`
(loose "run in SQL editor" script, NOT a tracked migration).

## GOTCHA: `client_id` is a clients.id UUID, not ghl_location_id
The column is `TEXT` and the original comment said "ghl_location_id", but the portal
sends `CLIENT_ID` = `clients.id` (a UUID) to `/api/milestones`. So `client_id` holds a
UUID string. RLS therefore casts: `client_id IN (SELECT my_client_ids()::text)`
(`my_client_ids()` returns SETOF uuid). Don't "fix" it to location ids - the data +
frontend both use the UUID.

## Security fix shipped with it (2026-07-05)
As originally written (PR #1129, Cole), this shipped with TWO auth gaps - fixed before/at
first run:
1. **API IDOR** in `api/milestones.js`: the only check was `auth.startsWith("Bearer ")` -
   token never validated, academy ownership never checked. Any caller could read/write ANY
   academy's revenue milestones. Fixed by adding `resolveUser(req)` (validates JWT via
   `/auth/v1/user`, resolves staff + `client_users` academies) + an `_owns(ctx, clientId)`
   gate on GET and POST (403 otherwise). Same pattern as `contacts.js`.
2. **Weak RLS**: Cole's policies used `auth.role() = 'authenticated'` (any logged-in user,
   all academies). Replaced with the standard `is_staff() OR client_id IN my_client_ids()`
   used by every other client-scoped table. RLS is a backstop (all access is server-side via
   the service key, which bypasses RLS); the API check in #1 is the live gate.

Lesson: new `/api/*` routes MUST validate the JWT + check academy ownership (resolveUser +
clientIds.includes), and new tables MUST use the `is_staff() OR my_client_ids()` RLS pattern -
never `auth.role() = 'authenticated'`. See [[project_contacts_offghl]] for the reference seam.
