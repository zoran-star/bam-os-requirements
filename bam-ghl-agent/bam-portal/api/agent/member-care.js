// Member Care agent - shared draft core.
//
// Watches a MEMBER's parent conversation and PROPOSES (never executes):
//   1. a billing/member action (pause / unpause / cancel / change / payment-link /
//      card-setup-link - the exact api/members.js action strings),
//   2. a draft reply back to the parent (sent via /api/ghl/send-message on approval),
//   3. staff to-dos (copied into action_items on approval).
// All three ride ONE agent_member_cards row with independent part statuses; a human
// approves each part in the member drawer. Refunds/coupons are deliberately NOT
// proposable actions - the prompt routes those intents into a to-do instead.
//
// draftMemberCareForMember() is shared by the detector cron (api/agent-member-care.js)
// and the inbound-webhook fast paths, so the two can never drift.

import { ghl } from "../ghl/_core.js";
import { smsProvider } from "../messaging/provider.js";
import { readStoreThreadAgent } from "../messaging/read-thread.js";
import { loadMergedOverrides } from "./_sections.js";
import { isMuted } from "./_mutes.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY        = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL      = "claude-sonnet-4-6";

// The columns every caller needs on the member row it passes in.
export const MEMBER_CARE_SELECT =
  "id,client_id,athlete_name,parent_name,parent_email,parent_phone,status,plan," +
  "ghl_contact_id,pause_scheduled_for,stripe_subscription_id";

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function anthropicCall(body) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

// ── GHL thread helpers (same shape as agent-approvals.js) ──
async function findConversation(token, locationId, contactId) {
  const params = new URLSearchParams({ locationId, contactId });
  const search = await ghl("GET", `/conversations/search?${params}`, { token });
  return (search.conversations || search.data || [])[0] || null;
}
async function threadMessages(token, conversationId) {
  const data = await ghl("GET", `/conversations/${encodeURIComponent(conversationId)}/messages`, { token });
  const raw = data.messages?.messages || data.messages || data.data || [];
  const msgs = raw.map(m => ({
    text: m.body || m.message || "",
    direction: (m.direction || "").toLowerCase(),
    date: m.dateAdded || m.createdAt || m.timestamp || null,
  })).filter(m => m.text && !(m.direction !== "outbound" && /^Liked\b/.test(m.text.trim())));   // inbound tapbacks never register
  msgs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  return msgs.map(m => ({ role: m.direction === "outbound" ? "agent" : "parent", text: m.text, date: m.date }));
}

// ── Allowed-actions matrix (guardrail; ALSO enforced server-side on insert) ──
// pause/unpause/cancel/change need a manageable Stripe sub. A member already
// pausing (open pause window or scheduled pause) can't be paused again.
export function allowedActionsFor(member, currentPause) {
  const hasSub = !!member.stripe_subscription_id;
  const alreadyPausing = !!(currentPause || member.pause_scheduled_for);
  const byStatus = {
    live:                    hasSub ? ["pause", "cancel", "change", "payment-link"] : ["payment-link"],
    paused:                  hasSub ? ["unpause", "cancel"] : [],
    payment_failed:          ["payment-link", "card-setup-link", ...(hasSub ? ["cancel"] : [])],
    payment_method_required: ["card-setup-link", "payment-link"],
  };
  let allowed = byStatus[member.status] || [];
  if (alreadyPausing) allowed = allowed.filter(a => a !== "pause");
  return allowed;
}

// Per-action input docs the model sees + the fields we copy into action_body.
const ACTION_FIELDS = {
  pause:             "start_date (YYYY-MM-DD, usually today), end_date (YYYY-MM-DD), reason, next_payment_date (optional YYYY-MM-DD)",
  unpause:           "new_until (optional YYYY-MM-DD to shift the resume date; omit to resume now)",
  cancel:            "immediate (boolean; false/omit = at period end), reason",
  change:            "new_plan (one of 1/wk, 2/wk, 3/wk, unlmtd), prorate (boolean, optional), next_payment_date (optional YYYY-MM-DD)",
  "payment-link":    "(no fields - generates a Stripe billing-portal link)",
  "card-setup-link": "(no fields - generates a save-your-card link)",
};

// The single forced terminal tool.
const CARE_TOOL = {
  name: "propose_member_care",
  description: "Propose what (if anything) this member's conversation needs. A human reviews every part before anything happens.",
  input_schema: {
    type: "object",
    properties: {
      no_op:         { type: "boolean", description: "True if the conversation needs NOTHING from us right now (already handled, small talk, staff already replied well). When true, leave action/draft_reply/action_items empty." },
      action:        { type: "string", enum: ["pause", "unpause", "cancel", "change", "payment-link", "card-setup-link"], description: "The ONE member action this conversation calls for, ONLY if it is in the allowed_actions list you were given. Omit if none." },
      action_input:  { type: "object", description: "The fields for that action (see the per-action field list in your instructions). Dates are YYYY-MM-DD computed from today's date." },
      draft_reply:   { type: "string", description: "The exact reply text to send the parent, if the thread needs a reply. Warm, human, short, no emojis, no em dashes. Empty if no reply is needed." },
      reply_channel: { type: "string", enum: ["SMS", "Email"], description: "Channel for the reply. Default SMS." },
      action_items:  { type: "array", items: { type: "object", properties: { title: { type: "string" }, notes: { type: "string" } }, required: ["title"] }, description: "Staff to-dos this conversation creates that are NOT one of the actions above (e.g. 'book a makeup session', 'review the July 4 charge for a refund'). Empty if none." },
      reasoning:     { type: "string", description: "1-2 sentences: why these proposals." },
      confidence:    { type: "number", description: "0..1 confidence in the proposals." },
      summary:       { type: "string", description: "2-3 sentence plain-English story of the conversation for the human reviewer." },
      escalate:      { type: "boolean", description: "True if this needs a human's judgment beyond your proposals (angry parent, ambiguous request, anything sensitive)." },
      escalate_reason: { type: "string", description: "If escalate: why." },
    },
    required: ["reasoning", "confidence", "escalate"],
  },
};

function todayYMD() { return new Date().toISOString().slice(0, 10); }

function buildSystem({ client, member, currentPause, allowed, overrides, lessons }) {
  const academy = client.business_name || "this academy";
  const who = member.athlete_name || "the athlete";
  const parent = member.parent_name || "the parent";
  const lines = [];
  lines.push(
    `You are the Member Care agent for ${academy}. You watch the conversation between the academy and ${parent}, ` +
    `the parent of CURRENT member ${who}. You NEVER execute anything - every proposal you make is reviewed and ` +
    `approved by a human before anything happens. Today's date is ${todayYMD()} (UTC).`
  );
  lines.push(
    `Your job: read the thread and decide if it calls for (1) ONE member/billing action, (2) a reply back to the parent, ` +
    `and/or (3) staff to-dos. Any mix, or none (no_op=true when the conversation needs nothing).`
  );
  lines.push(
    `<member_snapshot>\n` +
    `athlete: ${member.athlete_name || "-"}\nparent: ${member.parent_name || "-"}\n` +
    `status: ${member.status}\nplan: ${member.plan || "-"}\n` +
    `has_stripe_subscription: ${!!member.stripe_subscription_id}\n` +
    `pause_scheduled_for: ${member.pause_scheduled_for || "none"}\n` +
    `open_pause_window: ${currentPause ? `${currentPause.pause_start} to ${currentPause.pause_end}` : "none"}\n` +
    `parent_email_on_file: ${!!member.parent_email}\n` +
    `</member_snapshot>`
  );
  lines.push(
    `<allowed_actions>\n` +
    (allowed.length
      ? `For this member's current state you may ONLY propose: ${allowed.join(", ")}.\n` +
        allowed.map(a => `- ${a}: ${ACTION_FIELDS[a]}`).join("\n")
      : `No member action is proposable in this member's current state - use a to-do instead if something needs doing.`) +
    `\nNEVER propose refunds or coupons as actions - if the parent asks about a refund or discount, express it as an ` +
    `action_item for staff (e.g. "Parent asked about a refund for the July 4 charge - review in Payments") and address it in your reply.` +
    `\nOnly propose an action the parent actually asked for or that the conversation clearly requires. When unsure, prefer a to-do + escalate.` +
    `\n</allowed_actions>`
  );
  const policyBits = ["pricing", "policies", "business_info"]
    .filter(k => overrides[k] && String(overrides[k]).trim())
    .map(k => `<${k}>\n${String(overrides[k]).trim()}\n</${k}>`);
  if (policyBits.length) lines.push(policyBits.join("\n"));
  if (lessons.length) {
    lines.push(`<learned_lessons>\n` + lessons.map(l => `- ${l.lesson}`).join("\n") + `\n</learned_lessons>`);
  }
  lines.push(
    `Reply style: text like a real coach/front-desk person - short, warm, plain. No emojis. Never use an em dash; use a hyphen or a comma. ` +
    `Never promise that an action HAS been done - a human still has to approve it, so phrase replies as what will/can happen ` +
    `("We can pause your membership starting Monday - I'll set that up") rather than "I've paused it".`
  );
  lines.push(`Respond ONLY by calling propose_member_care.`);
  return lines.join("\n\n");
}

// Build the members.js PATCH body from the model's action_input (adapted from
// members-agent.js toActionBody - only the member-care action set).
function toActionBody(action, input) {
  const b = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (k === "member_id") continue;
    if (v !== undefined && v !== null && v !== "") b[k] = v;
  }
  return b;
}

// Human-readable preview line for the card (server-built = trustworthy).
function summarizeAction(action, name, input) {
  const who = name || "member";
  const i = input || {};
  switch (action) {
    case "pause": return `Pause ${who}: ${i.start_date} to ${i.end_date}${i.next_payment_date ? ` (next charge ${i.next_payment_date})` : ""}${i.reason ? ` - ${i.reason}` : ""}`;
    case "unpause": return i.new_until ? `Shift ${who}'s resume date to ${i.new_until}` : `Resume ${who} now`;
    case "cancel": return `Cancel ${who}${i.immediate ? " immediately" : " at period end"}${i.reason ? ` - ${i.reason}` : ""}`;
    case "change": return `Change ${who}'s plan to ${i.new_plan}${i.prorate ? " (prorate)" : ""}${i.next_payment_date ? `, next charge ${i.next_payment_date}` : ""}`;
    case "payment-link": return `Generate a payment / card-update link for ${who}`;
    case "card-setup-link": return `Generate a save-your-card link for ${who}`;
    default: return `${action} for ${who}`;
  }
}

// Minimal per-action required-field validation so a half-filled proposal can't
// reach the Confirm button (members.js re-validates anyway).
function actionInputValid(action, input) {
  const i = input || {};
  const ymd = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  switch (action) {
    case "pause": return ymd(i.start_date) && ymd(i.end_date);
    case "change": return ["1/wk", "2/wk", "3/wk", "unlmtd"].includes(i.new_plan);
    case "unpause": return i.new_until === undefined || ymd(i.new_until);
    default: return true;
  }
}

// Cancel every pending card for a member (webhook cancel-on-reply + detector prune).
export async function cancelPendingMemberCards(clientId, memberId, note) {
  await sb(`agent_member_cards?client_id=eq.${clientId}&member_id=eq.${memberId}&status=eq.pending`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "canceled", resolve_note: note || "superseded", updated_at: new Date().toISOString() }),
  });
}

// ── The draft turn ──────────────────────────────────────────────────────────
// client: clients row (id, business_name, ghl_* creds fields, ghl_kpi_config)
// member: members row with MEMBER_CARE_SELECT columns
// opts:   { token, locationId }  - GHL creds (omit for Twilio academies)
//         { createdBy }          - 'detector' | 'webhook-fastpath'
// Returns { inserted: true, card } | { skipped: reason } | { error }.
export async function draftMemberCareForMember(client, member, opts = {}) {
  if (!ANTHROPIC_KEY) return { error: "ANTHROPIC_API_KEY not configured" };
  const contactId = member.ghl_contact_id;
  if (!contactId) return { skipped: "member has no ghl_contact_id" };
  if (await isMuted(client.id, contactId, "member_care")) return { skipped: "muted" };

  // Dedup guard 1: an active card already covers this member.
  const existing = await sb(
    `agent_member_cards?client_id=eq.${client.id}&member_id=eq.${member.id}` +
    `&order=created_at.desc&select=id,status,last_inbound_at&limit=1`
  ).catch(() => []);
  const last = Array.isArray(existing) && existing[0];
  if (last && last.status === "pending") return { skipped: "already has a pending card" };

  // Read the thread (GHL or the Twilio own-store).
  const provider = await smsProvider(client.id);
  let messages;
  if (provider === "twilio") {
    messages = await readStoreThreadAgent(client.id, contactId);
  } else {
    if (!opts.token || !opts.locationId) return { error: "no GHL creds for thread read" };
    const convo = await findConversation(opts.token, opts.locationId, contactId);
    if (!convo) return { skipped: "no conversation for contact" };
    messages = await threadMessages(opts.token, convo.id);
  }
  if (!messages || !messages.length) return { skipped: "empty thread" };

  const lastInbound = [...messages].reverse().find(m => m.role === "parent");
  if (!lastInbound) return { skipped: "no inbound from parent" };
  // Only draft when the parent is the one waiting on us.
  if (messages[messages.length - 1].role !== "parent") return { skipped: "last message is outbound" };
  const lastInboundAt = lastInbound.date ? new Date(lastInbound.date).toISOString() : null;
  // Dedup guard 2: we already carded THIS inbound (timestamp match, like the
  // booking detector's last_lead_at check). A canceled/resolved card on the same
  // inbound means a human or a newer draft already covered it.
  if (last && last.last_inbound_at && lastInboundAt &&
      new Date(last.last_inbound_at).getTime() === new Date(lastInboundAt).getTime()) {
    return { skipped: "already drafted for this inbound" };
  }

  // Member context: open pause window + lessons + policy overrides.
  const [pauseRows, lessons, overrides] = await Promise.all([
    sb(`cancellations?member_id=eq.${member.id}&type=eq.pause&completed_at=is.null&select=pause_start,pause_end&order=created_at.desc&limit=1`).catch(() => []),
    sb(`agent_lessons?or=(client_id.eq.${client.id},and(client_id.is.null,scope.eq.general))&agent=eq.member_care&active=eq.true&select=lesson,kind&order=created_at.asc`).catch(() => []),
    loadMergedOverrides(client.id).catch(() => ({})),
  ]);
  const currentPause = Array.isArray(pauseRows) && pauseRows[0] ? pauseRows[0] : null;
  const allowed = allowedActionsFor(member, currentPause);

  const system = buildSystem({ client, member, currentPause, allowed, overrides, lessons: Array.isArray(lessons) ? lessons : [] });
  const convo = messages
    .filter(m => m && typeof m.text === "string" && m.text.trim() !== "")
    .map(m => ({ role: m.role === "agent" ? "assistant" : "user", content: m.text }));
  while (convo.length && convo[convo.length - 1].role === "assistant") convo.pop();
  if (!convo.length) return { skipped: "no usable thread turns" };

  const data = await anthropicCall({
    model: ANTHROPIC_MODEL, max_tokens: 1024, system,
    tools: [CARE_TOOL], tool_choice: { type: "tool", name: "propose_member_care" },
    messages: convo,
  });
  const tool = (data.content || []).find(b => b.type === "tool_use" && b.name === "propose_member_care");
  if (!tool?.input) return { error: "no structured proposal from Claude" };
  const out = tool.input;

  // ── Server-side validation (never trust the model) ──
  // Action part: must be allowed for the member's CURRENT status, re-read now.
  let action = null, actionBody = null, actionSummary = null;
  if (!out.no_op && out.action) {
    const fresh = await sb(`members?id=eq.${member.id}&select=${MEMBER_CARE_SELECT}&limit=1`).catch(() => []);
    const m2 = Array.isArray(fresh) && fresh[0] ? fresh[0] : member;
    const allowedNow = allowedActionsFor(m2, currentPause);
    if (allowedNow.includes(out.action) && actionInputValid(out.action, out.action_input)) {
      action = out.action;
      actionBody = toActionBody(action, out.action_input);
      actionSummary = summarizeAction(action, m2.athlete_name || m2.parent_name, out.action_input);
    }
  }

  const draftReply = (!out.no_op && out.draft_reply && String(out.draft_reply).trim()) ? String(out.draft_reply).trim() : null;
  // Twilio own-store threads are SMS-only; Email needs a parent email on file.
  let replyChannel = out.reply_channel === "Email" ? "Email" : "SMS";
  if (replyChannel === "Email" && (provider === "twilio" || !member.parent_email)) replyChannel = "SMS";

  const items = (!out.no_op && Array.isArray(out.action_items))
    ? out.action_items
        .filter(it => it && typeof it.title === "string" && it.title.trim())
        .map(it => ({ title: String(it.title).trim().slice(0, 200), notes: it.notes ? String(it.notes).trim().slice(0, 1000) : null }))
        .slice(0, 5)
    : [];

  // Nothing survived validation → no card (a clean no_op).
  if (!action && !draftReply && !items.length && !out.escalate) return { skipped: "no_op" };

  const card = {
    client_id: client.id,
    member_id: member.id,
    ghl_contact_id: String(contactId),
    member_name: member.athlete_name || null,
    parent_name: member.parent_name || null,
    action, action_body: actionBody, action_summary: actionSummary,
    action_status: action ? "pending" : "none",
    draft_reply: draftReply, reply_channel: draftReply ? replyChannel : null,
    reply_status: draftReply ? "pending" : "none",
    action_items: items.length ? items : null,
    action_items_status: items.length ? "pending" : "none",
    reasoning: out.reasoning || null,
    confidence: typeof out.confidence === "number" ? out.confidence : null,
    escalate: !!out.escalate, escalate_reason: out.escalate_reason || null,
    summary: out.summary ? String(out.summary).slice(0, 600) : null,
    thread_tail: messages.slice(-6).map(m => ({ role: m.role === "agent" ? "agent" : "parent", text: String(m.text).slice(0, 2000), at: m.date || null })),
    last_message: String(lastInbound.text).slice(0, 500),
    last_inbound_at: lastInboundAt,
    status: "pending",
    created_by: opts.createdBy || "detector",
  };
  try {
    const [row] = await sb(`agent_member_cards`, {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify([card]),
    });
    return { inserted: true, card: row };
  } catch (e) {
    // Unique partial index: another run drafted concurrently - that card wins.
    if (/duplicate key|23505/.test(e.message)) return { skipped: "concurrent card exists" };
    throw e;
  }
}
