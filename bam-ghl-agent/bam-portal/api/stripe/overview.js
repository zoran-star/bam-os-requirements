// Vercel Serverless Function — Stripe Financial Overview
// GET: MRR, revenue, expenses, customer list, recent invoices
// POST ?section=channel-ingest — pull Stripe + classify SKUs, upsert today's bam_channel_snapshots row

const STRIPE_API = "https://api.stripe.com/v1";
const CHANNEL_ALLOWLIST = [
  "zoran@byanymeansbball.com",
  "mike@byanymeansbball.com",
  "coleman@byanymeansbball.com",
];

async function stripeFetch(path) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stripe ${res.status}: ${err}`);
  }
  return res.json();
}

async function stripeFetchAll(path) {
  const all = [];
  let starting_after = null;
  for (let i = 0; i < 20; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const qs = `limit=100${starting_after ? `&starting_after=${starting_after}` : ""}`;
    const page = await stripeFetch(`${path}${sep}${qs}`);
    const data = page.data || [];
    all.push(...data);
    if (!page.has_more || data.length === 0) break;
    starting_after = data[data.length - 1].id;
  }
  return all;
}

function monthlyAmountCents(sub) {
  const amount = sub.plan?.amount || sub.items?.data?.[0]?.price?.unit_amount || 0;
  const interval = sub.plan?.interval || sub.items?.data?.[0]?.price?.recurring?.interval || "month";
  if (interval === "year") return amount / 12;
  if (interval === "week") return amount * 4;
  return amount;
}

function classifySku(sub, settings) {
  const haystack = [
    sub.plan?.nickname,
    sub.items?.data?.[0]?.price?.nickname,
    sub.items?.data?.[0]?.price?.product?.name,
  ].filter(Boolean).join(" ").toLowerCase();

  const full = (settings?.sku_full_pattern || "SS Full").toLowerCase();
  const partner = (settings?.sku_partner_pattern || "SS Partner").toLowerCase();
  const core = (settings?.sku_core_pattern || "SS Core").toLowerCase();

  if (haystack.includes(full)) return "full";
  if (haystack.includes(partner)) return "partner";
  if (haystack.includes(core)) return "core";

  // Fallback: classify by monthly amount band
  const monthly = monthlyAmountCents(sub) / 100;
  if (monthly >= 1200) return "full";
  if (monthly >= 600) return "partner";
  if (monthly >= 300) return "core";
  return null;
}

async function supabaseRequest(path, opts = {}) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function requireChannelViewer(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { ok: false, error: "missing auth token" };
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, error: "supabase env missing" };
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { ok: false, error: "invalid token" };
  const user = await userRes.json();
  const email = (user?.email || "").toLowerCase();
  if (!CHANNEL_ALLOWLIST.includes(email)) {
    return { ok: false, error: "not on channel allowlist" };
  }
  return { ok: true, email };
}

async function handleChannelIngest(req, res) {
  const gate = await requireChannelViewer(req);
  if (!gate.ok) return res.status(403).json({ error: gate.error });

  const now = Math.floor(Date.now() / 1000);
  const sixtyDaysAgo = now - 60 * 24 * 60 * 60;

  // Load settings (for SKU patterns + campaign start)
  const settingsRows = await supabaseRequest("bam_channel_settings?id=eq.1&select=*");
  const settings = settingsRows?.[0] || {};

  // Pull all active subs (expanded with price.product for SKU classification)
  const activeSubs = await stripeFetchAll(
    "/subscriptions?status=active&expand[]=data.items.data.price.product"
  );

  // Pull recent subs to find new closes in last 60d (any status — we filter by created)
  const recentSubs = await stripeFetchAll(
    `/subscriptions?status=all&created[gte]=${sixtyDaysAgo}&expand[]=data.items.data.price.product`
  );

  let active_full_partner = 0;
  let active_core = 0;
  let total_business_mrr_cents = 0;
  let full_partner_mrr_cents = 0;
  for (const sub of activeSubs) {
    const sku = classifySku(sub, settings);
    const monthly = monthlyAmountCents(sub);
    total_business_mrr_cents += monthly;
    if (sku === "full" || sku === "partner") {
      active_full_partner += 1;
      full_partner_mrr_cents += monthly;
    } else if (sku === "core") {
      active_core += 1;
    }
  }

  let new_closes_full_partner_60d = 0;
  let new_closes_core_60d = 0;
  let new_mrr_60d_cents = 0;
  for (const sub of recentSubs) {
    if (!sub.created || sub.created < sixtyDaysAgo) continue;
    const sku = classifySku(sub, settings);
    if (sku === "full" || sku === "partner") new_closes_full_partner_60d += 1;
    else if (sku === "core") new_closes_core_60d += 1;
    if (sub.status === "active" || sub.status === "trialing") {
      new_mrr_60d_cents += monthlyAmountCents(sub);
    }
  }

  const snapshot_date = new Date().toISOString().slice(0, 10);

  // Upsert (POST with Prefer: resolution=merge-duplicates)
  const upsertBody = [{
    snapshot_date,
    active_full_partner,
    active_core,
    total_business_mrr: Math.round(total_business_mrr_cents) / 100,
    full_partner_mrr: Math.round(full_partner_mrr_cents) / 100,
    new_closes_full_partner_60d,
    new_closes_core_60d,
    new_mrr_60d: Math.round(new_mrr_60d_cents) / 100,
    ingested_by: "stripe-auto",
    source_meta: {
      stripe_active_subs: activeSubs.length,
      stripe_recent_subs: recentSubs.length,
      ingested_at: new Date().toISOString(),
      ingested_by_email: gate.email,
    },
  }];

  await supabaseRequest("bam_channel_snapshots?on_conflict=snapshot_date", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(upsertBody),
  });

  return res.status(200).json({
    data: {
      snapshot_date,
      stripe_pulled: {
        active_full_partner,
        active_core,
        total_business_mrr: Math.round(total_business_mrr_cents) / 100,
        full_partner_mrr: Math.round(full_partner_mrr_cents) / 100,
        new_closes_full_partner_60d,
        new_closes_core_60d,
        new_mrr_60d: Math.round(new_mrr_60d_cents) / 100,
      },
    },
  });
}

export default async function handler(req, res) {
  const section = req.query.section || (req.method === "GET" ? "summary" : null);

  // Channel ingest — POST only
  if (section === "channel-ingest") {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: "STRIPE_SECRET_KEY not configured" });
    try {
      return await handleChannelIngest(req, res);
    } catch (err) {
      console.error("channel-ingest error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: "STRIPE_SECRET_KEY not configured" });

  try {

    if (section === "summary") {
      // Get balance, active subscriptions count, recent charges
      const [balance, subs, charges] = await Promise.all([
        stripeFetch("/balance"),
        stripeFetch("/subscriptions?status=active&limit=100"),
        stripeFetch("/charges?limit=100"),
      ]);

      const mrr = (subs.data || []).reduce((sum, s) => {
        const amount = s.plan?.amount || s.items?.data?.[0]?.price?.unit_amount || 0;
        const interval = s.plan?.interval || s.items?.data?.[0]?.price?.recurring?.interval || "month";
        const monthly = interval === "year" ? amount / 12 : interval === "week" ? amount * 4 : amount;
        return sum + monthly;
      }, 0) / 100;

      const totalRevenue = (charges.data || [])
        .filter(c => c.paid && !c.refunded)
        .reduce((sum, c) => sum + (c.amount || 0), 0) / 100;

      const availableBalance = (balance.available || [])
        .reduce((sum, b) => sum + b.amount, 0) / 100;

      return res.status(200).json({
        data: {
          mrr: Math.round(mrr * 100) / 100,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          activeSubscriptions: (subs.data || []).length,
          availableBalance: Math.round(availableBalance * 100) / 100,
          currency: balance.available?.[0]?.currency || "usd",
        },
      });
    }

    if (section === "search") {
      const q = (req.query.q || "").trim();
      if (!q) return res.status(400).json({ error: "q required" });
      const url = `/customers/search?query=${encodeURIComponent(`name~"${q}" OR email~"${q}"`)}&limit=20`;
      const result = await stripeFetch(url);
      const mapped = (result.data || []).map(c => ({
        id: c.id, name: c.name || "", email: c.email || "",
      }));
      return res.status(200).json({ data: mapped, total: mapped.length });
    }

    if (section === "count") {
      let total = 0; let starting_after = null;
      for (let i = 0; i < 20; i++) {
        const qs = `limit=100${starting_after ? `&starting_after=${starting_after}` : ""}`;
        const page = await stripeFetch(`/customers?${qs}`);
        const pd = page.data || [];
        total += pd.length;
        if (!page.has_more || pd.length === 0) break;
        starting_after = pd[pd.length - 1].id;
      }
      return res.status(200).json({ data: { total } });
    }

    if (section === "customers") {
      // Paginate to fetch ALL customers (Stripe caps each page at 100)
      const all = [];
      let starting_after = null;
      for (let i = 0; i < 10; i++) {
        const qs = `limit=100&expand[]=data.subscriptions${starting_after ? `&starting_after=${starting_after}` : ""}`;
        const page = await stripeFetch(`/customers?${qs}`);
        const pageData = page.data || [];
        all.push(...pageData);
        if (!page.has_more || pageData.length === 0) break;
        starting_after = pageData[pageData.length - 1].id;
      }
      const customers = { data: all };
      const mapped = (customers.data || []).map(c => ({
        id: c.id,
        name: c.name || c.email || "Unknown",
        email: c.email || "",
        created: c.created,
        subscriptions: (c.subscriptions?.data || []).map(s => ({
          id: s.id,
          status: s.status,
          planName: s.plan?.nickname || s.items?.data?.[0]?.price?.nickname || "Plan",
          amount: (s.plan?.amount || s.items?.data?.[0]?.price?.unit_amount || 0) / 100,
          interval: s.plan?.interval || s.items?.data?.[0]?.price?.recurring?.interval || "month",
          currentPeriodEnd: s.current_period_end,
        })),
      }));
      return res.status(200).json({ data: mapped });
    }

    if (section === "invoices") {
      const invoices = await stripeFetch("/invoices?limit=30&expand[]=data.customer");
      const mapped = (invoices.data || []).map(i => ({
        id: i.id,
        customerName: i.customer?.name || i.customer_email || "Unknown",
        customerEmail: i.customer_email || "",
        amount: (i.amount_paid || i.total || 0) / 100,
        status: i.status,
        created: i.created,
        paidAt: i.status_transitions?.paid_at || null,
        invoicePdf: i.invoice_pdf || null,
        number: i.number || "",
      }));
      return res.status(200).json({ data: mapped });
    }

    if (section === "alerts") {
      const now = Math.floor(Date.now() / 1000);
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60;
      const fourteenDaysFromNow = now + 14 * 24 * 60 * 60;

      const [failedCharges, openInvoices, activeSubs] = await Promise.all([
        stripeFetch(`/charges?limit=20&status=failed&created[gte]=${thirtyDaysAgo}`),
        stripeFetch("/invoices?status=open&limit=50&expand[]=data.customer"),
        stripeFetch("/subscriptions?status=active&limit=100&expand[]=data.customer"),
      ]);

      // Past-due = open invoices whose due_date has passed
      const pastDueInvoices = {
        data: (openInvoices.data || []).filter(i => i.due_date && i.due_date < now),
      };

      const failedPayments = (failedCharges.data || []).map(c => ({
        id: c.id,
        customerName: c.customer?.name || c.billing_details?.name || "Unknown",
        customerEmail: c.customer?.email || c.billing_details?.email || "",
        amount: (c.amount || 0) / 100,
        created: c.created,
        failureMessage: c.failure_message || "Unknown failure",
      }));

      const pastDue = (pastDueInvoices.data || []).map(i => ({
        id: i.id,
        customerName: i.customer?.name || i.customer_email || "Unknown",
        customerEmail: i.customer_email || "",
        amount: (i.amount_due || i.total || 0) / 100,
        created: i.created,
        dueDate: i.due_date || null,
      }));

      const upcomingRenewals = (activeSubs.data || [])
        .filter(s => s.current_period_end && s.current_period_end <= fourteenDaysFromNow)
        .map(s => ({
          id: s.id,
          customerName: s.customer?.name || s.customer?.email || "Unknown",
          customerEmail: s.customer?.email || "",
          amount: (s.plan?.amount || s.items?.data?.[0]?.price?.unit_amount || 0) / 100,
          renewalDate: s.current_period_end,
          planName: s.plan?.nickname || s.items?.data?.[0]?.price?.nickname || "Plan",
        }));

      return res.status(200).json({
        data: {
          failedPayments,
          pastDueInvoices: pastDue,
          upcomingRenewals,
          expiringCards: [],
        },
      });
    }

    if (section === "metrics") {
      const now = Math.floor(Date.now() / 1000);
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60;
      const sixtyDaysAgo = now - 60 * 24 * 60 * 60;

      const [charges, allSubs, invoices] = await Promise.all([
        stripeFetch(`/charges?limit=100&created[gte]=${sixtyDaysAgo}`),
        stripeFetch("/subscriptions?limit=100&status=all&expand[]=data.customer"),
        stripeFetch(`/invoices?limit=100&created[gte]=${sixtyDaysAgo}`),
      ]);

      const paidCharges = (charges.data || []).filter(c => c.paid && !c.refunded);
      const totalChargesLast30 = paidCharges
        .filter(c => c.created >= thirtyDaysAgo)
        .reduce((sum, c) => sum + (c.amount || 0), 0) / 100;
      const totalChargesPrev30 = paidCharges
        .filter(c => c.created >= sixtyDaysAgo && c.created < thirtyDaysAgo)
        .reduce((sum, c) => sum + (c.amount || 0), 0) / 100;

      const activeSubs = (allSubs.data || []).filter(s => s.status === "active");
      const canceledRecently = (allSubs.data || []).filter(
        s => s.status === "canceled" && s.canceled_at && s.canceled_at >= thirtyDaysAgo
      );
      const churnCount = canceledRecently.length;
      const activeCount = activeSubs.length;
      const churnRate = activeCount > 0
        ? ((churnCount / activeCount) * 100).toFixed(1) + "%"
        : "0%";

      const mrr = activeSubs.reduce((sum, s) => {
        const amount = s.plan?.amount || s.items?.data?.[0]?.price?.unit_amount || 0;
        const interval = s.plan?.interval || s.items?.data?.[0]?.price?.recurring?.interval || "month";
        const monthly = interval === "year" ? amount / 12 : interval === "week" ? amount * 4 : amount;
        return sum + monthly;
      }, 0) / 100;

      const avgRevenuePerClient = activeCount > 0
        ? Math.round((mrr / activeCount) * 100) / 100
        : 0;

      const revenueGrowth = totalChargesPrev30 > 0
        ? (((totalChargesLast30 - totalChargesPrev30) / totalChargesPrev30) * 100).toFixed(1) + "%"
        : "N/A";

      const ltv = Math.round(avgRevenuePerClient * 12 * 100) / 100;

      const allInvoices = invoices.data || [];
      const paidInvoices = allInvoices.filter(i => i.status === "paid");
      const collectionRate = allInvoices.length > 0
        ? ((paidInvoices.length / allInvoices.length) * 100).toFixed(1) + "%"
        : "100%";

      return res.status(200).json({
        data: {
          churnCount,
          churnRate,
          avgRevenuePerClient,
          revenueGrowth,
          ltv,
          collectionRate,
          totalChargesLast30: Math.round(totalChargesLast30 * 100) / 100,
          totalChargesPrev30: Math.round(totalChargesPrev30 * 100) / 100,
        },
      });
    }

    return res.status(400).json({ error: "Invalid section. Use: summary, customers, invoices, alerts, metrics" });
  } catch (err) {
    console.error("Stripe error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
