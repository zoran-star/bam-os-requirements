import { withSentryApiRoute } from "./_sentry.js";
// Vercel Serverless Function - Marketing AGENT (natural language, answer-only)
//
//   POST /api/marketing-agent   (staff OR client bearer)
//     body: { client_id, message, history?: [{ role:'user'|'assistant', text }] }
//
// A conversational advisor for the Marketing view. Clients ask plain-English
// questions about their ad performance ("why is my CPL up?", "which campaign is
// best?", "what's a good cost per lead?", "should I raise my budget?") and Claude
// answers using their LIVE Meta numbers.
//
// SAFETY MODEL - this endpoint is READ-ONLY (v1 is answer-only):
//   • It has NO write tools. It can read the academy's marketing report and
//     recent window, then explain them. It never changes budgets, goals, or
//     campaigns. To act, it points the user at the Marketing tab's own controls.
//   • Data is fetched by calling the existing /api/marketing endpoint with the
//     user's OWN bearer, so per-academy scoping is enforced by that proven
//     handler (a client can only ever read their own academy).
//
// Mirrors the member agent (api/members-agent.js): same model, same auth/scoping
// shape, same { reply } response the UI expects. No proposals (answer-only).

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
// Mirrors resolveUser in api/members-agent.js so scoping is identical.
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

  // A client can be linked either as the owner (clients.auth_user_id) or via a
  // client_users membership. Cover both so scoping matches the marketing API.
  const ownerRows = await sb(`clients?auth_user_id=eq.${user.id}&select=id`).catch(() => []);
  const memberships = await sb(
    `client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`
  ).catch(() => []);
  const clientIds = [
    ...new Set([
      ...(Array.isArray(ownerRows) ? ownerRows.map(o => String(o.id)) : []),
      ...(Array.isArray(memberships) ? memberships.map(m => String(m.client_id)) : []),
    ].filter(Boolean)),
  ];

  return { user, staff, clientIds, token };
}

// ── Call the existing marketing API internally, forwarding the user's bearer ──
// Reuses all Meta logic + auth in api/marketing.js. Returns { ok, status, json }.
async function marketingApi(req, token, query) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  const url = `${proto}://${host}/api/marketing?${query}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const txt = await res.text();
    let json;
    try { json = txt ? JSON.parse(txt) : {}; } catch { json = { raw: txt?.slice(0, 400) }; }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: { error: e.message || "fetch failed" } };
  }
}

// ─────────────────────────────────────────────────────────
// READ tools (execute server-side; no write tools in v1)
// ─────────────────────────────────────────────────────────
const READ_TOOLS = [
  {
    name: "get_marketing_report",
    description:
      "Get this academy's Meta ad performance report over recent months. Returns period totals (ad spend, leads, cost per lead / CPL), the per-campaign breakdown (leads, CPL, spend, reach, impressions, clicks, CTR, frequency), the CPL goal and monthly budget if set, and month-over-month trend. Call this to answer almost any performance question (how am I doing, why is CPL up, which campaign is best, am I on budget).",
    input_schema: {
      type: "object",
      properties: {
        months: { type: "integer", minimum: 1, maximum: 12, description: "How many recent months to include (default 6)." },
      },
    },
  },
  {
    name: "get_recent_window",
    description:
      "Get this academy's ad performance for just the last 7 days (spend, leads, CPL, per-campaign). Use for 'this week', 'lately', or 'right now' questions, or to compare recent momentum against the monthly average.",
    input_schema: { type: "object", properties: {} },
  },
];
const READ_TOOL_NAMES = new Set(READ_TOOLS.map(t => t.name));

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

function systemPrompt(academyName) {
  return (
    `You are the Marketing advisor for ${academyName || "this academy"}, embedded in the client portal's Marketing view. ` +
    `The people talking to you are academy owners (and BAM staff). Today's date is ${todayYMD()} (UTC).\n\n` +
    `WHAT YOU DO: help them understand and improve their paid advertising. You can:\n` +
    `- Read their live numbers (call get_marketing_report, and get_recent_window for "this week") and explain them in plain English.\n` +
    `- Explain marketing concepts and metrics (CPL = cost per lead = ad spend / leads; CTR = click-through rate; CPM; frequency; reach; conversion rate).\n` +
    `- Tell them what is working and what to fix (which campaign is most efficient, which is wasting spend, whether they are pacing to budget).\n` +
    `- Give benchmarks: for youth sports academies, a cost per lead under about $25 is healthy and under $15 is strong. If they have set a CPL goal, judge against that.\n` +
    `- Point them to the right action in the portal. You do NOT take actions yourself. To change a budget, request a new campaign, or refresh creative, tell them to use the buttons on this Marketing tab (New campaign / Change campaign / request a budget change), and their BAM marketing team will handle it.\n\n` +
    `HOW TO ANSWER:\n` +
    `1. For any question about their actual performance, numbers, campaigns, spend, leads, or budget, call get_marketing_report FIRST (and get_recent_window if they ask about this week). Never guess their numbers.\n` +
    `2. If a report comes back empty or with no campaigns, say plainly that you do not see live ad data yet for this academy, and suggest they check that their ads are connected on this tab, rather than inventing numbers.\n` +
    `3. Answer in short, plain sentences. Lead with the number or the takeaway. Name the specific campaign when relevant.\n` +
    `4. Be encouraging but honest. If something is underperforming, say so and give one concrete next step.\n` +
    `5. Never claim you changed anything. You explain and advise only.\n` +
    `6. Keep it concise. No emojis. No em dashes; use a hyphen or restructure.`
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
      tools: READ_TOOLS,
      messages,
    }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server" });

  let ctx;
  try { ctx = await resolveUser(req); } catch (e) { return res.status(500).json({ error: e.message }); }
  if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

  const isStaff = !!ctx.staff;
  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const clientId = body.client_id ? String(body.client_id) : null;
  const message = (body.message || "").toString().trim();
  if (!clientId) return res.status(400).json({ error: "client_id required" });
  if (!message) return res.status(400).json({ error: "message required" });

  // Scope check: staff may target any academy; a client only their own. The
  // internal /api/marketing call re-checks this too (defense in depth).
  if (!isStaff && !ctx.clientIds.includes(clientId)) {
    return res.status(403).json({ error: "not your academy" });
  }

  // Academy name for the system prompt.
  let academyName = "this academy";
  try {
    const rows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=business_name&limit=1`);
    const c = Array.isArray(rows) && rows[0];
    if (c && c.business_name) academyName = c.business_name;
  } catch (_) { /* non-fatal */ }

  // Seed the message array from prior plain-text turns + the new message.
  const history = Array.isArray(body.history) ? body.history : [];
  const messages = [];
  for (const h of history.slice(-8)) {
    if (!h || typeof h.text !== "string" || !h.text.trim()) continue;
    messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: h.text });
  }
  while (messages.length && messages[messages.length - 1].role === "assistant") messages.pop();
  messages.push({ role: "user", content: message });

  const system = systemPrompt(academyName);

  try {
    // Tool loop: run READ tools automatically, then return Claude's prose answer.
    for (let step = 0; step < 6; step++) {
      const data = await callClaude(system, messages);
      const content = Array.isArray(data.content) ? data.content : [];
      const text = content.filter(b => b.type === "text").map(b => b.text).join(" ").trim();
      const toolUses = content.filter(b => b.type === "tool_use");

      // No tool call → Claude answered in prose.
      if (!toolUses.length) {
        return res.status(200).json({ reply: text || "Okay." });
      }

      // Execute the requested READ tools, feed results back, continue.
      messages.push({ role: "assistant", content });
      const results = [];
      for (const t of toolUses) {
        let result;
        if (t.name === "get_marketing_report") {
          const months = Math.min(Math.max(parseInt(t.input?.months, 10) || 6, 1), 12);
          const r = await marketingApi(req, ctx.token, `resource=meta-report&months=${months}&client_id=${encodeURIComponent(clientId)}`);
          result = r.ok ? r.json : { error: r.json?.error || `report unavailable (HTTP ${r.status})` };
        } else if (t.name === "get_recent_window") {
          const r = await marketingApi(req, ctx.token, `resource=meta-report&window=last7&client_id=${encodeURIComponent(clientId)}`);
          result = r.ok ? r.json : { error: r.json?.error || `recent window unavailable (HTTP ${r.status})` };
        } else if (READ_TOOL_NAMES.has(t.name)) {
          result = { error: `tool ${t.name} not implemented` };
        } else {
          result = { error: `unknown tool ${t.name}` };
        }
        results.push({ type: "tool_result", tool_use_id: t.id, content: JSON.stringify(result).slice(0, 12000) });
      }
      messages.push({ role: "user", content: results });
    }

    return res.status(200).json({ reply: "I couldn't pull that together just now. Try asking about your cost per lead, a specific campaign, or how this month is pacing." });
  } catch (e) {
    console.error("[marketing-agent]", e);
    return res.status(500).json({ error: e.message || "internal error" });
  }
}

export default withSentryApiRoute(handler);
