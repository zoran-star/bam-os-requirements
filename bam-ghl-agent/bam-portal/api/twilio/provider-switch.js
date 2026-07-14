import { withSentryApiRoute } from "../_sentry.js";

// Staff-side "Texting & calling: Twilio | GHL" switch (V2).
//
//   GET  /api/twilio/provider-switch?client_id=
//     → { ok, messaging_provider, has_twilio, from_number, twilio_status,
//         port_status, a2p_required, a2p_status, voice_enabled, can_go_twilio, blockers:[...] }
//   POST /api/twilio/provider-switch   body { client_id, provider: "twilio"|"ghl" }
//     → { ok, messaging_provider }
//
// Semantics: ONE switch for both channels.
//   → twilio: manual cutover. Requires a client_twilio_config with a from_number
//     whose port has landed (or was bought new) and A2P verified when required -
//     i.e. only when texting can actually deliver. Sets messaging_provider='twilio',
//     config.status='active' (the resolver requires it), voice_enabled=true.
//     Every SMS send site already routes through maybeSendSmsViaProvider, so the
//     flip reroutes texting everywhere instantly; call buttons upgrade via
//     voice_enabled.
//   → ghl: escape hatch back to GHL transport. Sets messaging_provider='ghl' and
//     voice_enabled=false (call buttons fall back to "Call in GHL"). The Twilio
//     config row is left otherwise intact so flipping forward again is instant.
//
// Staff-only: this is transport routing for a live academy - owners never see it.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const enc = encodeURIComponent;

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
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${enc(user.email)}&select=id&limit=1`);
  if (!(Array.isArray(staff) && staff[0])) throw Object.assign(new Error("staff only"), { status: 403 });
  return user;
}

function twilioBlockers(cfg) {
  const blockers = [];
  if (!cfg) { blockers.push("No Twilio number set up yet - port their GHL number or buy a new one first."); return blockers; }
  if (!cfg.from_number) blockers.push("The Twilio config has no from_number yet.");
  if (cfg.port_status && cfg.port_status !== "landed") blockers.push(`Number port hasn't landed yet (${cfg.port_status}).`);
  if (cfg.a2p_required && cfg.a2p_status !== "verified") blockers.push(`A2P texting registration isn't verified yet (${cfg.a2p_status || "not started"}).`);
  return blockers;
}

async function handler(req, res) {
  try {
    const q = req.query || {};
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = q.client_id || b.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    await requireStaff(req);

    const clients = await sb(`clients?id=eq.${enc(clientId)}&select=id,messaging_provider&limit=1`);
    const client = Array.isArray(clients) && clients[0];
    if (!client) return res.status(404).json({ error: "academy not found" });
    const cfgs = await sb(`client_twilio_config?client_id=eq.${enc(clientId)}&select=id,from_number,status,port_status,a2p_required,a2p_status,voice_enabled&limit=1`);
    const cfg = Array.isArray(cfgs) && cfgs[0];
    const blockers = twilioBlockers(cfg);

    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        messaging_provider: client.messaging_provider || "ghl",
        has_twilio: !!cfg,
        from_number: cfg ? cfg.from_number : null,
        twilio_status: cfg ? cfg.status : null,
        port_status: cfg ? cfg.port_status : null,
        a2p_required: cfg ? !!cfg.a2p_required : false,
        a2p_status: cfg ? cfg.a2p_status : null,
        voice_enabled: cfg ? !!cfg.voice_enabled : false,
        can_go_twilio: blockers.length === 0,
        blockers,
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST required" });
    const provider = b.provider;
    if (provider !== "twilio" && provider !== "ghl") return res.status(400).json({ error: "provider must be 'twilio' or 'ghl'" });

    if (provider === "twilio") {
      if (blockers.length) return res.status(409).json({ error: "Twilio isn't ready for this academy yet", blockers });
      await sb(`clients?id=eq.${enc(clientId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ messaging_provider: "twilio" }) });
      await sb(`client_twilio_config?id=eq.${enc(cfg.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "active", voice_enabled: true, updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true, messaging_provider: "twilio" });
    }

    // → ghl: route texting back through GHL; call buttons fall back to GHL too.
    await sb(`clients?id=eq.${enc(clientId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ messaging_provider: "ghl" }) });
    if (cfg) await sb(`client_twilio_config?id=eq.${enc(cfg.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ voice_enabled: false, updated_at: new Date().toISOString() }) });
    return res.status(200).json({ ok: true, messaging_provider: "ghl" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
