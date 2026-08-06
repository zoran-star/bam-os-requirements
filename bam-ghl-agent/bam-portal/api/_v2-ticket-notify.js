// Staff notifier for the V2 ticket rail (api/v2-tickets.js).
//
// WHY THIS EXISTS: every mutation on the rail already called a notify hook, but
// the hook was a console.log stub, so nobody was ever told a ticket existed. A
// real client campaign request sat status='new' and unowned for 15 days because
// of it (BAM GTA, 2026-07-22). This turns the hook into a Slack DM to whoever
// the work actually belongs to.
//
// ROUTING (never hardcode a person):
//   1. ticket.assigned_to  ->  DM that staff member.
//   2. no owner            ->  DM the lane's fallback, resolved from the staff
//                              table: content -> the marketing manager (by
//                              MARKETING_MANAGER_EMAIL, default Cam), marketing
//                              -> the marketing executor (by
//                              MARKETING_EXECUTOR_EMAIL, else the first
//                              role='marketing_executor' row).
//   3. any other lane      ->  V2_TICKET_TRIAGE_EMAIL if set, else nobody.
// Lane fallback matters because most clients have no scaling_manager_id, so
// marketing tickets land unowned - exactly the case that motivated this work.
//
// SAFETY: this module NEVER throws and never rejects. Every network call is
// wrapped, Slack is given a hard timeout, and a missing SLACK_BOT_TOKEN (or a
// recipient with no slack_user_id) is a clean silent no-op. A ticket mutation
// can never be broken by it. It is also purely event-driven - there is no
// sweep, cron, or backfill here, so historical tickets are never touched.
//
// HARD RULE: no em dash (U+2014) in any string below. These are person-facing.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const SLACK_TIMEOUT_MS = 4000;

// Read-only Supabase helper. Throws on failure; every caller is inside a guard.
async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const STAFF_COLS = "id,name,email,slack_user_id";

async function staffById(id) {
  if (!id) return null;
  try {
    const rows = await sb(`staff?id=eq.${encodeURIComponent(id)}&select=${STAFF_COLS}`);
    return rows?.[0] || null;
  } catch (_) { return null; }
}

async function staffByEmail(email) {
  if (!email) return null;
  try {
    const rows = await sb(`staff?email=eq.${encodeURIComponent(email)}&select=${STAFF_COLS}`);
    return rows?.[0] || null;
  } catch (_) { return null; }
}

// Lane owner of last resort when a ticket lands with assigned_to = null.
// Resolved from the staff table by email or role, never by a pinned uuid.
async function laneFallbackStaff(role) {
  try {
    if (role === "content") {
      // Ads content defaults to the marketing manager, same resolver
      // marketingManagerStaffId() uses for auto-assignment.
      return await staffByEmail(process.env.MARKETING_MANAGER_EMAIL || "cameron@byanymeansbusiness.com");
    }
    if (role === "marketing") {
      // The teammate who actually posts the ads. Mirrors
      // marketingExecutorSlackId() in api/marketing.js.
      const email = process.env.MARKETING_EXECUTOR_EMAIL;
      if (email) {
        const byEmail = await staffByEmail(email);
        if (byEmail) return byEmail;
      }
      const rows = await sb(`staff?role=eq.marketing_executor&select=${STAFF_COLS}&order=created_at.asc&limit=1`);
      return rows?.[0] || null;
    }
    // systems / agent_supervision / backlog: Zoran (his call, 2026-08-06). The
    // `fix` type routes to backlog SPECIFICALLY so he triages client-reported
    // bugs first, so he is the lane's owner by design, not by convenience.
    // Defaulted in code rather than left to an unset env var, because "nobody
    // is told about client bug reports" was already the live state and a var
    // nobody sets would have preserved it.
    //
    // NOTE: as of writing his staff row has no slack_user_id, so this resolves
    // a recipient and then reports `no_slack_user_id` rather than sending. That
    // is deliberate and now VISIBLE in the logs (see notifyTicketEvent), which
    // beats resolving nobody and reporting a silent `no_recipient`. It starts
    // working the moment he connects Slack, with no code change.
    return await staffByEmail(process.env.V2_TICKET_TRIAGE_EMAIL || "zoran@byanymeansbball.com");
  } catch (_) { return null; }
}

async function academyName(clientId) {
  if (!clientId) return "";
  try {
    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=business_name`);
    return rows?.[0]?.business_name || "";
  } catch (_) { return ""; }
}

// ── Links ──────────────────────────────────────────────────────────────────
// Staff work lives in the staff portal, and the active page rides in ?p=
// (src/App.jsx reads ?p= then the legacy ?nav=). Pinned to STAFF_PORTAL_URL,
// else the canonical host - never derived from request headers, so a Vercel
// preview origin can't leak into a Slack DM. Same reasoning as api/messages.js.
const LANE_PAGE = {
  content: "content-v2",
  marketing: "marketing-v2",
  systems: "website-v2",
};

// Lanes with no page of their own land on the staff portal root, which is a
// dead end for the reader. Point them at the feedback queue, which is where
// backlog (client bug reports and ideas) is actually worked.
const LANE_PAGE_FALLBACK = "feedback";

// Env overrides api/marketing.js honours before any DB lookup. Mirrored here so
// the two Slack paths cannot disagree about who gets the ping.
const LANE_SLACK_ID_ENV = {
  content: "MARKETING_DM_SLACK_ID",
  marketing: "MARKETING_EXECUTOR_SLACK_ID",
};

function staffPortalOrigin(req) {
  if (process.env.STAFF_PORTAL_URL) return process.env.STAFF_PORTAL_URL.replace(/\/+$/, "");
  const reqOrigin = (req && (req.headers?.origin || (req.headers?.host ? `https://${req.headers.host}` : ""))) || "";
  if (/localhost|127\.0\.0\.1/.test(reqOrigin)) return reqOrigin.replace(/\/+$/, "");
  return "https://staff.byanymeansbusiness.com";
}

function laneLink(role, req) {
  const origin = staffPortalOrigin(req);
  return `${origin}/?p=${LANE_PAGE[role] || LANE_PAGE_FALLBACK}`;
}

const LANE_LABEL = {
  content: "Content",
  marketing: "Marketing",
  systems: "Website",
  agent_supervision: "Agent supervision",
  backlog: "Backlog",
};

const TYPE_LABEL = {
  fix: "bug report",
  website_change: "website change",
  billing_fix: "billing fix",
  data_fix: "data fix",
  build_ask: "build request",
  agent_correction: "agent correction",
  marketing_ask: "marketing request",
  content_ask: "content request",
  feature_idea: "feature idea",
  general: "request",
};

// ── Slack ──────────────────────────────────────────────────────────────────
// A user id works as `channel` for chat.postMessage (Slack opens/uses the IM).
// Same call shape as postStaffSlackDM() in api/marketing.js, plus a hard
// timeout so a hanging Slack can never stall a ticket mutation.
async function slackDM(slackUserId, text) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || !slackUserId || !text) return { ok: false, error: "not_configured" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SLACK_TIMEOUT_MS);
  try {
    const resp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: slackUserId, text, unfurl_links: false }),
      signal: ctl.signal,
    });
    const json = await resp.json().catch(() => ({}));
    if (!json.ok) {
      console.error("[v2-tickets] Slack DM rejected:", json.error || resp.status);
      return { ok: false, error: json.error || "slack_error" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[v2-tickets] Slack DM failed:", err?.message || err);
    return { ok: false, error: err?.message || "exception" };
  } finally {
    clearTimeout(timer);
  }
}

// ── Message copy ───────────────────────────────────────────────────────────
// Slack parses its own markup out of `text`, and BOTH values we quote here are
// CLIENT-TYPED: the ticket title and the body of a client reply. Unescaped, a
// client could title a ticket
//   <https://evil.example.com|URGENT: click here to verify your Slack>
// and it would render in Cam's DMs as a bold clickable link, sent by the
// trusted BAM Portal bot. Same trick smuggles in <!channel> and <@U123> pings.
// `unfurl_links:false` does NOT help - that suppresses previews, not links.
// Escaping these three characters is Slack's documented fix, and it must happen
// here rather than at the call sites so a future message cannot forget it.
const slackEscape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function quote(s, max = 180) {
  const t = (s || "").toString().replace(/\s+/g, " ").trim();
  if (!t) return "";
  // Truncate BEFORE escaping, so the entity expansion cannot be cut mid-sequence
  // and so `max` still means "180 characters the human sees".
  return `> ${slackEscape(t.length > max ? `${t.slice(0, max)}...` : t)}`;
}

// The "why you" line. Owned work reads as yours; unowned work reads as the
// lane's, so nobody assumes someone else already has it.
function ownershipLine(owned, role, action) {
  const lane = LANE_LABEL[role] || "staff";
  return owned
    ? `It is assigned to you. ${action}.`
    : `Nobody owns it yet, so it is sitting in the ${lane} queue. ${action}, or reassign it.`;
}

// Returns the Slack text for an event, or null if the event does not warrant
// a DM. Keeping this pure makes the routing above easy to reason about.
function buildText(event, ticket, opts, owned, academy, link) {
  const type = TYPE_LABEL[ticket?.type] || "request";
  const role = ticket?.assignee_role;
  // Escaped too. It is staff-entered rather than client-typed, so the risk is
  // far lower than the title, but an academy named with an angle bracket would
  // otherwise break the message shape, and a second rule is cheaper than
  // remembering which of these two strings was safe.
  const at = academy ? ` for *${slackEscape(academy)}*` : "";
  const title = quote(ticket?.title);

  if (event === "created") {
    return [
      `New ${type}${at}`,
      title,
      ownershipLine(owned, role, "Open it and take the first step"),
      `-> ${link}`,
    ].filter(Boolean).join("\n");
  }

  if (event === "handoff") {
    return [
      `Creative is finished and handed to marketing${at}`,
      title,
      ownershipLine(owned, role, "Launch it and mark it live"),
      `-> ${link}`,
    ].filter(Boolean).join("\n");
  }

  if (event === "reply") {
    return [
      `${academy || "A client"} replied on a ${type}`,
      title,
      quote(opts.preview),
      ownershipLine(owned, role, "They are waiting on a response, so open the thread and reply"),
      `-> ${link}`,
    ].filter(Boolean).join("\n");
  }

  if (event === "reassigned") {
    return [
      `A ${type}${at} was moved to you`,
      title,
      ownershipLine(owned, role, "Open it and pick it up"),
      `-> ${link}`,
    ].filter(Boolean).join("\n");
  }

  return null;
}

// Events that reach a person. Everything else is a staff member acting on
// their own ticket (status, final-upload, live) or is aimed at the client
// rather than at staff (client-action-requested), so a DM would be noise.
const NOTIFY_EVENTS = new Set(["created", "handoff", "reply", "reassigned"]);

/**
 * Fire the staff Slack DM for one ticket event. Never throws.
 *
 * @param {string} event   created | handoff | reply | reassigned | (others ignored)
 * @param {object} ticket  the v2_tickets row (post-mutation shape)
 * @param {object} opts
 *   req            - the incoming request, for the localhost link fallback
 *   actorStaffId   - the staff member who caused the event (never DM yourself)
 *   actorKind      - 'client' | 'staff', required for 'reply'
 *   preview        - reply body, for the 'reply' preview line
 *   ownerChanged   - 'reassigned' only: did the effective owner/lane change
 * @returns {Promise<{sent: boolean, reason?: string, to?: string}>}
 */
export async function notifyTicketStaff(event, ticket, opts = {}) {
  try {
    if (!ticket || !NOTIFY_EVENTS.has(event)) return { sent: false, reason: "event_skipped" };
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { sent: false, reason: "supabase_not_configured" };
    // Cheap exit before any DB work when Slack isn't wired up at all.
    if (!process.env.SLACK_BOT_TOKEN) return { sent: false, reason: "slack_not_configured" };

    // A staff reply is the owner talking to the client. Only a CLIENT reply
    // means somebody is waiting on us.
    if (event === "reply" && opts.actorKind !== "client") return { sent: false, reason: "staff_reply" };
    // A reassign that changed neither the owner nor the lane is a no-op move.
    if (event === "reassigned" && !opts.ownerChanged) return { sent: false, reason: "owner_unchanged" };

    const owner = await staffById(ticket.assigned_to);
    const recipient = owner || await laneFallbackStaff(ticket.assignee_role);
    if (!recipient) return { sent: false, reason: "no_recipient" };
    if (opts.actorStaffId && String(opts.actorStaffId) === String(recipient.id)) {
      return { sent: false, reason: "self" };
    }
    // Honour the SAME env overrides api/marketing.js checks first
    // (marketingManagerSlackId :381, marketingExecutorSlackId :396). Without
    // this, if either var is set in prod, the V2 rail would DM a different
    // person than every other Slack DM in the codebase, and the difference
    // would be invisible until someone noticed a message in the wrong place.
    // Only applies on the LANE FALLBACK: an explicitly assigned owner is a
    // deliberate choice and must never be redirected by an env var.
    const overrideSlackId = owner ? null : LANE_SLACK_ID_ENV[ticket.assignee_role];
    const slackId = (overrideSlackId && process.env[overrideSlackId]) || recipient.slack_user_id;
    if (!slackId) return { sent: false, reason: "no_slack_user_id" };

    const academy = await academyName(ticket.client_id);
    const link = laneLink(ticket.assignee_role, opts.req);
    const text = buildText(event, ticket, opts, !!owner, academy, link);
    if (!text) return { sent: false, reason: "no_text" };

    const r = await slackDM(slackId, text);
    return { sent: !!r.ok, reason: r.ok ? undefined : r.error, to: recipient.id };
  } catch (err) {
    // Belt and braces: nothing above is allowed to reach a ticket mutation.
    console.error("[v2-tickets] notify failed:", err?.message || err);
    return { sent: false, reason: "exception" };
  }
}
