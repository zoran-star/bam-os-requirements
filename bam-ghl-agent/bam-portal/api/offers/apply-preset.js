import { withSentryApiRoute } from "../_sentry.js";
import { applyPreset, buildPresetRows, PRESETS, presetContents } from "../agent/presets.js";

// Stamp a sales-pipeline preset onto an offer from the portal (Gap #2, phase 2B;
// station-model manifest since 2026-07-14).
//
//   GET  /api/offers/apply-preset?action=list
//     → { ok, presets:[{ key, label, description, stages, transitions, contents }] }
//   GET  /api/offers/apply-preset?action=preview&client_id=&offer_id=&preset=free_trial
//     → { ok, preset, label, stages, transitions, stageRows, transitionRows,
//         workers, contents }  (dry-run, no writes; `contents` is the manifest
//         summary the UI renders its chips from - agents, automations, forms,
//         calendars - so the front end never hardcodes what a preset brings)
//   GET  /api/offers/apply-preset?action=graph&client_id=
//     → { ok, preset, stages, edges }  (the MASTER flow graph this academy runs,
//        resolved from its offer stamp - what the config view renders since the
//        Phase 3 cleanup; per-academy pause state is overlaid client-side)
//   POST /api/offers/apply-preset   body { client_id, offer_id, preset, force? }
//     → { ok, preset, stages, transitions, stamp }
//        (Phase 3: writes ONLY the pipeline_stages identity anchors + the offer
//         stamp offer.data.sales.{preset_key,preset_version,preset_applied_at};
//         edges are runtime-read from the master, never copy-stamped. `force`
//         is accepted and ignored - the 409/needs_force flow is gone.)
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

// The preset's stage engines (agent template / automation), for a readable preview.
function stageWorkers(presetKey) {
  const p = PRESETS[presetKey];
  const map = {};
  for (const s of (p ? p.stages : [])) {
    const w = s.engine || {};
    map[s.role] = w.kind === "agent" ? `agent: ${w.template}` : w.kind === "automation" ? `automation: ${w.key}` : "human";
  }
  return map;
}

// Transitions count without a real client (list view) - compile with a dummy id.
function transitionCount(presetKey) {
  try { return buildPresetRows(presetKey, "count", null).transitionRows.length; } catch (_) { return 0; }
}

async function handler(req, res) {
  try {
    const q = req.query || {};
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const action = q.action || b.action || (req.method === "GET" ? "preview" : "apply");

    if (action === "list") {
      return res.status(200).json({
        ok: true,
        presets: Object.values(PRESETS).map(p => ({
          key: p.key, label: p.label, description: p.description,
          stages: p.stages.length, transitions: transitionCount(p.key),
          contents: presetContents(p.key),
        })),
      });
    }

    const clientId = q.client_id || b.client_id;
    const offerId = q.offer_id || b.offer_id;
    const presetKey = q.preset || b.preset || "free_trial";

    // The master flow graph this academy runs (Phase 3: the config view renders
    // from HERE, not from per-academy stage_transitions rows). Preset resolved
    // from the offer stamp; falls back to free_trial when un-stamped so a
    // mid-onboarding academy still sees the flow it is about to get.
    if (action === "graph") {
      if (!clientId) return res.status(400).json({ error: "client_id required" });
      const { isStaff, clientIds } = await resolveUser(req);
      if (!isStaff && !clientIds.includes(clientId)) return res.status(403).json({ error: "not authorized for this academy" });
      let key = "free_trial";
      try {
        const rows = await sb(`offers?client_id=eq.${enc(clientId)}&select=data&limit=10`);
        for (const r of rows || []) {
          const k = r && r.data && r.data.sales && r.data.sales.preset_key;
          if (k && PRESETS[k]) { key = k; break; }
        }
      } catch (_) { /* fall back to free_trial */ }
      const { stageRows, transitionRows } = buildPresetRows(key, clientId, null);
      return res.status(200).json({ ok: true, preset: key, stages: stageRows, edges: transitionRows });
    }

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
        contents: presetContents(presetKey),
      });
    }

    if (action === "apply") {
      try {
        const r = await applyPreset({ clientId, offerId, presetKey, force: b.force === true, log: () => {} });

        // Stamp the offer so setup-status + future re-stamps know which preset
        // (and which version of it) this offer runs on. Merge into data.sales -
        // never clobber the owner's wizard answers in the rest of the blob.
        let stamp = null;
        try {
          const rows = await sb(`offers?id=eq.${enc(offerId)}&select=data&limit=1`);
          const data = (Array.isArray(rows) && rows[0] && rows[0].data) || {};
          stamp = {
            preset_key: presetKey,
            preset_version: (PRESETS[presetKey] && PRESETS[presetKey].version) || 1,
            preset_applied_at: new Date().toISOString(),
          };
          data.sales = { ...(data.sales || {}), ...stamp };
          await sb(`offers?id=eq.${enc(offerId)}`, {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
          });
        } catch (_) { /* stamp is best-effort - the pipeline rows are already in */ }

        return res.status(200).json({ ok: true, preset: presetKey, stages: r.stages, transitions: r.transitions, stamp });
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
