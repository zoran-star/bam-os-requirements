---
description: BAM GTA — yesterday's cost-per-lead and lead count from Meta ads
---

Pull **BAM GTA's** lead numbers from **yesterday** (the full prior calendar day) off the Meta Ads API. Run every step, do not stop for confirmation, then print the result box.

## Context (fixed values)
- BAM GTA Meta ad account: `act_945289010672617`
- Meta Graph API version: `v22.0`
- Meta auth: the staff Meta token stored in Supabase table `staff_meta_tokens` (currently Ximena's token, scope `ads_read`)
- "Leads" for GTA register as the action type `offsite_conversion.fb_pixel_custom` (a custom pixel conversion). GTA's lead-gen campaign does not emit standard `lead` actions. The skill still also counts standard lead types in case that changes.

## Step 1: Get the Meta token

Run this via the Supabase MCP (`mcp__supabase__execute_sql`):

```sql
SELECT access_token, fb_user_name, expires_at, (expires_at > now()) AS valid
FROM staff_meta_tokens
ORDER BY updated_at DESC
LIMIT 1;
```

- If `valid` is false (token expired): STOP and tell the user the Meta token expired and someone needs to reconnect Meta in the staff portal. Do not continue.
- Otherwise keep the `access_token` for Step 3.

## Step 2: Compute yesterday's date

Yesterday = today minus 1 day, formatted `YYYY-MM-DD`. Use:

```bash
date -v-1d +%Y-%m-%d
```

## Step 3: Query Meta for yesterday's insights

Substitute `<TOKEN>` and `<YDAY>`:

```bash
curl -sS "https://graph.facebook.com/v22.0/act_945289010672617/insights?fields=spend,actions&time_range=%7B%22since%22%3A%22<YDAY>%22%2C%22until%22%3A%22<YDAY>%22%7D&access_token=<TOKEN>"
```

## Step 4: Parse the result

From the single row in `data[]`:
- `spend` is total spend for the day (USD).
- In `actions[]`, sum the `value` of every entry whose `action_type` is one of:
  `lead`, `onsite_conversion.lead_grouped`, `offsite_conversion.fb_pixel_lead`, `offsite_conversion.fb_pixel_custom`
  That sum is **leads**.
- **CPL** = `spend / leads` (if leads is 0, CPL is "—", do not divide by zero).
- If `data[]` is empty, yesterday had no delivery: leads 0, spend $0.

## Step 5: Print the result box

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 BAM GTA — Yesterday (<Mon DD>)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Leads:   <N>
  Spend:   $<spend>
  CPL:     $<cpl>   (or — if no leads)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If leads came from `offsite_conversion.fb_pixel_custom` (the usual case), add one line under the box:
`Leads counted from GTA's custom pixel conversion.`

Keep the whole response to just the box plus that one note. No preamble.
