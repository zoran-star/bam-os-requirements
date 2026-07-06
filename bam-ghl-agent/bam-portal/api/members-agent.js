import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function — Member-Management AGENT (natural language)
//
//   POST /api/members-agent   (staff OR client bearer)
//     body: { client_id, message, history?: [{ role:'user'|'assistant', text }] }
//
// A conversational command bar for the V2 Members tab. Staff type plain
// English ("pause Tristan 30 days", "refund Aarav $50", "cancel Ryan") and
// Claude parses it into ONE of the existing api/members.js billing actions.
//
// SAFETY MODEL — this endpoint NEVER writes billing:
//   • READ tools (find_members, get_member) run server-side automatically so
//     Claude can resolve a name → member_id and gather context (recent charges
//     for refunds, current plan, sub status).
//   • WRITE tools (pause, cancel, refund, change, …) are PROPOSAL-ONLY. When
//     Claude picks one, we STOP and return { proposal } to the UI. The actual
//     write happens only when the human clicks Confirm, which fires the proven
//     PATCH /api/members?id=… path with the user's own bearer (auth re-checked,
//     Stripe conventions honored, member_audit_log row written there).
//
// So this file translates language → a structured proposal. It does not, and
// must not, mutate Stripe or the DB. Defense in depth: even a bad proposal is
// re-authorized by the members.js PATCH handler before anything happens.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY        = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL      = "claude-sonnet-4-6"; // matches the other portal agents

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

// ── Auth: staff (any academy) OR a client user scoped to their academies ──
// Mirrors resolveUser in api/members.js so scoping is identical.
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

  let staffRows = await sb(`staff?user_id=eq.${user.id}&select=id,name,role`);
  if ((!staffRows || !staffRows[0]) && user.email) {
    staffRows = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,role`);
  }
  const staff = Array.isArray(staffRows) && staffRows[0] ? staffRows[0] : null;

  const memberships = await sb(
    `client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`
  );
  const clientIds = Array.isArray(memberships)
    ? [...new Set(memberships.map(m => m.client_id).filter(Boolean))]
    : [];

  return { user, staff, clientIds };
}

// ── Stripe helper (read-only here — connected-account GETs for context) ──
async function stripeFetch(path, { stripeAccount } = {}) {
  const stripeSecret = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const headers = { Authorization: `Bearer ${stripeSecret}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const res = await fetch(`https://api.stripe.com/v1${path}`, { headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
  return json;
}

// ─────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────
// READ tools run server-side; WRITE tools are named exactly like the
// api/members.js action strings so the proposal maps 1:1 (tool name = action).

const READ_TOOLS = [
  {
    name: "find_members",
    description: "Search this academy's roster by athlete or parent name. Use this FIRST to turn a name in the user's message into a member_id. Returns up to 12 matches with id, names, status and whether they have a Stripe subscription.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Part of the athlete's or parent's name, e.g. 'Tristan' or 'Pierre'." } },
      required: ["query"],
    },
  },
  {
    name: "get_member",
    description: "Get one member's full billing context by id: current plan, subscription status, and recent charges (with charge_id + amount + status, so you can see a failed charge). Call this before proposing a refund, or to explain why a specific member's payment failed.",
    input_schema: {
      type: "object",
      properties: { member_id: { type: "string", description: "The member's uuid from find_members." } },
      required: ["member_id"],
    },
  },
  {
    name: "list_members",
    description: "List or count members by billing status. Use for roster questions like 'who has failed payments', 'how many are paused', or 'show members with billing issues'. Omit everything to get a count of every status. status: live | paused | payment_failed (a charge bounced) | payment_method_required (no card on file) | cancelling. Set issues_only=true to get everyone in a problem state (payment_failed + payment_method_required).",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["live", "paused", "payment_failed", "payment_method_required", "cancelling"] },
        issues_only: { type: "boolean", description: "true = return all members with a billing problem (failed payment OR no card on file)." },
      },
    },
  },
];

// Each WRITE tool mirrors the body shape of the matching api/members.js action.
// member_id is always required. These are NEVER executed here — a match returns
// a proposal for the human to confirm.
const WRITE_TOOLS = [
  {
    name: "pause",
    description: "Pause a member's billing for a date range (Stripe trial_end is pushed out by the pause length). start_date/end_date are YYYY-MM-DD. Compute them from today's date given in the system prompt.",
    input_schema: {
      type: "object",
      properties: {
        member_id: { type: "string" },
        start_date: { type: "string", description: "Pause start, YYYY-MM-DD (usually today)." },
        end_date: { type: "string", description: "Pause end, YYYY-MM-DD." },
        reason: { type: "string" },
        next_payment_date: { type: "string", description: "Optional YYYY-MM-DD to force the next charge date instead of computing it." },
      },
      required: ["member_id", "start_date", "end_date"],
    },
  },
  {
    name: "pause-date-fix",
    description: "Record a pause WITHOUT touching Stripe (for members with no manageable Stripe sub, or to correct pause dates). start_date/end_date YYYY-MM-DD.",
    input_schema: {
      type: "object",
      properties: {
        member_id: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        reason: { type: "string" },
      },
      required: ["member_id", "start_date", "end_date"],
    },
  },
  {
    name: "unpause",
    description: "Resume a paused member. Omit new_until to resume now; pass new_until (YYYY-MM-DD) to just shift the resume date.",
    input_schema: {
      type: "object",
      properties: {
        member_id: { type: "string" },
        new_until: { type: "string", description: "Optional YYYY-MM-DD to move the resume date to instead of resuming now." },
      },
      required: ["member_id"],
    },
  },
  {
    name: "cancel",
    description: "Cancel a member's subscription. Default is at period end (they keep access until then); pass immediate=true to cancel right away.",
    input_schema: {
      type: "object",
      properties: {
        member_id: { type: "string" },
        reason: { type: "string" },
        immediate: { type: "boolean", description: "true = cancel now; false/omit = at period end." },
      },
      required: ["member_id"],
    },
  },
  {
    name: "refund",
    description: "Refund a Stripe charge. Call get_member first to find the charge_id. Omit amount_dollars for a full refund; pass it for a partial. reason must be one of duplicate|fraudulent|requested_by_customer if given.",
    input_schema: {
      type: "object",
      properties: {
        member_id: { type: "string" },
        charge_id: { type: "string", description: "The ch_… charge id from get_member." },
        amount_dollars: { type: "number", description: "Optional partial-refund amount in dollars. Omit for a full refund." },
        reason: { type: "string", enum: ["duplicate", "fraudulent", "requested_by_customer"] },
      },
      required: ["member_id", "charge_id"],
    },
  },
  {
    name: "change",
    description: "Change a member's plan. new_plan is one of 1/wk, 2/wk, 3/wk, unlmtd. Optional prorate (upgrades) and next_payment_date (YYYY-MM-DD).",
    input_schema: {
      type: "object",
      properties: {
        member_id: { type: "string" },
        new_plan: { type: "string", enum: ["1/wk", "2/wk", "3/wk", "unlmtd"] },
        prorate: { type: "boolean" },
        next_payment_date: { type: "string" },
      },
      required: ["member_id", "new_plan"],
    },
  },
  {
    name: "apply-coupon",
    description: "Apply a live promotion code (coupon) to a member's subscription.",
    input_schema: {
      type: "object",
      properties: { member_id: { type: "string" }, code: { type: "string", description: "The promotion code string, e.g. SIBLING10." } },
      required: ["member_id", "code"],
    },
  },
  {
    name: "remove-coupon",
    description: "Remove any active discount from a member's subscription (back to full price next invoice).",
    input_schema: {
      type: "object",
      properties: { member_id: { type: "string" } },
      required: ["member_id"],
    },
  },
  {
    name: "payment-link",
    description: "Generate a Stripe customer-portal link so the parent can update their card / manage billing.",
    input_schema: {
      type: "object",
      properties: { member_id: { type: "string" } },
      required: ["member_id"],
    },
  },
  {
    name: "card-setup-link",
    description: "Generate a 'save your card' link for a member with no card on file (collects a card, no subscription attached).",
    input_schema: {
      type: "object",
      properties: { member_id: { type: "string" } },
      required: ["member_id"],
    },
  },
  {
    name: "referred",
    description: "Credit a member for referrals. Each referral adds 4 weeks to their next charge (trial_end). count is 1-10.",
    input_schema: {
      type: "object",
      properties: { member_id: { type: "string" }, count: { type: "integer", minimum: 1, maximum: 10 }, reason: { type: "string" } },
      required: ["member_id", "count"],
    },
  },
  {
    name: "update-profile",
    description: "Update a member's non-billing profile fields. Allowed: archetype, trainer, engagement, skill_notes, parent_email, parent_phone, group_num, start_date.",
    input_schema: {
      type: "object",
      properties: {
        member_id: { type: "string" },
        archetype: { type: "string" },
        trainer: { type: "string" },
        engagement: { type: "string" },
        skill_notes: { type: "string" },
        parent_email: { type: "string" },
        parent_phone: { type: "string" },
        group_num: { type: "string" },
        start_date: { type: "string", description: "Membership start date YYYY-MM-DD (display label, not a billing change)." },
      },
      required: ["member_id"],
    },
  },
  {
    name: "call",
    description: "Start a click-to-call: ring the academy's staff phone, then bridge to this member's parent.",
    input_schema: {
      type: "object",
      properties: { member_id: { type: "string" } },
      required: ["member_id"],
    },
  },
];

const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map(t => t.name));

// Profile fields that update-profile accepts (wrapped into { fields } for members.js).
const PROFILE_FIELDS = ["archetype", "trainer", "engagement", "skill_notes", "parent_email", "parent_phone", "group_num", "start_date"];

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

function systemPrompt(academyName) {
  return (
    `You are the Member Management assistant for ${academyName || "this academy"}, embedded in the staff portal's Members tab. ` +
    `Staff type short commands to manage the athlete roster's billing. Today's date is ${todayYMD()} (UTC).\n\n` +
    `You can also ANSWER QUESTIONS, not just take actions. For roster/billing questions ` +
    `("who has failed payments", "how many are paused", "list members with billing issues"), call list_members ` +
    `(with issues_only=true for problem accounts, or a specific status) and answer in a short plain sentence, naming the members. ` +
    `payment_failed = a charge bounced; payment_method_required = no card on file. To explain ONE member's failed payment, ` +
    `use get_member and read their recent charges (a charge with status "failed" is the bounce).\n\n` +
    `HOW TO WORK:\n` +
    `1. Almost every command names a member. Call find_members to resolve the name to a member_id BEFORE any action. ` +
    `If find_members returns more than one plausible match, do NOT guess — ask the user which one (list the candidates with their status).\n` +
    `2. If the name isn't found, say so plainly and stop.\n` +
    `3. For a refund, call get_member first to read recent charges, then propose the refund with the correct charge_id.\n` +
    `4. Once you know the member and the intent, call the SINGLE matching action tool with the fields filled in. ` +
    `Convert relative time to explicit YYYY-MM-DD dates (e.g. "30 days" pause → start today, end today+30).\n` +
    `5. You CANNOT execute anything. Calling an action tool only PROPOSES it; a human then reviews and clicks Confirm. ` +
    `So never say "done" or "I've paused them" — say what you're proposing. If the user replies "yes"/"confirm", they still ` +
    `need to click the Confirm button; re-propose the action rather than claiming it ran.\n` +
    `6. Before calling an action tool, write ONE short sentence stating exactly what you're about to propose (member name + what changes). ` +
    `Keep it plain, no emojis, no em dashes.\n` +
    `7. If a request is ambiguous, out of scope, or missing info, ask a brief clarifying question instead of calling a tool.\n\n` +
    `Actions you can propose: pause, unpause, cancel, change plan (1/wk 2/wk 3/wk unlmtd), refund, apply/remove coupon, ` +
    `payment link, card-setup link, referral credit, profile edits, and click-to-call.`
  );
}

// ── Anthropic call ──
async function callClaude(system, messages) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system,
      tools: [...READ_TOOLS, ...WRITE_TOOLS],
      messages,
    }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

// ── READ tool executors (scoped to the validated client) ──
async function execFindMembers(clientId, query) {
  const q = String(query || "").trim();
  if (!q) return { matches: [] };
  const enc = encodeURIComponent(`%${q}%`);
  const rows = await sb(
    `members?client_id=eq.${clientId}` +
    `&or=(athlete_name.ilike.${enc},parent_name.ilike.${enc})` +
    `&select=id,athlete_name,parent_name,status,plan,stripe_subscription_id&limit=12`
  ).catch(() => []);
  const matches = (Array.isArray(rows) ? rows : []).map(m => ({
    member_id: m.id,
    athlete_name: m.athlete_name,
    parent_name: m.parent_name,
    status: m.status,
    plan: m.plan,
    has_subscription: !!m.stripe_subscription_id,
  }));
  return { matches };
}

const ISSUE_STATUSES = ["payment_failed", "payment_method_required"];

async function execListMembers(clientId, { status, issues_only } = {}) {
  const rows = await sb(
    `members?client_id=eq.${clientId}&select=id,athlete_name,parent_name,plan,status&order=athlete_name.asc`
  ).catch(() => []);
  const all = Array.isArray(rows) ? rows : [];
  const counts = {};
  for (const m of all) counts[m.status || "unknown"] = (counts[m.status || "unknown"] || 0) + 1;

  let filtered = null;
  if (issues_only) filtered = all.filter(m => ISSUE_STATUSES.includes(m.status));
  else if (status) filtered = all.filter(m => m.status === status);

  const out = { total: all.length, counts };
  if (filtered) {
    out.matches = filtered.map(m => ({
      member_id: m.id, athlete_name: m.athlete_name, parent_name: m.parent_name, plan: m.plan, status: m.status,
    }));
    out.count = filtered.length;
  }
  return out;
}

async function execGetMember(clientId, memberId, stripeAccountByClient) {
  const rows = await sb(`members?id=eq.${encodeURIComponent(memberId)}&client_id=eq.${clientId}&select=*`).catch(() => []);
  const m = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!m) return { error: "member not found for this academy" };
  const out = {
    member_id: m.id,
    athlete_name: m.athlete_name,
    parent_name: m.parent_name,
    status: m.status,
    plan: m.plan,
    has_subscription: !!m.stripe_subscription_id,
    has_customer: !!m.stripe_customer_id,
    charges: [],
  };
  const acct = stripeAccountByClient;
  if (acct && m.stripe_customer_id) {
    try {
      const ch = await stripeFetch(`/charges?customer=${m.stripe_customer_id}&limit=6`, { stripeAccount: acct });
      out.charges = (ch?.data || []).map(c => ({
        charge_id: c.id,
        amount_dollars: c.amount != null ? +(c.amount / 100).toFixed(2) : null,
        currency: (c.currency || "cad").toUpperCase(),
        date: c.created ? new Date(c.created * 1000).toISOString().slice(0, 10) : null,
        status: c.refunded ? "refunded" : c.status,
      }));
    } catch (_) { /* non-fatal — refund can still be proposed without the list */ }
  }
  return out;
}

// Build the members.js PATCH body from a write tool's input.
function toActionBody(action, input) {
  const b = {};
  if (action === "update-profile") {
    const fields = {};
    for (const k of PROFILE_FIELDS) if (input[k] !== undefined) fields[k] = input[k];
    b.fields = fields;
    return b;
  }
  if (action === "refund") {
    if (input.charge_id) b.charge_id = input.charge_id;
    if (input.amount_dollars != null) b.amount_cents = Math.round(Number(input.amount_dollars) * 100);
    if (input.reason) b.reason = input.reason;
    return b;
  }
  // Generic: copy everything except member_id verbatim.
  for (const [k, v] of Object.entries(input)) {
    if (k === "member_id") continue;
    if (v !== undefined) b[k] = v;
  }
  return b;
}

// Human-readable preview line for the confirm card (server-built = trustworthy).
function summarize(action, name, input, body) {
  const who = name || "member";
  switch (action) {
    case "pause": return `Pause ${who}: ${input.start_date} → ${input.end_date}${input.next_payment_date ? ` (next charge ${input.next_payment_date})` : ""}${input.reason ? ` — ${input.reason}` : ""}`;
    case "pause-date-fix": return `Record pause (no Stripe) for ${who}: ${input.start_date} → ${input.end_date}`;
    case "unpause": return input.new_until ? `Shift ${who}'s resume date to ${input.new_until}` : `Resume ${who} now`;
    case "cancel": return `Cancel ${who}${input.immediate ? " immediately" : " at period end"}${input.reason ? ` — ${input.reason}` : ""}`;
    case "refund": return `Refund ${who}: ${body.amount_cents != null ? `$${(body.amount_cents / 100).toFixed(2)}` : "full charge"} on ${input.charge_id}`;
    case "change": return `Change ${who}'s plan → ${input.new_plan}${input.prorate ? " (prorate)" : ""}${input.next_payment_date ? `, next charge ${input.next_payment_date}` : ""}`;
    case "apply-coupon": return `Apply coupon ${input.code} to ${who}`;
    case "remove-coupon": return `Remove the coupon from ${who}`;
    case "payment-link": return `Generate a payment / card-update link for ${who}`;
    case "card-setup-link": return `Generate a save-your-card link for ${who}`;
    case "referred": return `Credit ${who}: ${input.count} referral${input.count > 1 ? "s" : ""} (+${input.count * 4} weeks)`;
    case "update-profile": return `Update ${who}: ${Object.keys(body.fields || {}).join(", ") || "profile"}`;
    case "call": return `Call ${who}`;
    default: return `${action} for ${who}`;
  }
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server" });

  let ctx;
  try { ctx = await resolveUser(req); } catch (e) { return res.status(500).json({ error: e.message }); }
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  const isStaff = !!ctx.staff;
  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const clientId = body.client_id;
  const message = (body.message || "").toString().trim();
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!message) return res.status(400).json({ error: "message required" });

  // Scope check: staff may target any academy; a client only their own.
  if (!isStaff && !ctx.clientIds.includes(clientId)) {
    return res.status(403).json({ error: "not your academy" });
  }

  // Academy row → name + connected Stripe account (for get_member charge lookups).
  let academyName = "this academy";
  let stripeAccount = null;
  try {
    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=business_name,stripe_connect_account_id,stripe_connect_status&limit=1`);
    const c = Array.isArray(rows) && rows[0];
    if (c) {
      academyName = c.business_name || academyName;
      if (c.stripe_connect_status === "connected") stripeAccount = c.stripe_connect_account_id || null;
    }
  } catch (_) { /* non-fatal */ }

  // Seed the message array from prior plain-text turns + the new message.
  const history = Array.isArray(body.history) ? body.history : [];
  const messages = [];
  for (const h of history.slice(-8)) {
    if (!h || typeof h.text !== "string" || !h.text.trim()) continue;
    messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: h.text });
  }
  // Anthropic requires the turn list to end on a user message.
  while (messages.length && messages[messages.length - 1].role === "assistant") messages.pop();
  messages.push({ role: "user", content: message });

  const system = systemPrompt(academyName);

  // Cache member names seen via find_members so the proposal can label the member.
  const nameById = {};

  try {
    // Tool loop: run READ tools automatically, stop on a WRITE tool (proposal).
    for (let step = 0; step < 6; step++) {
      const data = await callClaude(system, messages);
      const content = Array.isArray(data.content) ? data.content : [];
      const text = content.filter(b => b.type === "text").map(b => b.text).join(" ").trim();
      const toolUses = content.filter(b => b.type === "tool_use");

      // No tool call → Claude is asking a question or replying in prose.
      if (!toolUses.length) {
        return res.status(200).json({ reply: text || "Okay.", proposal: null });
      }

      // A WRITE tool → build + return the proposal (do NOT execute).
      const write = toolUses.find(t => WRITE_TOOL_NAMES.has(t.name));
      if (write) {
        const action = write.name;
        const input = write.input || {};
        const memberId = input.member_id;
        if (!memberId) {
          return res.status(200).json({ reply: text || "I need to identify the member first.", proposal: null });
        }
        const actionBody = toActionBody(action, input);
        const name = nameById[memberId] || null;
        return res.status(200).json({
          reply: text || "",
          proposal: {
            action,
            member_id: memberId,
            member_name: name,
            body: actionBody,
            summary: summarize(action, name, input, actionBody),
          },
        });
      }

      // Otherwise: only READ tools — execute them, feed results back, continue.
      messages.push({ role: "assistant", content });
      const results = [];
      for (const t of toolUses) {
        let result;
        if (t.name === "find_members") {
          result = await execFindMembers(clientId, t.input?.query);
          for (const m of (result.matches || [])) nameById[m.member_id] = m.athlete_name || m.parent_name;
        } else if (t.name === "list_members") {
          result = await execListMembers(clientId, t.input || {});
          for (const m of (result.matches || [])) nameById[m.member_id] = m.athlete_name || m.parent_name;
        } else if (t.name === "get_member") {
          result = await execGetMember(clientId, t.input?.member_id, stripeAccount);
          if (result && result.member_id) nameById[result.member_id] = result.athlete_name || result.parent_name;
        } else {
          result = { error: `unknown tool ${t.name}` };
        }
        results.push({ type: "tool_result", tool_use_id: t.id, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: results });
    }

    // Ran out of steps without a proposal or a final answer.
    return res.status(200).json({ reply: "I couldn't resolve that into a single action. Try naming the member and what you'd like to do.", proposal: null });
  } catch (e) {
    console.error("[members-agent]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
