// Cancellation snapshot builder - freezes a member's economics at cancel time.
//
// Cancelled members are DELETED from `members`, so anything the KPI pages
// want to say about churned members later (tenure, monthly value, lifetime
// spend, plan) must be copied onto the cancellations row NOW. Used by
// actionCancel (api/members.js) and handleSubDeleted (api/stripe/webhook.js).
//
// Every field is best-effort: a Stripe hiccup must never block a cancel.
// Callers spread the returned object into the cancellations insert body.

// Term-vocabulary decode, server-side twin of the client's _ccMonthly()
// (client-portal.html). pricing_catalog.interval speaks terms ("4_weeks",
// "3_months", "one_time"), not raw Stripe intervals.
export function monthlyCentsFromCatalog(row) {
  if (!row || !Number.isFinite(Number(row.amount_cents))) return null;
  const iv = String(row.interval || "month").toLowerCase();
  if (iv === "one_time" || iv === "onetime") return 0;
  const t = iv.match(/^(\d+)[_ ]?(day|week|month|year)/) || iv.match(/(day|week|month|year)/);
  const unit = t ? t[t.length - 1] : "month";
  const count = (t && t.length === 3 && Number(t[1])) || 1;
  const perMonth = unit === "week" ? 4.33 : unit === "day" ? 30.44 : unit === "year" ? 1 / 12 : 1;
  return Math.round((Number(row.amount_cents) / count) * perMonth);
}

// Sum of paid invoices for a customer on the connected account.
// Paginates up to `maxPages` x 100 invoices (a member paying every 4 weeks
// for 10 years is ~130 invoices - 5 pages is generous headroom).
export async function stripeLifetimeSpend(stripeFetch, stripeAccount, customerId, maxPages = 5) {
  if (!stripeFetch || !stripeAccount || !customerId) return { total_spent_cents: null, payments_count: null };
  let total = 0, count = 0, startingAfter = null;
  for (let page = 0; page < maxPages; page++) {
    const qs = `customer=${encodeURIComponent(customerId)}&status=paid&limit=100` +
      (startingAfter ? `&starting_after=${encodeURIComponent(startingAfter)}` : "");
    const res = await stripeFetch(`/invoices?${qs}`, { stripeAccount });
    const data = (res && Array.isArray(res.data)) ? res.data : [];
    for (const inv of data) {
      const paid = Number(inv.amount_paid);
      if (Number.isFinite(paid) && paid > 0) { total += paid; count++; }
    }
    if (!res || !res.has_more || !data.length) break;
    startingAfter = data[data.length - 1].id;
  }
  return { total_spent_cents: total, payments_count: count };
}

export async function buildCancellationSnapshot({ member, sb, stripeFetch, stripeAccount }) {
  const snap = {
    joined_date: member.joined_date || null,
    plan_name: member.plan || null,
    stripe_price_id: member.stripe_price_id || null,
    offer_id: member.offer_id || null,
    monthly_amount_cents: null,
    total_spent_cents: Number.isFinite(Number(member.total_spent_cents)) ? Number(member.total_spent_cents) : null,
    payments_count: Number.isFinite(Number(member.payments_count)) ? Number(member.payments_count) : null,
  };

  // Monthly value from the pricing catalog (term decode).
  try {
    if (sb && member.stripe_price_id) {
      const rows = await sb(
        `pricing_catalog?client_id=eq.${member.client_id}` +
        `&stripe_price_id=eq.${encodeURIComponent(member.stripe_price_id)}` +
        `&select=display_name,amount_cents,interval&limit=1`
      );
      const row = Array.isArray(rows) && rows[0];
      if (row) {
        snap.monthly_amount_cents = monthlyCentsFromCatalog(row);
        if (!snap.plan_name && row.display_name) snap.plan_name = row.display_name;
      }
    }
  } catch (e) {
    console.error("cancellation-snapshot: catalog lookup failed (non-fatal):", e.message);
  }

  // Lifetime spend from Stripe (fresher than the synced members column).
  try {
    const spend = await stripeLifetimeSpend(stripeFetch, stripeAccount, member.stripe_customer_id);
    if (spend.total_spent_cents !== null) {
      snap.total_spent_cents = spend.total_spent_cents;
      snap.payments_count = spend.payments_count;
    }
  } catch (e) {
    console.error("cancellation-snapshot: spend lookup failed (non-fatal):", e.message);
  }

  return snap;
}
