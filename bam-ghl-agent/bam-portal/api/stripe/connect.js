import { withSentryApiRoute } from "../_sentry.js";
// Vercel Serverless Function — Stripe Connect (Standard OAuth)
//
// Connects each academy's existing Stripe account to the BAM platform.
// Modeled on api/marketing.js handleStaffMetaAuth (Meta OAuth pattern).
//
// Standard Connect via OAuth: the academy clicks "Connect Stripe" on the
// client portal Members tab, logs into their existing Stripe account, and
// approves BAM as a platform. We store the connected-account id (acct_...)
// on the clients row. The portal then acts on their billing later via the
// platform key + `Stripe-Account: acct_XXX` header — no per-academy key
// is ever stored on our side.
//
//   POST /api/stripe/connect   body: { client_id }   → { redirect_url }
//   GET  /api/stripe/connect?code=...&state=...      → 302 back to portal
//
// Env vars:
//   STRIPE_CONNECT_SECRET_KEY    PLATFORM secret key (the account where Connect
//                                is enabled). Used as client_secret in the OAuth
//                                token exchange. Falls back to STRIPE_SECRET_KEY
//                                if unset — so when the platform & the legacy
//                                STRIPE_SECRET_KEY are the same account, no new
//                                var needed; when they're different (e.g. BAM
//                                Business platform vs BAM Toronto financials),
//                                set this explicitly to the platform key.
//   STRIPE_CONNECT_CLIENT_ID     OAuth client id from Stripe Connect settings
//                                (the ca_xxxxx string)
//   STRIPE_CONNECT_STATE_SECRET  HMAC secret for the state token
//   VITE_SUPABASE_URL / SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY

import crypto from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const STRIPE_AUTHORIZE_URL = "https://connect.stripe.com/oauth/authorize";
const STRIPE_TOKEN_URL = "https://connect.stripe.com/oauth/token";

// ─────────────────────────────────────────────────────────
// Helpers (kept consistent with api/marketing.js + api/members.js)
// ─────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function getOrigin(req) {
  // Pinned to the canonical CLIENT portal domain — Stripe Connect's
  // registered redirect URI must match exactly, and we don't want
  // *.vercel.app preview hostnames sneaking into the URI. CLIENTS run this
  // flow (Connect Stripe lives in the client portal), and clients must
  // never touch staff.byanymeansbusiness.com — the 2026-05 sweep pinned
  // this to STAFF_PORTAL_URL by mistake and Stripe rejected the staff URI
  // as unregistered (Nathan, 2026-06-11). Mirrors api/messaging/connect.js.
  const origin = req.headers.origin || `https://${req.headers.host || ""}`;
  if (/localhost|127\.0\.0\.1/.test(origin)) return origin.replace(/\/+$/, "");
  return "https://portal.byanymeansbusiness.com";
}

// The redirect URI registered in the Stripe Connect dashboard must match this.
function redirectUri(req) {
  return `${getOrigin(req)}/api/stripe/connect`;
}

function signState(payload) {
  const secret = process.env.STRIPE_CONNECT_STATE_SECRET || SUPABASE_SERVICE_KEY;
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyState(state) {
  if (typeof state !== "string" || !state.includes(".")) throw new Error("invalid state format");
  const [data, sig] = state.split(".");
  const secret = process.env.STRIPE_CONNECT_STATE_SECRET || SUPABASE_SERVICE_KEY;
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("bad signature");
  }
  const payload = JSON.parse(Buffer.from(data, "base64url").toString());
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) throw new Error("state expired");
  return payload;
}

// Can this connected account actually take a live payment right now?
// charges_enabled is Stripe's own answer to "will a charge on this account
// succeed". details_submitted alone is not enough (an account can submit and
// still be blocked), so we gate the onboarding tick on charges_enabled.
// On any error we return false: better to leave the step open than to tick it
// for an academy that cannot get paid.
async function canCharge(acctId, platformSecret) {
  try {
    const r = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(acctId)}`, {
      headers: { Authorization: `Bearer ${platformSecret}` },
    });
    const a = await r.json();
    if (!r.ok) return false;
    return a.charges_enabled === true;
  } catch (_) {
    return false;
  }
}

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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function resolveUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: { status: 401, message: "auth required" } };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: { status: 401, message: "invalid token" } };
  const user = await userRes.json();
  if (!user?.id) return { error: { status: 401, message: "invalid token" } };

  // Staff: try user_id, fall back to email (mirrors members.js).
  let staffRows = await sb(`staff?user_id=eq.${user.id}&select=id,name,role,email,user_id`);
  if ((!staffRows || !staffRows[0]) && user.email) {
    staffRows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role,email,user_id`);
  }
  const staffRow = Array.isArray(staffRows) && staffRows[0] ? staffRows[0] : null;

  // Multi-user model: academies via client_users.
  const memberships = await sb(
    `client_users?user_id=eq.${user.id}&status=eq.active&select=client_id,role`
  );
  const clientIds = Array.isArray(memberships)
    ? [...new Set(memberships.map(m => m.client_id).filter(Boolean))]
    : [];
  let clients = [];
  if (clientIds.length) {
    clients = await sb(
      `clients?id=in.(${clientIds.join(",")})&select=id,business_name,stripe_connect_account_id,stripe_connect_status`
    ) || [];
  }

  return { user, staff: staffRow, clients, memberships: memberships || [] };
}

// The browser hits the callback as a top-level navigation from Stripe — no
// Bearer header. Send it back to the Members tab with a status flag.
function redirectBack(res, status, msg) {
  const params = new URLSearchParams({ stripe_connect: status });
  if (msg) params.set("msg", String(msg).slice(0, 160));
  res.setHeader("Location", `/client-portal.html?${params.toString()}#members`);
  return res.status(302).end();
}

// ─────────────────────────────────────────────────────────
// Handler — method-based dispatch
//   POST = prepare (authenticated; returns the Stripe authorize URL)
//   GET  = callback (Stripe redirects the browser here with code + state)
// ─────────────────────────────────────────────────────────

async function handler(req, res) {
  if (req.method === "POST") return handlePrepare(req, res);
  if (req.method === "GET") return handleCallback(req, res);
  return res.status(405).json({ error: "method not allowed" });
}

// ── Step 1: prepare ───────────────────────────────────────
// Authenticated. Verifies the caller owns the target academy (or is staff),
// signs a state token, returns the Stripe OAuth authorize URL.
async function handlePrepare(req, res) {
  const ctx = await resolveUser(req);
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";
  if (!clientId) return res.status(400).json({ error: "client_id required" });

  const isStaff = !!ctx.staff;
  const owns = (ctx.clients || []).some(c => c.id === clientId);
  if (!isStaff && !owns) return res.status(403).json({ error: "not your academy" });

  const stripeClientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!stripeClientId) {
    return res.status(500).json({ error: "STRIPE_CONNECT_CLIENT_ID not configured" });
  }

  // State carries client_id — the security anchor for the unauthenticated
  // callback. HMAC-signed + expiry + nonce. Mirrors metaSignState.
  const state = signState({
    client_id: clientId,
    user_id: ctx.user.id,
    exp: Date.now() + 10 * 60 * 1000,  // 10 min — Stripe consent can take longer than 5
    nonce: crypto.randomBytes(8).toString("hex"),
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: stripeClientId,
    scope: "read_write",                 // required for later billing writes (Phase 3 actions)
    redirect_uri: redirectUri(req),
    state,
  });

  // Surface "onboarding" status so the UI can show "Finishing setup…" if the
  // user bounces away mid-flow.
  try {
    await sb(`clients?id=eq.${encodeURIComponent(clientId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        stripe_connect_status: "onboarding",
        updated_at: nowIso(),
      }),
    });
  } catch (_) { /* non-fatal: continue */ }

  return res.status(200).json({
    redirect_url: `${STRIPE_AUTHORIZE_URL}?${params.toString()}`,
  });
}

// ── Step 2: callback ──────────────────────────────────────
// Stripe redirects the browser here with ?code=...&state=... (or ?error=...).
// No Bearer header — security is the HMAC-signed state.
async function handleCallback(req, res) {
  const { code, state, error: stripeError, error_description } = req.query;
  if (stripeError) {
    return redirectBack(res, "error", error_description || String(stripeError));
  }
  if (!code || !state) {
    return redirectBack(res, "error", "missing code or state");
  }

  let payload;
  try { payload = verifyState(state); }
  catch (e) { return redirectBack(res, "error", `state: ${e.message}`); }
  if (!payload.client_id) return redirectBack(res, "error", "state missing client_id");

  // Use the platform secret key for token exchange. Falls back to the legacy
  // STRIPE_SECRET_KEY if STRIPE_CONNECT_SECRET_KEY isn't set.
  const stripeSecret = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) return redirectBack(res, "error", "STRIPE_CONNECT_SECRET_KEY (or STRIPE_SECRET_KEY) not configured");

  // Exchange code for the connected-account id (`stripe_user_id` = acct_...).
  // (canCharge is defined below - it asks Stripe whether this account can really
  // take a live payment before we call the connection "done".)
  // For Standard accounts we don't store the returned `access_token` — we use
  // the platform key + `Stripe-Account: acct_...` header for all later writes.
  let tok;
  try {
    const tokenRes = await fetch(STRIPE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_secret: stripeSecret,
      }),
    });
    tok = await tokenRes.json();
    if (!tokenRes.ok || !tok?.stripe_user_id) {
      return redirectBack(res, "error", tok?.error_description || tok?.error || "token exchange failed");
    }
  } catch (e) {
    return redirectBack(res, "error", `token exchange: ${e.message}`);
  }

  const acctId = tok.stripe_user_id;

  // Finishing the OAuth handshake is NOT the same as being able to take money.
  // An academy can authorise us while their Stripe account still has outstanding
  // requirements, in which case charges are disabled and a live checkout would
  // fail. `stripe_connect_connected_at` is what ticks the "Connect your Stripe
  // account" onboarding step, so we only stamp it once Stripe says the account
  // can actually charge. Otherwise we store the account and leave them on
  // "onboarding" - the step stays open until they finish in Stripe.
  const chargeable = await canCharge(acctId, stripeSecret);

  try {
    await sb(`clients?id=eq.${encodeURIComponent(payload.client_id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        stripe_connect_account_id: acctId,
        stripe_connect_status: chargeable ? "connected" : "onboarding",
        stripe_connect_connected_at: chargeable ? nowIso() : null,
        updated_at: nowIso(),
      }),
    });
  } catch (e) {
    return redirectBack(res, "error", `db write: ${e.message}`);
  }

  if (!chargeable) {
    return redirectBack(res, "error", "Stripe connected, but it cannot accept payments yet. Finish the remaining steps in Stripe, then reconnect.");
  }
  return redirectBack(res, "connected");
}

export default withSentryApiRoute(handler);
