import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function — Agent autonomy mode
//
//   POST /api/agent-config { action }
//     "list"                 → every agent-capable academy + its modes (STAFF only)
//     "get-mode" { client_id }          → { mode, confirm_mode, closing_mode, self_drive_enabled }
//                                         (staff OR the academy's own owner/can_train_agent)
//     "set-mode" / "set-confirm-mode" / "set-closing-mode" { client_id, mode }
//                                         → off | hawkeye | self_drive. Staff OR the academy's
//                                           OWN owner/can_train_agent (so an academy can toggle
//                                           its own agents from the client portal). self_drive is
//                                           staff-only AND globally blocked, so academies get off/hawkeye.
//
// Booking switch at clients.ghl_kpi_config.agent_mode governs the Responded reply
// bot + follow-up engine. The CONFIRM agent has its OWN switch at
// clients.ghl_kpi_config.confirm_agent_mode (default off). See agent/_mode.js.

import { agentMode, confirmAgentMode, closingAgentMode, AGENT_MODES, SELF_DRIVE_GLOBALLY_DISABLED } from "./agent/_mode.js";
import { resolveAgentActor } from "./agent/_auth.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function requireStaff(req) {
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${bearer}` } });
  if (!r.ok) return null;
  const user = await r.json();
  if (!user?.id) return null;
  let staff = await sb(`staff?user_id=eq.${user.id}&select=role&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=role&limit=1`);
  return Array.isArray(staff) && staff[0] ? (user.email || "staff") : null;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const b = req.body && typeof req.body === "object" ? req.body : {};

  // Read-only mode lookup — staff OR the academy's own owner / can_train_agent
  // member (so the pipeline can glow the Responded stage). SETTING the mode
  // stays BAM-staff-only below.
  if (b.action === "get-mode") {
    const actor = await resolveAgentActor(req);
    if (!actor) return res.status(401).json({ error: "sign in required" });
    if (!b.client_id) return res.status(400).json({ error: "client_id required" });
    if (!actor.canActOn(b.client_id)) return res.status(403).json({ error: "not your academy" });
    try {
      const [row] = await sb(`clients?id=eq.${encodeURIComponent(b.client_id)}&select=ghl_kpi_config&limit=1`);
      return res.status(200).json({ mode: row ? agentMode(row) : "off", confirm_mode: row ? confirmAgentMode(row) : "off", closing_mode: row ? closingAgentMode(row) : "off", self_drive_enabled: !SELF_DRIVE_GLOBALLY_DISABLED });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // Setting a mode — staff OR the academy's own owner / can_train_agent member, for
  // their OWN academy (so an academy can turn its own agents on/off from the client
  // portal). self_drive stays staff-only AND is globally blocked, so academies can
  // only pick off / hawkeye (hawkeye = drafts for approval; nothing auto-sends).
  const SET_ACTIONS = { "set-mode": "mode", "set-confirm-mode": "confirm_mode", "set-closing-mode": "closing_mode" };
  if (SET_ACTIONS[b.action]) {
    const actor = await resolveAgentActor(req);
    if (!actor) return res.status(401).json({ error: "sign in required" });
    if (!b.client_id) return res.status(400).json({ error: "client_id required" });
    if (!actor.canActOn(b.client_id)) return res.status(403).json({ error: "not your academy" });
    if (!AGENT_MODES.includes(b.mode)) return res.status(400).json({ error: `mode must be one of ${AGENT_MODES.join(", ")}` });
    if (b.mode === "self_drive" && (SELF_DRIVE_GLOBALLY_DISABLED || !actor.isStaff)) return res.status(403).json({ error: "Self-drive is currently disabled - agents are capped at Hawkeye." });
    try {
      const [row] = await sb(`clients?id=eq.${encodeURIComponent(b.client_id)}&select=ghl_kpi_config&limit=1`);
      if (!row) return res.status(404).json({ error: "academy not found" });
      const cfg = { ...(row.ghl_kpi_config || {}) };
      if (b.action === "set-mode") {
        cfg.agent_mode = b.mode;
        // Keep the legacy booleans in sync so any code still reading them agrees.
        cfg.agent_approvals_enabled = b.mode !== "off";
        cfg.followup_engine_enabled = b.mode !== "off";
      } else if (b.action === "set-confirm-mode") {
        cfg.confirm_agent_mode = b.mode;
      } else {
        cfg.closing_agent_mode = b.mode;
      }
      await sb(`clients?id=eq.${encodeURIComponent(b.client_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_kpi_config: cfg }) });
      return res.status(200).json({ ok: true, [SET_ACTIONS[b.action]]: b.mode });
    } catch (e) { console.error("[agent-config set]", e); return res.status(500).json({ error: e.message || "internal error" }); }
  }

  // Entry-point routing config (clients.ghl_kpi_config.portal_entry_routing) - the
  // form-fill -> stage + bot wiring. Read + write, both scoped to the academy's own
  // owner / can_train_agent member or BAM staff (same as get/set-mode).
  if (b.action === "get-entry-routing") {
    const actor = await resolveAgentActor(req);
    if (!actor) return res.status(401).json({ error: "sign in required" });
    if (!b.client_id) return res.status(400).json({ error: "client_id required" });
    if (!actor.canActOn(b.client_id)) return res.status(403).json({ error: "not your academy" });
    try {
      const [row] = await sb(`clients?id=eq.${encodeURIComponent(b.client_id)}&select=ghl_kpi_config&limit=1`);
      return res.status(200).json({ routing: (row && row.ghl_kpi_config && row.ghl_kpi_config.portal_entry_routing) || null });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  if (b.action === "set-entry-routing") {
    const actor = await resolveAgentActor(req);
    if (!actor) return res.status(401).json({ error: "sign in required" });
    if (!b.client_id) return res.status(400).json({ error: "client_id required" });
    if (!actor.canActOn(b.client_id)) return res.status(403).json({ error: "not your academy" });
    const routing = (b.routing && typeof b.routing === "object" && !Array.isArray(b.routing)) ? b.routing : null;
    if (!routing) return res.status(400).json({ error: "routing object required" });
    try {
      const [row] = await sb(`clients?id=eq.${encodeURIComponent(b.client_id)}&select=ghl_kpi_config&limit=1`);
      if (!row) return res.status(404).json({ error: "academy not found" });
      const cfg = { ...(row.ghl_kpi_config || {}) };
      cfg.portal_entry_routing = { ...(cfg.portal_entry_routing || {}), ...routing };
      await sb(`clients?id=eq.${encodeURIComponent(b.client_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_kpi_config: cfg }) });
      return res.status(200).json({ ok: true, routing: cfg.portal_entry_routing });
    } catch (e) { console.error("[agent-config set-entry-routing]", e); return res.status(500).json({ error: e.message || "internal error" }); }
  }

  const staffEmail = await requireStaff(req);
  if (!staffEmail) return res.status(401).json({ error: "staff only" });

  try {
    if (b.action === "list") {
      // Agent feature is V2-only (currently just BAM GTA).
      const rows = await sb(`clients?select=id,business_name,ghl_kpi_config&v2_access=eq.true&order=business_name.asc`);
      const academies = (Array.isArray(rows) ? rows : []).map(c => ({
        client_id: c.id,
        business_name: c.business_name || "(academy)",
        mode: agentMode(c),
        confirm_mode: confirmAgentMode(c),
        closing_mode: closingAgentMode(c),
        notify_phone: (c.ghl_kpi_config || {}).agent_notify_phone || null,
      }));
      return res.status(200).json({ academies, self_drive_enabled: !SELF_DRIVE_GLOBALLY_DISABLED });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-config]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
