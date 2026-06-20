import { withSentryApiRoute } from "../_sentry.js";
export const maxDuration = 300; // paginates ALL GHL contacts — needs headroom
// Vercel Serverless Function — Member Onboarding: link members ↔ GHL contacts.
//
// CSV-imported members arrive with no ghl_contact_id, so the 10-minute GHL
// contact sync cron (api/ghl/cron-sync-contacts.js) silently skips them and
// no texts/emails/automations can target them. This endpoint closes that gap:
//
//   POST { client_id, mode:"propose" }
//     → members with ghl_contact_id IS NULL, matched against ALL GHL contacts
//       for the academy's location — by parent_email (case-insensitive) first,
//       then by phone (last-10-digit match).
//     → { proposals:[{member_id, athlete_name, parent_name, parent_email,
//          ghl_contact_id, contact_name, contact_email, matched_by}],
//         unmatched:[{member_id, athlete_name, parent_email, parent_phone}],
//         total_unlinked, total_contacts }
//     No DB writes.
//
//   POST { client_id, mode:"apply", links:[{member_id, ghl_contact_id}] }
//     → sets members.ghl_contact_id per confirmed link (only rows still NULL,
//       scoped to client_id). → { ok, linked }
//
// Auth = the standard sorter pattern (staff or active client_users member).
// GHL token plumbing mirrors api/ghl/cron-sync-contacts.js (refresh + backoff).

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const GHL_V2        = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION    = "2021-07-28";
const MAX_BACKOFF_ATTEMPTS = 5;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

// Auth: staff (any client) or active client_users membership of client_id.
async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,role&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,role&limit=1`);
  }
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, isStaff, clientIds };
}

// ── GHL token plumbing (mirrors cron-sync-contacts.js) ──
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

async function ghlFetchWithBackoff(path, token) {
  let attempt = 0;
  while (true) {
    const r = await fetch(`${GHL_V2}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json" },
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

const normEmail = (e) => String(e || "").trim().toLowerCase();
const normPhone = (p) => String(p || "").replace(/\D/g, "").slice(-10); // last 10 digits

// Targeted GHL contact lookup by a search term (email or phone). GHL's
// `query` param searches name/email/phone — we match the returned rows back
// against the EXACT normalized email/phone so a fuzzy hit can't link the wrong
// contact. Mirrors api/ghl/contacts-search.js (proven pattern).
async function ghlSearchContacts(tok, term) {
  const params = new URLSearchParams({ locationId: tok.locationId, limit: "20", query: term });
  const data = await ghlFetchWithBackoff(`/contacts/?${params}`, tok.token);
  const list = data?.contacts || data?.data || [];
  return list.map(c => ({
    id:    c.id || c.contactId,
    name:  c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
    email: c.email || null,
    phone: c.phone || null,
  })).filter(c => c.id);
}

async function runPropose(res, client) {
  const tok = await pickGhlToken(client);
  if (!tok?.token || !tok?.locationId) {
    return res.status(409).json({ error: "GHL not connected for this academy" });
  }

  // Members still missing their GHL link.
  const members = await sb(
    `members?client_id=eq.${client.id}&ghl_contact_id=is.null` +
    `&select=id,athlete_name,parent_name,parent_email,parent_phone&order=athlete_name`
  ) || [];
  if (!members.length) {
    return res.status(200).json({ ok: true, proposals: [], unmatched: [], total_unlinked: 0, note: "every member already has a GHL contact linked" });
  }

  // Look each member up DIRECTLY by email then phone. This replaces the old
  // "paginate every contact and build a map" approach, which silently capped at
  // 10k contacts — so on academies with >10k GHL contacts most members fell
  // outside the window and never matched. A targeted query has no such cap.
  const proposals = [], unmatched = [];
  const CONCURRENCY = 5; // ~5 req/s — friendly with GHL's per-location budget
  let cursor = 0, searched = 0;
  async function worker() {
    while (cursor < members.length) {
      const m = members[cursor++];
      const em = normEmail(m.parent_email);
      const ph = normPhone(m.parent_phone);
      let hit = null, matchedBy = null;
      try {
        if (em) {
          const list = await ghlSearchContacts(tok, em);
          const c = list.find(x => normEmail(x.email) === em);
          if (c) { hit = c; matchedBy = "email"; }
        }
        if (!hit && ph.length === 10) {
          const list = await ghlSearchContacts(tok, ph);
          const c = list.find(x => normPhone(x.phone) === ph);
          if (c) { hit = c; matchedBy = "phone"; }
        }
      } catch (_) { /* a single lookup failing → treat that member as unmatched */ }
      searched++;
      if (hit) {
        proposals.push({
          member_id: m.id, athlete_name: m.athlete_name, parent_name: m.parent_name,
          parent_email: m.parent_email, ghl_contact_id: hit.id, contact_name: hit.name,
          contact_email: hit.email, matched_by: matchedBy,
        });
      } else {
        unmatched.push({ member_id: m.id, athlete_name: m.athlete_name, parent_email: m.parent_email, parent_phone: m.parent_phone });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, members.length) }, worker));
  // Concurrency scrambles push order — restore stable alphabetical display.
  const byName = (a, b) => String(a.athlete_name || "").localeCompare(String(b.athlete_name || ""));
  proposals.sort(byName); unmatched.sort(byName);
  return res.status(200).json({ ok: true, proposals, unmatched, total_unlinked: members.length, searched, lookup: "search" });
}

async function runApply(res, client, body) {
  const links = Array.isArray(body.links) ? body.links.slice(0, 500) : [];
  if (!links.length) return res.status(400).json({ error: "apply needs links[]" });
  let linked = 0;
  for (const l of links) {
    if (!l.member_id || !l.ghl_contact_id) continue;
    // Only fill rows that are still NULL (idempotent; never overwrites a link).
    const r = await sb(
      `members?id=eq.${encodeURIComponent(l.member_id)}&client_id=eq.${client.id}&ghl_contact_id=is.null`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ghl_contact_id: l.ghl_contact_id }) }
    );
    if (Array.isArray(r) && r.length) linked++;
  }
  return res.status(200).json({ ok: true, linked });
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    const ctx = await resolveUser(req);
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = body.client_id || ctx.clientIds[0];
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    const rows = await sb(
      `clients?id=eq.${encodeURIComponent(clientId)}` +
      `&select=id,business_name,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`
    );
    const client = rows && rows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });

    const mode = body.mode || "propose";
    if (mode === "propose") return await runPropose(res, client);
    if (mode === "apply")   return await runApply(res, client, body);
    return res.status(400).json({ error: "unknown mode (expected 'propose' or 'apply')" });
  } catch (e) {
    let msg = e && e.message;
    if (!msg) { try { msg = typeof e === "string" ? e : JSON.stringify(e); } catch (_) { msg = String(e); } }
    console.error("link-ghl error:", msg);
    return res.status((e && e.status) || 500).json({ error: msg || "unknown error" });
  }
}

export default withSentryApiRoute(handler);
