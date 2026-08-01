import { withSentryApiRoute } from "../_sentry.js";
// Vercel Serverless Function — hourly health probe for DIRECT-KEY academies.
//
// A Connect academy's transport cannot silently die: the platform key is ours.
// A direct-key academy's transport can - the owner rolls the restricted key in
// their own dashboard and every webhook fetch, receipt lookup and reconcile
// pass starts failing quietly. This cron asks each direct-key academy's Stripe
// GET /v1/account (through api/_stripe-transport.js, which owns the key and the
// status writes) once an hour, so a dead key becomes a visible 'invalid' row
// within the hour instead of a support mystery.
//
// THREE outcomes per key, never two (see scripts/check-network-booleans.mjs):
//   answered (ready / not_ready)      -> key_last_verified_at stamped by the
//                                        transport; an 'invalid' row self-heals
//                                        to 'active' + audit 'stripe-key-restored'
//   definitive credential failure     -> status='invalid' (written by the
//   (Stripe 401/403 on the key)          transport) + audit 'stripe-key-invalid'
//   could-not-ask (timeout, 5xx, 429) -> NOTHING changes. A blip is not a
//                                        revoked key.
//
// This cron and readAccountHealth() are the ONLY writers of status='invalid' -
// and this cron only writes it THROUGH readAccountHealth, so the transport
// module keeps sole ownership of the flip rules (including the disable-race
// guard on its PATCHes).
//
// Auth: Bearer CRON_SECRET, same as reconcile-activations. Schedule: hourly
// (vercel.json). Rows probed: status active OR invalid - an invalid row must
// keep being probed or it could never self-heal after staff fixes the key in
// Stripe.

import { readAccountHealth } from "../_stripe-transport.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function writeAudit({ client_id, action_type, args }) {
  try {
    await sb(`member_audit_log`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        client_id: client_id || null,
        member_id: null,
        action_type,
        args: args || null,
        performed_by_name: "Stripe key-health cron",
      }]),
    });
  } catch { /* non-fatal */ }
}

async function handler(req, res) {
  // Auth — Bearer CRON_SECRET (mirrors api/stripe/reconcile-activations.js).
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: "CRON_SECRET not configured" });
  if (got !== expected) return res.status(401).json({ error: "unauthorized" });

  let rows;
  try {
    rows = await sb(
      `client_stripe_direct?status=in.(active,invalid)&select=client_id,status,stripe_account_id&order=client_id.asc`
    );
  } catch (e) {
    return res.status(500).json({ error: `direct-key query: ${String((e && e.message) || e)}` });
  }
  rows = Array.isArray(rows) ? rows : [];

  let ok = 0, invalid = 0, unreachable = 0;
  const results = [];
  // Sequential on purpose: a handful of academies, one Stripe read each.
  for (const row of rows) {
    const priorStatus = row.status;
    let health;
    try {
      // readAccountHealth does the whole dance: probes with the academy's own
      // key, stamps key_last_verified_at, flips invalid->active on an answer,
      // flips active->invalid ONLY on a definitive 401/403, and changes nothing
      // on a could-not-ask.
      health = await readAccountHealth(row.client_id);
    } catch (e) {
      unreachable++;
      results.push({ client_id: row.client_id, outcome: "unreachable", error: String((e && e.message) || e).slice(0, 200) });
      continue;
    }

    if (health.outcome === "ready" || health.outcome === "not_ready") {
      ok++;
      if (priorStatus === "invalid") {
        await writeAudit({
          client_id: row.client_id,
          action_type: "stripe-key-restored",
          args: { stripe_account_id: row.stripe_account_id, outcome: health.outcome },
        });
      }
      results.push({ client_id: row.client_id, outcome: health.outcome });
    } else if (health.credential_problem) {
      invalid++;
      if (priorStatus === "active") {
        await writeAudit({
          client_id: row.client_id,
          action_type: "stripe-key-invalid",
          args: { stripe_account_id: row.stripe_account_id, error: health.error || null },
        });
        console.warn(`[cron-key-health] direct key for client ${row.client_id} is INVALID: ${health.error || "credential problem"}`);
      }
      results.push({ client_id: row.client_id, outcome: "invalid", error: health.error || null });
    } else {
      // Could-not-ask: a timeout, a Stripe 5xx/429. Nothing was written, and
      // that is the point - a blip must never disable a working academy's key.
      unreachable++;
      results.push({ client_id: row.client_id, outcome: "unreachable", error: health.error || null });
    }
  }

  console.log(`[cron-key-health] checked=${rows.length} ok=${ok} invalid=${invalid} unreachable=${unreachable}`);
  return res.status(200).json({ checked: rows.length, ok, invalid, unreachable, results });
}

export default withSentryApiRoute(handler);
