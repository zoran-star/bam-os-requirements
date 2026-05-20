---
description: BAM GTA — lead flow last 7 days vs the previous 7 days (drop-off check)
---

Compare **BAM GTA's** lead flow over the **last 7 days** against the **previous 7 days** to spot any drop-off. Run every step, do not stop for confirmation, then print the comparison box.

## Context (fixed values)
- BAM GTA Meta ad account: `act_945289010672617`
- Meta Graph API version: `v22.0`
- Meta auth: the staff Meta token in Supabase table `staff_meta_tokens` (currently Ximena's token, scope `ads_read`)
- "Leads" for GTA register as `offsite_conversion.fb_pixel_custom`. Standard `lead` types are also counted in case GTA's tracking changes.

## Step 1: Get the Meta token

Run via the Supabase MCP (`mcp__supabase__execute_sql`):

```sql
SELECT access_token, expires_at, (expires_at > now()) AS valid
FROM staff_meta_tokens
ORDER BY updated_at DESC
LIMIT 1;
```

If `valid` is false: STOP and tell the user the Meta token expired and someone needs to reconnect Meta in the staff portal.

## Step 2: Compute the two 7-day windows

All dates `YYYY-MM-DD`. "Last 7 days" ends yesterday (not today, since today is partial).

```bash
echo "last7_start=$(date -v-7d +%Y-%m-%d)"   # 7 days ago
echo "last7_end=$(date -v-1d +%Y-%m-%d)"     # yesterday
echo "prev7_start=$(date -v-14d +%Y-%m-%d)"  # 14 days ago
echo "prev7_end=$(date -v-8d +%Y-%m-%d)"     # 8 days ago
```

So: **Last 7d** = `last7_start` → `last7_end`. **Prev 7d** = `prev7_start` → `prev7_end`.

## Step 3: Query Meta for each window

Run twice, once per window. Substitute `<TOKEN>`, `<SINCE>`, `<UNTIL>`:

```bash
curl -sS "https://graph.facebook.com/v22.0/act_945289010672617/insights?fields=spend,actions&time_range=%7B%22since%22%3A%22<SINCE>%22%2C%22until%22%3A%22<UNTIL>%22%7D&access_token=<TOKEN>"
```

## Step 4: Parse each window

For each window's `data[]` row:
- `spend` = total spend (USD).
- **leads** = sum of `value` for every `actions[]` entry whose `action_type` is one of:
  `lead`, `onsite_conversion.lead_grouped`, `offsite_conversion.fb_pixel_lead`, `offsite_conversion.fb_pixel_custom`
- **CPL** = `spend / leads` (— if leads is 0).
- Empty `data[]` → leads 0, spend $0.

## Step 5: Compute the change

- `lead_change_pct` = `((last7_leads - prev7_leads) / prev7_leads) * 100`, rounded to a whole number.
  - If `prev7_leads` is 0 and `last7_leads` > 0 → show "new flow (prev period had 0)".
  - If both 0 → show "no leads either period".
- Direction: `↑` if up, `↓` if down, `→` if flat.
- Drop-off verdict:
  - down more than 20% → `⚠️ Drop-off detected`
  - up more than 20% → `✅ Lead flow up`
  - within ±20% → `→ Roughly steady`

## Step 6: Print the comparison box

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📈 BAM GTA — Lead Flow (14-day view)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Last 7d  (<m/d>–<m/d>)
    Leads  <N>     Spend  $<X>     CPL  $<X>
  Prev 7d  (<m/d>–<m/d>)
    Leads  <N>     Spend  $<X>     CPL  $<X>
  ───────────────────────────────────────
  Leads:  <↑/↓/→> <pct>%
  <drop-off verdict line>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Keep the whole response to just the box. If GTA's leads are coming from the custom pixel conversion, add one line under the box: `Leads counted from GTA's custom pixel conversion.` No other preamble.
