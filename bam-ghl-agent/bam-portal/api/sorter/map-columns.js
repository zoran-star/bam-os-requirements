import { withSentryApiRoute } from "../_sentry.js";
import { claudeJsonArray } from "../_ai.js";
// Vercel Serverless Function — Pricing Sorter, Step 2 AI column mapping.
//
// POST /api/sorter/map-columns
//   body: { client_id, headers:[...csv header strings], sample_rows:[[...],[...]] }
//   → asks Claude (claude-sonnet-4-6, raw fetch) to map each CSV header to one of
//     the canonical member fields (or null → unmapped → goes to raw on import).
//   → { mapping:[{ header, field|null, confidence, sample }], unmapped_headers:[...] }
//
// No DB writes. The owner confirms/overrides the mapping in the UI before the
// /api/sorter/import commit step ever stages a row. Same auth as match-prices.js.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const MODEL = "claude-sonnet-4-6";

const FIELDS = [
  "athlete_name", "parent_name", "parent_email", "parent_phone",
  "plan", "status", "joined_date",
  "stripe_customer_id", "stripe_subscription_id",
];

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

async function aiMapColumns(headers, sampleRows) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error("ANTHROPIC_API_KEY not configured"), { status: 500 });

  const system =
    "You map the columns of a sports academy's messy member spreadsheet (CSV) to a fixed set of " +
    "canonical member fields. For EACH column header, pick the single best matching field — or " +
    "null if the column is irrelevant/leftover. Use BOTH the header name and the sample values. " +
    "The allowed fields are:\n" +
    "  athlete_name           = the player/child's name\n" +
    "  parent_name            = the parent/guardian's name\n" +
    "  parent_email           = an email address\n" +
    "  parent_phone           = a phone number\n" +
    "  plan                   = the membership plan/term label\n" +
    "  status                 = active/cancelled/paused/etc.\n" +
    "  joined_date            = the date they joined/started\n" +
    "  stripe_customer_id     = a Stripe customer id (cus_...)\n" +
    "  stripe_subscription_id = a Stripe subscription id (sub_...)\n" +
    "Map AT MOST ONE column to each field (the best one); set the rest of overlapping columns to null. " +
    "Respond with ONLY a JSON array, one object per input header, same order, no prose:\n" +
    '[{"header"(exact string),"field"(one allowed value or null),"confidence"(0-1)}]';

  const payload = {
    headers,
    sample_rows: (Array.isArray(sampleRows) ? sampleRows : []).slice(0, 8),
    allowed_fields: FIELDS,
  };

  return await claudeJsonArray({ apiKey, model: MODEL, system, payload, maxTokens: 4096 });
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

    const headers = Array.isArray(body.headers) ? body.headers.map(h => String(h)) : [];
    if (!headers.length) return res.status(400).json({ error: "headers[] required" });
    const sampleRows = Array.isArray(body.sample_rows) ? body.sample_rows : [];

    const raw = await aiMapColumns(headers, sampleRows);
    const byHeader = Object.fromEntries((Array.isArray(raw) ? raw : []).map(m => [String(m.header), m]));

    const mapping = headers.map((header, i) => {
      const m = byHeader[header] || {};
      const field = FIELDS.includes(m.field) ? m.field : null;
      const sample = (sampleRows[0] && sampleRows[0][i] != null) ? String(sampleRows[0][i]) : null;
      return { header, field, confidence: m.confidence != null ? m.confidence : null, sample };
    });

    return res.status(200).json({
      ok: true,
      mapping,
      unmapped_headers: mapping.filter(m => !m.field).map(m => m.header),
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
