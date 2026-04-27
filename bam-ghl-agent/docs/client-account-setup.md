# Client Account Setup

How to create a login for a client so they can access `client-portal.html`.

This is a **manual process** for now — once you do it a few times, we can automate it. Each client gets one Supabase auth user, linked to their row in the `clients` table.

---

## Prereqs (one-time, only if not already done)

In Supabase dashboard → **Authentication → Providers → Email**:
- ✅ Enabled
- ✅ Confirm email: **OFF** (we're creating accounts manually, no email verification needed)
- ✅ Allow new users to sign up: **OFF** (we don't want public signup — invites only)

If those settings aren't set, do them once.

---

## To create a new client login

### Step 1 — Create the Supabase user

1. Open [Supabase dashboard](https://supabase.com/dashboard) → your project (`jnojmfmpnsfmtqmwhopz`)
2. Go to **Authentication → Users**
3. Click **Add user → Create new user**
4. Fill in:
   - **Email:** the client's contact email (e.g. `owner@elitehoops.com`)
   - **Password:** generate a strong one (12+ chars). You'll send this to them.
   - **Auto Confirm User:** ✅ check this (they don't have to verify their email)
5. Click **Create user**
6. **Copy the user UUID** that appears in the users list (looks like `8d4f2c1e-...`)

### Step 2 — Link the user to the client row

In Supabase → **SQL Editor**, run:

```sql
update clients
set auth_user_id = '<paste-the-user-uuid-here>'
where id = '<the-client-uuid>';
```

Replace both UUIDs:
- `<the-client-uuid>` — find in the `clients` table (the row for the academy)
- `<the-user-uuid>` — the one you just copied from Authentication → Users

Verify it worked:

```sql
select c.name, c.id as client_id, c.auth_user_id, u.email
from clients c
left join auth.users u on u.id = c.auth_user_id
where c.id = '<the-client-uuid>';
```

You should see the email next to the academy name.

### Step 3 — Send the credentials to the client

Send them:
- The portal URL: `https://bam-portal-zoran-stars-projects.vercel.app/client-portal.html`
- Their email (the one you used as the user's email)
- The password you generated

Suggested message:

> Hey [Name], your BAM Business portal is ready. Sign in here:
>
> 🔗 https://bam-portal-zoran-stars-projects.vercel.app/client-portal.html
>
> Email: [their-email]
> Password: [generated-password]
>
> Once you're in, you can change your password from the portal (TODO — for now, ping us and we'll change it on our end).

---

## To reset a client's password

Until self-serve reset is built, do it from the dashboard:

1. **Authentication → Users** → click the user
2. **More options → Send password recovery** (sends them a reset link by email)
   — OR —
3. **More options → Reset password** (set a new password directly, send it to them)

---

## To deactivate / remove a client login

1. **Authentication → Users** → click the user → **Delete user**
2. Their `clients.auth_user_id` will auto-null out (the FK has `on delete set null`).
3. The `clients` row is preserved — you can re-link a new auth user later.

---

## Walkthrough for the first one (test_business)

To test the whole flow end-to-end:

1. Create a Supabase user with `test@bam-test.com` (or your own email — it'll work fine since email confirmation is off)
2. Link it to the test_business client:
   ```sql
   update clients
   set auth_user_id = '<the-user-uuid>'
   where id = '71d01c0f-2580-472b-b0c2-7d1746233967';
   ```
3. Open the portal URL in a fresh window → log in with that email + password → you should see the test_business portal load with the existing test tickets
