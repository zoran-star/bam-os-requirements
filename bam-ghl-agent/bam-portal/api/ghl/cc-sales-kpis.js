// Vercel Serverless Function - command-center Sales KPIs (off-GHL, V2).
//
//   GET /api/ghl/cc-sales-kpis?client_id=<uuid>[&from=<iso>&to=<iso>]
//     → { sales_7d, sales: [{id,name,joined_date}],
//         closing_rate, prev_closing_rate,
//         qualified_won, qualified_lost, qualified_pending,
//         won: [...], lost: [...], pending: [...],   // {name, contact_id, trainer, trial_date, plan?}
//         range: { from, to } }
//
// Fully off GHL - sourced from the portal's own tables:
//   sales_7d      = new PAYING members in the last 7 calendar days
//                   (members.joined_date, status in live/paused/payment_failed -
//                   payment_method_required = never completed checkout, not a sale)
//   sales         = those members listed out (id + athlete name) for the UI
//   closing_rate  = QUALIFIED TRIAL CLOSE RATE (Zoran's definition, 2026-07-10)
//                   over [from, to) - defaults to the last 45 days. Population =
//                   post-trial cards marked SHOWED UP + GOOD FIT. Of those:
//                     won  = the lead became a paying member (ground truth), or an
//                            opportunity/outcome marks it won
//                     lost = the lead's outcome is 'lost' OR 'nurture' - when
//                            portal Lead-Nurture is live, hand-marking "Lost"
//                            re-routes to nurture and writes status 'nurture'
//                            (api/ghl/pipelines.js), so nurture = marked lost
//                            (Zoran, 2026-07-15). Won beats lost if they buy later.
//                     pending = neither yet (excluded from the rate)
//                     rate = won / (won + lost)   [null if 0]
//                   won/lost/pending are the actual trials behind the number, for
//                   the client-portal popup (each row opens the contact drawer).
//                   prev_closing_rate = the same rate over the immediately preceding
//                   equal-length window, for the trend arrow.
//                   Rows come from the cc_qualified_trials() SQL function, which
//                   bridges the mixed portal-UUID / GHL-id opportunity ids through
//                   the opportunities table (post_trial_reviews.opportunity_id can be
//                   either form, but members / pipeline_outcomes key on GHL ids).
//                   "won" is read from the members table first because
//                   opportunities.status lags the actual sale.
//
// Auth: Supabase JWT - staff (any academy) or a client_users member of client_id.

import { withSentryApiRoute } from "../_sentry.js";

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : [];
}

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  }
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  const clientId = req.query.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });

  let ctx;
  try { ctx = await resolveUser(req); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }
  if (!ctx.isStaff && !ctx.clientIds.includes(clientId)) return res.status(403).json({ error: "not your academy" });

  // joined_date is a DATE column - compare with calendar days, not a timestamp,
  // or the 7-day window drifts with the time of day the endpoint is hit.
  const day = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const cid = encodeURIComponent(clientId);
  const c7 = day(6); // inclusive: today + the N-1 days before it
  // A "sale" is a member who completed checkout. payment_method_required rows
  // signed up but never paid - they are not sales (and test rows live there too).
  const PAID = "status=in.(live,paused,payment_failed)";

  // Close-rate window: [from, to). Defaults to the last 45 days. The popup's
  // date picker passes explicit from/to (to is exclusive - the frontend sends the
  // day AFTER the selected end). Guard against garbage / inverted ranges.
  const now = Date.now();
  const parseTs = (v, fallback) => { const t = Date.parse(v); return Number.isFinite(t) ? t : fallback; };
  let toMs = parseTs(req.query.to, now);
  let fromMs = parseTs(req.query.from, now - 45 * 86400000);
  if (fromMs >= toMs) { fromMs = toMs - 45 * 86400000; } // bad range -> fall back to 45d
  const span = toMs - fromMs;                            // for the previous equal-length window
  const iso = (ms) => new Date(ms).toISOString();
  const qtrials = (fromT, toT) =>
    sb(`rpc/cc_qualified_trials?p_client_id=${cid}&p_from=${encodeURIComponent(iso(fromT))}&p_to=${encodeURIComponent(iso(toT))}`);
  const rateOf = (rows) => {
    const won = rows.filter(x => x.outcome === "won").length;
    const lost = rows.filter(x => x.outcome === "lost").length;
    return (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : null;
  };

  try {
    const [m7, curRows, prevRows] = await Promise.all([
      sb(`members?client_id=eq.${cid}&${PAID}&joined_date=gte.${c7}&select=id,athlete_name,joined_date&order=joined_date.desc`),
      qtrials(fromMs, toMs),                 // trials in the selected window
      qtrials(fromMs - span, fromMs),        // the preceding equal-length window (trend)
    ]);
    const sales = (m7 || []).map((m) => ({ id: m.id, name: m.athlete_name || "Member", joined_date: m.joined_date }));
    const sales_7d = sales.length;

    // Shape each row for the UI (contact_id opens the drawer), newest trial first,
    // split by outcome. plan is won-only so it is dropped from lost/pending.
    const list = (o) => (Array.isArray(curRows) ? curRows : [])
      .filter(x => x.outcome === o)
      .sort((a, b) => new Date(b.trial_date) - new Date(a.trial_date))
      .map(x => ({ name: x.name, contact_id: x.ghl_contact_id, trainer: x.trainer || null, trial_date: x.trial_date, ...(o === "won" ? { plan: x.plan || null } : {}) }));
    const wonList = list("won");
    const lostList = list("lost");
    const pendingList = list("pending");

    const closing_rate = rateOf(Array.isArray(curRows) ? curRows : []);
    const prev_closing_rate = rateOf(Array.isArray(prevRows) ? prevRows : []);

    return res.status(200).json({
      sales_7d, sales,
      closing_rate, prev_closing_rate,
      qualified_won: wonList.length,
      qualified_lost: lostList.length,
      qualified_pending: pendingList.length,
      won: wonList, lost: lostList, pending: pendingList,
      range: { from: iso(fromMs), to: iso(toMs) },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
