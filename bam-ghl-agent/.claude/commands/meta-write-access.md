---
name: meta-write-access
description: Step-by-step walkthrough to enable + harden Meta ad-write access for the BAM portal. Covers verifying the token user has an app role (the make-or-break check) and migrating from a personal token to a durable BAM Business System User token. Use when setting up, debugging, or hardening Meta ad creation.
---

# Meta Write Access — guided setup

You are walking Zoran through enabling and hardening **Meta ad-write access** for the BAM portal.
Zoran has ADHD + is a visual learner: **short, bold, one action per message, lots of structure.**
Walk ONE phase at a time. Wait for him to confirm before moving on. Never dump all phases at once.

**At the end of every message, show this tracker** (✅ done, ⬅️ current, ⬜ todo):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔑 META WRITE ACCESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
P1: Verify app role (make-or-break)   ⬜
P2: Confirm scopes are Active         ⬜
P3: Reconnect Meta (Ximena)           ⬜
P4: Smoke-test it actually works      ⬜
P5: Harden → BAM System User token    ⬜
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👉 NEXT: [exact thing Zoran does]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Key facts (don't re-derive):
- Meta App ID: **`2059912628202822`**
- Supabase project ref: **`jnojmfmpnsfmtqmwhopz`**, table **`staff_meta_tokens`** (col `scopes[]`, `fb_user_name`, `access_token`)
- OAuth scopes in code (`api/marketing.js` → `META_OAUTH_SCOPES`): `ads_read, ads_management, business_management, public_profile`
- Why Standard Access is enough: see `memories/project_meta_api_integration.md` → "Access model" section.

---

## ⭐ Phase 1 — Verify the token user has an APP ROLE (the make-or-break check)

> Standard Access only reaches assets owned by / shared to **admins, developers, or testers of the app.**
> If Ximena isn't an app role, her token sees NOTHING on client accounts — silently. This check decides everything.

**Tell Zoran to do this:**
```
1. Go to  developers.facebook.com  → My Apps → open app 2059912628202822
2. Left sidebar → "App roles" → "Roles"
3. Look for XIMENA in the list
```
**What he should see:** Ximena listed as **Administrator**, **Developer**, OR **Tester** (any of the three works).

- ✅ She's there → Phase 1 done.
- ❌ She's NOT there → on that page click **"Add People"** → enter Ximena's Facebook account / email → role **Developer** (or Admin) → she must **accept the invite** from her own Facebook notifications/email before it counts. Then re-check.

Ask Zoran what he sees. Do not advance until Ximena appears in Roles.

---

## Phase 2 — Confirm both write scopes are Active

(Usually already true — Zoran confirmed via screenshots 2026-06-06.)

**Tell Zoran:**
```
App Dashboard → App Review → "Permissions and Features"
Search each:  ads_management   …then…   business_management
```
**Want for each row:** `Standard access` + `Active`. Ignore any "Request advanced access" button.
- Both Active → Phase 2 done. If one isn't, have him click into it; at Standard it's usually auto-granted for app-role users.

---

## Phase 3 — Reconnect Meta (Ximena) so the token picks up the write scopes

Her current token predates the scope change → still read-only. A reconnect swaps it.
Code forces `auth_type=rerequest`, so Facebook WILL show the permission screen.

**Send Ximena this text:**
> Hey Ximena! 2-min thing 🙏 We turned on ad-**creating** in the portal. Reconnect your Meta:
> 1. Staff portal → **Settings**
> 2. **Meta** row → click **Reconnect**
> 3. Facebook popup asks for **new permissions** (manage ads + business) → **Continue / Allow** everything ✅
> 4. Use **your** Meta account (the one with access to all client ad accounts)
> Ping me when done!

⚠️ Must be **Ximena's** account (she's the one with client-asset access). Wait for the Vercel deploy before she does it.

---

## Phase 4 — Smoke-test it actually works (don't trust the status dot)

The DB stores the scope list we hard-coded, so Supabase will SAY `ads_management` even if Meta didn't grant it.
Real proof = Meta itself confirms the permission on her live token.

**Option A (quick, by Claude):** read her token from Supabase and call Meta's permissions endpoint:
```
GET https://graph.facebook.com/v22.0/me/permissions?access_token=<her token>
→ confirm ads_management + business_management show "granted"
```
**Option B (definitive):** once the upload→creative→ad-create endpoints exist, create ONE paused test ad on a test client. If it creates (even in review), write access is real.

If permissions show "declined" → she likely skipped a checkbox in the FB popup → redo Phase 3.

---

## Phase 5 — Harden: migrate to a BAM Business **System User** token (durability)

Personal token = 60-day expiry, no refresh, dies if Ximena leaves / resets pw. Production should use a **non-expiring System User token** owned by BAM's Business, not a person.

**Walk Zoran through (in BAM's Business Manager — business.facebook.com):**
```
1. Business Settings → Users → "System Users" → Add
   • Name: "BAM Portal Connector"   • Role: Admin
2. Assign assets to that system user:
   Business Settings → (Ad Accounts / Pages / Instagram) → for EACH client asset
   → Assign → pick "BAM Portal Connector" → Manage / Advertiser
   (For client-owned assets: client shares the asset to BAM's Business via Partner/Leadsie FIRST,
    then you assign it to the system user.)
3. Generate token:  System Users → BAM Portal Connector → "Generate New Token"
   • App: 2059912628202822
   • Scopes: tick ads_read, ads_management, business_management
   • Set token expiration to "Never"
   • COPY the token now — shown once.
4. Store it (do NOT paste raw in chat):
   • Add to Vercel bam-portal prod as e.g.  META_SYSTEM_USER_TOKEN  (printf, no trailing newline)
   • Then a code change: prefer META_SYSTEM_USER_TOKEN in api/marketing.js token lookup,
     falling back to staff_meta_tokens. (Claude builds this — flag it as the follow-up.)
```
When this lands, the portal no longer depends on Ximena staying connected.

**After Phase 5:** update `memories/project_meta_api_integration.md` (token model → System User) and close the Open Loop.

---

## Wrap
- Commit any memory updates.
- Remind Zoran: Notion ↔ prototype sync — is there an MKT- requirement or Onboarding Data Point (CPL goal / monthly budget already noted) to update?
- Suggest logging the System User migration as an **Open Loop** if not yet done.
