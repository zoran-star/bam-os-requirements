import { withSentryApiRoute } from "../_sentry.js";
// Daily Twilio usage sync - the metering half of the rebill engine.
//
// For every academy with an active/pending Twilio config, pull yesterday's
// (and today's, rolling) usage from the Usage Records API and upsert into
// `twilio_usage` (one row per client + day + category). Works for both:
//   - subaccounts under the BAM master (authenticated with the master key)
//   - own-account academies like GTA (authenticated with their stored creds)
//
//   GET /api/twilio/usage-sync                     (Vercel cron, daily)
//   GET /api/twilio/usage-sync?days=30             backfill, Bearer CRON_SECRET
//   GET /api/twilio/usage-sync?summary=1&month=2026-07   spend per client (staff view)
//
// The charge side (markup % -> Stripe line item on the academy's plan) comes
// later; this makes sure the data exists from day one.

import { sb } from "./_voice.js";
import { decryptSecret } from "../messaging/_crypto.js";
import { masterAuth } from "./_master.js";

const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

// Categories worth line-itemizing; everything else rolls up into 'other'.
const KEEP = new Set(["sms", "mms", "calls", "phonenumbers", "recordings", "transcriptions", "carrier-fees", "a2p-registration-fees", "a2p-10dlc-campaigns"]);

async function pullDay(auth, accountSid, isoDate) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Usage/Records/Daily.json?StartDate=${isoDate}&EndDate=${isoDate}&PageSize=200`;
  const r = await fetch(url, { headers: { Authorization: auth } });
  if (!r.ok) throw new Error(`usage ${r.status}`);
  const j = await r.json().catch(() => ({}));
  const byCat = {};
  for (const rec of (j.usage_records || [])) {
    const price = Number(rec.price || 0);
    if (!price && !Number(rec.count || 0)) continue;
    const cat = KEEP.has(rec.category) ? rec.category : (rec.category === "totalprice" ? null : "other");
    if (!cat) continue;
    byCat[cat] = byCat[cat] || { count: 0, usd: 0 };
    byCat[cat].count += Number(rec.count || 0);
    byCat[cat].usd += price;
  }
  return byCat;
}

async function handler(req, res) {
  const isCron = !!req.headers["x-vercel-cron"];
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!isCron && !(process.env.CRON_SECRET && bearer === process.env.CRON_SECRET)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // ── Rebill report mode (monthly cron): previous month's spend per client
  //    + 10% markup, posted to Slack for staff to paste into GHL invoices.
  //    (Billing runs through GHL today; full automation waits until client
  //    billing moves off GHL - then these numbers become Stripe line items.)
  if (req.query.report) {
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const month = prev.toISOString().slice(0, 7);
    const rows = await sb(
      `twilio_usage?usage_date=gte.${month}-01&usage_date=lt.${nextMonth(month)}&select=client_id,usage_usd`
    ).catch(() => []);
    const per = {};
    for (const r of (rows || [])) per[r.client_id] = (per[r.client_id] || 0) + Number(r.usage_usd || 0);
    const ids = Object.keys(per);
    let names = {};
    if (ids.length) {
      const cs = await sb(`clients?id=in.(${ids.join(",")})&select=id,business_name`).catch(() => []);
      names = Object.fromEntries((cs || []).map(c => [c.id, c.business_name]));
    }
    const MARKUP = 1.10; // cost + 10% (Zoran, 2026-07-03)
    const lines = ids
      .map(id => ({ name: names[id] || id, cost: per[id], bill: per[id] * MARKUP }))
      .filter(x => x.cost >= 0.01)
      .sort((a, b) => b.cost - a.cost)
      .map(x => `${x.name}: $${x.cost.toFixed(2)} -> bill $${x.bill.toFixed(2)}`);
    const text = lines.length
      ? `📊 Phone rebill for ${month} (cost -> +10%). Paste each into that client's GHL invoice:\n` + lines.join("\n")
      : `📊 Phone rebill for ${month}: no billable usage.`;
    try {
      const token = process.env.SLACK_BOT_TOKEN, channel = process.env.FEEDBACK_SLACK_CHANNEL;
      if (token && channel) await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel, text }),
      });
    } catch (_) {}
    return res.status(200).json({ ok: true, month, markup: "10%", lines });
  }

  // ── Summary mode: spend per client for a month ──
  if (req.query.summary) {
    const month = String(req.query.month || new Date().toISOString().slice(0, 7));
    const rows = await sb(
      `twilio_usage?usage_date=gte.${month}-01&usage_date=lt.${nextMonth(month)}&select=client_id,category,count,usage_usd`
    ).catch(() => []);
    const per = {};
    for (const r of (rows || [])) {
      per[r.client_id] = per[r.client_id] || { total_usd: 0, categories: {} };
      per[r.client_id].total_usd += Number(r.usage_usd || 0);
      per[r.client_id].categories[r.category] = (per[r.client_id].categories[r.category] || 0) + Number(r.usage_usd || 0);
    }
    return res.status(200).json({ ok: true, month, clients: per });
  }

  // ── Sync mode ──
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 2)); // default: today + yesterday
  const master = masterAuth();
  const MASTER = process.env.TWILIO_MASTER_ACCOUNT_SID;

  const cfgs = await sb(`client_twilio_config?status=in.(active,pending)&select=client_id,account_sid,auth_token_enc,api_key_sid,api_key_secret_enc`).catch(() => []);
  const results = [];
  for (const cfg of (cfgs || [])) {
    if (!cfg.account_sid) continue;
    // Subaccounts of the master -> master key. Foreign accounts (GTA) -> their creds.
    let auth = null;
    try {
      const isSub = master && MASTER && cfg.account_sid !== MASTER;
      const ownSecret = cfg.api_key_secret_enc ? decryptSecret(cfg.api_key_secret_enc) : (cfg.auth_token_enc ? decryptSecret(cfg.auth_token_enc) : null);
      const ownUser = cfg.api_key_sid || cfg.account_sid;
      // Prefer own creds when we hold them (works for both); else master key.
      auth = ownSecret ? basic(ownUser, ownSecret) : (isSub ? master : null);
    } catch (_) { auth = master || null; }
    if (!auth) { results.push({ client_id: cfg.client_id, error: "no usable creds" }); continue; }

    const r = { client_id: cfg.client_id, days: 0, rows: 0, usd: 0 };
    for (let d = 0; d < days; d++) {
      const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
      try {
        const byCat = await pullDay(auth, cfg.account_sid, date);
        const upserts = Object.entries(byCat).map(([category, v]) => ({
          client_id: cfg.client_id, usage_date: date, category,
          count: v.count, usage_usd: Math.round(v.usd * 10000) / 10000,
          account_sid: cfg.account_sid, updated_at: new Date().toISOString(),
        }));
        if (upserts.length) {
          await sb(`twilio_usage?on_conflict=client_id,usage_date,category`, {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify(upserts),
          });
          r.rows += upserts.length;
          r.usd += upserts.reduce((s, u) => s + u.usage_usd, 0);
        }
        r.days++;
      } catch (e) { r.error = `${date}: ${e.message}`; break; }
    }
    r.usd = Math.round(r.usd * 100) / 100;
    results.push(r);
  }

  return res.status(200).json({ ok: true, accounts: results.length, results });
}

function nextMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export default withSentryApiRoute(handler);
