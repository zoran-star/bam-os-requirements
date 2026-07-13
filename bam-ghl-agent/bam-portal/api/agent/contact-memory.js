import { contactsReadTable } from "../_contacts.js";

// Per-contact memory → a <contact_memory> block injected into the agent's
// system prompt so it personalizes per person. Assembled from:
//   • ghl_contacts mirror  (athlete name, tags, FORM custom fields)
//   • post_trial_reviews   (attended a trial? good fit? trainer? trial notes)
//   • agent_contact_notes  (freeform trainer/staff notes)
//
// `sb` is the caller's Supabase REST helper (returns parsed JSON or null).
// `opts` (optional) = { ghl, token, locationId } — when present, the lead's GHL
// form answers (custom fields) are resolved to human labels and included.
// Returns "" when there's nothing known, else a prompt block to append.

// GHL custom-field id → label, cached per location for the process lifetime.
const _fieldLabelCache = new Map();
async function fieldLabels({ ghl, token, locationId } = {}) {
  if (!ghl || !token || !locationId) return null;
  if (_fieldLabelCache.has(locationId)) return _fieldLabelCache.get(locationId);
  try {
    const data = await ghl("GET", `/locations/${encodeURIComponent(locationId)}/customFields`, { token });
    const map = {};
    for (const f of (data.customFields || [])) if (f && f.id) map[String(f.id)] = f.name || f.fieldKey || null;
    _fieldLabelCache.set(locationId, map);
    return map;
  } catch (_) { _fieldLabelCache.set(locationId, {}); return {}; }
}

export async function loadContactMemory(sb, clientId, contactId, opts = {}) {
  if (!clientId || !contactId) return "";
  const cid = encodeURIComponent(contactId);
  let contact = null, ptr = null, notes = [], booking = null;
  try {
    [contact, ptr, notes, booking] = await Promise.all([
      sb(`${await contactsReadTable(clientId)}?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&select=name,athlete_name,tags,custom_fields&limit=1`).then(r => (Array.isArray(r) ? r[0] : null)).catch(() => null),
      sb(`post_trial_reviews?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&select=showed_up,good_fit,trainer,notes,created_at&order=created_at.desc&limit=1`).then(r => (Array.isArray(r) ? r[0] : null)).catch(() => null),
      sb(`agent_contact_notes?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&active=eq.true&select=note,created_by,created_at&order=created_at.desc&limit=20`).then(r => (Array.isArray(r) ? r : [])).catch(() => []),
      // Authoritative parent + athlete names from the portal trial spine (typed at
      // booking). Portal academies only; empty for GHL, where we fall back to name.
      sb(`trial_bookings?tenant_id=eq.${clientId}&ghl_contact_id=eq.${cid}&select=parent_name,athlete_name&order=created_at.desc&limit=1`).then(r => (Array.isArray(r) ? r[0] : null)).catch(() => null),
    ]);
  } catch (_) { /* best-effort — never block a draft */ }

  const lines = [];
  // WHO YOU'RE TEXTING: always the PARENT/guardian, addressed by their first name.
  // The athlete is their child, referenced in the third person - never greeted
  // directly (Zoran 2026-07-10). Parent name is authoritative from the booking,
  // then the contact record.
  const bookingParent = String((booking && booking.parent_name) || "").trim();
  const contactName = String(contact?.name || "").trim();
  const athleteName = String(contact?.athlete_name || (booking && booking.athlete_name) || "").trim();
  // contacts.name is the PARENT for most flows, but some (the ADAPT waiver
  // onboarding, api/website/onboarding.js) write the ATHLETE's name into
  // contacts.name. Trust the contact-name fallback as the parent ONLY when it
  // isn't the athlete's name - otherwise we'd greet the parent by their kid's
  // name (Zoran 2026-07-10). booking.parent_name is always authoritative.
  const contactNameIsAthlete = contactName && athleteName && contactName.toLowerCase() === athleteName.toLowerCase();
  const parentName = bookingParent || (contactNameIsAthlete ? "" : contactName);
  if (parentName) {
    const pf = parentName.split(/\s+/)[0];
    lines.push(`You are texting ${parentName} - the PARENT/guardian, and the person every message goes to. Greet and address them by their first name, ${pf}. Do not open a message to the athlete.`);
  } else {
    lines.push(`You are texting the PARENT/guardian${athleteName ? ` of ${athleteName}` : ""}, and the person every message goes to. You do NOT have the parent's own name on file - greet warmly WITHOUT a name (e.g. "Hi!"), and never open a message to the athlete by name as if they are the recipient.`);
  }
  if (athleteName) {
    const af = athleteName.split(/\s+/)[0];
    lines.push(`Their child, the athlete, is ${athleteName}. Refer to ${af} in the third person (e.g. "how did ${af} find the session?") - never address the athlete directly; you're talking to the parent.`);
  }
  if (Array.isArray(contact?.tags) && contact.tags.length) lines.push(`Tags: ${contact.tags.join(", ")}`);

  // Form answers (custom fields) → resolve GHL field ids to labels.
  try {
    const labels = await fieldLabels(opts);
    const cf = contact?.custom_fields;
    if (labels && cf && typeof cf === "object" && !Array.isArray(cf)) {
      const formLines = [];
      for (const [id, val] of Object.entries(cf)) {
        if (val == null || val === "") continue;
        const label = labels[String(id)];
        if (!label) continue;  // skip unmapped / opaque fields
        let v = Array.isArray(val) ? val.join(", ") : (typeof val === "object" ? JSON.stringify(val) : String(val));
        v = v.trim();
        if (!v) continue;
        formLines.push(`- ${label}: ${v.slice(0, 200)}`);
        if (formLines.length >= 12) break;
      }
      if (formLines.length) { lines.push(`From their form submission:`); lines.push(...formLines); }
    }
  } catch (_) { /* form fields are a bonus — never block a draft */ }

  if (ptr) {
    if (ptr.showed_up === false) lines.push(`They booked a free trial but did NOT show up.`);
    else if (ptr.showed_up === true || ptr.good_fit != null || ptr.trainer || ptr.notes) lines.push(`They have ALREADY attended a free trial — do not pitch a first trial as if they're brand new.`);
    if (ptr.good_fit === true) lines.push(`The coach felt they were a good fit.`);
    else if (ptr.good_fit === false) lines.push(`The coach felt it may not be the right fit.`);
    if (ptr.trainer) lines.push(`Their trainer was ${ptr.trainer}.`);
    if (ptr.notes && String(ptr.notes).trim()) lines.push(`Post-trial notes from the coach: ${String(ptr.notes).trim()}`);
  }

  if (Array.isArray(notes) && notes.length) {
    lines.push(`Notes the team left about this person:`);
    for (const n of notes) lines.push(`- ${String(n.note).trim()}${n.created_by ? ` (${n.created_by})` : ""}`);
  }

  if (!lines.length) return "";
  return `\n\n<contact_memory>\n` +
    `What you already know about THIS specific person. Use it to personalize and do NOT re-ask things you already know here. Honor any guidance in the team's notes:\n` +
    lines.join("\n") +
    `\n</contact_memory>`;
}
