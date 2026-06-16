import { withSentryApiRoute } from "../_sentry.js";
// Polling cron: keep BAM members.parent_email / parent_phone / parent_name
// in sync with GHL contact data. Runs every 10 minutes via vercel.json.
//
// Per-academy flow:
//   1. Fetch all GHL contacts for the academy's location (paginated)
//   2. For each contact, find a matching member by ghl_contact_id
//   3. Diff and patch only fields that actually changed (idempotent)
//   4. Write a sync audit row + update clients.ghl_contacts_last_synced_at
//
// Rate-limit safety:
//   - Academies are processed sequentially with a 2s gap (stagger across
//     GHL's 100-req-per-10s per-location budget; one academy at a time)
//   - 200ms sleep between pagination requests within an academy
//   - 429 responses trigger exponential backoff (max 5 retries)
//   - Global function timeout: 270s (Vercel Pro = 5min, we leave headroom)

import { timingSafeEqual } from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const GHL_V2        = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION    = "2021-07-28";

const HARD_DEADLINE_MS = 270_000;
const PER_REQUEST_SLEEP_MS = 200;
const PER_ACADEMY_STAGGER_MS = 2000;
const MAX_BACKOFF_ATTEMPTS = 5;

const nowIso  = () => new Date().toISOString();
const sleep   = (ms) => new Promise(r => setTimeout(r, ms));

async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// ── GHL token plumbing (same shape as inbox.js / send-message.js) ──
async function refreshGhlToken(client) {
  const cid = process.env.GHL_CLIENT_ID;
  const cs  = process.env.GHL_CLIENT_SECRET;
  if (!cid || !cs || !client.ghl_refresh_token) return null;
  const r = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cid, client_secret: cs,
      grant_type: "refresh_token",
      refresh_token: client.ghl_refresh_token,
    }).toString(),
  });
  const tok = await r.json().catch(() => null);
  if (!r.ok || !tok?.access_token) return null;
  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString();
  await sb(`clients?id=eq.${client.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      ghl_access_token:     tok.access_token,
      ghl_refresh_token:    tok.refresh_token || client.ghl_refresh_token,
      ghl_token_expires_at: expiresAt,
    }),
  }).catch(() => {});
  return { token: tok.access_token, locationId: tok.locationId || client.ghl_location_id };
}

async function pickGhlToken(client) {
  if (client.ghl_access_token) {
    const expiresAt = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
    if (expiresAt - Date.now() <= 60_000 && client.ghl_refresh_token) {
      const refreshed = await refreshGhlToken(client);
      if (refreshed) return refreshed;
    }
    return { token: client.ghl_access_token, locationId: client.ghl_location_id };
  }
  if (process.env.GHL_LOCATIONS_JSON) {
    let locs;
    try { locs = JSON.parse(process.env.GHL_LOCATIONS_JSON); } catch (_) { locs = []; }
    if (Array.isArray(locs)) {
      const entry =
        locs.find(l => l.locationId && l.locationId === client.ghl_location_id) ||
        locs.find(l => l.name && client.business_name && l.name.toLowerCase() === client.business_name.toLowerCase());
      if (entry && (entry.apiKeyV2 || entry.apiKey)) {
        return { token: entry.apiKeyV2 || entry.apiKey, locationId: entry.locationId || client.ghl_location_id };
      }
    }
  }
  const token = process.env.GHL_API_KEY || process.env.GHL_AGENCY_TOKEN || null;
  return token ? { token, locationId: client.ghl_location_id } : null;
}

// ── GHL fetch w/ 429 backoff ──
async function ghlFetchWithBackoff(path, token) {
  let attempt = 0;
  while (true) {
    const r = await fetch(`${GHL_V2}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Version:       V2_VERSION,
        Accept:        "application/json",
      },
    });
    if (r.status === 429 && attempt < MAX_BACKOFF_ATTEMPTS) {
      const retryAfter = parseInt(r.headers.get("Retry-After") || "2", 10);
      const wait = Math.min(retryAfter * 1000, 30_000) * Math.pow(1.5, attempt);
      await sleep(wait);
      attempt++;
      continue;
    }
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`GHL ${r.status}: ${text.slice(0, 200)}`);
    }
    return r.json();
  }
}

// ── Sync one academy ──
async function syncContactsForAcademy(client, deadline) {
  const tok = await pickGhlToken(client);
  if (!tok?.token || !tok?.locationId) {
    return { skipped: true, reason: "no GHL token / location" };
  }

  let startAfterId = null;
  let totalSeen = 0, totalUpdated = 0;
  const sampleChanges = [];

  while (true) {
    if (Date.now() > deadline) return { partial: true, reason: "deadline reached", totalSeen, totalUpdated };

    const params = new URLSearchParams({ locationId: tok.locationId, limit: "100" });
    if (startAfterId) params.set("startAfterId", startAfterId);

    let data;
    try { data = await ghlFetchWithBackoff(`/contacts/?${params}`, tok.token); }
    catch (e) { return { error: e.message, totalSeen, totalUpdated }; }

    const contacts = data?.contacts || data?.data || [];
    if (contacts.length === 0) break;
    totalSeen += contacts.length;

    // ── V1.5 mirror: upsert every contact into ghl_contacts (powers the
    // Contacts tab). Only for V1.5 academies — the Contacts tab is their CRM.
    // athlete_name is resolved from the mapped custom field(s).
    if (client.v15_access === true) {
      const athleteFieldIds = Array.isArray(client.v15_config?.athlete_name_field_ids)
        ? client.v15_config.athlete_name_field_ids.map(String) : [];
      const mirrorRows = contacts.map(c => {
        const cid = c.id || c.contactId;
        if (!cid) return null;
        const cfArr = c.customFields || c.customField || [];
        const cfMap = {};
        for (const f of (Array.isArray(cfArr) ? cfArr : [])) {
          if (f && f.id != null) cfMap[String(f.id)] = (f.value ?? f.field_value ?? f.fieldValue ?? "");
        }
        let athleteName = null;
        for (const fid of athleteFieldIds) {
          const v = cfMap[fid];
          if (v != null && String(v).trim()) { athleteName = String(v).trim(); break; }
        }
        const tags = Array.isArray(c.tags)
          ? c.tags.map(t => (typeof t === "string" ? t : (t.name || t.tag || ""))).filter(Boolean) : [];
        const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.contactName || c.name || null;
        return {
          client_id: client.id, ghl_contact_id: cid,
          first_name: c.firstName || null, last_name: c.lastName || null, name,
          email: (c.email || "").toLowerCase().trim() || null, phone: c.phone || null,
          tags, athlete_name: athleteName, custom_fields: cfMap,
          date_added: c.dateAdded || c.createdAt || null, synced_at: nowIso(),
        };
      }).filter(Boolean);
      if (mirrorRows.length) {
        await sb(`ghl_contacts?on_conflict=client_id,ghl_contact_id`, {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(mirrorRows),
        }).catch(() => {});
      }
    }

    // Batch member lookup by contact_id
    const contactIds = contacts.map(c => c.id || c.contactId).filter(Boolean);
    if (contactIds.length > 0) {
      const idsCsv = contactIds.map(encodeURIComponent).join(",");
      const memberRows = await sb(
        `members?client_id=eq.${client.id}&ghl_contact_id=in.(${idsCsv})` +
        `&select=id,ghl_contact_id,parent_email,parent_phone,parent_name`
      ).catch(() => []);
      const memberMap = new Map((memberRows || []).map(m => [m.ghl_contact_id, m]));

      for (const c of contacts) {
        const cid = c.id || c.contactId;
        const member = memberMap.get(cid);
        if (!member) continue;

        const patch = {};
        const newEmail = (c.email || "").toLowerCase().trim() || null;
        if (newEmail && newEmail !== (member.parent_email || "").toLowerCase()) {
          patch.parent_email = newEmail;
        }
        if (c.phone && c.phone !== member.parent_phone) {
          patch.parent_phone = c.phone;
        }
        const newName = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
        if (newName && newName !== (member.parent_name || "").trim()) {
          patch.parent_name = newName;
        }

        if (Object.keys(patch).length === 0) continue;
        patch.updated_at = nowIso();

        await sb(`members?id=eq.${member.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(patch),
        });

        // Audit
        await sb(`member_audit_log`, {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify([{
            client_id:         client.id,
            member_id:         member.id,
            action_type:       "cron-ghl-contact-synced",
            args:              { contact_id: cid, fields: Object.keys(patch).filter(k => k !== "updated_at") },
            performed_by_name: "GHL Sync Cron",
            db_changes:        { members: patch },
          }]),
        }).catch(() => {});

        totalUpdated++;
        if (sampleChanges.length < 5) {
          sampleChanges.push({ member_id: member.id, fields: Object.keys(patch).filter(k => k !== "updated_at") });
        }
      }
    }

    // Pagination — pick a next-page anchor; bail when we get a partial page
    const last = contacts[contacts.length - 1];
    startAfterId = data?.meta?.lastId || last?.id || last?.contactId || null;
    if (!startAfterId || contacts.length < 100) break;

    await sleep(PER_REQUEST_SLEEP_MS);
  }

  await sb(`clients?id=eq.${client.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ghl_contacts_last_synced_at: nowIso() }),
  }).catch(() => {});

  return { totalSeen, totalUpdated, sampleChanges };
}

// ── Handler ──
async function handler(req, res) {
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: "CRON_SECRET not configured" });
  const gotBuf = Buffer.from(got);
  const expBuf = Buffer.from(expected);
  const ok = gotBuf.length === expBuf.length && timingSafeEqual(gotBuf, expBuf);
  if (!ok) return res.status(401).json({ error: "unauthorized" });

  const deadline = Date.now() + HARD_DEADLINE_MS;

  // All academies with a usable GHL connection
  const clientsList = await sb(
    `clients?or=(ghl_access_token.not.is.null,ghl_location_id.not.is.null)` +
    `&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_contacts_last_synced_at,v15_access,v15_config`
  ).catch(() => []);

  if (!Array.isArray(clientsList) || clientsList.length === 0) {
    return res.status(200).json({ ok: true, academies: 0, summary: [] });
  }

  const results = [];
  for (let i = 0; i < clientsList.length; i++) {
    if (Date.now() > deadline) {
      results.push({ academy: clientsList[i].business_name, skipped: true, reason: "deadline reached before reaching this academy" });
      continue;
    }
    if (i > 0) await sleep(PER_ACADEMY_STAGGER_MS);

    const client = clientsList[i];
    let r;
    try { r = await syncContactsForAcademy(client, deadline); }
    catch (e) { r = { error: e.message }; }
    results.push({ academy: client.business_name, ...r });
  }

  const anyError = results.some(r => r.error);
  console.log(`[cron-sync-contacts] academies=${results.length} updated=${results.reduce((s, r) => s + (r.totalUpdated || 0), 0)} errors=${results.filter(r => r.error).length}`);
  return res.status(anyError ? 500 : 200).json({ ok: !anyError, academies: results.length, summary: results });
}

export default withSentryApiRoute(handler);
