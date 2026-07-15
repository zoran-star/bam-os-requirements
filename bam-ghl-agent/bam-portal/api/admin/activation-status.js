import { withSentryApiRoute } from "../_sentry.js";

// Staff Activation checklist - the STAFF half of onboarding an academy to the
// GTA V2 state (accepted design 2026-07-14). One call answers "what's left to
// activate this academy": tier, Slack, invite, phone spine, website/ads, and
// the GHL migration ladder (connect → contacts → preset → cards → flip).
//
//   GET /api/admin/activation-status?client_id=
//     → { ok, items: {...}, ghl_migration: {...} }
//
// Read-only. Auth: BAM staff only (this is the staff client view's Activation tab).

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
const count = (rows) => Array.isArray(rows) ? rows.length : 0;

async function requireStaff(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${enc(user.email)}&select=id&limit=1`);
  if (!(Array.isArray(staff) && staff[0])) throw Object.assign(new Error("staff only"), { status: 403 });
}

async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
    const clientId = req.query.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    await requireStaff(req);

    const cRows = await sb(`clients?id=eq.${enc(clientId)}&select=v2_access,v15_access,slack_channel_id,ghl_location_id,messaging_provider,pipeline_provider,contact_provider,booking_provider,stripe_connect_status,website_setup,meta_ad_account_id,ads_connected_at&limit=1`);
    const c = (Array.isArray(cRows) && cRows[0]) || {};

    const [twilioRows, users, contacts, offers, stages, oppRows] = await Promise.all([
      sb(`client_twilio_config?client_id=eq.${enc(clientId)}&select=status,port_status,a2p_status,a2p_required,from_number&limit=1`),
      sb(`client_users?client_id=eq.${enc(clientId)}&status=eq.active&select=id,user_id&limit=50`),
      sb(`contacts?client_id=eq.${enc(clientId)}&select=id&limit=1000`),
      sb(`offers?client_id=eq.${enc(clientId)}&type=eq.training&select=id,data,status&order=updated_at.desc&limit=5`),
      sb(`pipeline_stages?client_id=eq.${enc(clientId)}&select=role&limit=20`),
      sb(`opportunities?client_id=eq.${enc(clientId)}&select=id&limit=1000`),
    ]);
    const tw = (Array.isArray(twilioRows) && twilioRows[0]) || null;
    const offer = (offers || []).find(o => o.status === "published") || (offers || [])[0] || null;
    const preset = offer && offer.data && offer.data.sales && offer.data.sales.preset_key
      ? { key: offer.data.sales.preset_key, version: offer.data.sales.preset_version || 1 }
      : null;

    return res.status(200).json({
      ok: true,
      items: {
        tier: c.v2_access ? "v2" : (c.v15_access ? "v1.5" : "v1"),
        slack_wired: !!c.slack_channel_id,
        invites_active: count(users),
        website_live: !!(c.website_setup && c.website_setup.status === "live"),
        website_build: c.website_setup ? {
          build_status: c.website_setup.build_status || null,
          staging_url: c.website_setup.staging_url || null,
          auto_ok: !!(c.website_setup.readiness && c.website_setup.readiness.auto && c.website_setup.readiness.auto.ok),
          manual: (c.website_setup.readiness && c.website_setup.readiness.manual) || {},
        } : null,
        meta_connected: !!(c.meta_ad_account_id || c.ads_connected_at),
        stripe_connected: c.stripe_connect_status === "connected",
        booking_provider: c.booking_provider || "ghl",
        phone: tw ? {
          status: tw.status, port_status: tw.port_status, a2p_status: tw.a2p_status,
          a2p_required: tw.a2p_required, from_number: tw.from_number,
          messaging_provider: c.messaging_provider || "ghl",
        } : { status: "none", messaging_provider: c.messaging_provider || "ghl" },
      },
      // The GHL migration ladder: apply the ONE preset every academy runs, then
      // sort their cards into it (the /ghl-pipeline-import runbook drives 3-5).
      ghl_migration: {
        has_ghl: !!c.ghl_location_id,
        ghl_connected: !!c.ghl_location_id,
        contacts_landed: count(contacts),
        preset_applied: !!preset || count(stages) > 0,
        preset,
        opportunities_in_store: count(oppRows),
        pipeline_provider: c.pipeline_provider || "ghl",
        flipped: (c.pipeline_provider || "ghl") === "portal",
      },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
