import { withSentryApiRoute } from "../_sentry.js";

// Offer → sales-agent FACT sections (Gap #2, phase 2A).
//
//   GET  /api/offers/sync-agent?action=preview&client_id=&offer_id=
//     → { ok, sections:[{ key, label, body }] }
//        Generates the agent's per-academy FACT prompt sections from the offer +
//        client data (the same sections agent_prompt_sections overrides), so an
//        owner can review exactly what the booking agent will know.
//
//   POST /api/offers/sync-agent   body { client_id, offer_id, keys?:[...] }
//     → { ok, written:[keys] }
//        Upserts those sections as this academy's agent_prompt_sections overrides
//        (section_key + offer_id tagged). Only sections we can fill from the offer
//        are touched; anything else keeps its current override/default. User-
//        triggered so the live agent never changes silently.
//
// Auth: Supabase JWT — BAM staff (any academy) or a client_users member of client_id.

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function nowIso() { return new Date().toISOString(); }

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

async function resolveUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("no token"), { status: 401 });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw Object.assign(new Error("invalid token"), { status: 401 });
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`);
  const isStaff = Array.isArray(staff) && !!staff[0];
  const memberships = await sb(`client_users?user_id=eq.${user.id}&status=eq.active&select=client_id`);
  const clientIds = Array.isArray(memberships) ? memberships.map(m => m.client_id) : [];
  return { isStaff, clientIds };
}

const money = (v) => { const n = Number(String(v).replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? `$${n}` : null; };
const arr = (x) => Array.isArray(x) ? x : (x ? [x] : []);

// ── FACT section generators (offer.data + client → agent prompt text) ──
// Each returns a string, or null when the offer has nothing to say for it (so we
// never blank out a section the offer doesn't cover).
function genBusinessInfo(client, data) {
  const lines = [client.business_name || "The academy"];
  if (client.address) lines.push(`Location: ${client.address}`);
  const link = (data.sales && data.sales.signup_url) || "";
  if (link) lines.push(`Sign-up link: ${link}`);
  return lines.length ? lines.join("\n") : null;
}
function genProgram(data) {
  const g = data.general_info || {};
  const lines = [];
  if (g.age_range) lines.push(`Ages: ${g.age_range}`);
  if (g.skill_level) lines.push(`Skill levels: ${g.skill_level}`);
  const gender = arr(g.gender).join(", ");
  if (gender) lines.push(`Gender: ${gender}`);
  if (g.capacity) lines.push(`Group size: up to ${g.capacity} per session`);
  return lines.length ? lines.join("\n") : null;
}
function genSchedule(data) {
  const classes = arr(data.schedule && data.schedule.classes);
  const lines = [];
  for (const c of classes) {
    const times = arr(c.weekly_times).map(wt => `${arr(wt.days).join("/")} ${wt.start || ""}-${wt.end || ""}`.trim()).filter(Boolean).join("; ");
    const name = c.title || c.age || "Class";
    if (times) lines.push(`${name}: ${times}`);
  }
  const yr = data.schedule && data.schedule.year_round;
  if (yr) lines.push(String(yr).toLowerCase().includes("season") ? "Runs seasonally." : "Runs year-round.");
  return lines.length ? lines.join("\n") : null;
}
function genPricing(data) {
  const offerings = arr(data.pricing && data.pricing.pricing_offerings);
  if (!offerings.length) return null;
  const monthlies = offerings.map(o => Number(String(o.price || "").replace(/[^0-9.]/g, ""))).filter(n => isFinite(n) && n > 0);
  const lo = monthlies.length ? Math.min(...monthlies) : null;
  const hi = monthlies.length ? Math.max(...monthlies) : null;
  const range = (lo && hi) ? (lo === hi ? `$${lo} per month` : `$${lo} to $${hi} per month`) : null;
  const out = ["Transparency mode: RANGE", ""];
  if (range) out.push(`When the lead asks about pricing, share the range (${range}) and say full details are covered at the trial.`, "");
  out.push("Full pricing (internal reference only, do not share unless transparency mode changes to EXACT):");
  for (const o of offerings) {
    const m = money(o.price);
    const commits = arr(o.commitments).map(c => `${c.length} ${money(c.price) || ""}`.trim()).filter(Boolean).join(" | ");
    out.push(`- ${o.title || "Plan"}${o.billing_cycle ? ` (${o.billing_cycle})` : ""}: ${m ? m + "/mo" : ""}${commits ? " | " + commits : ""}`.replace(/:\s*\|/, ":"));
  }
  return out.join("\n");
}
function genSellingPoints(data) {
  const v = data.value || {};
  const parts = [];
  if (v.what_makes_different) parts.push(String(v.what_makes_different).trim());
  if (v.program_structure) parts.push(`Program structure: ${String(v.program_structure).trim()}`);
  return parts.length ? parts.join("\n\n") : null;
}
function genPolicies(data) {
  const p = data.policy || {};
  if (!Object.keys(p).length) return null;
  const lines = [];
  const amt = Number(p.cancel_notice_amount);
  if (p.cancellation === "Notice required" && amt > 0) {
    const unit = p.cancel_notice_unit === "hours" ? "hours" : "days";
    lines.push(`Cancellation: ${amt} ${amt === 1 ? unit.replace(/s$/, "") : unit} written notice required.`);
  } else lines.push("Cancellation: members can cancel anytime.");
  if (p.pause_allowed === "Yes") {
    const mn = Number(p.pause_min_days), mx = Number(p.pause_max_days), per = Number(p.pause_per_year);
    const len = (mn > 0 && mx > 0 && mn < mx) ? `${mn} to ${mx} days at a time` : (mx > 0 ? `up to ${mx} days at a time` : "flexible length");
    const freq = per === 1 ? ", once per year" : per === 2 ? ", twice per year" : per > 0 ? `, ${per} times per year` : "";
    lines.push(`Pause: memberships can be paused (${len}${freq}).`);
  } else if (p.pause_allowed === "No") lines.push("Pause: memberships cannot be paused.");
  const rw = Number(p.refund_window_days);
  lines.push((p.refund_policy === "Refundable within a window" && rw > 0)
    ? `Refunds: refundable within ${rw} days of purchase, otherwise non-refundable.`
    : "Refunds: fees already charged are non-refundable except where required by law.");
  if (p.makeup_policy && String(p.makeup_policy).trim()) lines.push(`Makeup/reschedule: ${String(p.makeup_policy).trim()}`);
  return lines.join("\n");
}

const SECTIONS = [
  { key: "business_info",  label: "Business info",  gen: (c, d) => genBusinessInfo(c, d) },
  { key: "program",        label: "Program",        gen: (c, d) => genProgram(d) },
  { key: "schedule",       label: "Schedule",       gen: (c, d) => genSchedule(d) },
  { key: "pricing",        label: "Pricing",        gen: (c, d) => genPricing(d) },
  { key: "selling_points", label: "Selling points", gen: (c, d) => genSellingPoints(d) },
  { key: "policies",       label: "Policies",       gen: (c, d) => genPolicies(d) },
];

function generateSections(client, data) {
  return SECTIONS.map(s => ({ key: s.key, label: s.label, body: s.gen(client, data) }))
    .filter(s => s.body && s.body.trim());
}

async function handler(req, res) {
  try {
    const q = req.query || {};
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const clientId = q.client_id || b.client_id;
    const offerId = q.offer_id || b.offer_id;
    const action = q.action || b.action || (req.method === "GET" ? "preview" : "apply");
    if (!clientId || !offerId) return res.status(400).json({ error: "client_id and offer_id required" });

    const { isStaff, clientIds } = await resolveUser(req);
    if (!isStaff && !clientIds.includes(clientId)) return res.status(403).json({ error: "not authorized for this academy" });

    const offerRows = await sb(`offers?id=eq.${encodeURIComponent(offerId)}&client_id=eq.${encodeURIComponent(clientId)}&select=id,data&limit=1`);
    const offer = Array.isArray(offerRows) && offerRows[0];
    if (!offer) return res.status(404).json({ error: "offer not found for this academy" });
    const clientRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=business_name,address&limit=1`);
    const client = (Array.isArray(clientRows) && clientRows[0]) || {};

    const sections = generateSections(client, offer.data || {});

    if (action === "preview") return res.status(200).json({ ok: true, sections });

    if (action === "apply") {
      const wantKeys = Array.isArray(b.keys) && b.keys.length ? new Set(b.keys) : null;
      const toWrite = sections.filter(s => !wantKeys || wantKeys.has(s.key));
      if (!toWrite.length) return res.status(200).json({ ok: true, written: [] });
      const rows = toWrite.map(s => ({
        client_id: clientId, section_key: s.key, body: s.body,
        offer_id: offerId, updated_by: "offer-sync", updated_at: nowIso(),
      }));
      await sb(`agent_prompt_sections?on_conflict=client_id,section_key`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      return res.status(200).json({ ok: true, written: toWrite.map(s => s.key) });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

export default withSentryApiRoute(handler);
