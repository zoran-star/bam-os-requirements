import { withSentryApiRoute } from "../_sentry.js";
import { pickGhlToken } from "../ghl/_core.js";
import { stripeFetch as transportStripeFetch } from "../_stripe-transport.js";
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
//     body { action:"auto-link", mode:"propose"|"apply" }
//       → seeds the ties from the offer spine, so a new academy's dashboards are not
//         blank until a human clicks through this tab. See AUTO-LINK below.
//
// Auth: Supabase JWT — staff (any academy) or a client_users member of client_id.
//
// ─────────────────────────────────────────────────────────────────────────────
// AUTO-LINK
//
// Two bases, and they are not equals. Precedence is strictly catalog/stamp over
// title, and a CONFLICTING strong signal stops the candidate rather than falling
// back to names - if the spine disagrees with itself, a name is not the tiebreak.
//
//   basis "catalog"  (stripe_product) the offer spine already knows which offer a
//        Stripe product belongs to, so no name-matching is involved. Two tables
//        carry it, both denormalizing the product id next to the offer id:
//          pricing_catalog  .stripe_product_id + .offer_id        (checkout routing)
//          offer_prices     .stripe_product_id + .source_offer_id (parent runtime)
//        pricing_catalog rows count only at match_status 'confirmed'. A 'proposed'
//        row is the AI price-matcher's GUESS awaiting approval, and laundering a
//        guess into a deterministic-looking tie is the whole thing this avoids -
//        such a product falls through to the title basis and is labelled honestly.
//        Rows that are live (is_routable, and is_active for offer_prices) win over
//        retired ones, so a product whose price was re-pointed to a new offer ties
//        to the offer it is sold under today instead of reading as ambiguous.
//   basis "stamp"    (ghl_pipeline) pipeline_stages rows carry ghl_pipeline_id and
//        the offer_id the preset stamped on them. That is the only strong pipeline
//        signal there is.
//   basis "title"    exact normalized-title match (case and whitespace insensitive,
//        nothing else - no punctuation stripping, no fuzz). Weakest, and for
//        pipelines it almost never fires, which is intended: a wrong pipeline tie
//        corrupts the sales KPIs silently, so an unsure pipeline stays unproposed.
//
// Idempotent and non-destructive. An existing link row is NEVER patched or deleted;
// the write is a single insert with ON CONFLICT DO NOTHING against the
// (client_id, kind, ref_id) unique index, so even a race cannot overwrite a human's
// tie. A product or pipeline already tied to an offer is reported under `existing`
// and never re-proposed. A link row with a NULL offer_id ties nothing (api/kpis-v15.js
// skips those too), so it does not count as existing.
//
// Nothing is silently dropped, and that is a claim about the whole action, not just
// the happy path. Every product and pipeline lands in EXACTLY ONE of proposed /
// existing / unmatched, and every unmatched entry carries a one-word reason -
//   "ambiguous"  the signal points at more than one offer
//   "missing"    the signal names an offer that is not among this academy's live ones
//   "unknown"    no signal at all
// Anything that weakened a run but is not about one candidate goes to `warnings`: a
// spine table that failed to load, a Stripe price that could not be read, and the
// 25-lookup cap on resolving product ids, which is counted BEFORE it truncates. A
// capped row loses its strong signal and can fall back to a title match, so leaving
// that uncounted would be the exact misattribution this action refuses to make.
//
//   → { proposed:[{kind,ref_id,label,offer_id,offer_title,basis}], existing:[...],
//       unmatched:[{kind,ref_id,label,reason}], warnings:[...] }   plus, on apply,
//     applied:[...] - what actually landed.
//
// On apply the buckets are REBUILT around what the database accepted. A candidate that
// lost a race between propose and apply leaves `proposed` and moves to `existing` with
// raced:true and no offer_id at all - absent, not null, because null here means "a row
// exists and ties nothing" and the truth is that something IS tied and we do not know
// what to. So `proposed` on an apply response means "stands", and the one-bucket
// contract survives the write.
//
// The decisions are pure: buildAutoLinkPlan(), autoLinkInserts() and
// settleAutoLinkPlan() take plain rows and touch no network and no DB.
// api/_kpi-autolink.test.mjs drives all three directly.

const GHL_V2        = "https://services.leadconnectorhq.com";
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
  // Delegates to THE seam (api/_stripe-transport.js): platform key + Stripe-Account
  // header for Connect academies, the academy's own key when a direct row exists.
  return transportStripeFetch(path, { stripeAccount });
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
async function fetchPipelines(client) {
  let creds;
  try { creds = await pickGhlToken(client); } catch (_) { creds = null; }
  if (!creds || !creds.token || !creds.locationId) return [];
  try {
    const r = await ghl("GET", `/opportunities/pipelines?locationId=${encodeURIComponent(creds.locationId)}`, { token: creds.token });
    return (r.pipelines || []).map(p => ({ id: p.id, name: p.name }));
  } catch (_) { return []; }
}
async function fetchCalendars(client) {
  let creds;
  try { creds = await pickGhlToken(client); } catch (_) { creds = null; }
  if (!creds || !creds.token || !creds.locationId) return [];
  try {
    const r = await ghl("GET", `/calendars/?locationId=${encodeURIComponent(creds.locationId)}`, { token: creds.token });
    return (r.calendars || []).map(c => ({ id: c.id, name: c.name }));
  } catch (_) { return []; }
}

// ── auto-link: the pure part ────────────────────────────────────────────────
// Everything below this line is a plain function of plain rows. No fetch, no sb().
// The handler does all the loading, then calls buildAutoLinkPlan ONCE and, on apply,
// writes exactly what that one call proposed - so an apply can never differ from the
// propose that a human just read.

const R_AMBIGUOUS = "ambiguous";
const R_MISSING   = "missing";
const R_UNKNOWN   = "unknown";

// Case and whitespace insensitive, and deliberately nothing more. Stripping
// punctuation here would quietly widen the weakest basis into new false ties.
export function normLabel(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();
}

const distinct = (a) => [...new Set((a || []).filter(Boolean))];
const pushInto = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
const asArray = (v) => (Array.isArray(v) ? v : []);

export function buildAutoLinkPlan(input = {}) {
  const offers         = asArray(input.offers);
  const stripeProducts = asArray(input.stripeProducts);
  const pipelines      = asArray(input.pipelines);
  const links          = asArray(input.links);
  const catalogRows    = asArray(input.catalogRows);
  const offerPriceRows = asArray(input.offerPriceRows);
  const stageRows      = asArray(input.stageRows);

  const offerById = new Map();
  const offersByTitle = new Map();
  for (const o of offers) {
    if (!o || !o.id) continue; // an id-less offer can neither be tied to nor named
    offerById.set(String(o.id), o);
    const k = normLabel(o.title);
    if (k) pushInto(offersByTitle, k, String(o.id));
  }

  // Existing ties. A row whose offer_id is null ties nothing, so it is not
  // "existing" - it is an empty slot this action is free to fill.
  const tiedTo = new Map();
  for (const l of links) {
    if (!l || !l.offer_id) continue;
    tiedTo.set(`${l.kind}:${l.ref_id}`, String(l.offer_id));
  }

  // The strong signal for Stripe products: product id → offer id(s), split into
  // what is live today and everything ever.
  const strongLive = new Map(), strongAny = new Map();
  for (const r of catalogRows) {
    if (!r || !r.stripe_product_id || !r.offer_id) continue;
    if (r.match_status !== "confirmed") continue; // 'proposed' is a guess, not a fact
    const pid = `stripe_product:${r.stripe_product_id}`;
    pushInto(strongAny, pid, String(r.offer_id));
    if (r.is_routable === true) pushInto(strongLive, pid, String(r.offer_id));
  }
  for (const r of offerPriceRows) {
    if (!r || !r.stripe_product_id || !r.source_offer_id) continue;
    const pid = `stripe_product:${r.stripe_product_id}`;
    pushInto(strongAny, pid, String(r.source_offer_id));
    if (r.is_routable === true && r.is_active !== false) pushInto(strongLive, pid, String(r.source_offer_id));
  }
  // The strong signal for pipelines: whatever offer the preset stamped on the
  // stage registry rows that point at this GHL pipeline.
  for (const r of stageRows) {
    if (!r || !r.ghl_pipeline_id || !r.offer_id) continue;
    pushInto(strongAny, `ghl_pipeline:${r.ghl_pipeline_id}`, String(r.offer_id));
  }

  const verdictFor = (offerId, basis) => {
    const o = offerById.get(offerId);
    if (!o) return { reason: R_MISSING };
    return { offer_id: offerId, offer_title: o.title, basis };
  };

  const proposed = [], existing = [], unmatched = [];

  const consider = (kind, refId, label, strongBasis) => {
    const key = `${kind}:${refId}`;
    const already = tiedTo.get(key);
    if (already) {
      const o = offerById.get(already);
      existing.push({ kind, ref_id: refId, label, offer_id: already, offer_title: o ? o.title : null });
      return;
    }
    const live = distinct(strongLive.get(key));
    const any  = distinct(strongAny.get(key));
    let v;
    if (live.length === 1)     v = verdictFor(live[0], strongBasis);
    else if (any.length === 1) v = verdictFor(any[0], strongBasis);
    else if (any.length > 1)   v = { reason: R_AMBIGUOUS }; // a split spine is a stop, not a cue to guess at names
    else {
      const hits = distinct(offersByTitle.get(normLabel(label)));
      if (hits.length === 1)   v = verdictFor(hits[0], "title");
      else if (hits.length > 1) v = { reason: R_AMBIGUOUS };
      else                      v = { reason: R_UNKNOWN };
    }
    if (v.reason) unmatched.push({ kind, ref_id: refId, label, reason: v.reason });
    else proposed.push({ kind, ref_id: refId, label, offer_id: v.offer_id, offer_title: v.offer_title, basis: v.basis });
  };

  for (const p of stripeProducts) {
    if (!p || !p.id) continue;
    consider("stripe_product", String(p.id), p.name == null ? null : String(p.name), "catalog");
  }
  for (const p of pipelines) {
    if (!p || !p.id) continue;
    consider("ghl_pipeline", String(p.id), p.name == null ? null : String(p.name), "stamp");
  }

  return { proposed, existing, unmatched };
}

// The apply payload, derived from the plan and from nothing else. Keeping this a
// pure function of `plan` is what makes "apply writes what propose showed" a
// property of the code rather than a promise in a comment.
export function autoLinkInserts(plan, clientId) {
  return asArray(plan && plan.proposed).map(p => ({
    client_id: clientId,
    kind: p.kind,
    ref_id: p.ref_id,
    label: p.label || null,
    offer_id: p.offer_id,
  }));
}

// The apply OUTCOME, as a pure function of the plan and of which rows the database
// actually accepted. Separate from the write for two reasons. It keeps the raced path
// testable without a database, and it keeps the one-bucket contract true through an
// apply: a candidate that lost a race LEAVES `proposed` instead of sitting in two
// buckets at once.
//
// A raced row carries no offer_id at all, rather than a null one. Null has a specific
// meaning here - "a link row exists and ties nothing" - and that is the opposite of
// what happened: something IS tied, by whoever won the race, and we do not yet know
// what to. Absent says that; null would say something false.
// Which offer_prices rows need a Stripe round trip to learn their product id, and
// what that costs in honesty. pricing_catalog.stripe_product_id is NOT NULL so the
// common path needs no lookup at all; offer_prices.stripe_product_id IS nullable.
//
// The cap is counted BEFORE it truncates. A row past it silently loses its strong
// signal and falls back to a title match, so an uncounted cap turns a budget into a
// misattribution nobody can see. Pure so that is provable without a network.
export function planPriceLookups(offerPriceRows, { cap = 25, stripeConnected = true } = {}) {
  const needAll = asArray(offerPriceRows).filter(r => r && !r.stripe_product_id && r.stripe_price_id);
  if (!needAll.length) return { lookups: [], skipped: 0, warnings: [] };
  if (!stripeConnected) {
    return {
      lookups: [], skipped: needAll.length,
      warnings: [`${needAll.length} runtime price row(s) carry no product id and Stripe is not connected, so they are not in this run.`],
    };
  }
  const lookups = needAll.slice(0, cap);
  const skipped = needAll.length - lookups.length;
  return {
    lookups, skipped,
    warnings: skipped
      ? [`${skipped} runtime price row(s) beyond the ${cap}-lookup cap were not resolved, so their offer signal is missing and those products may fall back to a title match.`]
      : [],
  };
}

export function settleAutoLinkPlan(plan, landedKeys) {
  const landed = landedKeys instanceof Set ? landedKeys : new Set(asArray(landedKeys));
  const wasProposed = asArray(plan && plan.proposed);
  const didLand = (p) => landed.has(`${p.kind}:${p.ref_id}`);
  const applied = wasProposed.filter(didLand);
  const raced = wasProposed.filter(p => !didLand(p))
    .map(p => ({ kind: p.kind, ref_id: p.ref_id, label: p.label, raced: true }));
  return {
    proposed: [...applied],
    existing: [...asArray(plan && plan.existing), ...raced],
    unmatched: [...asArray(plan && plan.unmatched)],
    applied: [...applied],
  };
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
        if (!["stripe_product", "ghl_pipeline", "ghl_calendar"].includes(kind) || !refId) {
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

      if (action === "auto-link") {
        const mode = body.mode === "apply" ? "apply" : "propose";
        const cid = encodeURIComponent(clientId);
        const warnings = [];

        const clientRows = await sb(
          `clients?id=eq.${cid}&select=id,stripe_connect_account_id,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at&limit=1`
        );
        const client = Array.isArray(clientRows) && clientRows[0];
        if (!client) return res.status(404).json({ error: "academy not found" });

        // Offers and existing links must load. If either quietly came back empty we
        // would propose nothing (or re-propose over a human's ties), so they throw.
        const offersRows = await sb(`offers?client_id=eq.${cid}&status=neq.archived&select=id,title&order=title.asc`) || [];
        const links = await sb(`kpi_offer_links?client_id=eq.${cid}&select=kind,ref_id,offer_id,label`) || [];

        // The spine tables are best-effort, but never silently: a table that failed
        // to load only weakens the strong basis, and the caller is told so.
        const soft = async (what, path) => {
          try { return (await sb(path)) || []; }
          catch (e) { warnings.push(`${what} did not load, so its signal is missing from this run: ${e.message || e}`); return []; }
        };
        const [catalogRows, offerPriceRows, stageRows] = await Promise.all([
          soft("pricing_catalog", `pricing_catalog?client_id=eq.${cid}&select=stripe_price_id,stripe_product_id,offer_id,is_routable,match_status`),
          soft("offer_prices", `offer_prices?tenant_id=eq.${cid}&select=stripe_price_id,stripe_product_id,source_offer_id,is_routable,is_active`),
          soft("pipeline_stages", `pipeline_stages?client_id=eq.${cid}&select=ghl_pipeline_id,offer_id`),
        ]);

        // pricing_catalog.stripe_product_id is NOT NULL, so the common path needs no
        // Stripe call at all. offer_prices.stripe_product_id IS nullable, so where a
        // runtime price row knows its price but not its product, ask Stripe once.
        // Bounded, and a lookup that fails just leaves that row out of the signal.
        const lookupPlan = planPriceLookups(offerPriceRows, { stripeConnected: !!client.stripe_connect_account_id });
        warnings.push(...lookupPlan.warnings);
        {
          const seen = new Map();
          for (const r of lookupPlan.lookups) {
            const priceId = String(r.stripe_price_id);
            try {
              if (!seen.has(priceId)) {
                const price = await stripeGet(`/prices/${encodeURIComponent(priceId)}`, client.stripe_connect_account_id);
                seen.set(priceId, price && (typeof price.product === "string" ? price.product : price.product && price.product.id) || null);
              }
              if (seen.get(priceId)) r.stripe_product_id = seen.get(priceId);
            } catch (e) { warnings.push(`Stripe price ${priceId} could not be read, so its offer tie is not in this run.`); }
          }
        }

        let stripeProducts = [];
        if (client.stripe_connect_account_id) {
          try { stripeProducts = await fetchProducts(client.stripe_connect_account_id); }
          catch (e) { warnings.push(`Stripe products did not load: ${e.message || e}`); }
        } else {
          warnings.push("Stripe is not connected for this academy, so no products were considered.");
        }
        const pipelines = await fetchPipelines(client);
        if (!pipelines.length) warnings.push("No GHL pipelines were returned, so none were considered.");

        // ONE computation. Everything below reads from `plan`; nothing recomputes.
        const plan = buildAutoLinkPlan({ offers: offersRows, stripeProducts, pipelines, links, catalogRows, offerPriceRows, stageRows });

        if (mode !== "apply") {
          return res.status(200).json({ ok: true, mode: "propose", ...plan, ...(warnings.length ? { warnings } : {}) });
        }

        // Add-if-absent, enforced by the database rather than by the check above:
        // ON CONFLICT DO NOTHING on (client_id, kind, ref_id). An existing row is
        // left exactly as it was, whoever wrote it and whenever.
        const rows = autoLinkInserts(plan, clientId);
        let landed = new Set();
        if (rows.length) {
          const out = await sb(`kpi_offer_links?on_conflict=client_id,kind,ref_id`, {
            method: "POST",
            headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
            body: JSON.stringify(rows),
          });
          landed = new Set((Array.isArray(out) ? out : []).map(r => `${r.kind}:${r.ref_id}`));
        }
        // Anything proposed that did not land was tied by someone else in between. The
        // buckets are rebuilt around what the database accepted, so a raced candidate
        // LEAVES `proposed` rather than being reported in two places at once.
        const settled = settleAutoLinkPlan(plan, landed);
        return res.status(200).json({ ok: true, mode: "apply", ...settled, ...(warnings.length ? { warnings } : {}) });
      }

      return res.status(400).json({ error: "unknown action" });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "GET or POST" });

    // ── GET: assemble offers + Stripe products + GHL pipelines + existing links ──
    const clientRows = await sb(
      `clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,stripe_connect_account_id,ghl_location_id,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,v2_access,v15_access&limit=1`
    );
    const client = Array.isArray(clientRows) && clientRows[0];
    if (!client) return res.status(404).json({ error: "academy not found" });
    const tier = client.v2_access ? "v2" : client.v15_access ? "v15" : "v1";

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

    // GHL pipelines + calendars.
    let pipelines = [], calendars = [];
    try {
      const pl = await fetchPipelines(client);
      pipelines = pl.map(p => ({ id: p.id, name: p.name, offer_id: linkOf[`ghl_pipeline:${p.id}`] || null }));
    } catch (_) { pipelines = []; }
    try {
      const cl = await fetchCalendars(client);
      calendars = cl.map(c => ({ id: c.id, name: c.name, offer_id: linkOf[`ghl_calendar:${c.id}`] || null }));
    } catch (_) { calendars = []; }

    return res.status(200).json({
      ok: true,
      academy: client.business_name,
      tier,
      stripeConnected: !!client.stripe_connect_account_id,
      offers, stripeProducts, pipelines, calendars, links,
    });
  } catch (e) {
    let msg = e && e.message; if (!msg) { try { msg = JSON.stringify(e); } catch (_) { msg = String(e); } }
    console.error("kpi-setup error:", msg, e && e.stack);
    return res.status((e && e.status) || 500).json({ error: msg || "unknown error" });
  }
}

export default withSentryApiRoute(handler);
