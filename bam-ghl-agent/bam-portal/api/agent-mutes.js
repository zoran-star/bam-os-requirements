import { withSentryApiRoute } from "./_sentry.js";
// Per-lead bot mute endpoint (guardrail #6): "hands off this lead".
//
//   POST /api/agent-mutes  { action, ... }   (staff or own-academy bearer)
//     "list"  { client_id, contact_id? }            → mutes for the academy (or one contact)
//     "set"   { client_id, contact_id, agent?, reason? } → mute a bot (agent null = ALL bots)
//     "clear" { client_id, contact_id, agent? }     → un-mute (agent null clears the global row)
//
// A mute stops the agent detectors from drafting on this lead; an explicit human
// send is unaffected. A global mute (agent null) also exits the lead from any
// running portal automation sequence.
import { resolveAgentActor } from "./agent/_auth.js";
import { exitEnrollment } from "./automations.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const VALID_AGENTS = ["booking", "confirm", "closing"];

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const actor = await resolveAgentActor(req);
  if (!actor) return res.status(401).json({ error: "sign in required" });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const clientId = b.client_id;
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!actor.canActOn(clientId)) return res.status(403).json({ error: "not your academy" });
  const staffEmail = actor.email;

  // Normalize the agent: a value must be one of the known bots; anything else
  // (including "" / "all" / missing) means a GLOBAL mute (all bots) = null.
  const rawAgent = (b.agent || "").toString().trim().toLowerCase();
  const agent = VALID_AGENTS.includes(rawAgent) ? rawAgent : null;

  try {
    if (b.action === "list") {
      let path = `agent_mutes?client_id=eq.${clientId}&select=*&order=created_at.desc`;
      if (b.contact_id) path += `&ghl_contact_id=eq.${encodeURIComponent(b.contact_id)}`;
      const rows = await sb(path);
      return res.status(200).json({ mutes: Array.isArray(rows) ? rows : [] });
    }

    if (b.action === "set") {
      if (!b.contact_id) return res.status(400).json({ error: "contact_id required" });
      // Idempotent set = delete any existing mute for this (contact, agent-or-global)
      // then insert. We can't use PostgREST on_conflict here: the unique index is on
      // the expression coalesce(agent,'*'), which on_conflict can't target by column.
      const row = { client_id: clientId, ghl_contact_id: String(b.contact_id), agent, reason: (b.reason || "").toString().slice(0, 300) || null, created_by: staffEmail || "staff" };
      const agentFilter = agent === null ? "&agent=is.null" : `&agent=eq.${encodeURIComponent(agent)}`;
      await sb(`agent_mutes?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(b.contact_id)}${agentFilter}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      await sb(`agent_mutes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([row]) });
      // A global mute also pulls the lead out of any running automation sequence.
      if (agent === null) { try { await exitEnrollment({ clientId, contactId: String(b.contact_id), reason: "muted" }); } catch (_) {} }
      return res.status(200).json({ ok: true, muted: true, agent });
    }

    if (b.action === "clear") {
      if (!b.contact_id) return res.status(400).json({ error: "contact_id required" });
      let path = `agent_mutes?client_id=eq.${clientId}&ghl_contact_id=eq.${encodeURIComponent(b.contact_id)}`;
      path += agent === null ? `&agent=is.null` : `&agent=eq.${encodeURIComponent(agent)}`;
      await sb(path, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return res.status(200).json({ ok: true, cleared: true, agent });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[agent-mutes]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
