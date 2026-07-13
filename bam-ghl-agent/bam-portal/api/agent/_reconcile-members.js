// SAFETY NET: close any OPEN sales opportunity whose person is already a LIVE
// (paying) member, and cancel every scheduled outbound for them. This is the
// catch-all behind the signup event path (api/stripe/webhook.js markOpportunityWon
// + cancelAllSalesOutbound): the event fires ONCE and matches a single contact id,
// so it misses two real cases we hit on GTA:
//
//   1. DUPLICATE CONTACT - the member landed on one contact record and the open
//      opportunity + agent cards on a different one (different id AND different
//      email), so neither the won-mark nor the read-time live-member hide could
//      connect "open opp" to "paying member". (Bashir Popal: member on
//      bashpopal@gmail.com, opp on superarmaan2012@gmail.com, same phone/athlete.)
//   2. ALREADY-STUCK opp - a lead who enrolled before the won-mark covered
//      portal-native opportunities. The event never re-runs, so the opp sat open
//      forever (the closing detector's per-lead O6 auto-won only evaluates leads it
//      is actively carding - a quiet enrolled lead is never re-checked). (Amir Jul 7,
//      Kartik Jul 12.)
//
// Runs once per academy per closing-detect cron (~15 min). Portal-native only
// (opportunities + members + the agent queue tables) - it never reads or writes GHL,
// and it early-returns for any academy whose pipeline isn't portal-provider, so V1 /
// GHL-managed academies are untouched. Fails soft everywhere; never throws.
//
// Match safety: contact-id / portal-contact-id / email are 1:1 with a person, so
// they close directly. Phone is NOT unique to a person (a parent enrolls one child
// while a sibling's trial is still a live lead on the same number), so a phone match
// ALSO requires the athlete name to match - that closes the dup-contact same-athlete
// case without ever closing a sibling's separate opp.
import { cancelAllSalesOutbound } from "./_cancel-outbound.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// The agent stages a lead can still be sitting in (terminal stages are never swept).
const AGENT_ROLES = ["responded", "scheduled_trial", "done_trial"];

const phone10  = (raw) => { const d = String(raw || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const nameNorm = (raw) => String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
const emailNorm = (raw) => String(raw || "").trim().toLowerCase();

// For one academy: find every open agent-stage opp that belongs to a live member and
// close it won + cancel its outbound. Returns a summary; never throws.
export async function reconcileLiveMembers(clientId) {
  if (!clientId) return { skipped: "no clientId" };
  try {
    // Gate: portal-native pipelines only. A GHL-managed (V1) academy keeps its opps
    // in GHL, not this table, so there is nothing here to reconcile - and we must
    // never touch V1. members rows are portal-only too, so this is doubly safe.
    const cRows = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=pipeline_provider&limit=1`);
    const provider = Array.isArray(cRows) && cRows[0] && cRows[0].pipeline_provider;
    if (provider !== "portal") return { skipped: `pipeline_provider=${provider || "unknown"} (not portal)` };

    const live = await sb(`members?client_id=eq.${encodeURIComponent(clientId)}&status=eq.live&select=ghl_contact_id,contact_id,parent_phone,parent_email,athlete_name`);
    if (!Array.isArray(live) || !live.length) return { ok: true, scanned: 0, closed: [] };

    // Build match indexes from the live-member set.
    const memGcid  = new Set();
    const memCid   = new Set();
    const memEmail = new Set();
    const memPhoneAthlete = new Map(); // phone10 -> Set(athleteNorm)
    for (const m of live) {
      if (m.ghl_contact_id) memGcid.add(String(m.ghl_contact_id));
      if (m.contact_id)     memCid.add(String(m.contact_id));
      const em = emailNorm(m.parent_email); if (em) memEmail.add(em);
      const ph = phone10(m.parent_phone), an = nameNorm(m.athlete_name);
      if (ph && an) { if (!memPhoneAthlete.has(ph)) memPhoneAthlete.set(ph, new Set()); memPhoneAthlete.get(ph).add(an); }
    }

    const roleList = AGENT_ROLES.map(r => `"${r}"`).join(",");
    const opps = await sb(`opportunities?client_id=eq.${encodeURIComponent(clientId)}&status=eq.open&stage_role=in.(${roleList})&select=id,ghl_contact_id,contact_id,contact_phone,athlete_name`);
    if (!Array.isArray(opps) || !opps.length) return { ok: true, scanned: live.length, closed: [] };

    // Backfill opp emails from their portal contact (dup-contact match uses phone+athlete,
    // but email is a strong 1:1 signal when present). One batched read, fail-soft.
    const cids = [...new Set(opps.map(o => o.contact_id).filter(Boolean))];
    const emailByCid = new Map();
    if (cids.length) {
      try {
        const inList = cids.map(id => `"${id}"`).join(",");
        const crows = await sb(`contacts?client_id=eq.${encodeURIComponent(clientId)}&id=in.(${inList})&select=id,email`);
        for (const c of (Array.isArray(crows) ? crows : [])) { const em = emailNorm(c.email); if (em) emailByCid.set(String(c.id), em); }
      } catch (_) { /* email match is a bonus - never block the sweep on it */ }
    }

    const isMemberOpp = (o) => {
      if (o.ghl_contact_id && memGcid.has(String(o.ghl_contact_id))) return "contact_id";
      if (o.contact_id && memCid.has(String(o.contact_id))) return "portal_contact";
      const em = emailByCid.get(String(o.contact_id)); if (em && memEmail.has(em)) return "email";
      const ph = phone10(o.contact_phone), an = nameNorm(o.athlete_name);
      if (ph && an && memPhoneAthlete.get(ph)?.has(an)) return "phone+athlete";
      return null;
    };

    const closed = [];
    for (const o of opps) {
      const via = isMemberOpp(o);
      if (!via) continue;
      const reason = `auto: already a paying member (reconcile match=${via})`;
      // Close the opp WON - guarded to status=open so a concurrent close is a no-op.
      try {
        const hit = await sb(`opportunities?id=eq.${encodeURIComponent(o.id)}&client_id=eq.${encodeURIComponent(clientId)}&status=eq.open&select=id`, {
          method: "PATCH", headers: { Prefer: "return=representation" },
          body: JSON.stringify({ status: "won", closed_at: new Date().toISOString(), updated_at: new Date().toISOString(), reason }),
        });
        if (!Array.isArray(hit) || !hit.length) continue; // someone else already closed it
      } catch (_) { continue; }
      // Record the WON outcome (idempotent: only if none exists for this opp).
      try {
        const prior = await sb(`pipeline_outcomes?client_id=eq.${encodeURIComponent(clientId)}&opportunity_id=eq.${encodeURIComponent(o.id)}&status=eq.won&select=id&limit=1`);
        if (!Array.isArray(prior) || !prior.length) {
          await sb(`pipeline_outcomes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ client_id: clientId, opportunity_id: o.id, status: "won", reason }]) });
        }
      } catch (_) { /* non-fatal */ }
      // Cancel every scheduled outbound + parked reignition for this contact.
      if (o.ghl_contact_id) { try { await cancelAllSalesOutbound({ clientId, contactId: o.ghl_contact_id, sendError: "already a live member" }); } catch (_) {} }
      closed.push({ opp_id: o.id, contact_id: o.ghl_contact_id || null, via });
    }

    return { ok: true, scanned: live.length, closed };
  } catch (e) {
    console.error("[_reconcile-members] soft-fail:", e && e.message);
    return { ok: false, error: String((e && e.message) || e) };
  }
}
