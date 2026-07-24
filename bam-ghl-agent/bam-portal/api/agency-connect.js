import { withSentryApiRoute } from "./_sentry.js";
import crypto from "node:crypto";
// ── Path B: GHL Agency (Company) connect + bulk sub-account token minting ──
// Uses the live FC app (GHL_OAUTH_CLIENT_ID) + the registered /api/messaging/connect redirect.
//
// BAM is the agency that owns every academy sub-account. Instead of connecting
// each one with its own OAuth, the agency owner authorizes ONCE at the company
// level; we store the Company token and mint a Location token per sub-account
// via /oauth/locationToken. Future academies connect with one click too.
//
//   GET /api/agency-connect?action=start   → redirect to GHL agency consent
//   GET /api/agency-connect?code=&state=   → callback: store company token,
//                                                 then mint a token for every
//                                                 sub-account, render results
//   GET /api/agency-connect?action=mint&key=<CRON_SECRET>            → re-mint all
//   GET /api/agency-connect?action=mint&scope=stale&key=<CRON_SECRET> → re-mint only
//                                                 tokens at or near expiry (hourly cron)
//
// Marketplace app must have Distribution = Agency (or Agency + Sub-Account) and
// this redirect URL registered: https://portal.byanymeansbusiness.com/api/agency-connect
//
// The minting/refresh mechanics live in ./ghl/_agency.js so the sync hot path can
// re-mint a token on demand without importing this HTTP handler.

import {
  sb, agencyCreds, assertCompanyToken, tokenClaims, getAgencyToken,
  mintAll, alertOnMintResults, slackAlert, reconnectHint,
} from "./ghl/_agency.js";

export const maxDuration = 60;

const GHL_AUTHORIZE_URL = "https://marketplace.gohighlevel.com/oauth/chooselocation";
const GHL_TOKEN_URL     = "https://services.leadconnectorhq.com/oauth/token";
const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Location tokens inherit these scopes (same set the per-location connect uses).
const SCOPES = [
  "locations.readonly", "users.readonly", "businesses.readonly", "contacts.readonly", "contacts.write",
  "conversations.readonly", "conversations.write", "conversations/message.readonly", "conversations/message.write",
  "opportunities.readonly", "opportunities.write",
  "calendars.readonly", "calendars.write", "calendars/events.readonly", "calendars/events.write",
  "calendars/groups.readonly", "calendars/groups.write",
  "forms.readonly", "workflows.readonly", "campaigns.readonly", "surveys.readonly",
  "locations/customFields.readonly", "locations/customFields.write",
  "locations/customValues.readonly", "locations/customValues.write",
  "locations/tags.readonly", "locations/tags.write",
  "locations/tasks.readonly", "locations/tasks.write", "locations/templates.readonly",
  "products.readonly", "products.write", "products/prices.readonly", "products/prices.write", "products/collection.readonly",
  "invoices.readonly", "invoices.write", "invoices/schedule.readonly", "invoices/schedule.write", "invoices/template.readonly",
  "payments/orders.readonly", "payments/orders.write", "payments/transactions.readonly", "payments/subscriptions.readonly",
  "payments/integration.readonly", "payments/coupons.readonly", "payments/coupons.write",
  "socialplanner/post.readonly", "socialplanner/post.write", "socialplanner/account.readonly", "socialplanner/oauth.readonly",
  "courses.readonly", "courses.write", "emails/builder.readonly", "emails/builder.write",
  "funnels/funnel.readonly", "funnels/page.readonly", "funnels/pagecount.readonly", "funnels/redirect.readonly",
  // REQUIRED for /oauth/locationToken — without oauth.write the agency token
  // can't mint sub-account tokens ("token is not authorized for this scope").
  "oauth.readonly", "oauth.write",
].join(" ");

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function getOrigin(req) {
  if (process.env.PORTAL_URL) return process.env.PORTAL_URL.replace(/\/+$/, "");
  const origin = req.headers.origin || `https://${req.headers.host || ""}`;
  if (/localhost|127\.0\.0\.1/.test(origin)) return origin.replace(/\/+$/, "");
  return "https://portal.byanymeansbusiness.com";
}
// The FC marketplace app only allows ONE redirect URL and it's already set to
// /api/messaging/connect — so the agency OAuth round-trips through THAT (it
// detects the agency-signed state and hands back here). Avoids needing to add a
// second redirect URL on a published app.
function redirectUri(req) { return `${getOrigin(req)}/api/messaging/connect`; }

function stateSecret() { return process.env.GHL_OAUTH_STATE_SECRET || SUPABASE_SERVICE_KEY; }
function signState(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", stateSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}
function verifyState(state) {
  if (typeof state !== "string" || !state.includes(".")) throw new Error("bad state");
  const [data, sig] = state.split(".");
  const expected = crypto.createHmac("sha256", stateSecret()).update(data).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("bad signature");
  const payload = JSON.parse(Buffer.from(data, "base64url").toString());
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) throw new Error("state expired");
  return payload;
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(title)}</title><style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;background:#0B0B0D;color:#EDEDED;margin:0;padding:32px}
    .wrap{max-width:640px;margin:0 auto}h1{font-size:20px}table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
    td{padding:6px 8px;border-bottom:1px solid #222}b{color:#E8C547}.muted{color:#888}</style></head>
    <body><div class="wrap"><h1>${esc(title)}</h1>${body}</div></body></html>`;
}

async function exchangeCode(code, redirect) {
  const { clientId, clientSecret } = agencyCreds();
  const r = await fetch(GHL_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code", code, user_type: "Company", redirect_uri: redirect,
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || `token exchange ${r.status}`);
  return j; // access_token, refresh_token, expires_in, companyId, userType
}

// Store the agency token, but ONLY if it really is a Company token.
//
// GHL returns a companyId even when the app was installed against a single
// sub-account, so "companyId came back" is not proof of an agency install. We
// learned this the hard way: a Location token sat in ghl_agency_tokens and every
// nightly re-mint failed 33/33 with a 200 OK for weeks, which silently expired
// half the academies one at a time.
async function storeAgencyToken(tok) {
  const companyId = tok.companyId || tok.company_id || null;
  if (!companyId) {
    throw new Error("No companyId in the OAuth response. Authorize at the AGENCY level (Distribution = Agency), not a single location.");
  }
  assertCompanyToken(tok.access_token); // throws with a fix-it message
  const expiresAt = tok.expires_in ? new Date(Date.now() + Number(tok.expires_in) * 1000).toISOString() : null;
  await sb(`ghl_agency_tokens?on_conflict=company_id`, {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      company_id: companyId, access_token: tok.access_token,
      refresh_token: tok.refresh_token || null, expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }),
  });
  return companyId;
}

function resultsPage(companyId, results) {
  const ok = results.filter(r => r.ok).length;
  const rows = results.map(r => `<tr><td>${r.ok ? "✅" : "❌"}</td><td>${esc(r.name)}</td><td class="muted">${r.ok ? "" : esc(r.err || "")}</td></tr>`).join("");
  return page("Agency connected ✓",
    `<p>Authorized agency <b>${esc(companyId)}</b>. Connected <b>${ok}/${results.length}</b> sub-accounts.</p>
     <table>${rows}</table>
     <p class="muted" style="margin-top:18px">Failures are usually sub-accounts not actually under this agency, or with no GHL location. You can close this tab.</p>`);
}

// Shared agency-callback logic, called from /api/messaging/connect when it sees
// an agency-signed state. Exchanges the code as a Company, stores the agency
// token, mints a location token for every academy, and returns the results HTML.
export async function agencyConnectFromCode(code, redirect) {
  const tok = await exchangeCode(code, redirect);
  const companyId = await storeAgencyToken(tok);
  const results = await mintAll(companyId, tok.access_token);
  await alertOnMintResults(results, { scope: "all" });
  return { companyId, results, html: resultsPage(companyId, results) };
}

async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).send("Supabase not configured");
  const action = (req.query.action || "").toString();

  // 1) Kick off the agency consent.
  if (action === "start") {
    const state = signState({ k: "agency", exp: Date.now() + 15 * 60 * 1000 });
    const params = new URLSearchParams({ client_id: agencyCreds().clientId, redirect_uri: redirectUri(req), scope: SCOPES, state });
    res.writeHead(302, { Location: `${GHL_AUTHORIZE_URL}?${params.toString()}` });
    return res.end();
  }

  // 3) Re-mint later (e.g. after adding academies) — gated by CRON_SECRET.
  // Accepts either ?key=<secret> (manual) or Authorization: Bearer <secret> (Vercel cron).
  if (action === "mint") {
    const expected = process.env.CRON_SECRET || "";
    const fromHeader = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const fromQuery  = (req.query.key || "").toString();
    const provided   = fromHeader || fromQuery;
    if (!expected || provided !== expected) return res.status(401).json({ error: "unauthorized" });

    const scope = (req.query.scope || "all").toString() === "stale" ? "stale" : "all";
    const t = await getAgencyToken();
    if (!t) {
      await slackAlert(`:rotating_light: GHL re-mint skipped: no agency token stored. Every academy stops syncing within 24h. Connect: ${reconnectHint()}`);
      return res.status(400).json({ error: "no agency token - authorize first via ?action=start" });
    }
    // Fail loudly rather than burning 30+ doomed mints and answering 200 OK.
    if (t.badAuthClass) {
      await slackAlert(
        `:rotating_light: The stored GHL agency token is a *${t.badAuthClass}* token, not a Company token, ` +
        `so it cannot mint sub-account tokens. Every academy stops syncing as its own token expires. ` +
        `Reconnect at the AGENCY level: ${reconnectHint()}`,
      );
      return res.status(409).json({
        error: `stored agency token has authClass=${t.badAuthClass}, expected Company`,
        fix: reconnectHint(),
      });
    }

    const results = await mintAll(t.company_id, t.access_token, { scope });
    await alertOnMintResults(results, { scope });
    const connected = results.filter(r => r.ok).length;
    console.log(`[agency-connect:mint] scope=${scope} connected=${connected}/${results.length}`);
    return res.status(200).json({ ok: true, scope, company_id: t.company_id, connected, total: results.length, results });
  }

  // 2) OAuth callback → store company token → mint all.
  if (req.query.code) {
    // State is best-effort CSRF protection for the ?action=start path. GHL's
    // own draft-app "Install link" doesn't carry our HMAC state, so we don't
    // hard-require it — this is a one-time owner-initiated agency install.
    if (req.query.state) { try { verifyState(req.query.state); } catch (_) { /* foreign/absent state (install-link flow) — allow */ } }
    try {
      const tok = await exchangeCode(req.query.code, redirectUri(req));
      const companyId = await storeAgencyToken(tok);
      const results = await mintAll(companyId, tok.access_token);
      await alertOnMintResults(results, { scope: "all" });
      return res.status(200).send(resultsPage(companyId, results));
    } catch (e) {
      return res.status(500).send(page("Couldn't connect", `<p>${esc(e.message || String(e))}</p>`));
    }
  }

  // Landing page doubles as a health check, so "is the agency token OK?" is one
  // click instead of a DB query.
  const t = await getAgencyToken().catch(() => null);
  const creds = agencyCreds();
  let status;
  if (!t) {
    status = `<p>❌ <b>No agency token stored.</b> Nothing can mint sub-account tokens.</p>`;
  } else if (t.badAuthClass) {
    status = `<p>❌ <b>Broken.</b> The stored token is a <b>${esc(t.badAuthClass)}</b> token, not a Company token,
      so <b>/oauth/locationToken</b> rejects it and no academy can be re-minted. Reconnect below and pick the
      <b>agency</b>, not a single sub-account.</p>`;
  } else {
    const claims = tokenClaims(t.access_token) || {};
    status = `<p>✅ <b>Healthy.</b> Company <b>${esc(t.company_id)}</b>, authClass <b>${esc(claims.authClass || "Company")}</b>,
      expires <span class="muted">${esc(t.expires_at || "unknown")}</span>.</p>`;
  }
  return res.status(200).send(page("BAM · GHL Agency Connect", `${status}
    <p class="muted">OAuth app: <b>${esc(creds.clientId.split("-")[0] || "not configured")}</b>
      ${creds.dedicated ? "(dedicated agency app)" : "(shared sub-account app - this app must have Distribution = Agency to mint location tokens)"}</p>
    <p style="margin-top:18px">Connect or reconnect: <a href="?action=start" style="color:#E8C547">?action=start</a></p>`));
}

export default withSentryApiRoute(handler);
