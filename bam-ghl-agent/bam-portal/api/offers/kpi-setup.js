import { withSentryApiRoute } from "../_sentry.js";
// Reads ALL Stripe subscriptions + products (paginated) and the GHL pipeline
// list — more than the default ~10s function budget, so give it headroom.
export const maxDuration = 60;
// Vercel Serverless Function — V1.5 KPIs Setup (Offer ⇄ Stripe ⇄ GHL pipeline)
//
// The Setup tab of the V1.5 KPIs dashboard. It ties the raw money/CRM sources to
// the academy's OFFERS so the Sales / Revenue / Members sections can group by
// offer. This is attribution-only (KPI grouping); it does NOT route checkout —
// that's pricing_catalog's job (the AI Price Match). Mappings live in
// kpi_offer_links.
//
//   GET  /api/offers/kpi-setup?client_id=<uuid>
//     → { offers:[{id,title}], stripeProducts:[{id,name,active,sub_count,offer_id}],
//         pipelines:[{id,name,offer_id}], links:[...] }
//
//   POST /api/offers/kpi-setup?client_id=<uuid>
//     body { action:"link", kind:"stripe_product"|"ghl_pipeline", ref_id, label, offer_id|null }
//       → ties (or, offer_id null, unties) one product/pipeline to an offer
//     body { action:"create-offer", title }
//       → creates a lightweight offer (so you can group by it) → { offer:{id,title} }
//
// Auth: Supabase JWT — staff (any academy) or a client_users member of client_id.

const GHL_V2        = "https://services.leadconnectorhq.com";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const V2_VERSION    = "2021-07-28";
const STRIPE_API    = "https://api.stripe.com/v1";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

// ── Stripe ──
function stripeKey() { return process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY; }
async function stripeGet(path, stripeAccount) {
  const headers = { Authorization: `Bearer ${stripeKey()}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const res = await fetch(`${STRIPE_API}${path}`, { headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
  return json;
}

// Every subscription (any status, incl. canceled) → product id → paid-sub count.
async function countSubsByProduct(stripeAccount) {
  const counts = {};
  let startingAfter = null;
  for (let page = 0; page < 20; page++) { // 20×100 = 2000 subs cap
    const qs = new URLSearchParams({ status: "all", limit: "100" });
    qs.append("expand[]", "data.items.data.price");
    if (startingAfter) qs.set("starting_after", startingAfter);
    const r = await stripeGet(`/subscriptions?${qs.toString()}`, stripeAccount);
    const data = r.data || [];
    for (const sub of data) {
      const item = sub.items && sub.items.data && sub.items.data[0];
      const price = item && item.price;
      const pid = price && (typeof price.product === "string" ? price.product : price.product && price.product.id);
      if (pid) counts[pid] = (counts[pid] || 0) + 1;
    }
    if (!r.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  return counts;
}

// Paid, non-subscription (one-time) invoices → product id → count sold.
// This is how one-time products/packages get a real "N sold" instead of the
// misleading "0 subs ever". Bounded scan (same spirit as the sub scan).
async function countOneTimeByProduct(stripeAccount) {
  const counts = {};
  let startingAfter = null;
  for (let page = 0; page < 15; page++) { // 15×100 = 1500 invoices cap
    const qs = new URLSearchParams({ status: "paid", limit: "100" });
    qs.append("expand[]", "data.lines.data.price");
    if (startingAfter) qs.set("starting_after", startingAfter);
    const r = await stripeGet(`/invoices?${qs.toString()}`, stripeAccount);
    const data = r.data || [];
    for (const inv of data) {
      if (inv.subscription) continue; // subscription invoices already counted as subs
      const seen = new Set();
      for (const line of (inv.lines && inv.lines.data) || []) {
        const price = line.price || line.plan;
        const pid = price && (typeof price.product === "string" ? price.product : price.product && price.product.id);
        if (pid && !seen.has(pid)) { counts[pid] = (counts[pid] || 0) + 1; seen.add(pid); }
      }
    }
    if (!r.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  return counts;
}

// All products on the connected account → id, name, active flag.
async function fetchProducts(stripeAccount) {
  const out = [];
  let startingAfter = null;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: "100" });
    if (startingAfter) qs.set("starting_after", startingAfter);
    const r = await stripeGet(`/products?${qs.toString()}`, stripeAccount);
    const data = r.data || [];
    for (const p of data) out.push({ id: p.id, name: p.name, active: p.active !== false });
    if (!r.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  return out;
}

// ── GHL ──
async function ghl(method, path, { token } = {}) {
  const headers = { Authorization: `Bearer ${token}`, Version: V2_VERSION, Accept: "application/json", "Content-Type": "application/json" };
  let res, text;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${GHL_V2}${path}`, { method, headers });
    if (res.status !== 429) break;
    const ra = Number(res.headers.get("retry-after"));
    await sleep(ra > 0 ? Math.min(ra * 1000, 5000) : Math.min(400 * 2 ** attempt, 5000));
  }
  text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
  if (!res.ok) { const err = new Error((json && (json.message || json.error)) || `GHL ${res.status}`); err.status = res.status; throw err; }
  return json;
}
async function refreshGhlToken(client) {
  const cid = (process.env.GHL_OAUTH_CLIENT_ID || "").trim();
  const sec = (process.env.GHL_OAUTH_CLIENT_SECRET || "").trim();
  if (!cid || !sec || !client.ghl_refresh_token) throw new Error("GHL refresh not configured");
  const tokenRes = await fetch(GHL_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cid, client_secret: sec, grant_type: "refresh_token", refresh_token: client.ghl_refresh_token, user_type: "Location" }),
  });
  const tok = await tokenRes.json();
  if (!tokenRes.ok || !tok?.access_token) throw new Error(tok?.error_description || "GHL token refresh failed");
  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 86400) * 1000).toISOString();
  await sb(`clients?id=eq.${client.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ghl_access_token: tok.access_token, ghl_refresh_token: tok.refresh_token || client.ghl_refresh_token, ghl_token_expires_at: expiresAt }) });
  return { token: tok.access_token, locationId: tok.locationId || client.ghl_location_id };
}
async function pickGhlToken(client) {
  if (client.ghl_access_token) {
    const exp = client.ghl_token_expires_at ? new Date(client.ghl_token_expires_at).getTime() : 0;
    if (exp - Date.now() <= 60_000 && client.ghl_refresh_token) { try { return await refreshGhlToken(client); } catch (_) {} }
    return { token: client.ghl_access_token, locationId: client.ghl_location_id };
  }
  const tok = process.env.GHL_API_KEY || process.env.GHL_AGENCY_TOKEN || null;
  return tok ? { token: tok, locationId: client.ghl_location_id } : null;
}
async function fetchPipelines(client) {
  let creds;
  try { creds = await pickGhlToken(client); } catch (_) { creds = null; }
  if (!creds || !creds.token || !creds.locationId) return [];
  try {
    const r = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(creds.locationId)}`, { token: creds.token });
    return (r.pipelines || []).map(p => ({ id: p.id, name: p.name }));
  } catch (_) { return []; }
}

async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Supabase env not configured");
    const ctx = await resolveUser(req);
    const clientId = (req.query && req.query.client_id) || (req.body && req.body.client_id) || ctx.clientIds[0];
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "forbidden" });

    // ── POST: link / create-offer ──
    if (req.method === "POST") {
      const body = (req.body && typeof req.body === "object") ? req.body : {};
      const action = body.action;

      if (action === "create-offer") {
        const title = String(body.title || "").trim();
        if (!title) return res.status(400).json({ error: "title required" });
        const rows = await sb(`offers`, {
          method: "POST", headers: { Prefer: "return=representation" },
          body: JSON.stringify({ client_id: clientId, title, type: "training", status: "draft", data: {} }),
        });
        const offer = Array.isArray(rows) ? rows[0] : rows;
        return res.status(200).json({ ok: true, offer: { id: offer.id, title: offer.title } });
      }

      if (action === "link") {
        const kind = body.kind;
        const refId = String(body.ref_id || "").trim();
        if (!["stripe_product", "ghl_pipeline"].includes(kind) || !refId) {
          return res.status(400).json({ error: "kind + ref_id required" });
        }
        const offerId = body.offer_id || null;
        // No offer → remove the link entirely.
        if (!offerId) {
          await sb(`kpi_offer_links?client_id=eq.${encodeURIComponent(clientId)}&kind=eq.${encodeURIComponent(kind)}&ref_id=eq.${encodeURIComponent(refId)}`,
            { method: "DELETE", headers: { Prefer: "return=minimal" } });
          return res.status(200).json({ ok: true, removed: true });
        }
        // Upsert: PATCH the existing row; if none, INSERT.
        const patch = await sb(
          `kpi_offer_links?client_id=eq.${encodeURIComponent(clientId)}&kind=eq.${encodeURIComponent(kind)}&ref_id=eq.${encodeURIComponent(refId)}`,
          { method: "PATCH", headers: { Prefer: "return=representation" },
            body: JSON.stringify({ offer_id: offerId, label: body.label || null, updated_at: nowIso() }) }
        );
        if (!Array.isArray(patch) || !patch.length) {
          await sb(`kpi_offer_links`, { method: "POST", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ client_id: clientId, kind, ref_id: refId, label: body.label || null, offer_id: offerId }) });
        }
        return res.status(200).json({ ok: true, linked: true });
      }

      return res.status(400).json({ error: "unknown action" });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "GET or POST" });

    // ── GET: assemble offers + Stripe products + GHL pipelines + existing links ──
    const clientRows = await sb(
      `clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,stripe_connect_account_id,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`
    );
    const client = Array.isArray(clientRows) && clientRows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });

    const offersRows = await sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&status=neq.archived&select=id,title&order=title.asc`) || [];
    const offers = offersRows.map(o => ({ id: o.id, title: o.title }));

    const links = await sb(`kpi_offer_links?client_id=eq.${encodeURIComponent(clientId)}&select=kind,ref_id,offer_id,label`) || [];
    const linkOf = {};
    for (const l of links) linkOf[`${l.kind}:${l.ref_id}`] = l.offer_id;

    // Stripe products ever paid (+ created). sub_count = subs ever on that product.
    let stripeProducts = [];
    if (client.stripe_connect_account_id) {
      try {
        const [subCounts, oneTimeCounts, prods] = await Promise.all([
          countSubsByProduct(client.stripe_connect_account_id),
          countOneTimeByProduct(client.stripe_connect_account_id).catch(() => ({})),
          fetchProducts(client.stripe_connect_account_id),
        ]);
        const byId = {};
        for (const p of prods) byId[p.id] = { id: p.id, name: p.name, active: p.active, sub_count: subCounts[p.id] || 0, onetime_count: oneTimeCounts[p.id] || 0 };
        // products referenced by a sub/one-time sale but missing from the list (deleted product)
        for (const pid of Object.keys({ ...subCounts, ...oneTimeCounts })) if (!byId[pid]) byId[pid] = { id: pid, name: "(deleted product)", active: false, sub_count: subCounts[pid] || 0, onetime_count: oneTimeCounts[pid] || 0 };
        stripeProducts = Object.values(byId)
          .map(p => ({ ...p, offer_id: linkOf[`stripe_product:${p.id}`] || null }))
          .sort((a, b) => ((b.sub_count + b.onetime_count) - (a.sub_count + a.onetime_count)) || String(a.name || "").localeCompare(String(b.name || "")));
      } catch (e) { stripeProducts = []; }
    }

    // GHL pipelines.
    let pipelines = [];
    try {
      const pl = await fetchPipelines(client);
      pipelines = pl.map(p => ({ id: p.id, name: p.name, offer_id: linkOf[`ghl_pipeline:${p.id}`] || null }));
    } catch (_) { pipelines = []; }

    return res.status(200).json({
      ok: true,
      academy: client.business_name,
      stripeConnected: !!client.stripe_connect_account_id,
      offers, stripeProducts, pipelines, links,
    });
  } catch (e) {
    let msg = e && e.message; if (!msg) { try { msg = JSON.stringify(e); } catch (_) { msg = String(e); } }
    console.error("kpi-setup error:", msg, e && e.stack);
    return res.status((e && e.status) || 500).json({ error: msg || "unknown error" });
  }
}

export default withSentryApiRoute(handler);
