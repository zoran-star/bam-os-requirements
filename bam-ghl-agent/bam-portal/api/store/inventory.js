import { withSentryApiRoute } from "../_sentry.js";
// Merch store - the portal owns stock AND the catalog edits; the live store
// reads both. Two things live in clients.ghl_kpi_config:
//
//   store_inventory  { "slug__colorwayKey": 12 | false }   per-colorway stock
//   store_catalog    { prices:{slug:cents}, removed:[slug], added:[product] }
//
// The store's own lib/products.ts stays the base catalog. The overlay is only
// the owner's edits on top of it, so nothing here can corrupt the base list -
// clearing the overlay restores the store exactly as it shipped.
//
//   GET  ?client_id=&stock=1     PUBLIC -> { out_of_stock: ["slug__key", ...] }
//   GET  ?client_id=&catalog=1   PUBLIC -> { prices, removed, added }  (store merges this)
//   GET  ?client_id=             AUTH   -> { enabled, products:[...] }  (portal Store tab)
//   POST { client_id, variant_key, qty|in_stock }   AUTH -> set one colorway's stock
//   POST { client_id, action, ... }                 AUTH -> catalog edit, see applyCatalogAction
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

// A variant's stock is stored as either:
//   number  -> real quantity (0 = sold out)
//   false   -> out of stock, no count (the original binary flag)
//   absent  -> in stock, no count (default)
// Quantities were added on top of the binary flag rather than replacing it, so
// the live store keeps working unchanged: it only reads out_of_stock, and a
// count of 0 lands in that list exactly like the old `false` did.
const isOut = (v) => v === false || (typeof v === "number" && v <= 0);
const outOfStockList = (map) => Object.entries(map || {}).filter(([, v]) => isOut(v)).map(([k]) => k);
const qtyOf = (v) => (typeof v === "number" ? v : null);

// ── Catalog overlay ──────────────────────────────────────────────────────────
// The owner's edits on top of the store's built-in catalog: re-price, hide, and
// add. Read back through normalisers so a half-written or hand-edited config can
// never hand the store something malformed.

const CATEGORIES = ["tshirts", "compression-shirts", "compression-tanks"];
const DEFAULT_SIZES = ["YS", "YM", "YL", "S", "M", "L", "XL", "XXL"];
const MAX_PRICE_CENTS = 100000;   // $1,000 - a merch price above this is a typo
const MAX_ADDED = 50;

const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// Prices are whole cents, always. A price is the one field here that moves money,
// so anything not a clean number in range is rejected rather than coerced.
function cleanPrice(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE_CENTS) return null;
  return n;
}

// Only https image URLs. The store renders these straight into <img>, so a
// javascript:/data: URL here would be an injection route.
function cleanImage(v) {
  const s = String(v || "").trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : null;
}

function cleanAddedProduct(raw) {
  if (!raw || typeof raw !== "object") return null;
  const slug = slugify(raw.slug || raw.name);
  const name = String(raw.name || "").trim().slice(0, 120);
  const priceCents = cleanPrice(raw.priceCents ?? raw.price_cents);
  if (!slug || !name || priceCents === null) return null;

  const category = CATEGORIES.includes(raw.category) ? raw.category : "tshirts";
  const colorways = (Array.isArray(raw.colorways) ? raw.colorways : [])
    .map((c) => {
      const key = slugify(c && (c.key || c.label));
      const label = String((c && c.label) || "").trim().slice(0, 80);
      if (!key || !label) return null;
      const images = (Array.isArray(c.images) ? c.images : [c && c.image]).map(cleanImage).filter(Boolean);
      return { key, label, images, inStock: true };
    })
    .filter(Boolean)
    .slice(0, 12);
  if (!colorways.length) return null;

  const sizes = (Array.isArray(raw.sizes) ? raw.sizes : DEFAULT_SIZES)
    .map((s) => String(s || "").trim().toUpperCase().slice(0, 6)).filter(Boolean).slice(0, 20);

  return {
    slug, name, category,
    categoryLabel: (CATEGORIES.includes(category) ? { "tshirts": "T-Shirts", "compression-shirts": "Compression Shirts", "compression-tanks": "Compression Tanks" }[category] : "T-Shirts"),
    subtitle: String(raw.subtitle || "").trim().slice(0, 120),
    priceCents,
    description: String(raw.description || "").trim().slice(0, 2000),
    features: (Array.isArray(raw.features) ? raw.features : []).map((f) => String(f || "").trim().slice(0, 200)).filter(Boolean).slice(0, 12),
    deliveryReturns: String(raw.deliveryReturns || "").trim().slice(0, 1000),
    sizes: sizes.length ? sizes : DEFAULT_SIZES,
    colorways,
    addedInPortal: true,
  };
}

function normaliseCatalog(raw) {
  const c = (raw && typeof raw === "object") ? raw : {};
  const prices = {};
  for (const [slug, v] of Object.entries(c.prices || {})) {
    const p = cleanPrice(v);
    if (p !== null && slugify(slug)) prices[slugify(slug)] = p;
  }
  const removed = [...new Set((Array.isArray(c.removed) ? c.removed : []).map(slugify).filter(Boolean))];
  const added = (Array.isArray(c.added) ? c.added : []).map(cleanAddedProduct).filter(Boolean).slice(0, MAX_ADDED);
  return { prices, removed, added };
}

// One catalog edit. Returns the next overlay, or throws a 400 with the reason.
function applyCatalogAction(cat, b) {
  const bad = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };
  const next = { prices: { ...cat.prices }, removed: [...cat.removed], added: [...cat.added] };
  const slug = slugify(b.slug);

  switch (b.action) {
    case "set_price": {
      if (!slug) bad("slug required");
      const p = cleanPrice(b.price_cents ?? b.priceCents);
      if (p === null) bad(`price must be whole cents between 0 and ${MAX_PRICE_CENTS}`);
      // A portal-added product carries its own price; edit it in place so there
      // is one price per product, never a base price plus a shadowing override.
      const i = next.added.findIndex((p2) => p2.slug === slug);
      if (i >= 0) next.added[i] = { ...next.added[i], priceCents: p };
      else next.prices[slug] = p;
      return next;
    }
    case "clear_price":
      if (!slug) bad("slug required");
      delete next.prices[slug];
      return next;

    case "remove_product": {
      if (!slug) bad("slug required");
      // Removing something the portal added deletes it outright; removing a
      // built-in product only hides it, so it can always be brought back.
      const i = next.added.findIndex((p) => p.slug === slug);
      if (i >= 0) next.added.splice(i, 1);
      else if (!next.removed.includes(slug)) next.removed.push(slug);
      return next;
    }
    case "restore_product":
      if (!slug) bad("slug required");
      next.removed = next.removed.filter((s) => s !== slug);
      return next;

    case "add_product": {
      const p = cleanAddedProduct(b.product || b);
      if (!p) bad("product needs a name, a price in cents, and at least one colorway with a label");
      if (next.added.length >= MAX_ADDED) bad(`the store is limited to ${MAX_ADDED} added products`);
      if (next.added.some((x) => x.slug === p.slug)) bad(`a product called "${p.name}" already exists`);
      next.added.push(p);
      // Adding back something previously hidden should not stay hidden.
      next.removed = next.removed.filter((s) => s !== p.slug);
      return next;
    }
    default:
      return bad(`unknown action ${b.action}`);
  }
}

async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: "Supabase not configured" });
    const clientId = (req.query && req.query.client_id) || (req.body && req.body.client_id);
    if (!clientId) return res.status(400).json({ error: "client_id required" });

    const wants = (k) => req.query && (req.query[k] === "1" || req.query[k] === "true");

    // ── PUBLIC stock read (the store calls this; no auth) ──
    if (req.method === "GET" && wants("stock")) {
      const client = await loadClient(clientId);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ out_of_stock: client ? outOfStockList(invMap(client)) : [] });
    }

    // ── PUBLIC catalog overlay (the store merges this over its own catalog) ──
    if (req.method === "GET" && wants("catalog")) {
      const client = await loadClient(clientId);
      const cfg = (client && client.ghl_kpi_config) || {};
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(normaliseCatalog(cfg.store_catalog));
    }

    // ── Everything else is authed (staff or this client's member) ──
    const ctx = await resolveUser(req);
    if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });
    const client = await loadClient(clientId);
    if (!client) return res.status(404).json({ error: "academy not found" });
    const cfg = (client.ghl_kpi_config && typeof client.ghl_kpi_config === "object") ? client.ghl_kpi_config : {};
    const map = cfg.store_inventory || {};
    const enabled = !!cfg.store_order_workflow_id;

    const cat = normaliseCatalog(cfg.store_catalog);

    if (req.method === "POST") {
      const b = (req.body && typeof req.body === "object") ? req.body : {};

      // Catalog edits (price / hide / add). Stock edits keep the older
      // variant_key shape below, so nothing that already works changes.
      if (b.action) {
        const nextCat = applyCatalogAction(cat, b);
        await sb(`clients?id=eq.${encodeURIComponent(clientId)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ ghl_kpi_config: { ...cfg, store_catalog: nextCat } }),
        });
        return res.status(200).json({ ok: true, catalog: nextCat });
      }

      if (!b.variant_key) return res.status(400).json({ error: "variant_key required" });
      const nextMap = { ...map };

      if (typeof b.qty !== "undefined") {
        // Setting a count. "" / null clears back to untracked (in stock).
        if (b.qty === "" || b.qty === null) {
          delete nextMap[b.variant_key];
        } else {
          const n = Math.max(0, Math.floor(Number(b.qty)));
          if (!Number.isFinite(n)) return res.status(400).json({ error: "qty must be a number" });
          nextMap[b.variant_key] = n;   // 0 lands in out_of_stock, which the store already honours
        }
      } else if (typeof b.in_stock !== "undefined") {
        // Original binary toggle, still supported.
        if (b.in_stock) delete nextMap[b.variant_key];
        else nextMap[b.variant_key] = false;
      } else {
        return res.status(400).json({ error: "qty or in_stock required" });
      }

      const nextCfg = { ...cfg, store_inventory: nextMap };
      await sb(`clients?id=eq.${encodeURIComponent(clientId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_kpi_config: nextCfg }) });
      return res.status(200).json({ ok: true, variant_key: b.variant_key, qty: qtyOf(nextMap[b.variant_key]), in_stock: !isOut(nextMap[b.variant_key]), out_of_stock: outOfStockList(nextMap) });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "GET or POST" });

    // AUTH GET: what the store is actually selling right now = its built-in
    // catalog, with this academy's own edits applied, plus stock state.
    const base = (cfg.store_base_url || "").replace(/\/+$/, "");
    let baseProducts = [];
    let reachedStore = false;
    if (base) {
      try {
        const r = await fetch(`${base}/api/catalog`, { headers: { Accept: "application/json" } });
        if (r.ok) { baseProducts = (await r.json()).products || []; reachedStore = true; }
      } catch (_) {}
    }

    const withStock = (slug, colorways) => (colorways || []).map((c) => {
      const v = map[`${slug}__${c.key}`];
      return {
        key: c.key, label: c.label,
        image: c.image || (Array.isArray(c.images) ? c.images[0] : null) || null,
        variant_key: `${slug}__${c.key}`,
        qty: qtyOf(v),                                    // null = untracked
        in_stock: c.baseInStock !== false && c.inStock !== false && !isOut(v),
      };
    });

    // Built-in products: current price, and whether the owner has hidden it.
    const products = baseProducts.map((p) => ({
      slug: p.slug, name: p.name, category: p.category || null,
      price_cents: typeof cat.prices[p.slug] === "number" ? cat.prices[p.slug]
        : (typeof p.priceCents === "number" ? p.priceCents : null),
      base_price_cents: typeof p.priceCents === "number" ? p.priceCents : null,
      price_edited: typeof cat.prices[p.slug] === "number",
      removed: cat.removed.includes(p.slug),
      added_in_portal: false,
      colorways: withStock(p.slug, p.colorways),
    }));

    // Products this academy added themselves.
    for (const p of cat.added) {
      products.push({
        slug: p.slug, name: p.name, category: p.category || null,
        price_cents: p.priceCents, base_price_cents: null, price_edited: false,
        removed: false, added_in_portal: true,
        colorways: withStock(p.slug, p.colorways),
      });
    }

    return res.status(200).json({
      ok: true, enabled, store_base_url: base || null,
      store_reachable: reachedStore, catalog: cat, products,
    });
  } catch (e) {
    return res.status((e && e.status) || 500).json({ error: (e && e.message) || "error" });
  }
}

export default withSentryApiRoute(handler);
