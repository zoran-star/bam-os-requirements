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
  // email is selected so the save's actor chain has something REAL to fall back
  // to when the cosmetic name field is empty - a fallback to a column nobody
  // asked for is a fallback that never fires.
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id,name,email&limit=1`);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,email&limit=1`);
  }
  if (!Array.isArray(staff) || !staff[0]) throw Object.assign(new Error("BAM staff only"), { status: 403 });
  return { user, staff: staff[0] };
}

const nowIso = () => new Date().toISOString();
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

// ── who is acting: ONE resolution, used by every branch that writes audit ────
// IDENTIFIABILITY, not a name check. `name` is a cosmetic column; an empty or
// whitespace-only one must never block a staff member from touching a payment
// credential, and it must never land a nameless row in the audit either.
//
// Every link is TRIMMED BEFORE it counts, which is what makes the invariant
// true rather than merely claimed: "   " is truthy, so an untrimmed `||` chain
// would short-circuit on it and hand back a blank actor. The tail is the staff
// id, a value that exists for every row that got past resolveStaff, so this
// function cannot return an empty string.
const actorName = (staff, user) =>
  String((staff && staff.name) || "").trim()
  || String((staff && staff.email) || "").trim()
  || String((user && user.email) || "").trim()
  || `staff:${staff.id}`;

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
// Writes NOTHING. Validates the key shape, reads the account, then tests each
// permission the member-management system leans on. A permission Stripe DENIES
// (401/403) records as false and the key still saves - the capability map is
// stored so the UI can say exactly what will not work. But a probe that could
// not get an answer (network, 429, 5xx) ABORTS the whole run with a 502: only
// established facts may enter the map.
export async function probeKey(secretKey, publishableKey) {
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
    // 429 is could-not-ask too: rate limiting says nothing about permissions.
    if (!e.stripeStatus || e.stripeStatus === 429 || e.stripeStatus >= 500) {
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

// ── the save: probe, persist, register the webhook ──────────────────────────
// ONE implementation, two callers: the HTTP route below and a CLI. It never
// touches req/res, so a chat/CLI can save a platform-locked academy's key
// without a browser. Errors are thrown with a .status the caller maps (the HTTP
// route to a status code, a CLI to an exit code).
//
// ACTOR DISCIPLINE. performedByName is REQUIRED - the goal is IDENTIFIABILITY,
// never a null actor in the audit row, and this function never invents a staff
// identity to fill the gap. It is NOT a name check standing between a staff
// member and a payment credential: the HTTP route resolves the first thing that
// identifies the signed-in human (name, then email, then the staff id - see the
// save branch), a chain that cannot come out empty for a real staff row. So the
// throw below only ever fires on the CLI path, where an omitted actor is a
// genuine caller bug.
//
// TWO IDS ON PURPOSE, not an oversight: performedBy is member_audit_log
// .performed_by and createdBy is client_stripe_direct.created_by. Both columns
// are uuid, but they hold DIFFERENT id spaces - the route passes the STAFF
// row's id for the first and the AUTH user's id for the second, exactly as this
// code did before it was extracted. One shared parameter would put a staff id
// in a column everything else joins as an auth id. Either may be null (a CLI
// has neither); the NAME is what makes the row answerable.
export async function saveDirectKey({
  clientId,
  secretKey,
  publishableKey,
  performedBy = null,
  performedByName,
  createdBy = null,
}) {
  if (!clientId) throw bad("client_id required");
  const actor = String(performedByName || "").trim();
  if (!actor) throw bad("performedByName required");

  const pk = String(publishableKey || "").trim();
  if (!pk || !pk.startsWith("pk_live_")) {
    throw bad("publishable_key (pk_live_...) is required to save - the checkout cannot mount Stripe.js without it");
  }
  const report = await probeKey(secretKey, pk);

  // Idempotency keys are ACCOUNT-scoped: re-pointing an academy at a
  // different Stripe account under the same client_id would replay old
  // idempotency keys against a stranger's account. No force flag on purpose
  // - clearing clients.stripe_connect_account_id first is the deliberate,
  // visible step that says "yes, this academy changed Stripe accounts".
  const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=id,stripe_connect_account_id&limit=1`);
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

  // ONE STRIPE ACCOUNT, ONE ACADEMY. The upsert below keys on client_id, but
  // client_stripe_direct carries a UNIQUE index on stripe_account_id, so an
  // account already saved under ANOTHER academy makes that upsert violate the
  // index. PostgREST answers 409 and sb() rethrows it as a raw
  // "Supabase 409: ..." with NO .status - which surfaces as a 500 full of
  // Postgres to staff and as a crash to a CLI, AFTER the probe has already hit
  // live Stripe, and in neither case does anyone get told the actual problem.
  // So ask first and say it in a sentence someone can act on. Trim-compared on
  // both sides, same discipline as the stored-account check above: an academy
  // re-saving its OWN account id must stay idempotent.
  const acctId = String(report.account_id || "").trim();
  const claimRows = await sb(`client_stripe_direct?stripe_account_id=eq.${encodeURIComponent(acctId)}&select=client_id&limit=1`);
  const claimedBy = Array.isArray(claimRows) && claimRows[0] ? String(claimRows[0].client_id || "").trim() : "";
  if (claimedBy && claimedBy !== String(clientId).trim()) {
    // NAME THE OTHER ACADEMY. "already saved under BAM Whatever" is something an
    // operator can act on; a uuid is not. But the lookup is BEST EFFORT and the
    // throw is computed OUTSIDE the try on purpose: if this select fails or
    // comes back empty we still refuse, just less helpfully. A failure to look
    // up a name must never become a failure to refuse - that would turn a
    // nice-to-have into a hole that lets a colliding save through.
    let claimedName = "";
    try {
      const owner = await sb(`clients?id=eq.${encodeURIComponent(claimedBy)}&select=business_name&limit=1`);
      claimedName = Array.isArray(owner) && owner[0] ? String(owner[0].business_name || "").trim() : "";
    } catch (e) {
      claimedName = "";
    }
    throw bad(
      claimedName
        ? `that Stripe account (${acctId}) is already saved under "${claimedName}" - remove it there first`
        : `that Stripe account (${acctId}) is already saved under another academy (client_id ${claimedBy}) - remove it there first`,
      409
    );
  }

  await sb(`client_stripe_direct?on_conflict=client_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      client_id: clientId,
      status: "active",
      secret_key_enc: encryptSecret(String(secretKey).trim()),
      secret_key_last4: report.key_last4,
      publishable_key: pk,
      livemode: true, // rk_live_ enforced by the probe
      stripe_account_id: report.account_id,
      capabilities: report.capabilities,
      key_last_verified_at: nowIso(),
      created_by: createdBy,
      created_by_name: actor,
      updated_at: nowIso(),
    }]),
  });

  // Mirror api/stripe/connect.js exactly: 'connected' + connected_at only
  // once Stripe says the account can actually charge.
  const chargeable = report.charges_enabled === true;
  await sb(`clients?id=eq.${encodeURIComponent(clientId)}`, {
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
    client_id: clientId,
    action_type: "stripe-direct-key-save",
    args: { account: report.account_id, key_last4: report.key_last4, capabilities: report.capabilities },
    performed_by: performedBy,
    performed_by_name: actor,
  });

  bustTransportCache();

  // Webhook registration failure is REPORTED, never thrown away, and never
  // undoes the save - staff can re-run it from the card.
  let webhook;
  try {
    webhook = await ensureAcademyWebhook({ clientId });
  } catch (e) {
    webhook = { ok: false, error: e.message || String(e) };
  }

  return { ok: true, ...report, webhook };
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
      // Thin caller. The save lives in saveDirectKey above so a CLI can run the
      // exact same code path - re-inlining it here forks the money path.
      //
      // The actor is resolved by actorName() - the same one the disable branch
      // uses, so the two can never drift into different rules about who counts
      // as identifiable.
      const payload = await saveDirectKey({
        clientId: client_id,
        secretKey: req.body.secret_key,
        publishableKey: req.body.publishable_key,
        performedBy: staff.id,
        performedByName: actorName(staff, user),
        createdBy: user.id,
      });
      return res.status(200).json(payload);
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
        // Same resolution as the save. Switching a live academy's payment
        // transport off is exactly as answerable as switching it on, so it may
        // not land nameless either.
        performed_by_name: actorName(staff, user),
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
