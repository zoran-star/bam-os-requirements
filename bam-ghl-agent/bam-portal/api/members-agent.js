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
    description: "Get one member's full billing context by id: current plan, subscription status, recent charges (with charge_id + amount + status), the CURRENT next-charge date (subscription.next_charge_date), plan price (subscription.amount_dollars), and any open pause window (current_pause). Call this before proposing a refund, a pause, or a next-payment change - you need next_charge_date and the pause window to reason about dates.",
    input_schema: {
      type: "object",
      properties: { member_id: { type: "string", description: "The member's uuid from find_members." } },
      required: ["member_id"],
    },
  },
  {
    name: "list_members",
    description: "List or count members by billing status. Use for roster questions like 'who has failed payments', 'how many are paused', or 'show members with billing issues'. Omit everything to get a count of every status. status: live | paused | payment_failed (a charge bounced) | payment_method_required (a real member with no card on file - collecting card) | cancelling. Set issues_only=true to get everyone in a problem state (payment_failed + payment_method_required). People who merely started the enroll form but never paid are leads, not members, and never appear here.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["live", "paused", "payment_failed", "payment_method_required", "cancelling"] },
        issues_only: { type: "boolean", description: "true = return all members with a billing problem (failed payment OR no card on file)." },
      },
    },
  },
  {
    name: "show_payments",
    description: "Display a member's recent payments as nicely formatted cards to the user, each with a Refund button. ALWAYS use this (never a text/markdown table) when the user asks to see, list, review, or pull up a member's payments, charges, or billing history. Give a one-line intro; the cards render below it. This is ONLY for payments - to open the member's contact/profile card use open_contact instead.",
    input_schema: {
      type: "object",
      properties: { member_id: { type: "string", description: "The member's uuid from find_members." } },
      required: ["member_id"],
    },
  },
  {
    name: "open_contact",
    description: "Open the member's contact/profile card (the detail drawer on the right) - their athlete + parent info, plan, and history. Use this when the user asks to see, open, or pull up a member's contact card, profile, contact info, or details. Does NOT list payments (use show_payments for that). Give a one-line intro.",
    input_schema: {
      type: "object",
      properties: { member_id: { type: "string", description: "The member's uuid from find_members." } },
      required: ["member_id"],
    },
  },
  {
    name: "start_returning_signup",
    description: "Open the Returning Client Signup wizard (the guided flow that signs an EXISTING Stripe customer onto a live offer, no public checkout). Use this whenever the user wants to ADD / SIGN UP / ENROLL someone as a new member manually - a returning or past client, someone who paid before, or anyone NOT on the roster ('add Jim back', 'sign up Houssein', 'enroll a returning client on 2/wk'). Also use it when find_members can't find the person AND the user's intent is to enroll them. Do NOT use billing action tools for new signups. Pass search_query = the name, email, or phone mentioned so the wizard pre-searches Stripe. Give a one-line intro; the wizard opens as a drawer.",
    input_schema: {
      type: "object",
      properties: { search_query: { type: "string", description: "Name, email, or phone of the person to sign up, taken from the user's message. Empty if none was given." } },
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
    `use get_member and read their recent charges (a charge with status "failed" is the bounce).\n` +
    `When the user asks to SEE / LIST / review a member's payments, charges, or billing history, call show_payments ` +
    `(after find_members resolves the member) with a one-line intro - it renders payment cards with a Refund button. ` +
    `NEVER hand-write a markdown/text table of charges. When the user instead asks to open/see a member's CONTACT CARD, ` +
    `profile, contact info, or details, call open_contact (NOT show_payments) - it opens their detail drawer. ` +
    `Pick the tool by what they asked for this turn: "payments/charges" → show_payments; "contact card/profile" → open_contact.\n` +
    `NEW MEMBER SIGNUPS: when the user wants to ADD, SIGN UP, or ENROLL someone as a member manually - a returning ` +
    `or past client, someone who paid before, or a person NOT on the roster - call start_returning_signup with ` +
    `search_query set to the name/email/phone they mentioned. It opens the guided signup wizard (search Stripe → ` +
    `pick a live plan → consent → confirm). If find_members finds nothing for a name and the user's intent is to ` +
    `enroll that person, route to start_returning_signup instead of just saying they weren't found. Never use ` +
    `change/pause/payment-link tools to create a brand-new member.\n\n` +
    `HOW TO WORK:\n` +
    `1. Almost every command names a member. Call find_members to resolve the name to a member_id BEFORE any action. ` +
    `If find_members returns more than one plausible match, do NOT guess — ask the user which one (list the candidates with their status).\n` +
    `2. If the name isn't found, say so plainly and stop.\n` +
    `3. For a refund, call get_member first to read recent charges, then propose the refund with the correct charge_id.\n` +
    `4. Once you know the member and the intent, call the SINGLE matching action tool with the fields filled in. ` +
    `Convert relative time to explicit YYYY-MM-DD dates (e.g. "30 days" pause → start today, end today+30).\n` +
    `4b. PAUSE + NEXT PAYMENT: pausing and setting the next payment date is ONE 'pause' action ` +
    `(start_date, end_date, and optional next_payment_date - all YYYY-MM-DD). First call get_member to read ` +
    `subscription.next_charge_date (the current next charge) and current_pause (any existing pause window). ` +
    `By default a pause pushes the next charge out by the pause length: natural_next_charge = current next_charge_date + (end_date - start_date). ` +
    `REASON OUT LOUD with the user: state the current next charge, what the pause length would make it, and ` +
    `either confirm that date or ask what next-payment date they want, THEN set next_payment_date to that. ` +
    `If they only give a pause period, compute and propose the natural next-payment date; if they give a specific ` +
    `next-payment date, use it as next_payment_date. Do not propose the pause until the pause window AND the ` +
    `next payment date are both settled with the user.\n` +
    `5. You CANNOT execute anything. Calling an action tool only PROPOSES it; a human then reviews and clicks Confirm. ` +
    `So never say "done" or "I've paused them" — say what you're proposing. If the user replies "yes"/"confirm", they still ` +
    `need to click the Confirm button; re-propose the action rather than claiming it ran.\n` +
    `6. Before calling an action tool, write ONE short sentence stating exactly what you're about to propose (member name + what changes). ` +
    `Keep it plain, no emojis, no em dashes.\n` +
    `7. If a request is ambiguous, out of scope, or missing info, ask a brief clarifying question instead of calling a tool.\n` +
    `8. GUIDED STYLE: you are a walk-through assistant, not an essay writer. Keep every reply to 1-3 short sentences ` +
    `and ask at most ONE question per turn. For multi-decision requests (e.g. pause window + next payment), settle the ` +
    `decisions one at a time across turns: confirm the member, then the pause window, then the next payment date, then propose. ` +
    `State facts plainly with real dates and amounts ("Her next charge is $315.27 on Jul 20"). ` +
    `A history line like "(Executed: ...)" means that action already ran; "(Proposal cancelled ...)" means it did not.\n\n` +
    `Actions you can propose: pause (with an optional next-payment date), unpause, cancel, change plan (1/wk 2/wk 3/wk unlmtd), refund, apply/remove coupon, ` +
    `payment link, card-setup link, referral credit, profile edits, and click-to-call. ` +
    `To manually sign up a returning/new client, use start_returning_signup (opens the wizard).`
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

// Pre-payment signup shells (enroll form filled / pipeline convert, never paid)
// are LEADS, not members - the roster hides them, so the AI must not count or
// list them as members with billing issues either.
const HIDDEN_SIGNUP_ORIGINS = new Set(["website_enroll", "convert", "wizard"]);

async function execListMembers(clientId, { status, issues_only } = {}) {
  const rows = await sb(
    `members?client_id=eq.${clientId}&select=id,athlete_name,parent_name,plan,status,signup_origin&order=athlete_name.asc`
  ).catch(() => []);
  const all = (Array.isArray(rows) ? rows : []).filter(
    m => !(m.status === "payment_method_required" && HIDDEN_SIGNUP_ORIGINS.has(m.signup_origin))
  );
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
  const unixToDate = (u) => (u ? new Date(u * 1000).toISOString().slice(0, 10) : null);
  const out = {
    member_id: m.id,
    athlete_name: m.athlete_name,
    parent_name: m.parent_name,
    status: m.status,
    plan: m.plan,
    has_subscription: !!m.stripe_subscription_id,
    has_customer: !!m.stripe_customer_id,
    pause_scheduled_for: m.pause_scheduled_for || null,
    charges: [],
    subscription: null,   // current billing timing (for pause / next-payment reasoning)
    current_pause: null,  // the member's open pause window, if any
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
  // Subscription timing: what the NEXT charge date currently is + the plan price.
  // next_charge_date = trial_end (a pause/credit pushes the charge here) if set,
  // else current_period_end. This is what the agent reasons about when changing a
  // pause or setting a new next-payment date.
  if (acct && m.stripe_subscription_id) {
    try {
      const sub = await stripeFetch(`/subscriptions/${m.stripe_subscription_id}`, { stripeAccount: acct });
      const item = sub.items?.data?.[0];
      const periodEnd = sub.current_period_end || item?.current_period_end || null;
      const nextUnix = sub.trial_end || periodEnd || null;
      const rec = item?.price?.recurring;
      out.subscription = {
        status: sub.status,
        next_charge_date: unixToDate(nextUnix),
        trial_end: unixToDate(sub.trial_end),
        current_period_end: unixToDate(periodEnd),
        cancel_at_period_end: !!sub.cancel_at_period_end,
        amount_dollars: item?.price?.unit_amount != null ? +(item.price.unit_amount / 100).toFixed(2) : null,
        currency: (item?.price?.currency || "cad").toUpperCase(),
        interval: rec ? `${rec.interval_count || 1} ${rec.interval}${(rec.interval_count || 1) > 1 ? "s" : ""}` : null,
      };
    } catch (_) { /* non-fatal — pause can still be proposed without exact timing */ }
  }
  // The member's open pause window (if any), so "change the pause period" can be
  // reasoned against what's already set rather than guessed.
  try {
    const pr = await sb(`cancellations?member_id=eq.${encodeURIComponent(memberId)}&type=eq.pause&completed_at=is.null&select=pause_start,pause_end,manual_trial_end&order=created_at.desc&limit=1`);
    if (Array.isArray(pr) && pr[0]) {
      out.current_pause = {
        pause_start: pr[0].pause_start,
        pause_end: pr[0].pause_end,
        manual_next_payment: pr[0].manual_trial_end || null,
      };
    }
  } catch (_) { /* non-fatal */ }
  return out;
}

// DISPLAY tool: the member's recent charges shaped for the UI cards (amount,
// date, status, refund state). Returned to the frontend as member_context so it
// renders payment cards + a Refund button per charge, instead of a text table.
async function execShowPayments(clientId, memberId, acct) {
  const rows = await sb(`members?id=eq.${encodeURIComponent(memberId)}&client_id=eq.${clientId}&select=id,athlete_name,parent_name,stripe_customer_id`).catch(() => []);
  const m = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!m) return { error: "member not found for this academy" };
  const ctx = {
    member_id: m.id,
    member_name: m.athlete_name || m.parent_name || "Member",
    stripe_customer_id: m.stripe_customer_id || null,
    charges: [],
  };
  if (acct && m.stripe_customer_id) {
    try {
      const ch = await stripeFetch(`/charges?customer=${m.stripe_customer_id}&limit=8`, { stripeAccount: acct });
      ctx.charges = (ch?.data || []).map(c => ({
        charge_id: c.id,
        amount_dollars: c.amount != null ? +(c.amount / 100).toFixed(2) : null,
        amount_refunded_dollars: c.amount_refunded ? +(c.amount_refunded / 100).toFixed(2) : 0,
        currency: (c.currency || "cad").toUpperCase(),
        date: c.created ? new Date(c.created * 1000).toISOString().slice(0, 10) : null,
        status: c.refunded ? "refunded" : (c.amount_refunded ? "partial_refund" : c.status),
      }));
    } catch (_) { /* non-fatal — cards just render empty */ }
  }
  return ctx;
}

// DISPLAY tool: just resolve the member's identity so the UI can pop the
// contact drawer (no charges → no payment cards).
async function execOpenContact(clientId, memberId) {
  const rows = await sb(`members?id=eq.${encodeURIComponent(memberId)}&client_id=eq.${clientId}&select=id,athlete_name,parent_name`).catch(() => []);
  const m = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!m) return { error: "member not found for this academy" };
  return { member_id: m.id, member_name: m.athlete_name || m.parent_name || "Member", open_contact: true };
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

      // UI-ACTION tool → tell the front-end to open the Returning Client Signup
      // wizard (nothing is written here; the wizard has its own consent gate +
      // server-side permission check). Terminal, like a proposal.
      const enrollUi = toolUses.find(t => t.name === "start_returning_signup");
      if (enrollUi) {
        const q = String((enrollUi.input && enrollUi.input.search_query) || "").trim();
        return res.status(200).json({
          reply: text || "Opening the returning-client signup wizard.",
          proposal: null,
          ui_action: { kind: "open_returning_enroll", search_query: q },
        });
      }

      // DISPLAY tools → return member_context so the UI renders (payment cards for
      // show_payments, contact drawer for open_contact). Terminal, like a proposal.
      const display = toolUses.find(t => t.name === "show_payments" || t.name === "open_contact");
      if (display) {
        const memberId = display.input?.member_id;
        if (!memberId) {
          return res.status(200).json({ reply: text || "Which member?", proposal: null });
        }
        if (display.name === "open_contact") {
          const ctx = await execOpenContact(clientId, memberId);
          if (ctx.error) return res.status(200).json({ reply: text || ctx.error, proposal: null });
          const nm = ctx.member_name || nameById[memberId] || "their";
          return res.status(200).json({ reply: text || `Opening ${nm}'s contact card.`, proposal: null, member_context: ctx });
        }
        const ctx = await execShowPayments(clientId, memberId, stripeAccount);
        if (ctx.error) {
          return res.status(200).json({ reply: text || ctx.error, proposal: null });
        }
        const name = ctx.member_name || nameById[memberId] || "this member";
        return res.status(200).json({
          reply: text || `Here are ${name}'s recent payments:`,
          proposal: null,
          member_context: ctx,
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
