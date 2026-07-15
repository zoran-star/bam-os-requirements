import { withSentryApiRoute } from "../_sentry.js";
// Merch store inventory - the portal owns per-colorway stock; the live store
// reads it. Inventory lives in clients.ghl_kpi_config.store_inventory as a map
// { "slug__colorwayKey": false } (absent/true = in stock, false = out).
//
//   GET  ?client_id=&stock=1   PUBLIC  -> { out_of_stock: ["slug__key", ...] }  (store reads this)
//   GET  ?client_id=           AUTH    -> { enabled, products:[{slug,name,colorways:[{key,label,in_stock}]}] }
//   POST { client_id, variant_key, in_stock }  AUTH -> update one colorway's stock
//
// Auth (non-public): Supabase JWT - staff (any academy) or client_users member.

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { user, isStaff, clientIds };
}

async function loadClient(clientId) {
  const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,ghl_kpi_config&limit=1`);
  return rows?.[0] || null;
}
const invMap = (client) => (client && client.ghl_kpi_config && client.ghl_kpi_config.store_inventory) || {};
const outOfStockList = (map) => Object.entries(map || {}).filter(([, v]) => v === false).map(([k]) => k);

async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: "Supabase not configured" });
    const clientId = (req.query && req.query.client_id) || (req.body && req.body.client_id);
    if (!clientId) return res.status(400).json({ error: "client_id required" });

    // ── PUBLIC stock read (the store calls this; no auth) ──
    if (req.method === "GET" && req.query && (req.query.stock === "1" || req.query.stock === "true")) {
      const client = await loadClient(clientId);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ out_of_stock: client ? outOfStockList(invMap(client)) : [] });
    }

    // ── Everything else is authed (staff or this client's member) ──
    const ctx = await resolveUser(req);
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });
    const client = await loadClient(clientId);
    if (!client) return res.status(404).json({ error: "academy not found" });
    const cfg = (client.ghl_kpi_config && typeof client.ghl_kpi_config === "object") ? client.ghl_kpi_config : {};
    const map = cfg.store_inventory || {};
    const enabled = !!cfg.store_order_workflow_id;

    if (req.method === "POST") {
      const b = (req.body && typeof req.body === "object") ? req.body : {};
      if (!b.variant_key || typeof b.in_stock === "undefined") return res.status(400).json({ error: "variant_key and in_stock required" });
      const nextMap = { ...map };
      if (b.in_stock) delete nextMap[b.variant_key]; // in stock = default, keep the map lean
      else nextMap[b.variant_key] = false;
      const nextCfg = { ...cfg, store_inventory: nextMap };
      await sb(`clients?id=eq.${encodeURIComponent(clientId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_kpi_config: nextCfg }) });
      return res.status(200).json({ ok: true, out_of_stock: outOfStockList(nextMap) });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "GET or POST" });

    // AUTH GET: catalog (from the store) merged with stock state, for the Store tab UI.
    const base = (cfg.store_base_url || "").replace(/\/+$/, "");
    let products = [];
    if (base) {
      try {
        const r = await fetch(`${base}/api/catalog`, { headers: { Accept: "application/json" } });
        if (r.ok) {
          const j = await r.json();
          products = (j.products || []).map(p => ({
            slug: p.slug, name: p.name, category: p.category || null,
            colorways: (p.colorways || []).map(c => ({
              key: c.key, label: c.label, image: c.image || null,
              in_stock: c.baseInStock !== false && map[`${p.slug}__${c.key}`] !== false,
            })),
          }));
        }
      } catch (_) {}
    }
    return res.status(200).json({ ok: true, enabled, store_base_url: base || null, products });
  } catch (e) {
    return res.status((e && e.status) || 500).json({ error: (e && e.message) || "error" });
  }
}

export default withSentryApiRoute(handler);
