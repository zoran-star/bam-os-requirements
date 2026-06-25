import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function — Agent autonomy mode (BAM staff only)
//
//   POST /api/agent-config { action }            (staff bearer required)
//     "list"                 → every agent-capable academy + its booking + confirm mode
//     "get-mode" { client_id }          → { mode, confirm_mode } (owner-readable)
//     "set-mode" { client_id, mode }    → booking agent: off | hawkeye | self_drive
//     "set-confirm-mode" { client_id, mode } → confirm agent (Scheduled-Trial), same vocab
//
// Booking switch at clients.ghl_kpi_config.agent_mode governs the Responded reply
// bot + follow-up engine. The CONFIRM agent has its OWN switch at
// clients.ghl_kpi_config.confirm_agent_mode (default off). See agent/_mode.js.

import { agentMode, confirmAgentMode, AGENT_MODES } from "./agent/_mode.js";
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
      return res.status(200).json({ mode: row ? agentMode(row) : "off", confirm_mode: row ? confirmAgentMode(row) : "off" });
    } catch (e) { return res.status(500).json({ error: e.message }); }
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
        notify_phone: (c.ghl_kpi_config || {}).agent_notify_phone || null,
      }));
      return res.status(200).json({ academies });
    }

    if (b.action === "set-mode") {
      if (!b.client_id) return res.status(400).json({ error: "client_id required" });
      if (!AGENT_MODES.includes(b.mode)) return res.status(400).json({ error: `mode must be one of ${AGENT_MODES.join(", ")}` });
      const [row] = await sb(`clients?id=eq.${encodeURIComponent(b.client_id)}&select=ghl_kpi_config&limit=1`);
      if (!row) return res.status(404).json({ error: "academy not found" });
      const cfg = { ...(row.ghl_kpi_config || {}), agent_mode: b.mode };
      // Keep the legacy booleans in sync so any code still reading them agrees.
      cfg.agent_approvals_enabled = b.mode !== "off";
      cfg.followup_engine_enabled = b.mode !== "off";
      await sb(`clients?id=eq.${encodeURIComponent(b.client_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_kpi_config: cfg }) });
      return res.status(200).json({ ok: true, mode: b.mode });
    }

    // The CONFIRM agent's OWN switch (Scheduled-Trial stage) — independent of the
    // booking agent's agent_mode. No legacy booleans to keep in sync.
    if (b.action === "set-confirm-mode") {
      if (!b.client_id) return res.status(400).json({ error: "client_id required" });
      if (!AGENT_MODES.includes(b.mode)) return res.status(400).json({ error: `mode must be one of ${AGENT_MODES.join(", ")}` });
      const [row] = await sb(`clients?id=eq.${encodeURIComponent(b.client_id)}&select=ghl_kpi_config&limit=1`);
      if (!row) return res.status(404).json({ error: "academy not found" });
      const cfg = { ...(row.ghl_kpi_config || {}), confirm_agent_mode: b.mode };
      await sb(`clients?id=eq.${encodeURIComponent(b.client_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ghl_kpi_config: cfg }) });
      return res.status(200).json({ ok: true, confirm_mode: b.mode });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-config]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
