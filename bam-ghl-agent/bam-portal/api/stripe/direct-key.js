import { withSentryApiRoute } from "../_sentry.js";
import { encryptSecret } from "../_stripe-direct-crypto.js";
import { stripeFetch, bustTransportCache, readAccountHealth } from "../_stripe-transport.js";
import { ensureAcademyWebhook } from "./ensure-academy-webhook.js";

// Vercel Serverless Function - staff entry point for a DIRECT-KEY academy's
// Stripe credentials (platform-locked accounts, e.g. CoachIQ, where Connect
// OAuth is impossible). The academy owner creates a RESTRICTED key (rk_live_)
// in their own Stripe dashboard; staff paste it here. Everything downstream
// keeps calling api/_stripe-transport.js with stripeAccount as always - the
// resolver is what starts routing to this key.
//
// POST /api/stripe/direct-key   { action, client_id, ... }
//   probe    { secret_key, publishable_key? }  dry run, writes NOTHING
//   save     { secret_key, publishable_key }   probe + persist + webhook
//   disable  {}                                key off, academy back to Connect
//   status   {}                                row minus secrets + health
//
// The pasted key is never logged, never audited, never echoed back. Only its
// last 4 characters are stored in the clear.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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

async function resolveStaff(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("auth required"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,name&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name&limit=1`);
  }
  if (!Array.isArray(staff) || !staff[0]) throw Object.assign(new Error("BAM staff only"), { status: 403 });
  return { user, staff: staff[0] };
}

const nowIso = () => new Date().toISOString();
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

async function writeAudit({ client_id, action_type, args, performed_by, performed_by_name }) {
  try {
    await sb("member_audit_log", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        client_id,
        member_id: null,
        action_type,
        args: args || null,
        performed_by: performed_by || null,
        performed_by_name: performed_by_name || null,
      }]),
    });
  } catch (e) {
    console.error("member_audit_log write failed:", e.message);
  }
}

// ── the probe: what can this key actually do? ───────────────────────────────
// Writes NOTHING. Validates the key shape, reads the account, then best-effort
// tests each permission the member-management system leans on. Every probe is
// an independent true/false; a key missing one still saves (the capability map
// is stored so the UI can say exactly what will not work).
async function probeKey(secretKey, publishableKey) {
  const k = String(secretKey || "").trim();
  if (!k) throw bad("secret_key required");
  if (k.startsWith("sk_")) throw bad("paste a RESTRICTED key, never the full secret key");
  if (k.startsWith("rk_test_")) throw bad("that is a TEST-mode restricted key - paste the rk_live_ key");
  if (!k.startsWith("rk_live_")) throw bad("expected a live restricted key starting rk_live_");

  const pk = publishableKey == null ? null : String(publishableKey).trim();
  if (pk && !pk.startsWith("pk_live_")) throw bad("publishable_key must start with pk_live_");

  let account;
  try {
    account = await stripeFetch("/account", { keyOverride: k });
  } catch (e) {
    if (e.stripeStatus === 401 || e.stripeStatus === 403) {
      throw bad("this key cannot read its own account - recreate the key with Account read permission");
    }
    throw e;
  }

  const capabilities = {};
  // THREE outcomes per probe, never two. `false` may ONLY mean "Stripe said no"
  // (401/403). Could-not-ask - a network failure (no stripeStatus on the error)
  // or a Stripe 5xx - ABORTS the whole probe instead: this map is persisted on
  // save and served forever via getCapabilities, so a timeout recorded as
  // "cannot do payouts" would gate features off a fact nobody ever established.
  // A partial or guessed map is worse than a retry.
  const classify = (e, name) => {
    if (e.stripeStatus === 401 || e.stripeStatus === 403) return false;
    if (!e.stripeStatus || e.stripeStatus >= 500) {
      throw bad(`could not reach Stripe to test permissions (${name}) - try again`, 502);
    }
    // Any other 4xx got PAST the permission gate before failing on the request
    // itself, so the permission is present.
    return true;
  };
  const reads = [
    ["customers", "/customers?limit=1"],
    ["subscriptions", "/subscriptions?limit=1"],
    ["prices", "/prices?limit=1"],
    ["invoices", "/invoices?limit=1"],
    ["customer_search", `/customers/search?query=${encodeURIComponent('email:"probe@example.com"')}`],
    ["payouts", "/payouts?limit=1"],
  ];
  for (const [name, path] of reads) {
    try {
      await stripeFetch(path, { keyOverride: k });
      capabilities[name] = true;
    } catch (e) {
      capabilities[name] = classify(e, name);
    }
  }
  // THE 400-MEANS-YES TRICK: a key WITHOUT billing-portal permission is stopped
  // at the door with a 403 before Stripe ever looks at the body. A key WITH the
  // permission gets far enough for Stripe to complain that cus_probe_nonexistent
  // does not exist - HTTP 400. So 400 = permission PRESENT, 403 = absent, and no
  // billing portal session is ever actually created. Anything else is
  // could-not-ask and aborts, same as the reads.
  try {
    await stripeFetch("/billing_portal/sessions", { method: "POST", body: { customer: "cus_probe_nonexistent" }, keyOverride: k });
    capabilities.billing_portal = true; // cannot happen with a nonexistent customer, but a success is a yes
  } catch (e) {
    capabilities.billing_portal = e.stripeStatus === 400 ? true : classify(e, "billing_portal");
  }

  return {
    account_id: account.id,
    charges_enabled: account.charges_enabled === true,
    details_submitted: account.details_submitted === true,
    capabilities,
    key_last4: k.slice(-4),
  };
}

const ROW_SELECT = "client_id,status,secret_key_last4,publishable_key,livemode,stripe_account_id,capabilities,key_last_verified_at,created_by_name,created_at,updated_at";
const WEBHOOK_SELECT = "client_id,endpoint_id,enabled_events,registered_at,last_verified_at";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  try {
    const { user, staff } = await resolveStaff(req);
    const { action, client_id } = req.body || {};
    if (!client_id) throw bad("client_id required");

    if (action === "probe") {
      const report = await probeKey(req.body.secret_key, req.body.publishable_key);
      return res.status(200).json({ ok: true, ...report });
    }

    if (action === "save") {
      const pk = String(req.body.publishable_key || "").trim();
      if (!pk || !pk.startsWith("pk_live_")) {
        throw bad("publishable_key (pk_live_...) is required to save - the checkout cannot mount Stripe.js without it");
      }
      const report = await probeKey(req.body.secret_key, pk);

      // Idempotency keys are ACCOUNT-scoped: re-pointing an academy at a
      // different Stripe account under the same client_id would replay old
      // idempotency keys against a stranger's account. No force flag on purpose
      // - clearing clients.stripe_connect_account_id first is the deliberate,
      // visible step that says "yes, this academy changed Stripe accounts".
      const clientRows = await sb(`clients?id=eq.${encodeURIComponent(client_id)}&select=id,stripe_connect_account_id&limit=1`);
      const client = Array.isArray(clientRows) && clientRows[0] ? clientRows[0] : null;
      if (!client) throw bad("academy not found", 404);
      // Trimmed on both sides: a stored id with whitespace drift (the classic
      // trailing-\n from a bad env pipe) is still the SAME account and must not
      // false-409, while a genuinely different account must never slip past on
      // a formatting difference.
      const storedAcct = String(client.stripe_connect_account_id || "").trim();
      if (storedAcct && storedAcct !== String(report.account_id || "").trim()) {
        throw bad(
          `this key belongs to ${report.account_id}, but the academy is already tied to ${storedAcct}. ` +
          "Refusing to switch Stripe accounts through a key save.",
          409
        );
      }

      await sb(`client_stripe_direct?on_conflict=client_id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{
          client_id,
          status: "active",
          secret_key_enc: encryptSecret(String(req.body.secret_key).trim()),
          secret_key_last4: report.key_last4,
          publishable_key: pk,
          livemode: true, // rk_live_ enforced by the probe
          stripe_account_id: report.account_id,
          capabilities: report.capabilities,
          key_last_verified_at: nowIso(),
          created_by: user.id,
          created_by_name: staff.name || null,
          updated_at: nowIso(),
        }]),
      });

      // Mirror api/stripe/connect.js exactly: 'connected' + connected_at only
      // once Stripe says the account can actually charge.
      const chargeable = report.charges_enabled === true;
      await sb(`clients?id=eq.${encodeURIComponent(client_id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          ...(storedAcct ? {} : { stripe_connect_account_id: report.account_id }),
          stripe_connect_status: chargeable ? "connected" : "onboarding",
          stripe_connect_connected_at: chargeable ? nowIso() : null,
          updated_at: nowIso(),
        }),
      });

      await writeAudit({
        client_id,
        action_type: "stripe-direct-key-save",
        args: { account: report.account_id, key_last4: report.key_last4, capabilities: report.capabilities },
        performed_by: staff.id,
        performed_by_name: staff.name || null,
      });

      bustTransportCache();

      // Webhook registration failure is REPORTED, never thrown away, and never
      // undoes the save - staff can re-run it from the card.
      let webhook;
      try {
        webhook = await ensureAcademyWebhook({ clientId: client_id });
      } catch (e) {
        webhook = { ok: false, error: e.message || String(e) };
      }

      return res.status(200).json({ ok: true, ...report, webhook });
    }

    if (action === "disable") {
      await sb(`client_stripe_direct?client_id=eq.${encodeURIComponent(client_id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "disabled", updated_at: nowIso() }),
      });
      await writeAudit({
        client_id,
        action_type: "stripe-direct-key-disable",
        args: { note: "direct key switched off by staff - academy routes via Connect again" },
        performed_by: staff.id,
        performed_by_name: staff.name || null,
      });
      bustTransportCache();
      return res.status(200).json({ ok: true });
    }

    if (action === "status") {
      const rows = await sb(`client_stripe_direct?client_id=eq.${encodeURIComponent(client_id)}&select=${ROW_SELECT}&limit=1`);
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      const whRows = await sb(`stripe_academy_webhooks?client_id=eq.${encodeURIComponent(client_id)}&select=${WEBHOOK_SELECT}&limit=1`);
      const webhook = Array.isArray(whRows) && whRows[0] ? whRows[0] : null;
      // Health over whichever transport the resolver would actually use (this
      // also stamps key_last_verified_at / self-heals an invalid key).
      let health = null;
      try { health = await readAccountHealth(client_id); } catch (e) { health = { outcome: "unreachable", error: e.message }; }
      const transport = row && row.status === "active" ? `direct:${row.stripe_account_id}` : "connect";
      return res.status(200).json({ ok: true, transport, direct: row, webhook, health });
    }

    throw bad(`unknown action: ${action}`);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
