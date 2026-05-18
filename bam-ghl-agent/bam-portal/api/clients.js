// Vercel Serverless Function — Clients (Supabase clients table + live Stripe revenue)
// GET /api/clients               → list all clients
// GET /api/clients?id=<uuid>     → single client

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_API = "https://api.stripe.com/v1";

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
              <p style="margin:0 0 6px;font-family:'JetBrains Mono',Menlo,monospace;font-size:11px;font-weight:600;color:#8B6914;letter-spacing:0.14em;text-transform:uppercase;">Client Portal</p>
              <h1 style="margin:0 0 18px;font-family:'Space Grotesk',-apple-system,sans-serif;font-size:28px;font-weight:700;letter-spacing:-0.025em;color:#0B0B0D;line-height:1.15;">
                Reset your password
              </h1>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#3A3A45;">
                We got a request to reset the password on your BAM Business portal account.
                Click the button below to choose a new one.
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
                BAM Business · <a href="https://bam-portal-tawny.vercel.app/client-portal.html" style="color:#AAA;text-decoration:underline;">Client portal</a>
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

async function sendResetPasswordEmail({ to, actionLink, resendApiKey }) {
  const { html, text } = buildResetPasswordEmail(actionLink);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: "Supabase env vars missing (need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)" });
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

        // Generate the recovery link via Supabase admin endpoint.
        const origin = req.headers.origin || `https://${req.headers.host}`;
        const redirectTo = `${origin}/client-portal.html?type=recovery`;
        const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ type: "recovery", email, options: { redirect_to: redirectTo } }),
        });
        if (!linkRes.ok) {
          // 404 = user not found. Return generic success to avoid email enumeration.
          await logResetAttempt(false);
          return res.status(200).json(GENERIC_RESET_RESPONSE);
        }
        const linkJson = await linkRes.json();
        const actionLink = linkJson?.properties?.action_link || linkJson?.action_link;
        if (!actionLink) {
          console.error("generate_link returned no action_link (public reset)");
          await logResetAttempt(false);
          return res.status(200).json(GENERIC_RESET_RESPONSE);
        }

        // Send via shared helper (BAM-branded, email-client-bulletproof template).
        const sent = await sendResetPasswordEmail({
          to: email,
          actionLink,
          resendApiKey: process.env.RESEND_API_KEY,
        });
        await logResetAttempt(sent.ok);
        // Always return generic success regardless of whether send succeeded
        // (don't leak infra failure info to anonymous callers).
        return res.status(200).json(GENERIC_RESET_RESPONSE);
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
        const origin = req.headers.origin || `https://${req.headers.host}`;
        const redirectTo = `${origin}/client-portal.html?type=invite`;
        const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, redirect_to: redirectTo, data: { needs_password: true } }),
        });
        if (!inviteRes.ok) {
          // 422 = already exists in auth (no clients row though — orphan auth user).
          // Either way: log + return generic success. Never echo Supabase error text.
          await logAttempt(false);
          return res.status(200).json(GENERIC_RESPONSE);
        }
        const invited = await inviteRes.json();
        const auth_user_id = invited?.id || invited?.user?.id;
        if (!auth_user_id) {
          await logAttempt(false);
          return res.status(200).json(GENERIC_RESPONSE);
        }

        try {
          await supabaseInsert("clients", {
            business_name, owner_name, email, status: "onboarding", auth_user_id,
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
      //   update-fields            any staff (field-level gating below)
      //   (default insert)         admin+scaling
      const ADMIN_ONLY_ACTIONS = new Set(["invite-staff", "create-client", "setup-account", "reset-password", "archive"]);
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

        // Refuse if a staff row with this email already exists
        const dup = await supabaseSelect(`staff?email=eq.${encodeURIComponent(newEmail)}&select=id`);
        if (dup?.length) {
          return res.status(409).json({ error: "a staff member with that email already exists" });
        }

        // Send Supabase invite — creates auth user, emails the password-set link.
        // Redirect goes to staff portal root so they land in the right app.
        const origin = req.headers.origin || `https://${req.headers.host}`;
        const redirectTo = `${origin}/?type=invite`;
        const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: newEmail, redirect_to: redirectTo }),
        });
        if (!inviteRes.ok) {
          const errText = await inviteRes.text();
          const friendly = inviteRes.status === 422 || /already/i.test(errText)
            ? "an account with that email already exists in auth"
            : `invite: ${errText}`;
          return res.status(400).json({ error: friendly });
        }
        const invited = await inviteRes.json();
        const auth_user_id = invited?.id || invited?.user?.id;
        if (!auth_user_id) return res.status(500).json({ error: "invite sent but no auth user id returned" });

        // Insert the staff row
        try {
          const rows = await supabaseInsert("staff", {
            name: newName,
            email: newEmail,
            role: newRole,
            user_id: auth_user_id,
          });
          const row = Array.isArray(rows) ? rows[0] : rows;
          return res.status(200).json({ id: row?.id, name: newName, email: newEmail, role: newRole, invited: true });
        } catch (insertErr) {
          // Roll back the auth user if the staff insert fails so we don't orphan
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${auth_user_id}`, {
            method: "DELETE",
            headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
          }).catch(() => {});
          return res.status(500).json({ error: `staff insert failed: ${insertErr.message}` });
        }
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
        return res.status(200).json({ ok: true, ...patch });
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

      if (action === "setup-account") {
        // Send an INVITE email to the client. They click the link to set their
        // own password (never seen by us). Updates the clients row with
        // owner_name + email + auth_user_id once the invite call succeeds.
        const body = req.body || {};
        const client_id = typeof body.client_id === "string" ? body.client_id : "";
        const owner_name = typeof body.owner_name === "string" ? body.owner_name.trim() : "";
        const newEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

        if (!client_id) return res.status(400).json({ error: "client_id required" });
        if (!owner_name) return res.status(400).json({ error: "owner name required" });
        if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
          return res.status(400).json({ error: "valid email required" });
        }

        const existing = await supabaseSelect(`clients?id=eq.${client_id}&select=id,business_name,auth_user_id`);
        if (!existing?.length) return res.status(404).json({ error: "client not found" });
        if (existing[0].auth_user_id) {
          return res.status(400).json({ error: "this client already has an account — use Reset password instead" });
        }

        // Send invite via Supabase admin endpoint — creates the auth user (no
        // password) AND emails the invite link in one call.
        // user_metadata.needs_password=true is a defensive marker so the client portal
        // forces the password-set form even if redirect query params get stripped.
        const origin = req.headers.origin || `https://${req.headers.host}`;
        const redirectTo = `${origin}/client-portal.html?type=invite`;
        const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: newEmail, redirect_to: redirectTo, data: { needs_password: true } }),
        });
        if (!inviteRes.ok) {
          const errText = await inviteRes.text();
          const friendly = inviteRes.status === 422 || /already/i.test(errText)
            ? "an account with that email already exists"
            : `invite: ${errText}`;
          return res.status(400).json({ error: friendly });
        }
        const invited = await inviteRes.json();
        const auth_user_id = invited?.id || invited?.user?.id;
        if (!auth_user_id) return res.status(500).json({ error: "invite sent but no user id returned" });

        // Update the clients row
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
          const rows = await updateRes.json();
          return res.status(200).json({ id: client_id, business_name: rows?.[0]?.business_name, email: newEmail, invited: true });
        } catch (updateErr) {
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${auth_user_id}`, {
            method: "DELETE",
            headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
          }).catch(() => {});
          return res.status(500).json({ error: `update failed: ${updateErr.message}` });
        }
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

        const origin = req.headers.origin || `https://${req.headers.host}`;
        const redirectTo = `${origin}/client-portal.html?type=recovery`;

        // Step 1: generate the recovery link via Supabase admin endpoint
        const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "recovery",
            email: targetEmail,
            options: { redirect_to: redirectTo },
          }),
        });
        if (!linkRes.ok) {
          const errText = await linkRes.text();
          // Common case: user not found → return generic 200 to avoid email enumeration
          if (linkRes.status === 404 || /not found/i.test(errText)) {
            return res.status(200).json({ ok: true });
          }
          console.error("generate_link failed:", errText);
          return res.status(500).json({ error: "could not generate reset link" });
        }
        const linkJson = await linkRes.json();
        const actionLink = linkJson?.properties?.action_link || linkJson?.action_link;
        if (!actionLink) {
          console.error("generate_link returned no action_link:", JSON.stringify(linkJson).slice(0, 200));
          return res.status(500).json({ error: "reset link missing from response" });
        }

        // Step 2: send via the shared helper (BAM-branded, email-client-bulletproof).
        const sent = await sendResetPasswordEmail({
          to: targetEmail,
          actionLink,
          resendApiKey: process.env.RESEND_API_KEY,
        });
        if (!sent.ok) {
          return res.status(500).json({ error: "failed to send email" });
        }
        return res.status(200).json({ ok: true, sent_to: targetEmail });
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

      // ── Send invite (creates auth user with no password + emails the link) ──
      const origin = req.headers.origin || `https://${req.headers.host}`;
      const redirectTo = `${origin}/client-portal.html?type=invite`;
      const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, redirect_to: redirectTo }),
      });
      if (!inviteRes.ok) {
        const errText = await inviteRes.text();
        const friendly = inviteRes.status === 422 || /already/i.test(errText)
          ? "an account with that email already exists"
          : `invite: ${errText}`;
        return res.status(400).json({ error: friendly });
      }
      const invited = await inviteRes.json();
      const auth_user_id = invited?.id || invited?.user?.id;
      if (!auth_user_id) return res.status(500).json({ error: "invite sent but no user id returned" });

      // ── Insert the clients row, linked to the new auth user ──
      try {
        const rows = await supabaseInsert("clients", {
          business_name, owner_name, email, status, auth_user_id,
        });
        const row = Array.isArray(rows) ? rows[0] : rows;
        return res.status(200).json({ id: row?.id, business_name: row?.business_name, email, invited: true });
      } catch (insertErr) {
        // Roll back the auth user if the clients insert fails so they don't get orphaned
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${auth_user_id}`, {
          method: "DELETE",
          headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
        }).catch(() => {});
        return res.status(500).json({ error: `clients insert failed: ${insertErr.message}` });
      }
    } catch (err) {
      console.error("/api/clients POST error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

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
