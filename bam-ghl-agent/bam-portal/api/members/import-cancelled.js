import { withSentryApiRoute } from "../_sentry.js";

// Import CANCELLED members (onboarding mini-flow, 2026-07-14; rebuilt 2026-07-18
// to close the cancellations-contract gap - see
// memories/project_cancellations_contract.md).
//
// The owner clicks "Import cancelled" in the onboarding flow. We pull their
// churned Stripe subscriptions, match each one against the contacts already
// imported (this is WHY contacts import first), and hand back buckets:
//
//   matched    exact email hit on a contact           → bulk-approve
//   review     phone or name hit only (fuzzy)         → human confirms which
//   none       nobody in the CRM matches              → create from Stripe, or skip
//
// What the 2026-07-18 rebuild adds (Plan 5, confirmed by Zoran):
//   - CHAINS: a sub that ends within days of the same customer's next sub
//     starting is a plan switch, not churn. Only chain-terminal ends count.
//   - CAME BACK: a customer with a live Stripe sub is not churn, even if
//     they're not a portal member yet.
//   - GUARDRAIL FLAGS on each row (bulk-cleanup day, cancel-before-join,
//     $0 plan, unreachable). Flagged rows default OUT of the churn numbers;
//     a human includes them explicitly (the cleaning pass).
//   - POST writes `cancellations` rows (type='cancel', source='import',
//     member_id=null, KEEP stripe_subscription_id for idempotency, amounts in
//     CENTS, Stripe-enriched joined_date / total_spent / payments_count).
//     Contact tagging stays - the write is ADDITIVE per the contract.
//
// Cancel meta still stores on the contact record's custom_fields jsonb -
// deliberately NOT as custom_field_defs (Zoran 2026-07-14 and re-confirmed
// 2026-07-18: the cancelled flow never grows the academy's custom values).
//
//   GET  /api/members/import-cancelled?client_id=
//     → { ok, total, plan_switches, buckets: { matched:[], review:[], none:[],
//          already_member:[] }, excluded:[{ name, reason }] }
//   POST /api/members/import-cancelled
//     body { client_id, decisions: [{ customer_id, action:'link'|'create'|'skip',
//            contact_id?, exclude_churn?, cancel_date_override?, churn_events? }] }
//     → { ok, linked, created, skipped, churn_written, churn_duplicates, churn_excluded }
//
// Auth: Supabase JWT — BAM staff (any academy) or a client_users member of client_id.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_KEY           = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
const enc = encodeURIComponent;

// A gap of up to 14 days between one sub ending and the next starting is a
// plan switch / billing migration, not a real leave-and-come-back.
const CHAIN_GAP_DAYS = 14;
// This many cancellations sharing one calendar day smells like a bulk Stripe
// cleanup, not real same-day churn.
const BULK_DAY_MIN = 10;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw Object.assign(new Error(`Supabase ${res.status}: ${await res.text()}`), { status: res.status });
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function stripeGet(path, stripeAccount) {
  const headers = { Authorization: `Bearer ${STRIPE_KEY}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const res = await fetch(`https://api.stripe.com/v1${path}`, { headers });
  const j = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${(j.error && j.error.message) || "error"}`);
  return j;
}

// params is an ARRAY of [key, value] entries so repeated keys (expand[]) survive.
async function stripePage(pathBase, params, stripeAccount, pages = 3) {
  let out = [], starting_after = null;
  for (let page = 0; page < pages; page++) {
    const qs = new URLSearchParams(params);
    if (starting_after) qs.set("starting_after", starting_after);
    const r = await stripeGet(`${pathBase}?${qs.toString()}`, stripeAccount);
    out = out.concat(r.data || []);
    if (!r.has_more || !r.data.length) break;
    starting_after = r.data[r.data.length - 1].id;
  }
  return out;
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${enc(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

const normPhone = (p) => String(p || "").replace(/\D/g, "").slice(-10) || null;
const normName  = (n) => String(n || "").toLowerCase().replace(/[^a-z ]/g, "").trim();
const toDay = (unix) => unix ? new Date(unix * 1000).toISOString().slice(0, 10) : null;

// True monthly cents from a RAW Stripe price (has real interval/interval_count) -
// same decode as scripts/backfill-cancellations.mjs monthlyCentsFromStripePrice.
function monthlyCents(price) {
  if (!price || price.unit_amount == null) return null;
  const rec = price.recurring || {};
  const per = { day: 30.44, week: 4.33, month: 1, year: 1 / 12 }[rec.interval] ?? 1;
  const count = rec.interval_count || 1;
  return Math.round((price.unit_amount * per) / count);
}

// Group one customer's CANCELED subs into chains: sorted by start, a sub whose
// end is within CHAIN_GAP_DAYS of the next start is the same run of membership
// (a plan switch / billing migration). One churn event per chain END.
function buildChains(subs) {
  const sorted = subs.slice().sort((a, b) => (a.start_date || 0) - (b.start_date || 0));
  const chains = [];
  for (const s of sorted) {
    const end = s.canceled_at || s.ended_at || null;
    const cur = chains[chains.length - 1];
    if (cur && s.start_date && cur.end_unix && (s.start_date - cur.end_unix) <= CHAIN_GAP_DAYS * 86400) {
      cur.subs.push(s);
      if ((end || 0) > (cur.end_unix || 0)) { cur.end_unix = end; cur.last = s; }
    } else {
      chains.push({ subs: [s], start_unix: s.start_date || end, end_unix: end, last: s });
    }
  }
  return chains;
}

function handlerRowFlags(row, bulkDays) {
  const flags = [];
  if (row.churn_events.some(ev => ev.cancel_date && bulkDays.has(ev.cancel_date))) flags.push("bulk_day");
  if (row.churn_events.some(ev => ev.joined_date && ev.cancel_date && ev.cancel_date < ev.joined_date)) flags.push("date_conflict");
  if (row.churn_events.some(ev => !ev.monthly_amount_cents)) flags.push("zero_amount");
  if (!row.email && !row.phone) flags.push("unreachable");
  return flags;
}

async function handler(req, res) {
  try {
    const q = req.query || {};
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = q.client_id || b.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    const { isStaff, clientIds } = await resolveUser(req);
    if (!isStaff && !clientIds.includes(clientId)) return res.status(403).json({ error: "not authorized for this academy" });

    const cRows = await sb(`clients?id=eq.${enc(clientId)}&select=stripe_connect_account_id,stripe_connect_status&limit=1`);
    const client = (Array.isArray(cRows) && cRows[0]) || {};
    const acct = client.stripe_connect_account_id;
    if (!acct) return res.status(400).json({ error: "Connect Stripe first - there is no account to read cancelled subscriptions from" });

    if (req.method === "GET") {
      // Canceled subs (up to ~300 - plenty for an academy) + the LIVE subs, so a
      // customer who came back on their own is never offered as churn.
      const [subsFull, live] = await Promise.all([
        stripePage("/subscriptions", [["status", "canceled"], ["limit", "100"], ["expand[]", "data.customer"], ["expand[]", "data.items.data.price.product"]], acct),
        stripePage("/subscriptions", [["limit", "100"]], acct), // default = every non-canceled status
      ]);
      const liveCustomers = new Set(live.map(s => (typeof s.customer === "string" ? s.customer : s.customer && s.customer.id)).filter(Boolean));

      // Group canceled subs per customer.
      const byCustomer = new Map();
      for (const s of subsFull) {
        const cu = (s.customer && typeof s.customer === "object") ? s.customer : { id: s.customer };
        if (!byCustomer.has(cu.id)) byCustomer.set(cu.id, { customer: cu, subs: [] });
        byCustomer.get(cu.id).subs.push(s);
      }

      // Match targets: imported contacts + the live portal roster.
      const [contacts, members] = await Promise.all([
        sb(`contacts?client_id=eq.${enc(clientId)}&select=id,name,first_name,last_name,email,phone,tags&limit=2000`),
        sb(`members?client_id=eq.${enc(clientId)}&select=id,stripe_customer_id&limit=1000`),
      ]);
      const memberCustomers = new Set((members || []).map(m => m.stripe_customer_id).filter(Boolean));
      // Which of these customers already have an imported churn row? (re-open safe)
      const existingCancels = await sb(`cancellations?client_id=eq.${enc(clientId)}&type=eq.cancel&select=stripe_subscription_id&limit=2000`).catch(() => []);
      const cancelledSubIds = new Set((existingCancels || []).map(r => r.stripe_subscription_id).filter(Boolean));

      const byEmail = new Map(), byPhone = new Map(), byName = new Map();
      for (const c of contacts || []) {
        const nm = c.name || [c.first_name, c.last_name].filter(Boolean).join(" ");
        if (c.email) byEmail.set(String(c.email).toLowerCase(), c);
        const ph = normPhone(c.phone);
        if (ph) byPhone.set(ph, c);
        const nn = normName(nm);
        if (nn) byName.set(nn, { ...c, _name: nm });
      }
      const contactLabel = (c) => c.name || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || c.phone || c.id;

      // Build per-customer rows: chains → churn events. Hard block: an ended sub
      // with no cancel date at all cannot enter the churn table.
      const rows = [];
      const excluded = [];
      let planSwitches = 0;
      const alreadyMember = [];
      for (const { customer: cu, subs } of byCustomer.values()) {
        const label = cu.name || cu.email || cu.id;
        if (memberCustomers.has(cu.id) || liveCustomers.has(cu.id)) {
          alreadyMember.push({ customer_id: cu.id, name: cu.name || null, email: (cu.email || "").toLowerCase() || null });
          continue;
        }
        const dated = subs.filter(s => s.canceled_at || s.ended_at);
        for (const s of subs) {
          if (!s.canceled_at && !s.ended_at) excluded.push({ name: label, reason: "no cancel date on the Stripe subscription" });
        }
        if (!dated.length) continue;
        const chains = buildChains(dated);
        planSwitches += dated.length - chains.length;
        const churn_events = chains.map(ch => {
          const s = ch.last;
          const item = (s.items && s.items.data && s.items.data[0]) || {};
          const price = item.price || {};
          return {
            sub_id: s.id,
            chain_sub_ids: ch.subs.map(x => x.id),
            cancel_date: toDay(ch.end_unix),
            joined_date: toDay(ch.start_unix),
            stripe_price_id: price.id || null,
            plan: price.nickname || (price.product && price.product.name) || null,
            monthly_amount_cents: monthlyCents(price),
            involuntary: !!(s.cancellation_details && s.cancellation_details.reason === "payment_failed"),
            reason: (s.cancellation_details && (s.cancellation_details.feedback || s.cancellation_details.reason)) || null,
            already_written: cancelledSubIds.has(s.id),
          };
        });
        const latest = churn_events.reduce((a, ev) => (!a || (ev.cancel_date || "") > (a.cancel_date || "")) ? ev : a, null);
        rows.push({
          customer_id: cu.id,
          email: (cu.email || "").toLowerCase() || null,
          phone: cu.phone || null,
          name: cu.name || null,
          cancelled_at: latest && latest.cancel_date,
          cancel_reason: latest && latest.reason,
          last_plan: latest && latest.plan,
          monthly_amount: latest && latest.monthly_amount_cents != null ? Math.round(latest.monthly_amount_cents) / 100 : null,
          subs: dated.length,
          plan_switches: dated.length - chains.length,
          churn_events,
        });
      }

      // Bulk-cleanup radar: a calendar day carrying BULK_DAY_MIN+ cancel events.
      const dayCounts = new Map();
      for (const r of rows) for (const ev of r.churn_events) {
        if (ev.cancel_date) dayCounts.set(ev.cancel_date, (dayCounts.get(ev.cancel_date) || 0) + 1);
      }
      const bulkDays = new Set([...dayCounts.entries()].filter(([, n]) => n >= BULK_DAY_MIN).map(([d]) => d));
      for (const r of rows) r.flags = handlerRowFlags(r, bulkDays);

      const buckets = { matched: [], review: [], none: [], already_member: alreadyMember };
      for (const row of rows) {
        const emailHit = row.email && byEmail.get(row.email);
        if (emailHit) {
          const already = Array.isArray(emailHit.tags) && emailHit.tags.includes("cancelled");
          buckets.matched.push({ ...row, contact_id: emailHit.id, contact_name: contactLabel(emailHit), why: "email", already_tagged: already });
          continue;
        }
        const phoneHit = normPhone(row.phone) && byPhone.get(normPhone(row.phone));
        const nameHit = normName(row.name) && byName.get(normName(row.name));
        if (phoneHit || nameHit) {
          const cand = phoneHit || nameHit;
          buckets.review.push({ ...row, candidate_id: cand.id, candidate_name: contactLabel(cand), why: phoneHit ? "phone" : "name" });
          continue;
        }
        buckets.none.push(row);
      }
      return res.status(200).json({ ok: true, total: rows.length, plan_switches: planSwitches, bulk_days: [...bulkDays], buckets, excluded });
    }

    if (req.method === "POST") {
      const decisions = Array.isArray(b.decisions) ? b.decisions : [];
      if (!decisions.length) return res.status(400).json({ error: "decisions required" });
      let linked = 0, created = 0, skipped = 0, churnWritten = 0, churnDupes = 0, churnExcluded = 0;
      const nowIso = new Date().toISOString();

      // plan_name / offer_id come from the academy's pricing_catalog when the
      // Stripe price is mapped there (same lookup as backfill-cancellations.mjs).
      const catalog = await sb(`pricing_catalog?client_id=eq.${enc(clientId)}&select=stripe_price_id,display_name,offer_id`).catch(() => []);
      const catByPrice = new Map((catalog || []).filter(c => c.stripe_price_id).map(c => [c.stripe_price_id, c]));

      const metaOf = (d) => {
        const m = {};
        if (d.cancelled_at) m.cancelled_at = d.cancelled_at;
        if (d.cancel_reason) m.cancel_reason = d.cancel_reason;
        if (d.last_plan) m.last_plan = d.last_plan;
        if (d.monthly_amount != null) m.last_monthly_amount = d.monthly_amount;
        m.stripe_customer_id = d.customer_id;
        return m;
      };

      // One cancellations row per chain-terminal churn event, enriched from the
      // chain's paid invoices (true joined date + lifetime spend). Idempotent on
      // the sub-id unique index: a 409 means already imported, skip quietly.
      async function writeChurnRows(d) {
        const events = Array.isArray(d.churn_events) ? d.churn_events : [];
        if (d.exclude_churn) { churnExcluded += events.length; return; }
        for (const ev of events) {
          if (!ev || !ev.sub_id || !(d.cancel_date_override || ev.cancel_date)) continue;
          if (ev.excluded) { churnExcluded++; continue; }
          if (ev.already_written) { churnDupes++; continue; }
          let totalSpent = 0, payments = 0, earliestPaid = null;
          try {
            const invLists = await Promise.all((ev.chain_sub_ids || [ev.sub_id]).slice(0, 6).map(sid =>
              stripeGet(`/invoices?subscription=${enc(sid)}&status=paid&limit=100`, acct).then(r => r.data || []).catch(() => [])
            ));
            for (const inv of invLists.flat()) {
              if (inv.amount_paid > 0) {
                totalSpent += inv.amount_paid; payments++;
                if (!earliestPaid || inv.created < earliestPaid) earliestPaid = inv.created;
              }
            }
          } catch (_) { /* enrichment is best-effort */ }
          const invoiceJoin = toDay(earliestPaid);
          const joined = (invoiceJoin && (!ev.joined_date || invoiceJoin < ev.joined_date)) ? invoiceJoin : ev.joined_date || null;
          const cat = ev.stripe_price_id ? catByPrice.get(ev.stripe_price_id) : null;
          const row = {
            client_id: clientId,
            member_id: null, // pre-platform cancels have no member row (contract)
            athlete_name: d.name || null,
            parent_name: d.name || null,
            type: "cancel",
            cancel_date: d.cancel_date_override || ev.cancel_date,
            reason: ev.reason || "imported from Stripe history",
            stripe_subscription_id: ev.sub_id,
            stripe_customer_id: d.customer_id,
            joined_date: joined,
            plan_name: (cat && cat.display_name) || ev.plan || null,
            stripe_price_id: ev.stripe_price_id || null,
            offer_id: (cat && cat.offer_id) || null,
            monthly_amount_cents: ev.monthly_amount_cents != null ? ev.monthly_amount_cents : null,
            total_spent_cents: totalSpent || null,
            payments_count: payments || null,
            source: "import",
            involuntary: !!ev.involuntary,
          };
          const ins = await fetch(`${SUPABASE_URL}/rest/v1/cancellations`, {
            method: "POST",
            headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify([row]),
          });
          if (ins.ok) churnWritten++;
          else if (ins.status === 409) churnDupes++; // one-cancel-per-sub index: already imported
          else throw new Error(`cancellations insert ${ins.status}: ${(await ins.text()).slice(0, 200)}`);
        }
      }

      for (const d of decisions) {
        if (!d || !d.customer_id) continue;
        if (d.action === "skip") { skipped++; continue; }
        if (d.action === "link" && d.contact_id) {
          const rows = await sb(`contacts?id=eq.${enc(d.contact_id)}&client_id=eq.${enc(clientId)}&select=id,tags,custom_fields&limit=1`);
          const c = Array.isArray(rows) && rows[0];
          if (!c) { skipped++; continue; }
          const tags = Array.isArray(c.tags) ? c.tags.slice() : [];
          if (!tags.includes("cancelled")) tags.push("cancelled");
          await sb(`contacts?id=eq.${enc(c.id)}`, {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ tags, custom_fields: { ...(c.custom_fields || {}), ...metaOf(d) }, updated_at: nowIso }),
          });
          linked++;
          await writeChurnRows(d);
          continue;
        }
        if (d.action === "create") {
          // Mint a portal contact from the Stripe data (same id=ghl_contact_id
          // convention as _contacts.js resolveOrMintPortalContact).
          const minted = globalThis.crypto.randomUUID();
          await sb(`contacts?select=id`, {
            method: "POST", headers: { Prefer: "return=minimal" },
            body: JSON.stringify([{
              id: minted, client_id: clientId, ghl_contact_id: minted,
              name: d.name || null, email: d.email || null, phone: d.phone || null,
              tags: ["cancelled"], custom_fields: metaOf(d),
              date_added: nowIso, updated_at: nowIso,
            }]),
          });
          created++;
          await writeChurnRows(d);
          continue;
        }
        skipped++;
      }
      return res.status(200).json({ ok: true, linked, created, skipped, churn_written: churnWritten, churn_duplicates: churnDupes, churn_excluded: churnExcluded });
    }

    return res.status(405).json({ error: "GET or POST" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
