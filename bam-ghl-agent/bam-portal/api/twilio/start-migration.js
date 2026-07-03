import { withSentryApiRoute } from "../_sentry.js";
// Start a client's migration OFF GHL/LC Phone and onto the BAM master Twilio.
// This is the entry point of the pipeline the migration watcher finishes:
//
//   start-migration → pending config row → [staff submits the port] →
//   migration-watch cron sees the number land (+ A2P verify) → auto-cutover
//
//   POST /api/twilio/start-migration
//   body: {
//     client_id,            required
//     phone_number,         required - the E.164 number being ported (their LC number)
//     ring_number,          optional - staff/owner cell for inbound calls
//     a2p_required,         optional - default TRUE (US). Set false for CA/AU.
//     dry_run: true         optional - report the plan, create nothing
//   }
//
// What it does:
//   1. find-or-create the academy's subaccount under the master
//   2. upsert their client_twilio_config as status='pending' with voice
//      defaults + port_status='awaiting_submission' (the watcher's queue)
//   3. return the PORT SUBMISSION PACK - everything needed to click the
//      port-in through the Twilio console (target subaccount, number,
//      legal details we hold, and the step list). Port-ins need an
//      e-signed LOA + records matching the losing carrier, so submission
//      stays a human step for now; landing detection is automatic.
//
// A2P registration is a separate step (gated on TrustHub approval); it fills
// a2p_campaign_sid on the same pending row and the watcher takes it from there.
//
// Auth: Bearer CRON_SECRET or BAM staff JWT.

import { sb } from "./_voice.js";
import { encryptSecret } from "../messaging/_crypto.js";
import { masterAuth, findOrCreateSubaccount } from "./_master.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function isStaff(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return false;
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`).catch(() => null);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`).catch(() => null);
  }
  return Array.isArray(staff) && !!staff[0];
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const cronOk = process.env.CRON_SECRET && bearer === process.env.CRON_SECRET;
  if (!cronOk && !(await isStaff(req))) return res.status(401).json({ error: "unauthorized" });

  const auth = masterAuth();
  if (!auth) return res.status(500).json({ error: "master creds not configured" });
  const MASTER = process.env.TWILIO_MASTER_ACCOUNT_SID;
  if (!MASTER) return res.status(500).json({ error: "TWILIO_MASTER_ACCOUNT_SID not configured" });

  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const clientId = String(body.client_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return res.status(400).json({ error: "client_id must be a uuid" });
  const number = String(body.phone_number || "").trim();
  if (!/^\+\d{8,15}$/.test(number)) return res.status(400).json({ error: "phone_number must be E.164 (+1…)" });
  const ring = String(body.ring_number || "").trim();
  const a2pRequired = body.a2p_required !== false; // default true (US-heavy fleet)
  const dryRun = body.dry_run === true;

  const clients = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,legal_name,email&limit=1`);
  const client = clients && clients[0];
  if (!client) return res.status(404).json({ error: "unknown client_id" });

  // Never restart a live academy; re-running a pending one is fine (idempotent).
  const existing = await sb(
    `client_twilio_config?client_id=eq.${encodeURIComponent(clientId)}&select=status,from_number,account_sid,port_status&limit=1`
  ).catch(() => []);
  if (existing && existing[0] && existing[0].status === "active") {
    return res.status(409).json({ error: "client is already live on Twilio", number: existing[0].from_number });
  }

  const { sub, subName } = await findOrCreateSubaccount(auth, MASTER, client.business_name, { dryRun });

  if (!dryRun) {
    await sb(`client_twilio_config?on_conflict=client_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{
        client_id: clientId,
        account_sid: sub.sid,
        auth_token_enc: sub.auth_token ? encryptSecret(sub.auth_token) : null,
        from_number: number,
        status: "pending",                    // ← the watcher's queue
        port_status: "awaiting_submission",
        a2p_required: a2pRequired,
        auto_cutover: true,
        voice_enabled: true,
        voice_ring_numbers: ring ? [ring] : [],
        voice_record: false,
        voicemail_enabled: true,
        missed_call_text_enabled: true,
        notes: `migration started ${new Date().toISOString().slice(0, 10)} - porting ${number} from LC Phone`,
        updated_at: new Date().toISOString(),
      }]),
    });
  }

  // The pack that gets the port submitted (console wizard, ~5 min/client).
  return res.status(200).json({
    ok: true,
    dry_run: dryRun,
    client: client.business_name,
    pending_row: !dryRun,
    a2p_required: a2pRequired,
    port_submission_pack: {
      number_to_port: number,
      target_subaccount_sid: dryRun ? (sub ? sub.sid : `(would create: ${subName})`) : sub.sid,
      legal_name_on_file: client.legal_name || client.business_name,
      losing_carrier: "LC Phone (GoHighLevel's Twilio) - also request the port-out from GHL support",
      console_url: "https://console.twilio.com/us1/develop/phone-numbers/manage/port-in-request",
      steps: [
        "1. Switch the Twilio console into the target subaccount (account picker, top-left)",
        "2. Phone Numbers → Port in → new request for the number above",
        "3. Owner info must match GHL's records EXACTLY (legal name + service address from the audit)",
        "4. LOA e-sign request goes to the client from the wizard",
        "5. Open a GHL support ticket announcing the port-out for this number",
        "6. Done - the migration watcher detects the landing, wires webhooks, and cuts them over automatically",
      ],
    },
    watcher: "armed - checks every 30 min once the number lands" + (a2pRequired ? "; cutover ALSO waits for the A2P campaign to verify (register it after TrustHub approval)" : ""),
  });
}

export default withSentryApiRoute(handler);
