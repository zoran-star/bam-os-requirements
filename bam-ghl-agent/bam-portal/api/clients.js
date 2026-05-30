// Vercel Serverless Function — Clients (Supabase clients table + live Stripe revenue)
// GET /api/clients               → list all clients
// GET /api/clients?id=<uuid>     → single client

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_API = "https://api.stripe.com/v1";

// Identity gate for feedback-management actions (list-feedback,
// resolve-feedback). Only this email can see / check off feedback.
const ZORAN_EMAIL = "zoran@byanymeansbball.com";

// In-memory cache for Stripe revenue (keyed by stripe_customer_id, 60s TTL)
const revenueCache = new Map();
const REVENUE_TTL_MS = 60 * 1000;

async function supabaseSelect(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// Update an auth user's email via the admin API. Without this, edits
// to clients.email or staff.email leave the auth login email stale —
// the user keeps logging in with the old address. Uses email_confirm:
// true so the change is immediate (staff is doing this on the user's
// behalf, no point bouncing through a confirmation email).
//
// Returns { ok: true } on success, { ok: false, error, status } on
// failure. Callers should treat the auth update as best-effort: if it
// fails (e.g. email already taken by a different auth user), surface
// the error so the caller knows the local row + auth drifted.
async function adminUpdateAuthEmail(authUserId, newEmail) {
  if (!authUserId || !newEmail) return { ok: false, error: "missing args" };
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authUserId}`, {
    method: "PUT",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: newEmail, email_confirm: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, error: text };
  }
  return { ok: true };
}

// Look up an auth user by email. The previous implementation hit the
// auth schema via PostgREST with Accept-Profile: auth — that silently
// fails on this project (auth schema isn't in PostgREST's exposed
// schemas), so the "user already exists, link them" fallback path was
// broken (404'd as "user exists in auth but couldn't be looked up").
// Migration `auth_user_id_by_email_rpc` adds a SECURITY DEFINER RPC
// gated to service_role that does the lookup inside Postgres.
async function findAuthUserByEmail(email) {
  if (!email) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/auth_user_id_by_email`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_email: String(email).toLowerCase() }),
  });
  if (!res.ok) return null;
  const id = await res.json().catch(() => null);
  return id ? { id, email: String(email).toLowerCase() } : null;
}

// Lists candidates for the auto-resend-invite cron. A candidate is a
// client_users row whose linked auth user has never signed in AND never
// confirmed email — i.e. they got an invite at some point but never
// followed through. Filters out test domains, anyone we've already
// retried 7+ times, and anyone we already sent something to in the
// last 20 hours. Joins client_users + auth.users + clients in one round
// trip via PostgREST embedded resources.
async function listInviteResendCandidates({ hoursSince = 20, maxRetries = 7, limit = 50 } = {}) {
  // Single round-trip via Postgres RPC because PostgREST does not expose
  // the `auth` schema on this project — embedding/filtering across the
  // public.client_users → auth.users join can only happen server-side.
  // See migration `client_users_resend_invite_candidates_rpc`.
  const url = `${SUPABASE_URL}/rest/v1/rpc/resend_invite_candidates`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_hours_since: hoursSince,
      p_max_retries: maxRetries,
      p_limit: limit,
    }),
  });
  if (!res.ok) throw new Error(`rpc resend_invite_candidates ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

async function markInviteResent({ cuId, retryCount }) {
  const url = `${SUPABASE_URL}/rest/v1/client_users?id=eq.${encodeURIComponent(cuId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      last_invite_sent_at: new Date().toISOString(),
      invite_retry_count: (retryCount || 0) + 1,
    }),
  });
  if (!res.ok) throw new Error(`mark resent ${res.status}: ${await res.text()}`);
}

async function getStripeRevenue(customerId) {
  if (!customerId || !STRIPE_KEY) return null;

  const cached = revenueCache.get(customerId);
  if (cached && Date.now() - cached.at < REVENUE_TTL_MS) return cached.data;

  try {
    const res = await fetch(
      `${STRIPE_API}/subscriptions?customer=${customerId}&status=all&limit=10`,
      { headers: { Authorization: `Bearer ${STRIPE_KEY}` } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const subs = json.data || [];

    const active = subs.filter(s => ["active", "trialing", "past_due"].includes(s.status));
    const mrrCents = active.reduce((sum, s) => {
      const amount = s.plan?.amount || s.items?.data?.[0]?.price?.unit_amount || 0;
      const interval = s.plan?.interval || s.items?.data?.[0]?.price?.recurring?.interval || "month";
      const monthly = interval === "year" ? amount / 12 : interval === "week" ? amount * 4 : amount;
      return sum + monthly;
    }, 0);

    const data = {
      mrr: Math.round(mrrCents) / 100,
      activeSubs: active.length,
      totalSubs: subs.length,
      status: active.length > 0 ? "active" : subs.length > 0 ? "lapsed" : "none",
      revenueLabel: active.length > 0 ? `$${(Math.round(mrrCents) / 100).toLocaleString()}/mo` : "—",
    };
    revenueCache.set(customerId, { data, at: Date.now() });
    return data;
  } catch {
    return null;
  }
}

function shapeClient(row, revenue) {
  return {
    id: row.id,
    business_name: row.business_name,
    owner_name: row.owner_name || null,
    email: row.email || null,
    auth_user_id: row.auth_user_id || null,
    status: row.status,
    ghl_location_id: row.ghl_location_id || null,
    slack_channel_id: row.slack_channel_id || null,
    stripe_customer_id: row.stripe_customer_id || null,
    notion_page_id: row.notion_page_id || null,
    asana_project_id: row.asana_project_id || null,
    scaling_manager_id: row.scaling_manager_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,

    // Live Stripe data
    revenue: revenue?.revenueLabel || "—",
    mrr: revenue?.mrr || 0,
    billing_status: revenue?.status || "unknown",
    active_subs: revenue?.activeSubs || 0,

    // Legacy-shape fields (UI compat — empty until backfilled in Supabase)
    manager: "",
    startDate: "",
    renewal: "",
    onboardingStatus: row.status === "onboarding" ? "In Progress" : "Done",
    progress: row.status === "active" ? 100 : 0,
    checks: Array(14).fill(row.status === "active"),
    health: row.status === "active" ? 95 : 50,
    healthStatus: row.status === "active" ? "healthy" : "at-risk",
    tier: "Foundations",
    lastActivity: "",
    tasksDue: 0,
    notes: "",
    wins: row.status === "active" ? ["Onboarding complete"] : [],
    alerts: [],
    salesNotes: "",
    customTasks: [],
    aiSentiment: null,
  };
}

// ─── Password reset email ──────────────────────────────────────────────────
// Bulletproof email-client-compatible template. Uses table layout (Outlook
// hates flexbox/grid), all-inline styles, and a bgcolor button. The plain
// URL is also prominently shown as a fallback in case the button is stripped
// by a paranoid spam filter.
function buildResetPasswordEmail(actionLink) {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reset your BAM portal password</title>
</head>
<body style="margin:0;padding:0;background:#F5F1E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1A1A1F;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F1E8;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">

          <!-- Header band -->
          <tr>
            <td style="background:#0B0B0D;padding:24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,sans-serif;font-size:20px;font-weight:700;color:#FFFFFF;letter-spacing:-0.01em;">
                    <span style="color:#E8C547;">BAM</span> Business
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 8px 32px;">
              <p style="margin:0 0 6px;font-family:'JetBrains Mono',Menlo,monospace;font-size:11px;font-weight:600;color:#8B6914;letter-spacing:0.14em;text-transform:uppercase;">Password Reset</p>
              <h1 style="margin:0 0 18px;font-family:'Space Grotesk',-apple-system,sans-serif;font-size:28px;font-weight:700;letter-spacing:-0.025em;color:#0B0B0D;line-height:1.15;">
                Reset your password
              </h1>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#3A3A45;">
                We got a request to reset the password on your BAM Business portal account.
                Click the button below to choose a new one — you'll be taken straight to the
                page where you can set it and log in.
              </p>
            </td>
          </tr>

          <!-- Bulletproof button -->
          <tr>
            <td style="padding:0 32px 16px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#E8C547" style="border-radius:6px;">
                    <a href="${actionLink}"
                       style="display:inline-block;padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:700;color:#0B0B0D;text-decoration:none;letter-spacing:-0.01em;border-radius:6px;">
                      Reset password →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Fallback URL -->
          <tr>
            <td style="padding:24px 32px 12px 32px;">
              <p style="margin:0 0 8px;font-size:13px;color:#666;">
                Button not working? Copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-family:'JetBrains Mono',Menlo,Consolas,monospace;font-size:12px;line-height:1.55;word-break:break-all;">
                <a href="${actionLink}" style="color:#0B0B0D;text-decoration:underline;">${actionLink}</a>
              </p>
            </td>
          </tr>

          <!-- Divider + footer -->
          <tr>
            <td style="padding:28px 32px 36px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #E8E8E8;height:1px;line-height:1px;">&nbsp;</td></tr>
              </table>
              <p style="margin:20px 0 0;font-size:12px;line-height:1.55;color:#888;">
                This link expires in <strong style="color:#3A3A45;">1 hour</strong>.
                If you didn't ask for a password reset, you can ignore this email — your password won't change.
              </p>
              <p style="margin:14px 0 0;font-size:11px;color:#AAA;">
                BAM Business · <a href="https://portal.byanymeansbusiness.com/client-portal.html" style="color:#AAA;text-decoration:underline;">Client portal</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Plain-text fallback used by some mail clients when HTML rendering is off.
  // Keep the URL on its own line so it auto-links.
  const text = [
    "Reset your BAM portal password",
    "",
    "We got a request to reset the password on your BAM Business portal account.",
    "",
    "Open this link to choose a new password:",
    actionLink,
    "",
    "This link expires in 1 hour.",
    "If you didn't ask for a password reset, you can ignore this email — your password won't change.",
    "",
    "— BAM Business",
  ].join("\n");

  return { html, text };
}

// Invite email — separate template from reset-password so the copy
// matches a brand-new account setup ("Set your password" vs "Reset").
function buildInviteEmail(actionLink, businessName) {
  const biz = (businessName || "").trim();
  const greeting = biz ? `Welcome ${biz}` : "Welcome";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${greeting} to your BAM portal</title>
</head>
<body style="margin:0;padding:0;background:#F5F1E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1A1A1F;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F1E8;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:#0B0B0D;padding:24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,sans-serif;font-size:20px;font-weight:700;color:#FFFFFF;letter-spacing:-0.01em;">
                  <span style="color:#E8C547;">BAM</span> Business
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 8px 32px;">
              <p style="margin:0 0 6px;font-family:'JetBrains Mono',Menlo,monospace;font-size:11px;font-weight:600;color:#8B6914;letter-spacing:0.14em;text-transform:uppercase;">Client Portal</p>
              <h1 style="margin:0 0 18px;font-family:'Space Grotesk',-apple-system,sans-serif;font-size:28px;font-weight:700;letter-spacing:-0.025em;color:#0B0B0D;line-height:1.15;">
                ${greeting} to your BAM portal
              </h1>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#3A3A45;">
                Your BAM Business portal is ready. Click the button below to set your password and log in.
                You'll use this portal to track tickets, request changes, and see your live campaigns.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 16px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td bgcolor="#E8C547" style="border-radius:6px;">
                  <a href="${actionLink}"
                     style="display:inline-block;padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:700;color:#0B0B0D;text-decoration:none;letter-spacing:-0.01em;border-radius:6px;">
                    Set your password →
                  </a>
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 12px 32px;">
              <p style="margin:0 0 8px;font-size:13px;color:#666;">
                Button not working? Copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-family:'JetBrains Mono',Menlo,Consolas,monospace;font-size:12px;line-height:1.55;word-break:break-all;">
                <a href="${actionLink}" style="color:#0B0B0D;text-decoration:underline;">${actionLink}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 36px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #E8E8E8;height:1px;line-height:1px;">&nbsp;</td></tr>
              </table>
              <p style="margin:20px 0 0;font-size:12px;line-height:1.55;color:#888;">
                This link expires in <strong style="color:#3A3A45;">24 hours</strong>.
                If you weren't expecting this, you can ignore the email — no account changes happen until you click the link.
              </p>
              <p style="margin:14px 0 0;font-size:11px;color:#AAA;">
                BAM Business
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  const text = [
    `${greeting} to your BAM portal`,
    "",
    "Your BAM Business portal is ready. Click the link below to set your password and log in:",
    actionLink,
    "",
    "This link expires in 24 hours.",
    "",
    "— BAM Business",
  ].join("\n");
  return { html, text };
}

async function sendInviteEmail({ to, actionLink, businessName, resendApiKey }) {
  const { html, text } = buildInviteEmail(actionLink, businessName);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Resend FROM domain: must use byanymeansbball.com (verified in Resend
      // by Coleman). byanymeansbusiness.com was never DNS-verified there even
      // though the memory note suggested it was — verified 2026-05-19 by
      // probing the Resend API directly. Using the .com domain returns 403
      // "API key is not authorized to send emails from byanymeansbusiness.com"
      // and silently drops every reset/invite email.
      from: "BAM Business <portal@byanymeansbball.com>",
      to: [to],
      subject: `${businessName ? `${businessName.trim()}: w` : "W"}elcome to your BAM portal — set your password`,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("Resend invite send failed:", errText.slice(0, 200));
    return { ok: false, error: errText };
  }
  return { ok: true };
}

// Post an invite link to the client's Slack channel. Fire-and-forget,
// silently no-ops if SLACK_BOT_TOKEN unset or channel not mapped.
// Lighter Slack notification for the "teammate added" case. The original
// postInviteToSlack message (Hi team! / portal is ready / link below) was
// too noisy when a teammate was added — clients only need to know that
// a teammate was added, not get the full re-onboarding-style message.
// Used by invite-team-member only; the first-owner / setup-account /
// reset-password flows still get the full postInviteToSlack message.
async function postTeammateAddedToSlack({ slackChannelId, name, email }) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token || !slackChannelId) return { ok: false, skipped: true };
    const who = name ? `*${name}*` : "A new teammate";
    const text = `👥 ${who}${email ? ` (${email})` : ""} was added as a portal teammate. They'll get the setup link by email.`;
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: slackChannelId,
        text,
        unfurl_links: false,
      }),
    });
    const j = await res.json().catch(() => ({}));
    return { ok: !!j.ok, error: j.error };
  } catch (err) {
    console.error("Slack teammate-added post failed:", err?.message || err);
    return { ok: false, error: err?.message };
  }
}

async function postInviteToSlack({ slackChannelId, businessName, ownerName, email, actionLink }) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token || !slackChannelId) return { ok: false, skipped: true };
    const greet = "Hi team!";
    const biz = businessName ? ` for ${businessName}` : "";
    const text = [
      `${greet} Your BAM Business portal${biz} is ready 🎉`,
      `Click the link below to set your password and log in:`,
      actionLink,
      ``,
      `_Sent to ${email}. Link expires in 24 hours._`,
    ].join("\n");
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: slackChannelId,
        text,
        unfurl_links: false,
      }),
    });
    const j = await res.json().catch(() => ({}));
    return { ok: !!j.ok, error: j.error };
  } catch (err) {
    console.error("Slack invite post failed:", err?.message || err);
    return { ok: false, error: err?.message };
  }
}

// Smart link generator for "send a link to log in" flows. Tries invite
// first (which works for never-confirmed users, including unaccepted
// invitees like Cam was). Falls back to recovery (which works for users
// who already have a password). Returns { ok, mode, actionLink, kind }
// where kind is 'invite' | 'recovery' so the caller can pick the right
// email template.
async function generateLinkForResetOrInvite({ supabaseUrl, serviceKey, email, redirectTo }) {
  const tryGen = async (type, opts = {}) => {
    // CRITICAL: redirect_to MUST be at the top level of the request body —
    // nesting it inside `options: { redirect_to }` causes Supabase to
    // silently ignore the value and substitute the Site URL, breaking
    // every reset/invite link. Confirmed via direct API probe 2026-05-19.
    const body = { type, email, redirect_to: redirectTo, ...opts };
    const r = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, status: r.status, text: await r.text() };
    const j = await r.json();
    return { ok: true, actionLink: j?.properties?.action_link || j?.action_link };
  };

  // Try invite first. For an invited-but-not-confirmed user this re-issues
  // a fresh invite link (right tool for the job). For a brand-new email,
  // this creates the user + returns the link. For a fully-confirmed user,
  // this returns 422 'already_registered' and we fall back to recovery.
  const inviteRes = await tryGen("invite", { data: { needs_password: true } });
  if (inviteRes.ok && inviteRes.actionLink) {
    return { ok: true, kind: "invite", actionLink: inviteRes.actionLink };
  }

  // Fall back to recovery if invite said the user already exists. Anything
  // else surfaces as an error to the caller.
  const looksLikeAlreadyRegistered =
    inviteRes.status === 422 || /already|registered|exist/i.test(inviteRes.text || "");
  if (!looksLikeAlreadyRegistered) {
    return { ok: false, error: inviteRes.text || `invite: ${inviteRes.status}` };
  }

  const recoveryRes = await tryGen("recovery");
  if (recoveryRes.ok && recoveryRes.actionLink) {
    return { ok: true, kind: "recovery", actionLink: recoveryRes.actionLink };
  }
  if (recoveryRes.status === 404 || /not found/i.test(recoveryRes.text || "")) {
    return { ok: false, notFound: true };
  }
  return { ok: false, error: recoveryRes.text || `recovery: ${recoveryRes.status}` };
}

async function sendResetPasswordEmail({ to, actionLink, resendApiKey }) {
  const { html, text } = buildResetPasswordEmail(actionLink);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Resend FROM domain: must use byanymeansbball.com (verified in Resend
      // by Coleman). byanymeansbusiness.com was never DNS-verified there even
      // though the memory note suggested it was — verified 2026-05-19 by
      // probing the Resend API directly. Using the .com domain returns 403
      // "API key is not authorized to send emails from byanymeansbusiness.com"
      // and silently drops every reset/invite email.
      from: "BAM Business <portal@byanymeansbball.com>",
      to: [to],
      subject: "Reset your BAM portal password",
      html,
      text,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("Resend send failed:", errText.slice(0, 200));
    return { ok: false, error: errText };
  }
  return { ok: true };
}

async function supabaseInsert(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// Ensures the academy OWNER has a client_users membership row. The
// multi-user client portal resolves access ONLY from client_users — a
// clients row (even with clients.auth_user_id set) is NOT enough; without
// this row the owner sees "your account is not linked to a client".
// Idempotent: reactivates an old/revoked row, no-op if already active.
// Best-effort — logs on failure rather than breaking client creation.
async function ensureOwnerMembership({ clientId, authUserId, name, email }) {
  if (!clientId || !authUserId) return;
  try {
    const existing = await supabaseSelect(
      `client_users?user_id=eq.${authUserId}&client_id=eq.${clientId}&select=id`
    );
    if (existing?.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/client_users?id=eq.${existing[0].id}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "owner", status: "active" }),
      });
      return;
    }
    await supabaseInsert("client_users", {
      user_id: authUserId, client_id: clientId,
      name: name || "", email: email || "",
      role: "owner", status: "active",
    });
  } catch (err) {
    console.error("ensureOwnerMembership failed:", err?.message || err);
  }
}

// Resolves the canonical staff + client portal URLs used to build invite
// and password-recovery redirect links in emails / Slack messages.
//
// staffUrl honours the STAFF_PORTAL_URL env var. clientUrl is a hardcoded
// constant — NOT env-overridable (see the note on the return). Both fall
// back to the request's own origin on localhost so dev still works. This
// matters because an invite sent from the staff portal must land the
// client on the CLIENT portal, not whichever URL staff is on.
function portalUrls(req) {
  const origin = req.headers.origin || `https://${req.headers.host}` || "";
  // Supabase only honours redirect_to URLs that match its allow-list. An
  // invite generated from a *.vercel.app preview origin (or any non-prod
  // host) won't match, so Supabase silently falls back to the Site URL —
  // the staff portal root. Unless we're genuinely on localhost, pin to
  // the allow-listed production domain instead of the raw request origin.
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);
  const base = isLocal ? origin : "https://portal.byanymeansbusiness.com";
  return {
    staffUrl: process.env.STAFF_PORTAL_URL || base,
    // clientUrl is intentionally NOT env-overridable. A misconfigured
    // CLIENT_PORTAL_URL silently breaks every client invite + password
    // reset: Supabase rejects the off-allow-list redirect_to and falls
    // back to the Site URL (the staff portal), landing clients on the
    // wrong app. The client portal domain is stable — pin it. Confirmed
    // 2026-05-21: a real invite's redirect_to came back as the staff
    // Site URL because CLIENT_PORTAL_URL was set wrong in Vercel.
    clientUrl: isLocal ? origin : "https://portal.byanymeansbusiness.com",
  };
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "Supabase env vars missing (need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)" });
  }

  // ── Cron job: auto-resend invite links to clients who never accepted ──
  // Vercel cron triggers this hourly (configured in vercel.json). Auth is
  // a bearer token matching CRON_SECRET. For each candidate (never signed
  // in, never confirmed, last outbound >20h ago, retry_count < 7) we
  // generate a fresh invite/recovery link via the same machinery as the
  // staff-triggered reset-password flow and email it via Resend. Stops
  // pinging Slack after 3 attempts so we don't spam channels.
  if (req.query.action === "cron-resend-invites") {
    const auth = req.headers.authorization || "";
    const expected = process.env.CRON_SECRET;
    if (!expected) return res.status(500).json({ error: "CRON_SECRET not configured" });
    if (auth !== `Bearer ${expected}`) return res.status(401).json({ error: "unauthorized" });
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ error: "RESEND_API_KEY not configured" });
    }

    try {
      const candidates = await listInviteResendCandidates({});
      if (candidates.length === 0) {
        return res.status(200).json({ ok: true, processed: 0, sent: 0, errors: 0, skipped: 0 });
      }

      const { clientUrl } = portalUrls(req);
      const redirectTo = `${clientUrl}/client-portal.html?type=invite`;
      let sent = 0, errors = 0, skipped = 0;
      const results = [];

      for (const cand of candidates) {
        try {
          const link = await generateLinkForResetOrInvite({
            supabaseUrl: SUPABASE_URL,
            serviceKey: SUPABASE_SERVICE_KEY,
            email: cand.email,
            redirectTo,
          });
          if (link.notFound || !link.ok) {
            skipped += 1;
            results.push({ email: cand.email, status: "skipped", reason: link.notFound ? "no auth user" : "link gen failed" });
            continue;
          }

          const sendRes = link.kind === "invite"
            ? await sendInviteEmail({
                to: cand.email,
                actionLink: link.actionLink,
                businessName: cand.business_name,
                resendApiKey: process.env.RESEND_API_KEY,
              })
            : await sendResetPasswordEmail({
                to: cand.email,
                actionLink: link.actionLink,
                resendApiKey: process.env.RESEND_API_KEY,
              });
          if (!sendRes.ok) {
            errors += 1;
            results.push({ email: cand.email, status: "error", reason: "email failed" });
            continue;
          }

          // Slack notify on attempts 0,1,2 — silent after that to avoid
          // channel spam for stale invites that may never be accepted.
          if (link.kind === "invite" && cand.slack_channel_id && cand.retry_count < 3) {
            await postInviteToSlack({
              slackChannelId: cand.slack_channel_id,
              businessName: cand.business_name,
              ownerName: cand.name,
              email: cand.email,
              actionLink: link.actionLink,
            }).catch(() => {});
          }

          await markInviteResent({ cuId: cand.cu_id, retryCount: cand.retry_count });
          sent += 1;
          results.push({ email: cand.email, status: "sent", kind: link.kind, retry_count: cand.retry_count + 1 });
        } catch (e) {
          errors += 1;
          results.push({ email: cand.email, status: "error", reason: e.message?.slice(0, 200) });
        }
      }

      console.log(`[cron-resend-invites] processed=${candidates.length} sent=${sent} errors=${errors} skipped=${skipped}`);
      return res.status(200).json({
        ok: true,
        processed: candidates.length,
        sent,
        errors,
        skipped,
        results,
      });
    } catch (err) {
      console.error("/api/clients?action=cron-resend-invites error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const hasAuth = (req.headers.authorization || "").startsWith("Bearer ");
      const publicSignupAction = req.query.action;
      const signupBody = req.body || {};

      // ── Public "forgot password" path ──
      // Client portal login screen posts here when a user clicks "Forgot password?"
      // No auth required. Generic 200 response regardless of whether the email
      // exists, plus IP rate limit, to prevent enumeration + nuisance reset spam.
      if (!hasAuth && publicSignupAction === "request-password-reset") {
        const email = typeof signupBody.email === "string" ? signupBody.email.trim().toLowerCase() : "";
        const GENERIC_RESET_RESPONSE = {
          ok: true,
          message: "If that email is registered, we've sent a password reset link. Check your inbox.",
        };
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.status(400).json({ error: "valid email required" });
        }
        if (!process.env.RESEND_API_KEY) {
          return res.status(500).json({ error: "email service not configured" });
        }

        // Rate limit: 5 reset requests per IP per 24h. More aggressive than
        // signup (10/24h) because resets target a specific victim and could be
        // used for nuisance spam.
        const ip = (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "unknown")
          .toString().split(",")[0].trim();
        const RESETS_PER_IP_PER_DAY = 5;
        try {
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const recent = await supabaseSelect(
            `signup_attempts?ip=eq.${encodeURIComponent(ip)}&kind=eq.password_reset&attempted_at=gte.${encodeURIComponent(since)}&select=id`
          );
          if (Array.isArray(recent) && recent.length >= RESETS_PER_IP_PER_DAY) {
            return res.status(429).json({ error: "Too many reset attempts. Try again later." });
          }
        } catch (_) { /* fail-open on rate-limit lookup */ }

        const logResetAttempt = (succeeded) =>
          supabaseInsert("signup_attempts", { ip, email, succeeded, kind: "password_reset" }).catch(() => {});

        // Detect staff vs client by email lookup so the recovery link
        // redirects to the right portal. Staff land on / (staff portal
        // root, which handles PASSWORD_RECOVERY via App.jsx). Clients
        // land on /client-portal.html?type=recovery.
        // Failing-open: if the staff lookup errors, default to client
        // portal — that's the safer guess since most users are clients.
        let isStaff = false;
        try {
          const staffRows = await supabaseSelect(`staff?email=eq.${encodeURIComponent(email)}&select=id`);
          isStaff = Array.isArray(staffRows) && staffRows.length > 0;
        } catch (_) { /* default isStaff=false */ }

        // Smart link generator: invite first (for never-confirmed accounts),
        // recovery fallback (for active accounts). Right tool per user state.
        const { staffUrl, clientUrl } = portalUrls(req);
        const redirectTo = isStaff
          ? `${staffUrl}/?type=recovery`
          : `${clientUrl}/client-portal.html?type=recovery`;
        const link = await generateLinkForResetOrInvite({
          supabaseUrl: SUPABASE_URL,
          serviceKey: SUPABASE_SERVICE_KEY,
          email,
          redirectTo,
        });
        if (link.notFound || !link.ok) {
          // Either user doesn't exist or link gen failed — return generic
          // success to avoid leaking either piece of info to anonymous callers.
          await logResetAttempt(false);
          return res.status(200).json(GENERIC_RESET_RESPONSE);
        }

        // Send via the matching template.
        const sent = link.kind === "invite"
          ? await sendInviteEmail({
              to: email,
              actionLink: link.actionLink,
              businessName: "",
              resendApiKey: process.env.RESEND_API_KEY,
            })
          : await sendResetPasswordEmail({
              to: email,
              actionLink: link.actionLink,
              resendApiKey: process.env.RESEND_API_KEY,
            });
        await logResetAttempt(sent.ok);
        return res.status(200).json(GENERIC_RESET_RESPONSE);
      }

      // ── Post-welcome-slack — fires when a client finishes setting up
      // their portal account (first password set via invite link).
      // Idempotent: only posts the first time (welcome_slack_sent_at IS NULL).
      // Auth: Bearer token from the client's authed session — we resolve
      // the client_id from auth_user_id, so the client can't trigger this
      // for any other client.
      if (publicSignupAction === "post-welcome-slack") {
        if (!hasAuth) return res.status(401).json({ error: "auth required" });
        const tokenStr = (req.headers.authorization || "").slice(7);
        let authUser = null;
        try {
          const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${tokenStr}` },
          });
          if (r.ok) authUser = await r.json();
        } catch (_) { /* unauth */ }
        if (!authUser?.id) return res.status(401).json({ error: "invalid session" });

        // Find any client this user belongs to that hasn't had the
        // welcome posted yet. Owner first via auth_user_id; fall back
        // to client_users join for teammates.
        let clientRow = null;
        try {
          const owned = await supabaseSelect(
            `clients?auth_user_id=eq.${authUser.id}&welcome_slack_sent_at=is.null&select=id,business_name,slack_channel_id,owner_name,welcome_slack_sent_at&limit=1`
          );
          clientRow = owned?.[0] || null;
        } catch (_) { /* keep null */ }
        if (!clientRow) {
          // No owned row needing welcome → no-op (200 to avoid leaking)
          return res.status(200).json({ ok: true, skipped: true });
        }
        if (!clientRow.slack_channel_id) {
          // No Slack channel mapped → mark sent (so we don't retry every
          // login) and bail.
          await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientRow.id}`, {
            method: "PATCH",
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ welcome_slack_sent_at: new Date().toISOString() }),
          });
          return res.status(200).json({ ok: true, slack_skipped: "no channel" });
        }

        // Post the welcome.
        const token = process.env.SLACK_BOT_TOKEN;
        if (!token) {
          return res.status(200).json({ ok: true, slack_skipped: "no bot token" });
        }
        const biz = clientRow.business_name || "your academy";
        const ownerLabel = clientRow.owner_name ? ` (${clientRow.owner_name})` : "";
        const text = [
          `🎉 Welcome to BAM, ${biz}!${ownerLabel} just set up the portal account.`,
          ``,
          `*This channel is where notifications live for now.* When something needs your attention — a ticket update, an action request, a content drop, anything — it'll land here.`,
          ``,
          `Portal: https://portal.byanymeansbusiness.com/client-portal.html`,
        ].join("\n");
        try {
          const r = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify({ channel: clientRow.slack_channel_id, text, unfurl_links: false }),
          });
          const j = await r.json().catch(() => ({}));
          if (!j.ok) {
            // Don't mark sent if Slack rejected — gives us a retry next login.
            return res.status(200).json({ ok: false, slack_error: j.error });
          }
        } catch (e) {
          return res.status(200).json({ ok: false, slack_error: e?.message });
        }
        // Mark sent so we don't post again.
        await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${clientRow.id}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ welcome_slack_sent_at: new Date().toISOString() }),
        });
        return res.status(200).json({ ok: true, posted: true });
      }

      // ── Public submit-feedback path ──
      // Universal feedback widget on every page (client portal, signup page,
      // staff portal). Accepts anonymous submissions (no auth header) AND
      // authenticated submissions (Bearer token used to populate submitter
      // email + author_id if the user is staff). Anonymous submissions are
      // IP rate-limited to 20/24h to deter spam.
      if (publicSignupAction === "submit-feedback") {
        const fb = req.body || {};
        const fbBody = typeof fb.body === "string" ? fb.body.trim() : "";
        const fbKind = fb.kind === "feature" ? "feature" : "bug";
        const fileUrl = typeof fb.file_url === "string" ? fb.file_url.trim() : null;
        const fileName = typeof fb.file_name === "string" ? fb.file_name.trim() : null;
        const page = typeof fb.page === "string" ? fb.page.trim().slice(0, 500) : "";
        const portalKind = ["client", "staff", "signup", "spec"].includes(fb.portal)
          ? fb.portal : "client";
        if (!fbBody) return res.status(400).json({ error: "feedback body required" });

        // Try to resolve the submitter from the Bearer token if present.
        // Auth failures don't reject the submission, just leave fields blank.
        let submitterEmail = null;
        let authorId = null;
        if (hasAuth) {
          const fbToken = (req.headers.authorization || "").slice(7);
          try {
            const whoRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
              headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${fbToken}` },
            });
            if (whoRes.ok) {
              const who = await whoRes.json();
              if (who?.email) {
                submitterEmail = who.email;
                try {
                  const sRows = await supabaseSelect(
                    `staff?email=eq.${encodeURIComponent(who.email)}&select=id`
                  );
                  authorId = sRows?.[0]?.id || null;
                } catch (_) { /* not staff */ }
              }
            }
          } catch (_) { /* unauth submission, fine */ }
        }
        // Allow caller-supplied email if no auth (e.g. anon user on signup page typed it in)
        if (!submitterEmail && typeof fb.submitter_email === "string"
            && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fb.submitter_email.trim())) {
          submitterEmail = fb.submitter_email.trim().toLowerCase();
        }

        // IP rate limit anonymous submissions (20 per 24h).
        if (!authorId && !submitterEmail) {
          const ip = (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "unknown")
            .toString().split(",")[0].trim();
          try {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const recent = await supabaseSelect(
              `signup_attempts?ip=eq.${encodeURIComponent(ip)}&kind=eq.feedback&attempted_at=gte.${encodeURIComponent(since)}&select=id`
            );
            if (Array.isArray(recent) && recent.length >= 20) {
              return res.status(429).json({ error: "Too many feedback submissions. Try again later." });
            }
            supabaseInsert("signup_attempts", { ip, email: null, succeeded: true, kind: "feedback" }).catch(() => {});
          } catch (_) { /* fail-open */ }
        }

        try {
          const insertRow = {
            body: fbBody,
            kind: fbKind,
            source: "text",
            page: page || null,
            file_url: fileUrl,
            file_name: fileName,
            submitter_email: submitterEmail,
            portal: portalKind,
            status: "pending",
          };
          // Only set author_id when we resolved one (otherwise the table's
          // gen_random_uuid() default fills in a placeholder).
          if (authorId) insertRow.author_id = authorId;
          const rows = await supabaseInsert("portal_feedback", insertRow);
          const row = Array.isArray(rows) ? rows[0] : rows;
          return res.status(200).json({ ok: true, id: row?.id });
        } catch (insertErr) {
          return res.status(500).json({ error: `feedback insert failed: ${insertErr.message}` });
        }
      }

      // ── Public self-serve signup path ──
      // /onboarding.html posts {business_name, owner_name, email} with no auth header.
      // Treat as a public signup (creates client + auth user via Supabase invite).
      // Detected by: no Authorization header AND no ?action= AND body has the
      // signup shape. Anything else falls through to the admin path below.
      const isPublicSignup = !hasAuth && !publicSignupAction
        && typeof signupBody.business_name === "string"
        && typeof signupBody.owner_name === "string"
        && typeof signupBody.email === "string";

      if (isPublicSignup) {
        const business_name = signupBody.business_name.trim();
        const owner_name = signupBody.owner_name.trim();
        const email = signupBody.email.trim().toLowerCase();
        // Genericized response so attackers can't distinguish "email exists" from
        // "invite sent". Closes SEC-2 (email enumeration).
        const GENERIC_RESPONSE = {
          ok: true,
          message: "If that's a new account, we've sent you an invite. Check your inbox in a few minutes (and your spam folder).",
        };

        // Basic shape validation. Return errors here are NOT enumeration-relevant —
        // they only fire for malformed input, not "email exists" decisions.
        if (!business_name) return res.status(400).json({ error: "business name required" });
        if (!owner_name) return res.status(400).json({ error: "owner name required" });
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.status(400).json({ error: "valid email required" });
        }

        // ── Rate limit: 10 signup attempts per IP per 24h ──
        // Headers Vercel populates with the real client IP, falling back gracefully.
        const ip = (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "unknown")
          .toString()
          .split(",")[0]
          .trim();
        const SIGNUPS_PER_IP_PER_DAY = 10;
        try {
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const recent = await supabaseSelect(
            `signup_attempts?ip=eq.${encodeURIComponent(ip)}&attempted_at=gte.${encodeURIComponent(since)}&select=id`
          );
          if (Array.isArray(recent) && recent.length >= SIGNUPS_PER_IP_PER_DAY) {
            // Don't tell them the limit — vague rate-limit message.
            return res.status(429).json({ error: "Too many signup attempts. Try again later." });
          }
        } catch (_) {
          // If the rate-limit lookup itself fails, fall open (don't block legit signups).
          // We still log the attempt below.
        }

        // Log this attempt up front so even failures count toward the limit.
        const logAttempt = (succeeded) =>
          supabaseInsert("signup_attempts", { ip, email, succeeded }).catch(() => {});

        // Check if a clients row with this email already exists. If so, silently
        // succeed without re-inviting (don't spam the existing user, don't tell
        // the caller).
        try {
          const existing = await supabaseSelect(
            `clients?email=eq.${encodeURIComponent(email)}&select=id&limit=1`
          );
          if (Array.isArray(existing) && existing.length > 0) {
            await logAttempt(false);
            return res.status(200).json(GENERIC_RESPONSE);
          }
        } catch (_) {
          // If the lookup itself fails, continue with invite — fail-open.
        }

        // Send invite (creates auth user with no password + emails the link).
        // user_metadata.needs_password=true is a defensive marker: the client portal
        // checks this on boot and forces the password-set form even if redirect query
        // params get stripped. Cleared on first successful password update.
        const { clientUrl } = portalUrls(req);
        const redirectTo = `${clientUrl}/client-portal.html?type=invite`;
        const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, redirect_to: redirectTo, data: { needs_password: true } }),
        });
        let auth_user_id = null;
        if (inviteRes.ok) {
          const invited = await inviteRes.json();
          auth_user_id = invited?.id || invited?.user?.id || null;
        } else {
          // 422 = the email already has an auth account (likely staff at
          // another academy, or a prior client). Fall back to linking the
          // existing user instead of silently dropping the signup.
          const errText = await inviteRes.text();
          if (inviteRes.status === 422 || /already/i.test(errText)) {
            const existingAuth = await findAuthUserByEmail(email);
            if (existingAuth?.id) auth_user_id = existingAuth.id;
          }
          if (!auth_user_id) {
            // Genuine failure (network / other Supabase error). Generic success
            // to avoid leaking; logged as failure for our metrics.
            await logAttempt(false);
            return res.status(200).json(GENERIC_RESPONSE);
          }
        }
        if (!auth_user_id) {
          await logAttempt(false);
          return res.status(200).json(GENERIC_RESPONSE);
        }

        try {
          const newRows = await supabaseInsert("clients", {
            business_name, owner_name, email, status: "onboarding", auth_user_id,
          });
          const newClient = Array.isArray(newRows) ? newRows[0] : newRows;
          // Wire the owner into client_users so they can log in to the
          // multi-user portal (clients.auth_user_id alone is not enough).
          await ensureOwnerMembership({
            clientId: newClient?.id, authUserId: auth_user_id, name: owner_name, email,
          });
          await logAttempt(true);
          return res.status(200).json(GENERIC_RESPONSE);
        } catch (_insertErr) {
          // Roll back the auth user if the clients insert fails so they don't get orphaned
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${auth_user_id}`, {
            method: "DELETE",
            headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
          }).catch(() => {});
          await logAttempt(false);
          // Still return generic success — caller doesn't get to see internal failures.
          return res.status(200).json(GENERIC_RESPONSE);
        }
      }

      // ── Authenticated client action: complete-onboarding ──
      // Fires when the client clicks "Got it" (or "Skip") at the end of the
      // first-login product tour. Sets onboarding_completed_at = now() on the
      // client row whose auth_user_id matches the caller. The auth_user_id
      // match IS the authorization boundary — a client can only mark their
      // own onboarding complete, never someone else's.
      if (publicSignupAction === "complete-onboarding") {
        const clientAuth = req.headers.authorization || "";
        const clientToken = clientAuth.startsWith("Bearer ") ? clientAuth.slice(7) : null;
        if (!clientToken) return res.status(401).json({ error: "auth required" });

        const whoRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${clientToken}` },
        });
        if (!whoRes.ok) return res.status(401).json({ error: "invalid token" });
        const who = await whoRes.json();
        if (!who?.id) return res.status(401).json({ error: "invalid token" });

        const updRes = await fetch(
          `${SUPABASE_URL}/rest/v1/clients?auth_user_id=eq.${encodeURIComponent(who.id)}`,
          {
            method: "PATCH",
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify({ onboarding_completed_at: new Date().toISOString() }),
          }
        );
        if (!updRes.ok) {
          const txt = await updRes.text();
          return res.status(500).json({ error: `update failed: ${txt}` });
        }
        const updRows = await updRes.json();
        if (!Array.isArray(updRows) || updRows.length === 0) {
          return res.status(404).json({ error: "no client row linked to this user" });
        }
        return res.status(200).json({ ok: true });
      }

      // ── Dual-auth actions: client portal Team management ──
      // invite-team-member / revoke-team-member can be called by BAM staff
      // OR by a client portal user (the academy owner or a teammate). Auth
      // is resolved per-action below, so these MUST sit before the staff-only
      // gate — that gate would 403 a legitimate client-portal caller.
      if (publicSignupAction === "invite-team-member" || publicSignupAction === "revoke-team-member") {
        const teamAuth = req.headers.authorization || "";
        const teamToken = teamAuth.startsWith("Bearer ") ? teamAuth.slice(7) : null;
        if (!teamToken) return res.status(401).json({ error: "auth required" });

        const whoRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${teamToken}` },
        });
        if (!whoRes.ok) return res.status(401).json({ error: "invalid token" });
        const who = await whoRes.json();
        if (!who?.id) return res.status(401).json({ error: "invalid token" });

        const teamBody = req.body || {};
        const client_id = typeof teamBody.client_id === "string" ? teamBody.client_id.trim() : "";
        if (!client_id) return res.status(400).json({ error: "client_id required" });

        // Resolve the caller's capabilities for this client.
        const callerStaff = who.email
          ? await supabaseSelect(`staff?email=eq.${encodeURIComponent(who.email)}&select=id`).catch(() => [])
          : [];
        const isStaffCaller = Array.isArray(callerStaff) && callerStaff.length > 0;
        const callerMembership = await supabaseSelect(
          `client_users?user_id=eq.${who.id}&client_id=eq.${client_id}&status=eq.active&select=id,role`
        ).catch(() => []);
        const callerRole = callerMembership?.[0]?.role || null;   // 'owner' | 'member' | null

        // The target client row — needed for business name + Slack channel.
        const teamClientRows = await supabaseSelect(
          `clients?id=eq.${client_id}&select=id,business_name,slack_channel_id`
        );
        if (!teamClientRows?.length) return res.status(404).json({ error: "client not found" });
        const teamClient = teamClientRows[0];

        // ---- action=invite-team-member ----
        // Any BAM staff OR any active portal user of this client can invite.
        if (publicSignupAction === "invite-team-member") {
          if (!isStaffCaller && !callerRole) {
            return res.status(403).json({ error: "not authorized for this client" });
          }
          const name = typeof teamBody.name === "string" ? teamBody.name.trim() : "";
          const email = typeof teamBody.email === "string" ? teamBody.email.trim().toLowerCase() : "";
          if (!name) return res.status(400).json({ error: "name required" });
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: "valid email required" });
          }
          if (!process.env.RESEND_API_KEY) {
            return res.status(500).json({ error: "RESEND_API_KEY not configured" });
          }

          const { clientUrl } = portalUrls(req);
          const redirectTo = `${clientUrl}/client-portal.html?type=invite`;

          // generate_link returns both the action_link and the auth user id.
          const genTeamLink = async (type, extra = {}) => {
            const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
              method: "POST",
              headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ type, email, redirect_to: redirectTo, ...extra }),
            });
            if (!r.ok) return { ok: false, status: r.status, text: await r.text() };
            const j = await r.json();
            return {
              ok: true,
              actionLink: j?.properties?.action_link || j?.action_link,
              authUserId: j?.user?.id || j?.id,
            };
          };

          // Try invite (creates a fresh auth user). If the email already has
          // an auth user, look them up and issue a magiclink instead.
          let actionLink = null, memberUserId = null;
          const inviteRes = await genTeamLink("invite", { data: { needs_password: true } });
          if (inviteRes.ok) {
            actionLink = inviteRes.actionLink;
            memberUserId = inviteRes.authUserId;
          } else if (inviteRes.status === 422 || /already/i.test(inviteRes.text || "")) {
            const existingUser = await findAuthUserByEmail(email);
            if (!existingUser?.id) {
              return res.status(500).json({ error: "user exists in auth but couldn't be looked up" });
            }
            memberUserId = existingUser.id;
            const ml = await genTeamLink("magiclink");
            if (ml.ok) actionLink = ml.actionLink;
            // If the magiclink fails the access is still wired up — they can
            // log in with their existing password; we just lack a copy link.
          } else {
            return res.status(400).json({ error: `invite: ${inviteRes.text}` });
          }
          if (!memberUserId) return res.status(500).json({ error: "could not resolve the invited user" });

          // Upsert the membership. A previously-revoked row for this
          // user+client is reactivated; otherwise a fresh row is inserted.
          const existingMembership = await supabaseSelect(
            `client_users?user_id=eq.${memberUserId}&client_id=eq.${client_id}&select=id,role,status`
          ).catch(() => []);
          let memberRow;
          if (existingMembership?.length) {
            const ex = existingMembership[0];
            if (ex.status === "active") {
              return res.status(409).json({ error: "that person already has access to this portal" });
            }
            const updRes = await fetch(`${SUPABASE_URL}/rest/v1/client_users?id=eq.${ex.id}`, {
              method: "PATCH",
              headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
              },
              body: JSON.stringify({ name, email, status: "active" }),
            });
            if (!updRes.ok) return res.status(500).json({ error: `membership update failed: ${await updRes.text()}` });
            memberRow = (await updRes.json())[0];
          } else {
            try {
              const rows = await supabaseInsert("client_users", {
                user_id: memberUserId, client_id, name, email,
                role: "member", status: "active",
              });
              memberRow = Array.isArray(rows) ? rows[0] : rows;
            } catch (insErr) {
              return res.status(500).json({ error: `membership insert failed: ${insErr.message}` });
            }
          }

          // Notify: email to the new teammate (with the setup link) +
          // a LIGHT "teammate added" message to the client's Slack
          // channel — no link blob, just an FYI that someone's coming
          // online. Owners still get the full invite-style Slack post
          // via postInviteToSlack from setup-account / reset-password;
          // this branch is for adding teammates to an existing client.
          const [emailRes, slackRes] = actionLink
            ? await Promise.all([
                sendInviteEmail({
                  to: email, actionLink,
                  businessName: teamClient.business_name || "",
                  resendApiKey: process.env.RESEND_API_KEY,
                }),
                postTeammateAddedToSlack({
                  slackChannelId: teamClient.slack_channel_id || null,
                  name, email,
                }),
              ])
            : [{ ok: false, error: "no link generated" }, { ok: false, skipped: true }];

          return res.status(200).json({
            ok: true,
            member: memberRow,
            action_link: actionLink,
            email_sent: !!emailRes?.ok,
            slack_posted: !!slackRes?.ok,
            slack_skipped: !!slackRes?.skipped,
            slack_error: slackRes?.error || null,
          });
        }

        // ---- action=revoke-team-member ----
        // BAM staff OR the client's owner can revoke. Regular members cannot.
        if (publicSignupAction === "revoke-team-member") {
          if (!isStaffCaller && callerRole !== "owner") {
            return res.status(403).json({ error: "only the owner or BAM staff can revoke access" });
          }
          const member_id = typeof teamBody.member_id === "string" ? teamBody.member_id.trim() : "";
          if (!member_id) return res.status(400).json({ error: "member_id required" });

          const targetRows = await supabaseSelect(
            `client_users?id=eq.${member_id}&select=id,client_id,role,status`
          );
          if (!targetRows?.length) return res.status(404).json({ error: "team member not found" });
          const target = targetRows[0];
          if (target.client_id !== client_id) {
            return res.status(400).json({ error: "member does not belong to this client" });
          }
          if (target.role === "owner") {
            return res.status(403).json({ error: "the owner's access can't be revoked here" });
          }

          const updRes = await fetch(`${SUPABASE_URL}/rest/v1/client_users?id=eq.${member_id}`, {
            method: "PATCH",
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify({ status: "revoked" }),
          });
          if (!updRes.ok) return res.status(500).json({ error: `revoke failed: ${await updRes.text()}` });

          return res.status(200).json({ ok: true, member_id, status: "revoked" });
        }
      }

      // ── Staff auth (admin only) ──
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) return res.status(401).json({ error: "auth required" });

      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
      });
      if (!userRes.ok) return res.status(401).json({ error: "invalid token" });
      const user = await userRes.json();
      if (!user?.email) return res.status(401).json({ error: "invalid token" });

      const staffRows = await supabaseSelect(
        `staff?email=eq.${encodeURIComponent(user.email)}&select=role`
      );
      const role = staffRows?.[0]?.role;
      const action = req.query.action;

      // Per-action role gating.
      // - invite-staff + creating new clients (no action) = admin only
      // - setup-account / update-fields / reset-password = admin + marketing roles
      //   (so Ximena and other marketing staff can run the Client Setup page)
      // Roles model (combined clients page):
      //   ADMIN_LIKE = admin OR scaling_manager   — full power
      //   MARKETING  = ADMIN_LIKE + marketing roles
      //   ANY_STAFF  = anyone with a row in `staff` (defensive: must be authenticated)
      const ADMIN_LIKE_ROLES = new Set(["admin", "scaling_manager"]);
      const MARKETING_ROLES  = new Set(["admin", "scaling_manager", "marketing_manager", "marketing_executor"]);
      const ANY_STAFF_ROLES  = new Set(["admin", "scaling_manager", "marketing_manager", "marketing_executor", "systems_manager", "systems_executor", "systems"]);

      // Action gating:
      //   invite-staff             admin+scaling
      //   create-client            admin+scaling
      //   setup-account            admin+scaling   (per Zoran's feedback: not marketing)
      //   reset-password           admin+scaling
      //   archive                  admin+scaling
      //   submit-feedback          admin+scaling   (red bug button on client portal)
      //   list-feedback            admin+scaling   (Feedback tab in staff portal)
      //   update-fields            any staff (field-level gating below)
      //   (default insert)         admin+scaling
      // submit-feedback moved to the public path (no auth required).
      // list-feedback + resolve-feedback flow through staff auth, then are
      // additionally gated to ZORAN_EMAIL inside their handlers.
      const ADMIN_ONLY_ACTIONS = new Set(["invite-staff", "update-staff", "reset-staff-password", "create-client", "setup-account", "reset-password", "transfer-owner", "archive", "list-feedback", "resolve-feedback"]);
      const ANY_STAFF_OK_ACTIONS = new Set(["update-fields"]);

      if (ADMIN_ONLY_ACTIONS.has(action)) {
        if (!ADMIN_LIKE_ROLES.has(role)) return res.status(403).json({ error: "admin or scaling_manager required" });
      } else if (ANY_STAFF_OK_ACTIONS.has(action)) {
        if (!ANY_STAFF_ROLES.has(role)) return res.status(403).json({ error: "staff role required" });
      } else {
        // Default: creating a new client (no action). Admin-level only.
        if (!ADMIN_LIKE_ROLES.has(role)) return res.status(403).json({ error: "admin or scaling_manager required" });
      }

      // ── action=invite-staff ──
      // Admin-only. Inserts a row into the `staff` table and sends a
      // Supabase invite email so the new staff can set their password.
      // Redirect goes to the staff portal root (NOT /client-portal.html).
      if (action === "invite-staff") {
        const VALID_STAFF_ROLES = new Set([
          "admin",
          "systems_manager",
          "systems_executor",
          "marketing_manager",
          "marketing_executor",
          "scaling_manager",
        ]);
        const body = req.body || {};
        const newName = typeof body.name === "string" ? body.name.trim() : "";
        const newEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const newRole = typeof body.role === "string" ? body.role.trim() : "";

        if (!newName) return res.status(400).json({ error: "name required" });
        if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
          return res.status(400).json({ error: "valid email required" });
        }
        if (!VALID_STAFF_ROLES.has(newRole)) {
          return res.status(400).json({ error: `invalid role (must be one of: ${[...VALID_STAFF_ROLES].join(", ")})` });
        }

        // Existing staff with the same email — three sub-cases:
        //   - row + user_id present → genuine duplicate, refuse
        //   - row + user_id NULL    → repair by linking (Silva's case)
        //   - no row                → continue to invite/link flow
        const dup = await supabaseSelect(`staff?email=eq.${encodeURIComponent(newEmail)}&select=id,user_id`);
        const existingStaff = dup?.[0];
        if (existingStaff && existingStaff.user_id) {
          return res.status(409).json({ error: "a staff member with that email already exists" });
        }

        const { staffUrl } = portalUrls(req);
        const redirectTo = `${staffUrl}/?type=invite`;

        // Try to send a Supabase invite first. If the auth user already
        // exists (e.g. they have a client account too), Supabase returns
        // 422 — fall back to looking up that user via the RPC and just
        // linking. Mirrors the existing client-portal access flow.
        let auth_user_id = null;
        let mode = "invite";
        const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: newEmail, redirect_to: redirectTo }),
        });

        if (inviteRes.ok) {
          const invited = await inviteRes.json();
          auth_user_id = invited?.id || invited?.user?.id || null;
          if (!auth_user_id) return res.status(500).json({ error: "invite sent but no auth user id returned" });
        } else {
          const errText = await inviteRes.text();
          if (inviteRes.status === 422 || /already/i.test(errText)) {
            const existingAuth = await findAuthUserByEmail(newEmail);
            if (!existingAuth?.id) {
              return res.status(500).json({ error: "user exists in auth but couldn't be looked up" });
            }
            auth_user_id = existingAuth.id;
            mode = "link-existing";
          } else {
            return res.status(400).json({ error: `invite: ${errText}` });
          }
        }

        // Repair path: staff row exists with NULL user_id — just link.
        if (existingStaff && !existingStaff.user_id) {
          try {
            const updRes = await fetch(`${SUPABASE_URL}/rest/v1/staff?id=eq.${existingStaff.id}`, {
              method: "PATCH",
              headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                "Content-Type": "application/json",
                Prefer: "return=representation",
              },
              body: JSON.stringify({ name: newName, role: newRole, user_id: auth_user_id }),
            });
            if (!updRes.ok) throw new Error(`Supabase ${updRes.status}: ${await updRes.text()}`);
            return res.status(200).json({
              id: existingStaff.id, name: newName, email: newEmail, role: newRole,
              invited: mode === "invite", linked: true,
            });
          } catch (updErr) {
            // Don't roll back the auth user here — it may have existed before
            // and belong to other resources. Just report the failure.
            return res.status(500).json({ error: `staff link failed: ${updErr.message}` });
          }
        }

        // Insert the staff row
        try {
          const rows = await supabaseInsert("staff", {
            name: newName,
            email: newEmail,
            role: newRole,
            user_id: auth_user_id,
          });
          const row = Array.isArray(rows) ? rows[0] : rows;
          return res.status(200).json({
            id: row?.id, name: newName, email: newEmail, role: newRole,
            invited: mode === "invite", linked: mode === "link-existing",
          });
        } catch (insertErr) {
          // Only roll back the auth user if WE created it (invite mode).
          // For link-existing, the user belongs to other resources too.
          if (mode === "invite") {
            await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${auth_user_id}`, {
              method: "DELETE",
              headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
            }).catch(() => {});
          }
          return res.status(500).json({ error: `staff insert failed: ${insertErr.message}` });
        }
      }

      // ── action=update-staff ──
      // Admin-only. Update a staff row's name/email/role.
      if (action === "update-staff") {
        const VALID_STAFF_ROLES = new Set([
          "admin", "systems_manager", "systems_executor",
          "marketing_manager", "marketing_executor", "scaling_manager",
        ]);
        const body = req.body || {};
        const staffId = typeof body.id === "string" ? body.id.trim() : "";
        const newName = typeof body.name === "string" ? body.name.trim() : "";
        const newEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const newRole = typeof body.role === "string" ? body.role.trim() : "";

        if (!staffId) return res.status(400).json({ error: "id required" });
        if (!newName) return res.status(400).json({ error: "name required" });
        if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
          return res.status(400).json({ error: "valid email required" });
        }
        if (!VALID_STAFF_ROLES.has(newRole)) {
          return res.status(400).json({ error: `invalid role (must be one of: ${[...VALID_STAFF_ROLES].join(", ")})` });
        }

        // If email is changing AND the staff member has a linked auth user,
        // sync the auth login email FIRST. If it 422s (e.g. that email is
        // already taken by another auth user), bail before drifting the
        // staff row away from the actual auth email.
        const existingStaff = await supabaseSelect(`staff?id=eq.${encodeURIComponent(staffId)}&select=email,user_id`);
        const prevStaff = existingStaff?.[0];
        let authEmailSync = null;
        if (prevStaff && prevStaff.email !== newEmail && prevStaff.user_id) {
          const sync = await adminUpdateAuthEmail(prevStaff.user_id, newEmail);
          if (!sync.ok) {
            if (/already|duplicate|409|422/i.test(sync.error || "")) {
              return res.status(409).json({
                error: "That email already belongs to another login account. If this is a different person taking over, archive this staff member and invite the new email as a fresh staff member instead.",
                code: "email_belongs_to_other_user",
              });
            }
            return res.status(400).json({ error: `couldn't update login email: ${sync.error}` });
          }
          authEmailSync = "updated";
        }

        const updRes = await fetch(
          `${SUPABASE_URL}/rest/v1/staff?id=eq.${encodeURIComponent(staffId)}`,
          {
            method: "PATCH",
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify({ name: newName, email: newEmail, role: newRole }),
          }
        );
        if (!updRes.ok) {
          const txt = await updRes.text();
          return res.status(500).json({ error: `update failed: ${txt}` });
        }
        const rows = await updRes.json();
        if (!Array.isArray(rows) || rows.length === 0) {
          return res.status(404).json({ error: "staff member not found" });
        }
        const row = rows[0];
        return res.status(200).json({ id: row.id, name: row.name, email: row.email, role: row.role, auth_email_sync: authEmailSync });
      }

      // ── action=reset-staff-password ──
      // Admin-only. Same flow as the client reset-password action, but
      // the recovery link redirects to the staff portal root (/) instead
      // of /client-portal.html.
      if (action === "reset-staff-password") {
        const body = req.body || {};
        const targetEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!targetEmail) return res.status(400).json({ error: "email required" });
        if (!process.env.RESEND_API_KEY) {
          return res.status(500).json({ error: "RESEND_API_KEY not configured" });
        }

        const { staffUrl } = portalUrls(req);
        const redirectTo = `${staffUrl}/?type=recovery`;

        // Smart link: re-issues an INVITE link for staff who never
        // accepted their original invite (the right tool for that case);
        // falls back to RECOVERY for staff who already have a password.
        const link = await generateLinkForResetOrInvite({
          supabaseUrl: SUPABASE_URL,
          serviceKey: SUPABASE_SERVICE_KEY,
          email: targetEmail,
          redirectTo,
        });
        if (link.notFound) {
          // Generic OK to avoid enumeration even though only admins call this
          return res.status(200).json({ ok: true });
        }
        if (!link.ok) {
          console.error("link gen failed (staff):", link.error);
          return res.status(500).json({ error: "could not generate link" });
        }

        // Pick the email template that matches what we just generated.
        // Invite = first-time set-password copy; recovery = reset-password copy.
        // Staff get a clean "Staff Portal" business name on the invite header.
        const sent = link.kind === "invite"
          ? await sendInviteEmail({
              to: targetEmail,
              actionLink: link.actionLink,
              businessName: "",
              resendApiKey: process.env.RESEND_API_KEY,
            })
          : await sendResetPasswordEmail({
              to: targetEmail,
              actionLink: link.actionLink,
              resendApiKey: process.env.RESEND_API_KEY,
            });
        if (!sent.ok) {
          return res.status(500).json({ error: "failed to send email" });
        }
        return res.status(200).json({ ok: true, sent_to: targetEmail, kind: link.kind });
      }

      // ── action=create-client ──
      // Admin + marketing roles. Insert an EMPTY-ish client row from the
      // Client Setup page so staff can wire it up (ad account, campaigns,
      // owner email) before sending the invite. No auth user created here —
      // Send Invite later via ?action=setup-account.
      if (action === "create-client") {
        const body = req.body || {};
        const newBusinessName = typeof body.business_name === "string" ? body.business_name.trim() : "";
        const newOwnerName = typeof body.owner_name === "string" ? body.owner_name.trim() : "";
        const newEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!newBusinessName) return res.status(400).json({ error: "business name required" });
        if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
          return res.status(400).json({ error: "email format invalid (or leave blank)" });
        }
        const insertBody = { business_name: newBusinessName, status: "onboarding" };
        if (newOwnerName) insertBody.owner_name = newOwnerName;
        if (newEmail) insertBody.email = newEmail;
        try {
          const rows = await supabaseInsert("clients", insertBody);
          const row = Array.isArray(rows) ? rows[0] : rows;
          return res.status(200).json({ id: row?.id, business_name: row?.business_name, created: true });
        } catch (insertErr) {
          return res.status(500).json({ error: `clients insert failed: ${insertErr.message}` });
        }
      }

      // ── action=update-fields ──
      // Field-level role gating per Zoran's spec:
      //   any staff → owner_name, email, status, scaling_manager_id, slack_channel_id, ghl_location_id, business_name
      //   admin+scaling → stripe_customer_id, notion_page_id
      if (action === "update-fields") {
        const body = req.body || {};
        const client_id = typeof body.client_id === "string" ? body.client_id : "";
        if (!client_id) return res.status(400).json({ error: "client_id required" });

        const isAdminLike = ADMIN_LIKE_ROLES.has(role);

        // Validators / coercion per field
        const setText = (k) => {
          if (typeof body[k] === "string") return body[k].trim() || null;
          if (body[k] === null) return null;
          return undefined;
        };

        const patch = {};
        const wasSet = (k) => Object.prototype.hasOwnProperty.call(body, k);

        // ── Any-staff fields ──
        if (wasSet("business_name"))      patch.business_name      = setText("business_name");
        if (wasSet("owner_name"))         patch.owner_name         = setText("owner_name");
        if (wasSet("slack_channel_id"))   patch.slack_channel_id   = setText("slack_channel_id");
        if (wasSet("ghl_location_id"))    patch.ghl_location_id    = setText("ghl_location_id");
        if (wasSet("scaling_manager_id")) patch.scaling_manager_id = body.scaling_manager_id || null;

        if (wasSet("status")) {
          const s = body.status;
          if (s !== null && !["onboarding","active","paused","churned"].includes(s)) {
            return res.status(400).json({ error: "invalid status value" });
          }
          patch.status = s;
        }
        if (wasSet("email")) {
          const newEmail = (body.email || "").trim().toLowerCase();
          if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
            return res.status(400).json({ error: "invalid email format" });
          }
          patch.email = newEmail || null;
        }

        if (wasSet("marketing_included")) {
          const v = body.marketing_included;
          if (typeof v !== "boolean") {
            return res.status(400).json({ error: "marketing_included must be a boolean" });
          }
          patch.marketing_included = v;
        }

        // v2_access — formerly named "onboarding_in_progress". Renamed
        // 2026-05-27 to match its new semantics (V2 portal opt-in, not
        // onboarding state). The staff "V2 access?" toggle posts this.
        if (wasSet("v2_access")) {
          const v = body.v2_access;
          if (typeof v !== "boolean") {
            return res.status(400).json({ error: "v2_access must be a boolean" });
          }
          patch.v2_access = v;
        }

        // Meta Ads onboarding-tracker flag. Staff flips this on/off — the
        // body sends a boolean, we store NOW() / NULL on the timestamp
        // column. The client-portal tracker reads it via get_onboarding_progress().
        if (wasSet("meta_ads_marked_done")) {
          const v = body.meta_ads_marked_done;
          if (typeof v !== "boolean") {
            return res.status(400).json({ error: "meta_ads_marked_done must be a boolean" });
          }
          patch.meta_ads_marked_done_at = v ? new Date().toISOString() : null;
        }

        // GHL signup + Slack join onboarding flags — staff-only checks
        // (clients SEE them in their tracker but only BAM marks done).
        // Same boolean → timestamp pattern as meta_ads_marked_done.
        if (wasSet("ghl_signup_done")) {
          const v = body.ghl_signup_done;
          if (typeof v !== "boolean") {
            return res.status(400).json({ error: "ghl_signup_done must be a boolean" });
          }
          patch.ghl_signup_done_at = v ? new Date().toISOString() : null;
        }
        if (wasSet("slack_join_done")) {
          const v = body.slack_join_done;
          if (typeof v !== "boolean") {
            return res.status(400).json({ error: "slack_join_done must be a boolean" });
          }
          patch.slack_join_done_at = v ? new Date().toISOString() : null;
        }

        // Staff override flags for sections normally driven by the
        // client (Staff/Brand/Locations/Offers BB cards) or auto-derived
        // (General). Lets SMs unblock a client or mark sections done
        // out-of-band from the staff Onboarding tab. Each maps to its
        // *_marked_done_at column — null = unmark, NOW() = done.
        const overrideMap = {
          general_marked_done:   "general_marked_done_at",
          staff_marked_done:     "staff_marked_done_at",
          locations_marked_done: "locations_marked_done_at",
          brand_marked_done:     "brand_marked_done_at",
          offers_marked_done:    "offers_marked_done_at",
        };
        for (const [bodyField, col] of Object.entries(overrideMap)) {
          if (wasSet(bodyField)) {
            const v = body[bodyField];
            if (typeof v !== "boolean") {
              return res.status(400).json({ error: bodyField + " must be a boolean" });
            }
            patch[col] = v ? new Date().toISOString() : null;
          }
        }

        if (wasSet("onboarding_method")) {
          const m = body.onboarding_method;
          if (m !== null && !["call", "send_link"].includes(m)) {
            return res.status(400).json({ error: "onboarding_method must be 'call' or 'send_link'" });
          }
          patch.onboarding_method = m;
        }

        // call_completed_at: clients send boolean true/false (the checkbox state).
        // We translate to timestamp now() / null and auto-promote status to
        // 'active' when call done (so the Onboarding count drops + the client
        // counts toward Active).
        if (wasSet("call_completed_at")) {
          const v = body.call_completed_at;
          if (v === true) {
            patch.call_completed_at = new Date().toISOString();
            // Only auto-flip status if not explicitly overridden by the same patch
            if (!wasSet("status")) patch.status = "active";
          } else if (v === false || v === null) {
            patch.call_completed_at = null;
            // Reverting "call done" should drop them back to onboarding so the
            // status pill isn't lying — but only if the same patch didn't set
            // status explicitly.
            if (!wasSet("status")) patch.status = "onboarding";
          } else if (typeof v === "string") {
            // Pass-through ISO timestamp (in case we ever need to backfill)
            patch.call_completed_at = v;
          } else {
            return res.status(400).json({ error: "call_completed_at must be a boolean or ISO string" });
          }
        }

        // ── Admin+scaling-only fields ──
        if (wasSet("stripe_customer_id")) {
          if (!isAdminLike) return res.status(403).json({ error: "stripe_customer_id requires admin or scaling_manager" });
          patch.stripe_customer_id = setText("stripe_customer_id");
        }
        if (wasSet("notion_page_id")) {
          if (!isAdminLike) return res.status(403).json({ error: "notion_page_id requires admin or scaling_manager" });
          patch.notion_page_id = setText("notion_page_id");
        }

        if (!Object.keys(patch).length) return res.status(400).json({ error: "nothing to update" });
        patch.updated_at = new Date().toISOString();

        // If email is changing AND the client has a linked auth user, also
        // update auth.users.email so the owner can log in with the new
        // address. We do this BEFORE the clients PATCH so a 422 (e.g. email
        // already taken by another auth user) blocks the update — otherwise
        // we'd silently drift the auth login from the displayed email.
        let authEmailSync = null;
        if (patch.email !== undefined) {
          const existing = await supabaseSelect(`clients?id=eq.${client_id}&select=email,auth_user_id`);
          const prev = existing?.[0];
          const newEmail = patch.email;
          const changing = prev && newEmail && prev.email !== newEmail;
          if (changing && prev.auth_user_id) {
            const sync = await adminUpdateAuthEmail(prev.auth_user_id, newEmail);
            if (!sync.ok) {
              if (/already|duplicate|409|422/i.test(sync.error || "")) {
                // The new email is owned by a DIFFERENT auth user. Editing
                // the email field here would silently leave the original
                // owner with login access. The correct flow is Transfer
                // ownership, which demotes the old user and links the new
                // one — point staff there instead of just erroring.
                return res.status(409).json({
                  error: "That email already belongs to another login account. To put portal access on this email, use \"Transfer ownership\" in the Account management section below — it cleanly moves the client to the new person.",
                  code: "email_belongs_to_other_user",
                });
              }
              return res.status(400).json({ error: `couldn't update login email: ${sync.error}` });
            }
            authEmailSync = "updated";
            // Also keep the owner's client_users.email row in sync so the
            // teammate list shows the right address.
            await fetch(`${SUPABASE_URL}/rest/v1/client_users?user_id=eq.${prev.auth_user_id}&client_id=eq.${client_id}`, {
              method: "PATCH",
              headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                "Content-Type": "application/json",
                Prefer: "return=minimal",
              },
              body: JSON.stringify({ email: newEmail }),
            }).catch(() => {});
          }
        }

        const res2 = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${client_id}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify(patch),
        });
        if (!res2.ok) {
          const errText = await res2.text();
          return res.status(500).json({ error: `update failed: ${errText}` });
        }
        return res.status(200).json({ ok: true, auth_email_sync: authEmailSync, ...patch });
      }

      // ── action=archive ──
      // Soft-delete: sets clients.archived_at = now(). Hidden from active list.
      if (action === "archive") {
        const body = req.body || {};
        const client_id = typeof body.client_id === "string" ? body.client_id : "";
        if (!client_id) return res.status(400).json({ error: "client_id required" });
        const res2 = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${client_id}`, {
          method: "PATCH",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
        });
        if (!res2.ok) {
          const errText = await res2.text();
          return res.status(500).json({ error: `archive failed: ${errText}` });
        }
        return res.status(200).json({ ok: true, archived: true });
      }

      // (submit-feedback moved up to the public path so anonymous + clients
      //  + staff can all use the universal widget. See above.)

      // ── action=list-feedback ──
      // ZORAN-ONLY (email-gated, not role-gated). Returns the most recent
      // portal_feedback rows for the staff portal's Feedback tab.
      if (action === "list-feedback") {
        if (user.email !== ZORAN_EMAIL) {
          return res.status(403).json({ error: "feedback view is Zoran-only" });
        }
        const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
        const portalFilter = (req.query.portal === "client" || req.query.portal === "staff" || req.query.portal === "signup")
          ? `&portal=eq.${req.query.portal}` : "";
        const kindFilter = (req.query.kind === "bug" || req.query.kind === "feature")
          ? `&kind=eq.${req.query.kind}` : "";
        // Open first (resolved_at NULL), then by newest. Postgres orders NULLs
        // last by default with DESC; use ASC NULLS FIRST to put unresolved on top.
        const rows = await supabaseSelect(
          `portal_feedback?select=*${portalFilter}${kindFilter}&order=resolved_at.asc.nullsfirst,created_at.desc&limit=${limit}`
        );
        return res.status(200).json({ data: rows || [] });
      }

      // ── action=resolve-feedback ──
      // ZORAN-ONLY. Checks off a feedback item as resolved (or un-resolves
      // it with ?undo=1).
      if (action === "resolve-feedback") {
        if (user.email !== ZORAN_EMAIL) {
          return res.status(403).json({ error: "feedback resolve is Zoran-only" });
        }
        const fbId = typeof req.query.id === "string" ? req.query.id : "";
        if (!fbId) return res.status(400).json({ error: "id required" });
        const undo = req.query.undo === "1" || req.body?.undo === true;

        // Resolve the staff id for Zoran (for the resolved_by FK)
        const sRows = await supabaseSelect(
          `staff?email=eq.${encodeURIComponent(ZORAN_EMAIL)}&select=id`
        );
        const zoranStaffId = sRows?.[0]?.id || null;

        const updateBody = undo
          ? { resolved_at: null, resolved_by: null }
          : { resolved_at: new Date().toISOString(), resolved_by: zoranStaffId };
        const updRes = await fetch(
          `${SUPABASE_URL}/rest/v1/portal_feedback?id=eq.${encodeURIComponent(fbId)}`,
          {
            method: "PATCH",
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify(updateBody),
          }
        );
        if (!updRes.ok) {
          const txt = await updRes.text();
          return res.status(500).json({ error: `resolve failed: ${txt}` });
        }
        const updated = await updRes.json();
        if (!Array.isArray(updated) || updated.length === 0) {
          return res.status(404).json({ error: "feedback id not found" });
        }
        return res.status(200).json({ ok: true, resolved: !undo, item: updated[0] });
      }

      // ── action=transfer-owner ──
      // Admin/scaling-only. Atomically moves ownership of a client from
      // the current owner to a new email + name. Steps:
      //   1. Demote the old owner's client_users row (status='revoked')
      //      so they lose portal access via my_client_ids(). Audit trail
      //      preserved — we don't delete.
      //   2. Resolve the new owner's auth user: invite if email is fresh,
      //      link if the email already exists in auth (e.g. they own
      //      another client too). Mirrors setup-account / invite-staff.
      //   3. Patch clients: new auth_user_id + email + owner_name.
      //   4. Insert/upsert client_users row for the new owner with
      //      role='owner', status='active'.
      //   5. Send the new owner an invite/magiclink email + Slack.
      //
      // Old owner's auth.users account is NOT deleted — they may still
      // be staff somewhere, or own another client. Just lose access to
      // THIS client.
      if (action === "transfer-owner") {
        const body = req.body || {};
        const client_id = typeof body.client_id === "string" ? body.client_id : "";
        const new_email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const new_owner_name = typeof body.owner_name === "string" ? body.owner_name.trim() : "";
        if (!client_id) return res.status(400).json({ error: "client_id required" });
        if (!new_owner_name) return res.status(400).json({ error: "new owner name required" });
        if (!new_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_email)) {
          return res.status(400).json({ error: "valid email required" });
        }

        // Fetch current state
        const curRows = await supabaseSelect(
          `clients?id=eq.${client_id}&select=id,business_name,auth_user_id,email,owner_name,slack_channel_id`
        );
        const cur = curRows?.[0];
        if (!cur) return res.status(404).json({ error: "client not found" });
        if (cur.email && cur.email.toLowerCase() === new_email && cur.owner_name === new_owner_name) {
          return res.status(400).json({ error: "new owner matches current owner — nothing to transfer" });
        }

        // 1. Demote old owner (if any). Don't fail the transfer if the
        // row doesn't exist — clients without a corresponding
        // client_users row are valid (legacy data).
        if (cur.auth_user_id) {
          await fetch(
            `${SUPABASE_URL}/rest/v1/client_users?client_id=eq.${client_id}&user_id=eq.${cur.auth_user_id}`,
            {
              method: "PATCH",
              headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                "Content-Type": "application/json",
                Prefer: "return=minimal",
              },
              body: JSON.stringify({ status: "revoked", updated_at: new Date().toISOString() }),
            }
          ).catch(() => {});
        }

        // 2. Resolve new owner's auth user (invite OR link existing).
        const { clientUrl } = portalUrls(req);
        const redirectTo = `${clientUrl}/client-portal.html?type=invite`;
        let new_auth_user_id = null;
        let inviteMode = "invite";
        let actionLink = null;
        const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "invite",
            email: new_email,
            options: { redirect_to: redirectTo, data: { needs_password: true } },
          }),
        });
        if (inviteRes.ok) {
          const j = await inviteRes.json();
          new_auth_user_id = j?.id || j?.user?.id || null;
          actionLink = j?.action_link || null;
        } else {
          const errText = await inviteRes.text();
          if (inviteRes.status === 422 || /already/i.test(errText)) {
            const existingAuth = await findAuthUserByEmail(new_email);
            if (!existingAuth?.id) {
              return res.status(500).json({ error: "new owner exists in auth but couldn't be looked up" });
            }
            new_auth_user_id = existingAuth.id;
            inviteMode = "link-existing";
            // Issue a magiclink so the new owner has a clickable login.
            const ml = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
              method: "POST",
              headers: {
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                type: "magiclink", email: new_email,
                options: { redirect_to: redirectTo },
              }),
            });
            if (ml.ok) {
              const mj = await ml.json();
              actionLink = mj?.action_link || null;
            }
          } else {
            return res.status(400).json({ error: `invite: ${errText}` });
          }
        }
        if (!new_auth_user_id) {
          return res.status(500).json({ error: "couldn't resolve new owner auth user" });
        }

        // 3. Patch clients row (auth_user_id + email + owner_name).
        const updateRes = await fetch(
          `${SUPABASE_URL}/rest/v1/clients?id=eq.${client_id}`,
          {
            method: "PATCH",
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              auth_user_id: new_auth_user_id,
              email: new_email,
              owner_name: new_owner_name,
              updated_at: new Date().toISOString(),
            }),
          }
        );
        if (!updateRes.ok) {
          return res.status(500).json({ error: `clients update failed: ${await updateRes.text()}` });
        }

        // 4. Ensure client_users row exists for the new owner with role=owner.
        await ensureOwnerMembership({
          clientId: client_id, authUserId: new_auth_user_id,
          name: new_owner_name, email: new_email,
        });

        // 5. Email + Slack (best-effort, parallel).
        const [emailResult, slackResult] = actionLink
          ? await Promise.all([
              process.env.RESEND_API_KEY
                ? (inviteMode === "invite"
                    ? sendInviteEmail({
                        to: new_email, actionLink,
                        businessName: cur.business_name || "",
                        resendApiKey: process.env.RESEND_API_KEY,
                      })
                    : sendResetPasswordEmail({
                        to: new_email, actionLink,
                        resendApiKey: process.env.RESEND_API_KEY,
                      }))
                : Promise.resolve({ ok: false, skipped: true }),
              postInviteToSlack({
                slackChannelId: cur.slack_channel_id || null,
                businessName: cur.business_name || "",
                ownerName: new_owner_name, email: new_email, actionLink,
              }),
            ])
          : [{ ok: false, skipped: true }, { ok: false, skipped: true }];

        return res.status(200).json({
          ok: true,
          mode: inviteMode,
          old_owner: { email: cur.email, owner_name: cur.owner_name, auth_user_id: cur.auth_user_id },
          new_owner: { email: new_email, owner_name: new_owner_name, auth_user_id: new_auth_user_id },
          action_link: actionLink,
          email_sent: !!emailResult?.ok,
          slack_posted: !!slackResult?.ok,
          slack_skipped: !!slackResult?.skipped,
        });
      }

      if (action === "setup-account") {
        // Three-way smart invite:
        //   A. Client already accepted (has auth_user_id + onboarding_completed_at)
        //      → block, tell staff to use Reset password instead.
        //   B. Client invited but never completed onboarding (has auth_user_id,
        //      no onboarding_completed_at) → RESEND. Generate fresh magiclink,
        //      send via Resend + Slack, return link.
        //   C. No auth_user_id yet → search auth.users by email.
        //      - If a user with that email already exists (e.g. Mike — also
        //        the point of contact on other clients) → link this client
        //        to that user_id, generate a magiclink so they can log in,
        //        send a 'now has portal access' email + Slack.
        //      - If no existing user → generate_link(invite) which creates
        //        a fresh auth user AND returns the action_link.
        const body = req.body || {};
        const client_id = typeof body.client_id === "string" ? body.client_id : "";
        const owner_name = typeof body.owner_name === "string" ? body.owner_name.trim() : "";
        const newEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

        if (!client_id) return res.status(400).json({ error: "client_id required" });
        if (!owner_name) return res.status(400).json({ error: "point of contact name required" });
        if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
          return res.status(400).json({ error: "valid email required" });
        }
        if (!process.env.RESEND_API_KEY) {
          return res.status(500).json({ error: "RESEND_API_KEY not configured" });
        }

        const existing = await supabaseSelect(`clients?id=eq.${client_id}&select=id,business_name,auth_user_id,slack_channel_id,onboarding_completed_at`);
        if (!existing?.length) return res.status(404).json({ error: "client not found" });
        const row = existing[0];
        const businessName = row.business_name || "";
        const slackChannelId = row.slack_channel_id || null;

        const { clientUrl } = portalUrls(req);
        const redirectTo = `${clientUrl}/client-portal.html?type=invite`;

        // Helper: call generate_link with a given type and return action_link + user id.
        // redirect_to MUST be at the top level (not nested under options) or
        // Supabase silently ignores it and uses Site URL. See note in
        // generateLinkForResetOrInvite above for the full story.
        const genLink = async (type, extra = {}) => {
          const body = { type, email: newEmail, redirect_to: redirectTo, ...extra };
          const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
            method: "POST",
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
          if (!r.ok) {
            const t = await r.text();
            return { ok: false, status: r.status, text: t };
          }
          const j = await r.json();
          return {
            ok: true,
            actionLink: j?.properties?.action_link || j?.action_link,
            authUserId: j?.user?.id || j?.id,
          };
        };

        let mode = "invite"; // 'invite' | 'resend' | 'link-existing'
        let actionLink = null;
        let auth_user_id = null;

        // Case A: already fully onboarded
        if (row.auth_user_id && row.onboarding_completed_at) {
          return res.status(400).json({
            error: "this client already has an active account — use Send password reset instead",
          });
        }

        // Case B: invited but not accepted yet → resend
        if (row.auth_user_id && !row.onboarding_completed_at) {
          mode = "resend";
          const r = await genLink("magiclink");
          if (!r.ok) return res.status(500).json({ error: `resend link: ${r.text}` });
          actionLink = r.actionLink;
          auth_user_id = row.auth_user_id; // unchanged
        } else {
          // Case C: no auth_user_id yet. Try invite first; if user already
          // exists in auth, fall back to link-existing.
          const inviteRes = await genLink("invite", { data: { needs_password: true } });
          if (inviteRes.ok) {
            mode = "invite";
            actionLink = inviteRes.actionLink;
            auth_user_id = inviteRes.authUserId;
          } else if (inviteRes.status === 422 || /already/i.test(inviteRes.text || "")) {
            // User already exists — look up by email and link
            const existingUser = await findAuthUserByEmail(newEmail);
            if (!existingUser?.id) {
              return res.status(500).json({ error: "user exists in auth but couldn't be looked up" });
            }
            mode = "link-existing";
            auth_user_id = existingUser.id;
            // Generate a magiclink so they have something clickable in the
            // Slack/email notification.
            const ml = await genLink("magiclink");
            if (ml.ok) actionLink = ml.actionLink;
            // If magiclink fails (e.g. settings disabled), the access is
            // still wired up — they can log in normally with their existing
            // password. We just won't have a copy/paste link.
          } else {
            return res.status(400).json({ error: `invite: ${inviteRes.text}` });
          }
        }

        if (!auth_user_id) {
          return res.status(500).json({ error: "auth_user_id not resolved" });
        }

        // Update the clients row (skip on resend — auth_user_id unchanged,
        // and we don't want to overwrite owner_name/email mid-flight).
        if (mode !== "resend") {
          try {
            const updateRes = await fetch(
              `${SUPABASE_URL}/rest/v1/clients?id=eq.${client_id}`,
              {
                method: "PATCH",
                headers: {
                  apikey: SUPABASE_SERVICE_KEY,
                  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                  "Content-Type": "application/json",
                  Prefer: "return=representation",
                },
                body: JSON.stringify({ owner_name, email: newEmail, auth_user_id }),
              }
            );
            if (!updateRes.ok) throw new Error(`Supabase ${updateRes.status}: ${await updateRes.text()}`);
          } catch (updateErr) {
            // Only roll back the auth user if WE created it (invite mode).
            // For link-existing, the user belongs to other clients too.
            if (mode === "invite") {
              await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${auth_user_id}`, {
                method: "DELETE",
                headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
              }).catch(() => {});
            }
            return res.status(500).json({ error: `update failed: ${updateErr.message}` });
          }
        }

        // Wire the owner into client_users so they can log in to the
        // multi-user portal (clients.auth_user_id alone is not enough).
        // Runs for every mode incl. resend — idempotent, so it also
        // backfills any client invited before this wiring existed.
        await ensureOwnerMembership({
          clientId: client_id, authUserId: auth_user_id, name: owner_name, email: newEmail,
        });

        // Notify via Resend + Slack in parallel. For 'link-existing' the
        // copy is more about "you now have access" than "set your password",
        // but the invite email template is generic enough either way.
        const [emailRes, slackRes] = actionLink
          ? await Promise.all([
              sendInviteEmail({
                to: newEmail,
                actionLink,
                businessName,
                resendApiKey: process.env.RESEND_API_KEY,
              }),
              postInviteToSlack({
                slackChannelId,
                businessName,
                ownerName: owner_name,
                email: newEmail,
                actionLink,
              }),
            ])
          : [{ ok: false, error: "no link generated" }, { ok: false, skipped: true }];

        return res.status(200).json({
          id: client_id,
          business_name: businessName,
          email: newEmail,
          invited: true,
          mode,
          action_link: actionLink,
          email_sent: !!emailRes?.ok,
          slack_posted: !!slackRes?.ok,
          slack_skipped: !!slackRes?.skipped,
          slack_error: slackRes?.error || null,
        });
      }

      if (action === "reset-password") {
        // Old Supabase /auth/v1/recover flow relied on the "Reset Password" email
        // template configured in the Supabase dashboard — which got broken (no link
        // rendered). We now:
        //   1. Use admin/generate_link to get a one-shot recovery URL
         //   2. Send it ourselves via Resend with a clean BAM-branded template
        // This bypasses Supabase's email templates entirely for client-facing
        // emails. The invite (setup-account) flow is still on Supabase invite —
        // can be migrated later for consistency.
        const body = req.body || {};
        const targetEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!targetEmail) return res.status(400).json({ error: "email required" });
        if (!process.env.RESEND_API_KEY) {
          return res.status(500).json({ error: "RESEND_API_KEY not configured" });
        }

        const { clientUrl } = portalUrls(req);
        const redirectTo = `${clientUrl}/client-portal.html?type=recovery`;

        // Smart link: re-issues INVITE for never-confirmed clients (e.g.
        // someone we invited months ago who never clicked through), falls
        // back to RECOVERY for clients who already have a password.
        const link = await generateLinkForResetOrInvite({
          supabaseUrl: SUPABASE_URL,
          serviceKey: SUPABASE_SERVICE_KEY,
          email: targetEmail,
          redirectTo,
        });
        if (link.notFound) return res.status(200).json({ ok: true });
        if (!link.ok) {
          console.error("link gen failed:", link.error);
          return res.status(500).json({ error: "could not generate link" });
        }

        // Look up business + Slack channel for nicer messaging on resends
        let businessName = "";
        let slackChannelId = null;
        try {
          const c = await supabaseSelect(`clients?email=eq.${encodeURIComponent(targetEmail)}&select=business_name,slack_channel_id`);
          businessName = c?.[0]?.business_name || "";
          slackChannelId = c?.[0]?.slack_channel_id || null;
        } catch (_) { /* best-effort */ }

        const sent = link.kind === "invite"
          ? await sendInviteEmail({
              to: targetEmail,
              actionLink: link.actionLink,
              businessName,
              resendApiKey: process.env.RESEND_API_KEY,
            })
          : await sendResetPasswordEmail({
              to: targetEmail,
              actionLink: link.actionLink,
              resendApiKey: process.env.RESEND_API_KEY,
            });
        if (!sent.ok) {
          return res.status(500).json({ error: "failed to send email" });
        }

        // If we re-issued an INVITE (never-accepted client), also post to
        // Slack so they have a second delivery channel — same pattern as
        // setup-account. Recovery resets don't ping Slack (the user is
        // already active and most likely just lost their password).
        let slackPosted = false;
        if (link.kind === "invite" && slackChannelId) {
          const sr = await postInviteToSlack({
            slackChannelId,
            businessName,
            ownerName: "",
            email: targetEmail,
            actionLink: link.actionLink,
          });
          slackPosted = !!sr?.ok;
        }

        return res.status(200).json({
          ok: true,
          sent_to: targetEmail,
          kind: link.kind,
          slack_posted: slackPosted,
        });
      }

      // ── Validate inputs (no password — invite flow) ──
      const body = req.body || {};
      const business_name = typeof body.business_name === "string" ? body.business_name.trim() : "";
      const owner_name    = typeof body.owner_name === "string" ? body.owner_name.trim() : "";
      const email         = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const status        = typeof body.status === "string" && ["onboarding","active","paused","churned"].includes(body.status) ? body.status : "onboarding";

      if (!business_name) return res.status(400).json({ error: "business name required" });
      if (!owner_name) return res.status(400).json({ error: "owner name required" });
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "valid email required" });
      }

      // ── Send invite, fall back to link-existing on 422 ──
      const { clientUrl } = portalUrls(req);
      const redirectTo = `${clientUrl}/client-portal.html?type=invite`;
      const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, redirect_to: redirectTo }),
      });
      let auth_user_id = null;
      let mode = "invite";
      if (inviteRes.ok) {
        const invited = await inviteRes.json();
        auth_user_id = invited?.id || invited?.user?.id || null;
        if (!auth_user_id) return res.status(500).json({ error: "invite sent but no user id returned" });
      } else {
        const errText = await inviteRes.text();
        if (inviteRes.status === 422 || /already/i.test(errText)) {
          const existingAuth = await findAuthUserByEmail(email);
          if (!existingAuth?.id) {
            return res.status(500).json({ error: "user exists in auth but couldn't be looked up" });
          }
          auth_user_id = existingAuth.id;
          mode = "link-existing";
        } else {
          return res.status(400).json({ error: `invite: ${errText}` });
        }
      }

      // ── Insert the clients row, linked to the auth user ──
      try {
        const rows = await supabaseInsert("clients", {
          business_name, owner_name, email, status, auth_user_id,
        });
        const row = Array.isArray(rows) ? rows[0] : rows;
        // Wire the owner into client_users so they can actually log in to
        // the multi-user portal (clients.auth_user_id alone is not enough).
        await ensureOwnerMembership({
          clientId: row?.id, authUserId: auth_user_id, name: owner_name, email,
        });
        return res.status(200).json({
          id: row?.id, business_name: row?.business_name, email,
          invited: mode === "invite", linked: mode === "link-existing",
        });
      } catch (insertErr) {
        // Only roll back the auth user if WE created it (invite mode).
        // For link-existing, the user belongs to other resources too.
        if (mode === "invite") {
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${auth_user_id}`, {
            method: "DELETE",
            headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
          }).catch(() => {});
        }
        return res.status(500).json({ error: `clients insert failed: ${insertErr.message}` });
      }
    } catch (err) {
      console.error("/api/clients POST error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Lightweight counts used by the staff per-client Onboarding tab so SMs
  // see "3 offers", "2 locations", "1 teammate" inline next to each
  // section status. Returns { count }. No deep client_id auth check
  // because the values are non-sensitive aggregate counts — service-role
  // can fetch them; staff Bearer is the gate at the network layer.
  if (req.method === "GET" && req.query.action) {
    const cnt = async (table, filters) => {
      const url = `${SUPABASE_URL}/rest/v1/${table}?${filters}&select=id`;
      const r = await fetch(url, {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          Prefer: "count=exact",
          "Range-Unit": "items",
          Range: "0-0",
        },
      });
      const cr = r.headers.get("content-range") || "";
      const m = cr.match(/\/(\d+)$/);
      return m ? Number(m[1]) : 0;
    };
    const clientId = req.query.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id required" });
    try {
      if (req.query.action === "count-offers") {
        return res.status(200).json({ count: await cnt("offers", `client_id=eq.${clientId}&status=neq.archived`) });
      }
      if (req.query.action === "count-locations") {
        return res.status(200).json({ count: await cnt("locations", `client_id=eq.${clientId}`) });
      }
      if (req.query.action === "count-teammates") {
        return res.status(200).json({ count: await cnt("client_users", `client_id=eq.${clientId}&status=eq.active&role=neq.owner`) });
      }
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  try {
    const id = req.query.id;
    const path = id
      ? `clients?id=eq.${encodeURIComponent(id)}&select=*`
      : `clients?select=*&order=business_name.asc`;

    const rows = await supabaseSelect(path);

    const enriched = await Promise.all(
      rows.map(async (row) => {
        const revenue = await getStripeRevenue(row.stripe_customer_id);
        return shapeClient(row, revenue);
      })
    );

    return res.status(200).json({ data: id ? enriched[0] : enriched });
  } catch (err) {
    console.error("/api/clients error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
