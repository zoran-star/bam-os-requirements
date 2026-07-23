import { withSentryApiRoute } from "../_sentry.js";
// One-shot backfill: populate members.ghl_contact_id for any member where
// it's still null but we have a parent_email or parent_phone we can use to
// look them up in GHL.
//
// Auth: bearer CRON_SECRET (same as the scheduled-pause cron). Manually
// triggered — not on a schedule. Safe to re-run; only writes when:
//   - a contact is found in GHL
//   - members.ghl_contact_id is still null at the time of write
//
// Trigger:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://portal.byanymeansbusiness.com/api/ghl/backfill-contacts"
//
// Optional ?client_id=<uuid> scopes the backfill to a single academy.
// Optional ?dry_run=1 reports what would change without writing.

import { timingSafeEqual } from "node:crypto";

import { pickGhlToken } from "./_core.js";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const GHL_V2        = "https://services.leadconnectorhq.com";
const V2_VERSION    = "2021-07-28";

async function sb(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  const r = await fetch(url, { ...opts, headers });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`);
  if (opts.method && opts.method !== "GET" && headers.Prefer === "return=minimal") return null;
  return r.json().catch(() => null);
}

// ── GHL helpers (V2 — services.leadconnectorhq.com) ──
async function ghl(method, path, { token, body } = {}) {
  const r = await fetch(`${GHL_V2}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version:       V2_VERSION,
      Accept:        "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch (_) { j = { raw: text }; }
  if (!r.ok) {
    const err = new Error((j && (j.message || j.error)) || `GHL ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return j;
}

// Lookup a contact by email (preferred — more stable than phone) then phone.
// Returns the GHL contactId or null.
async function lookupGhlContact({ token, locationId, email, phone }) {
  if (!email && !phone) return null;

  const tryQuery = async (q) => {
    const params = new URLSearchParams({ locationId, limit: "5", query: q });
    try {
      const data = await ghl("GET", `/contacts/?${params}`, { token });
      const contacts = data?.contacts || data?.data || [];
      return contacts[0]?.id || contacts[0]?.contactId || null;
    } catch (_) { return null; }
  };

  if (email) {
    const hit = await tryQuery(email);
    if (hit) return hit;
  }
  if (phone) {
    const hit = await tryQuery(phone);
    if (hit) return hit;
  }
  return null;
}

async function handler(req, res) {
  // Auth — bearer CRON_SECRET, constant-time compare
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: "CRON_SECRET not configured" });
  const gotBuf = Buffer.from(got);
  const expBuf = Buffer.from(expected);
  const ok = gotBuf.length === expBuf.length && timingSafeEqual(gotBuf, expBuf);
  if (!ok) return res.status(401).json({ error: "unauthorized" });

  const dryRun = req.query.dry_run === "1" || req.query.dry_run === "true";
  const clientFilter = req.query.client_id || null;

  // Pull every member that needs a contact_id, has at least one of email/phone.
  // Limit to a safe batch for one invocation; re-run to continue if there's more.
  let memberSql =
    `members?ghl_contact_id=is.null` +
    `&or=(parent_email.not.is.null,parent_phone.not.is.null)` +
    `&select=id,client_id,athlete_name,parent_email,parent_phone&limit=500`;
  if (clientFilter) memberSql += `&client_id=eq.${encodeURIComponent(clientFilter)}`;

  const members = await sb(memberSql).catch(() => []);
  if (!Array.isArray(members) || members.length === 0) {
    return res.status(200).json({ ok: true, total_candidates: 0, updated: 0, missed: 0, errors: [] });
  }

  // Group by client and load each client's GHL token once.
  const byClient = new Map();
  for (const m of members) {
    if (!byClient.has(m.client_id)) byClient.set(m.client_id, []);
    byClient.get(m.client_id).push(m);
  }

  const clientIds = Array.from(byClient.keys());
  const clientRows = await sb(
    `clients?id=in.(${clientIds.join(",")})` +
    `&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at`
  ).catch(() => []);
  const clientById = Object.fromEntries((clientRows || []).map(c => [c.id, c]));

  let updated = 0, missed = 0;
  const errors = [];
  const sampleUpdates = [];

  for (const [clientId, list] of byClient.entries()) {
    const client = clientById[clientId];
    if (!client) {
      errors.push({ client_id: clientId, reason: "client not found" });
      continue;
    }
    const tok = await pickGhlToken(client);
    if (!tok?.token || !tok?.locationId) {
      errors.push({ client_id: clientId, business_name: client.business_name, reason: "no GHL token / location" });
      continue;
    }

    for (const m of list) {
      try {
        const contactId = await lookupGhlContact({
          token:      tok.token,
          locationId: tok.locationId,
          email:      m.parent_email,
          phone:      m.parent_phone,
        });
        if (!contactId) { missed++; continue; }

        if (!dryRun) {
          // Conditional update: only write if still null (don't clobber a race).
          await sb(`members?id=eq.${m.id}&ghl_contact_id=is.null`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ ghl_contact_id: contactId, updated_at: new Date().toISOString() }),
          });
        }
        updated++;
        if (sampleUpdates.length < 10) {
          sampleUpdates.push({
            member_id:    m.id,
            athlete_name: m.athlete_name,
            email:        m.parent_email,
            contact_id:   contactId,
            applied:      !dryRun,
          });
        }
      } catch (e) {
        errors.push({ member_id: m.id, athlete_name: m.athlete_name, message: e.message });
      }
    }
  }

  return res.status(errors.length ? 200 : 200).json({
    ok: true,
    dry_run:            dryRun,
    total_candidates:   members.length,
    updated,
    missed,
    errors_count:       errors.length,
    sample_updates:     sampleUpdates,
    errors:             errors.slice(0, 20),
  });
}

export default withSentryApiRoute(handler);
