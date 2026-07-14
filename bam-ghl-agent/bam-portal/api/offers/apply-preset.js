import { withSentryApiRoute } from "../_sentry.js";
import { applyPreset, PRESETS } from "../agent/presets.js";

// Stamp a sales-pipeline preset onto an offer from the portal (Gap #2, phase 2B).
// Wraps api/agent/presets.js applyPreset() (CLI-only until now) behind JWT auth.
//
//   GET  /api/offers/apply-preset?action=list
//     → { ok, presets:[{ key, label, description, stages, transitions }] }
//   GET  /api/offers/apply-preset?action=preview&client_id=&offer_id=&preset=free_trial
//     → { ok, preset, label, stages, transitions, stageRows, transitionRows }  (dry-run, no writes)
//   POST /api/offers/apply-preset   body { client_id, offer_id, preset, force? }
//     → { ok, preset, stages, transitions }   (writes pipeline_stages + stage_transitions)
//        409 { error, needs_force } when the offer already has conflicting edges.
//
// Auth: Supabase JWT — BAM staff (any academy) or a client_users member of client_id.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const enc = encodeURIComponent;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json", ...(init.headers || {}),
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
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${enc(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

// The preset's stage workers (agent template / automation), for a readable preview.
function stageWorkers(presetKey) {
  const p = PRESETS[presetKey];
  const map = {};
  for (const s of (p ? p.stages : [])) {
    const w = s.worker || {};
    map[s.role] = w.kind === "agent" ? `agent: ${w.template}` : w.kind === "automation" ? `automation: ${w.key}` : "human";
  }
  return map;
}

async function handler(req, res) {
  try {
    const q = req.query || {};
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const action = q.action || b.action || (req.method === "GET" ? "preview" : "apply");

    if (action === "list") {
      return res.status(200).json({
        ok: true,
        presets: Object.values(PRESETS).map(p => ({ key: p.key, label: p.label, description: p.description, stages: p.stages.length, transitions: p.transitions.length })),
      });
    }

    const clientId = q.client_id || b.client_id;
    const offerId = q.offer_id || b.offer_id;
    const presetKey = q.preset || b.preset || "free_trial";
    if (!clientId || !offerId) return res.status(400).json({ error: "client_id and offer_id required" });
    if (!PRESETS[presetKey]) return res.status(400).json({ error: `unknown preset '${presetKey}'` });

    const { isStaff, clientIds } = await resolveUser(req);
    if (!isStaff && !clientIds.includes(clientId)) return res.status(403).json({ error: "not authorized for this academy" });

    const offerRows = await sb(`offers?id=eq.${enc(offerId)}&client_id=eq.${enc(clientId)}&select=id&limit=1`);
    if (!(Array.isArray(offerRows) && offerRows[0])) return res.status(404).json({ error: "offer not found for this academy" });

    if (action === "preview") {
      const r = await applyPreset({ clientId, offerId, presetKey, dryRun: true, log: () => {} });
      return res.status(200).json({
        ok: true, preset: presetKey, label: PRESETS[presetKey].label,
        stages: r.stages, transitions: r.transitions,
        stageRows: r.stageRows, transitionRows: r.transitionRows, workers: stageWorkers(presetKey),
      });
    }

    if (action === "apply") {
      try {
        const r = await applyPreset({ clientId, offerId, presetKey, force: b.force === true, log: () => {} });
        return res.status(200).json({ ok: true, preset: presetKey, stages: r.stages, transitions: r.transitions });
      } catch (e) {
        const msg = e.message || String(e);
        const needsForce = /force:\s*true|Re-run with force|nondeterministic/.test(msg);
        return res.status(409).json({ error: msg, needs_force: needsForce });
      }
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
