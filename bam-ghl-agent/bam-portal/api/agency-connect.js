import { withSentryApiRoute } from "./_sentry.js";
import crypto from "node:crypto";
// ── Path B: GHL Agency (Company) connect + bulk sub-account token minting ──
//
// BAM is the agency that owns every academy sub-account. Instead of connecting
// each one with its own OAuth, the agency owner authorizes ONCE at the company
// level; we store the Company token and mint a Location token per sub-account
// via /oauth/locationToken. Future academies connect with one click too.
//
//   GET /api/agency-connect?action=start   → redirect to GHL agency consent
//   GET /api/agency-connect?code=&state=   → callback: store company token,
//                                                 then mint a token for every
//                                                 sub-account, render results
//   GET /api/agency-connect?action=mint&key=<CRON_SECRET>  → re-mint later
//
// Marketplace app must have Distribution = Agency (or Agency + Sub-Account) and
// this redirect URL registered: https://portal.byanymeansbusiness.com/api/agency-connect

export const maxDuration = 60;

const GHL_AUTHORIZE_URL = "https://marketplace.gohighlevel.com/oauth/chooselocation";
const GHL_TOKEN_URL     = "https://services.leadconnectorhq.com/oauth/token";
const GHL_LOC_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/locationToken";
const V2_VERSION        = "2021-07-28";
const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Location tokens inherit these scopes (same set the per-location connect uses).
const SCOPES = [
  "locations.readonly", "users.readonly", "businesses.readonly", "contacts.readonly", "contacts.write",
  "conversations.readonly", "conversations.write", "conversations/message.readonly", "conversations/message.write",
  "opportunities.readonly", "opportunities.write",
  "calendars.readonly", "calendars.write", "calendars/events.readonly", "calendars/events.write",
  "calendars/groups.readonly", "calendars/groups.write",
  "forms.readonly", "workflows.readonly", "campaigns.readonly", "surveys.readonly",
  "locations/customFields.readonly", "locations/customFields.write",
  "locations/customValues.readonly", "locations/customValues.write",
  "locations/tags.readonly", "locations/tags.write",
  "locations/tasks.readonly", "locations/tasks.write", "locations/templates.readonly",
  "products.readonly", "products.write", "products/prices.readonly", "products/prices.write", "products/collection.readonly",
  "invoices.readonly", "invoices.write", "invoices/schedule.readonly", "invoices/schedule.write", "invoices/template.readonly",
  "payments/orders.readonly", "payments/orders.write", "payments/transactions.readonly", "payments/subscriptions.readonly",
  "payments/integration.readonly", "payments/coupons.readonly", "payments/coupons.write",
  "socialplanner/post.readonly", "socialplanner/post.write", "socialplanner/account.readonly", "socialplanner/oauth.readonly",
  "courses.readonly", "courses.write", "emails/builder.readonly", "emails/builder.write",
  "funnels/funnel.readonly", "funnels/page.readonly", "funnels/pagecount.readonly", "funnels/redirect.readonly",
].join(" ");

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

function getOrigin(req) {
  if (process.env.PORTAL_URL) return process.env.PORTAL_URL.replace(/\/+$/, "");
  const origin = req.headers.origin || `https://${req.headers.host || ""}`;
  if (/localhost|127\.0\.0\.1/.test(origin)) return origin.replace(/\/+$/, "");
  return "https://portal.byanymeansbusiness.com";
}
function redirectUri(req) { return `${getOrigin(req)}/api/agency-connect`; }

function stateSecret() { return process.env.GHL_OAUTH_STATE_SECRET || SUPABASE_SERVICE_KEY; }
function signState(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", stateSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}
function verifyState(state) {
  if (typeof state !== "string" || !state.includes(".")) throw new Error("bad state");
  const [data, sig] = state.split(".");
  const expected = crypto.createHmac("sha256", stateSecret()).update(data).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("bad signature");
  const payload = JSON.parse(Buffer.from(data, "base64url").toString());
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) throw new Error("state expired");
  return payload;
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(title)}</title><style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;background:#0B0B0D;color:#EDEDED;margin:0;padding:32px}
    .wrap{max-width:640px;margin:0 auto}h1{font-size:20px}table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
    td{padding:6px 8px;border-bottom:1px solid #222}b{color:#E8C547}.muted{color:#888}</style></head>
    <body><div class="wrap"><h1>${esc(title)}</h1>${body}</div></body></html>`;
}

async function exchangeCode(code, redirect) {
  const r = await fetch(GHL_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: (process.env.GHL_AGENCY_OAUTH_CLIENT_ID || process.env.GHL_OAUTH_CLIENT_ID || "").trim(),
      client_secret: (process.env.GHL_AGENCY_OAUTH_CLIENT_SECRET || process.env.GHL_OAUTH_CLIENT_SECRET || "").trim(),
      grant_type: "authorization_code", code, user_type: "Company", redirect_uri: redirect,
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || `token exchange ${r.status}`);
  return j; // access_token, refresh_token, expires_in, companyId, userType
}

async function getAgencyToken() {
  const rows = await sb(`ghl_agency_tokens?select=*&order=updated_at.desc&limit=1`);
  const t = rows && rows[0];
  if (!t) return null;
  const exp = t.expires_at ? new Date(t.expires_at).getTime() : 0;
  if (exp && exp - Date.now() <= 60_000 && t.refresh_token) {
    try {
      const r = await fetch(GHL_TOKEN_URL, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: (process.env.GHL_AGENCY_OAUTH_CLIENT_ID || process.env.GHL_OAUTH_CLIENT_ID || "").trim(),
          client_secret: (process.env.GHL_AGENCY_OAUTH_CLIENT_SECRET || process.env.GHL_OAUTH_CLIENT_SECRET || "").trim(),
          grant_type: "refresh_token", refresh_token: t.refresh_token, user_type: "Company",
        }),
      });
      const j = await r.json();
      if (r.ok && j.access_token) {
        const expiresAt = j.expires_in ? new Date(Date.now() + Number(j.expires_in) * 1000).toISOString() : null;
        await sb(`ghl_agency_tokens?company_id=eq.${encodeURIComponent(t.company_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ access_token: j.access_token, refresh_token: j.refresh_token || t.refresh_token, expires_at: expiresAt, updated_at: new Date().toISOString() }) });
        return { ...t, access_token: j.access_token };
      }
    } catch (_) {}
  }
  return t;
}

async function mintLocationToken(agencyToken, companyId, locationId) {
  const r = await fetch(GHL_LOC_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${agencyToken}`, Version: V2_VERSION, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ companyId, locationId }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error((j && (j.message || j.error)) || `locationToken ${r.status}`);
  return j; // access_token, refresh_token, expires_in
}

// Mint + store a location token for every academy that has a GHL location id.
async function mintAll(companyId, agencyToken) {
  const clients = await sb(`clients?ghl_location_id=not.is.null&select=id,business_name,ghl_location_id&order=business_name.asc`);
  const queue = [...(clients || [])];
  const results = [];
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift();
      try {
        const tok = await mintLocationToken(agencyToken, companyId, c.ghl_location_id);
        const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString();
        await sb(`clients?id=eq.${c.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_access_token: tok.access_token, ghl_refresh_token: tok.refresh_token || null, ghl_token_expires_at: expiresAt, ghl_connect_status: "connected", ghl_connected_at: new Date().toISOString() }) });
        results.push({ name: c.business_name, ok: true });
      } catch (e) { results.push({ name: c.business_name, ok: false, err: String(e.message || e).slice(0, 140) }); }
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  results.sort((a, b) => (a.ok === b.ok ? String(a.name).localeCompare(String(b.name)) : a.ok ? 1 : -1));
  return results;
}

function resultsPage(companyId, results) {
  const ok = results.filter(r => r.ok).length;
  const rows = results.map(r => `<tr><td>${r.ok ? "✅" : "❌"}</td><td>${esc(r.name)}</td><td class="muted">${r.ok ? "" : esc(r.err || "")}</td></tr>`).join("");
  return page("Agency connected ✓",
    `<p>Authorized agency <b>${esc(companyId)}</b>. Connected <b>${ok}/${results.length}</b> sub-accounts.</p>
     <table>${rows}</table>
     <p class="muted" style="margin-top:18px">Failures are usually sub-accounts not actually under this agency, or with no GHL location. You can close this tab.</p>`);
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).send("Supabase not configured");
  const action = (req.query.action || "").toString();

  // 1) Kick off the agency consent.
  if (action === "start") {
    const state = signState({ k: "agency", exp: Date.now() + 15 * 60 * 1000 });
    const params = new URLSearchParams({ response_type: "code", client_id: (process.env.GHL_AGENCY_OAUTH_CLIENT_ID || process.env.GHL_OAUTH_CLIENT_ID || "").trim(), redirect_uri: redirectUri(req), scope: SCOPES, state });
    res.writeHead(302, { Location: `${GHL_AUTHORIZE_URL}?${params.toString()}` });
    return res.end();
  }

  // 3) Re-mint later (e.g. after adding academies) — gated by CRON_SECRET.
  if (action === "mint") {
    const expected = process.env.CRON_SECRET || "";
    if (!expected || (req.query.key || "") !== expected) return res.status(401).json({ error: "unauthorized" });
    const t = await getAgencyToken();
    if (!t) return res.status(400).json({ error: "no agency token — authorize first via ?action=start" });
    const results = await mintAll(t.company_id, t.access_token);
    return res.status(200).json({ ok: true, company_id: t.company_id, connected: results.filter(r => r.ok).length, total: results.length, results });
  }

  // 2) OAuth callback → store company token → mint all.
  if (req.query.code) {
    // State is best-effort CSRF protection for the ?action=start path. GHL's
    // own draft-app "Install link" doesn't carry our HMAC state, so we don't
    // hard-require it — this is a one-time owner-initiated agency install.
    if (req.query.state) { try { verifyState(req.query.state); } catch (_) { /* foreign/absent state (install-link flow) — allow */ } }
    try {
      const tok = await exchangeCode(req.query.code, redirectUri(req));
      const companyId = tok.companyId || tok.company_id || null;
      if (!companyId) throw new Error("No companyId in the OAuth response — make sure the app installed at the AGENCY level (Distribution = Agency), not a single location.");
      const expiresAt = tok.expires_in ? new Date(Date.now() + Number(tok.expires_in) * 1000).toISOString() : null;
      await sb(`ghl_agency_tokens?on_conflict=company_id`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ company_id: companyId, access_token: tok.access_token, refresh_token: tok.refresh_token || null, expires_at: expiresAt, updated_at: new Date().toISOString() }) });
      const results = await mintAll(companyId, tok.access_token);
      return res.status(200).send(resultsPage(companyId, results));
    } catch (e) {
      return res.status(500).send(page("Couldn't connect", `<p>${esc(e.message || String(e))}</p>`));
    }
  }

  return res.status(200).send(page("BAM · GHL Agency Connect", `<p>Start the agency connection by opening <b>?action=start</b>.</p>`));
}

export default withSentryApiRoute(handler);
