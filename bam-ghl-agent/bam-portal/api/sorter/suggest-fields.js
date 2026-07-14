import { withSentryApiRoute } from "../_sentry.js";
import { claudeJsonArray } from "../_ai.js";
export const maxDuration = 30;

// Member-import AI field suggestions (Gap #5, phase 5C).
//
//   POST /api/sorter/suggest-fields
//     body: { client_id, offer_id?, columns:[{ column, samples:[...] }] }
//     → { ok, offer_id, suggestions:[{ label, type, source_column, confidence }] }
//
// Given the CSV columns the owner did NOT map to a canonical member field, ask
// Claude which are worth collecting on the ONBOARDING intake form going forward,
// skipping anything already collected. The owner reviews + confirms in a
// checklist, then the chosen ones are created via POST /api/custom-fields
// (section=onboarding, offer_id). Nothing is written here.
//
// Auth: Supabase JWT — staff (any academy) or a client_users member of client_id.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const MODEL = "claude-sonnet-4-6";
const TYPES = ["text", "number", "date", "select", "multiselect", "boolean", "phone", "email", "url"];

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
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  }
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

async function aiSuggest(columns, alreadyCollected) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  const system =
    "A sports academy imported a member spreadsheet. Some columns did not map to a standard member " +
    "field. Decide which of those leftover columns hold useful PER-ATHLETE / PER-MEMBER info worth " +
    "collecting on their ONBOARDING intake form going forward (e.g. jersey size, grade, school, " +
    "birthdate, medical notes, emergency contact, position). SKIP columns that are internal/system " +
    "junk (ids, timestamps, internal notes), one-offs, or duplicates of something they already " +
    "collect. Pick a field type from: " + TYPES.join(", ") + ". Prefer fewer, high-quality " +
    "suggestions and it is fine to return an empty array. Respond with ONLY a JSON array, no prose:\n" +
    '[{"label"(clean human label),"type"(one allowed type),"source_column"(the exact input column),"confidence"(0-1)}]';
  const payload = {
    columns: columns.map(c => ({ column: c.column, samples: (Array.isArray(c.samples) ? c.samples : []).slice(0, 5).map(String) })),
    already_collected: alreadyCollected,
    allowed_types: TYPES,
  };
  return await claudeJsonArray({ apiKey, model: MODEL, system, payload, maxTokens: 2048 });
}

async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = b.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    const { isStaff, clientIds } = await resolveUser(req);
    if (!isStaff && !clientIds.includes(clientId)) return res.status(403).json({ error: "not authorized for this academy" });

    const columns = Array.isArray(b.columns) ? b.columns.filter(c => c && c.column).slice(0, 40) : [];
    if (!columns.length) return res.status(200).json({ ok: true, offer_id: null, suggestions: [] });

    // Resolve the offer to attach onboarding fields to (given id, else the
    // published training offer, else the newest training offer).
    let offer = null;
    if (b.offer_id) {
      const rows = await sb(`offers?id=eq.${encodeURIComponent(b.offer_id)}&client_id=eq.${encodeURIComponent(clientId)}&select=id&limit=1`);
      offer = Array.isArray(rows) && rows[0];
    }
    if (!offer) {
      const rows = await sb(`offers?client_id=eq.${encodeURIComponent(clientId)}&type=eq.training&select=id,status&order=status.asc,updated_at.desc`);
      offer = (rows || []).find(o => o.status === "published") || (rows || [])[0] || null;
    }
    if (!offer) return res.status(200).json({ ok: true, offer_id: null, suggestions: [] });

    // Skip anything already collected (any of this academy's field labels).
    const defs = (await sb(`custom_field_defs?client_id=eq.${encodeURIComponent(clientId)}&archived=eq.false&select=label`)) || [];
    const existing = new Set(defs.map(d => String(d.label || "").trim().toLowerCase()).filter(Boolean));
    // Standard member fields are already captured by the import itself.
    ["athlete name", "parent name", "name", "email", "phone", "plan", "status", "joined date"].forEach(l => existing.add(l));

    const raw = await aiSuggest(columns, Array.from(existing));
    const suggestions = (Array.isArray(raw) ? raw : [])
      .filter(s => s && s.label)
      .map(s => ({
        label: String(s.label).trim(),
        type: TYPES.includes(s.type) ? s.type : "text",
        source_column: s.source_column ? String(s.source_column) : null,
        confidence: s.confidence != null ? s.confidence : null,
      }))
      .filter(s => s.label && !existing.has(s.label.toLowerCase()));

    return res.status(200).json({ ok: true, offer_id: offer.id, suggestions });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
