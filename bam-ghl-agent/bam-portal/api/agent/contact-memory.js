import { contactsReadTable, athleteFieldIds, resolveAthleteNameFromFields } from "../_contacts.js";

// Per-contact memory → a <contact_memory> block injected into the agent's
// system prompt so it personalizes per person. Assembled from:
//   • contact store        (athlete name, tags, FORM custom fields — the
//                           provider-aware table: portal `contacts` or the
//                           `ghl_contacts` mirror)
//   • contact_field_values (portal-native form answers with no GHL bridge —
//                           funnel wizard questions, checkout intake)
//   • LIVE GHL contact     (fallback when the store row has no custom fields —
//                           leads that predate an academy's portal flip only
//                           have their form answers in GHL; what we find is
//                           healed back onto the contacts row, fill-only, so
//                           the Hawkeye Book-it card + bookPortalTrial see the
//                           athlete name too)
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
      sb(`${await contactsReadTable(clientId)}?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&select=id,name,athlete_name,tags,custom_fields&limit=1`).then(r => (Array.isArray(r) ? r[0] : null)).catch(() => null),
      sb(`post_trial_reviews?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&select=showed_up,good_fit,trainer,notes,created_at&order=created_at.desc&limit=1`).then(r => (Array.isArray(r) ? r[0] : null)).catch(() => null),
      sb(`agent_contact_notes?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&active=eq.true&select=note,created_by,created_at&order=created_at.desc&limit=20`).then(r => (Array.isArray(r) ? r : [])).catch(() => []),
      // Authoritative parent + athlete names from the portal trial spine (typed at
      // booking). Portal academies only; empty for GHL, where we fall back to name.
      sb(`trial_bookings?tenant_id=eq.${clientId}&ghl_contact_id=eq.${cid}&select=parent_name,athlete_name&order=created_at.desc&limit=1`).then(r => (Array.isArray(r) ? r[0] : null)).catch(() => null),
    ]);
  } catch (_) { /* best-effort — never block a draft */ }

  // Every form answer we can find, as one ghl-field-id-keyed map. Starts from
  // the store row; when that's empty and we can reach GHL, fall back to the
  // LIVE GHL contact — leads that predate an academy's portal flip were
  // backfilled with just email+phone, so their form answers only exist in GHL.
  const storeCf = (contact && contact.custom_fields && typeof contact.custom_fields === "object" && !Array.isArray(contact.custom_fields)) ? contact.custom_fields : {};
  const cfMap = { ...storeCf };
  const storeCfEmpty = !Object.values(storeCf).some(v => v != null && String(v).trim());
  let ghlLive = null;
  // Minted portal ids are uuids (dashes); real GHL contact ids never have them.
  if (storeCfEmpty && opts.ghl && opts.token && !String(contactId).includes("-")) {
    try {
      const data = await opts.ghl("GET", `/contacts/${encodeURIComponent(contactId)}`, { token: opts.token });
      const c = (data && (data.contact || data)) || null;
      const arr = (c && (c.customFields || c.customField)) || [];
      for (const f of (Array.isArray(arr) ? arr : [])) {
        const v = f && (f.value ?? f.field_value ?? f.fieldValue);
        if (f && f.id != null && v != null && String(v).trim()) cfMap[String(f.id)] = v;
      }
      ghlLive = c;
    } catch (_) { /* live GHL is a bonus — never block a draft */ }
  }

  const lines = [];
  // WHO YOU'RE TEXTING: always the PARENT/guardian, addressed by their first name.
  // The athlete is their child, referenced in the third person - never greeted
  // directly (Zoran 2026-07-10). Parent name is authoritative from the booking,
  // then the contact record, then the athlete-name fields the lead's own form
  // filled (mapped via v15_config.athlete_name_field_ids, first+last aware).
  const bookingParent = String((booking && booking.parent_name) || "").trim();
  const contactName = String(contact?.name || "").trim();
  let athleteName = String(contact?.athlete_name || (booking && booking.athlete_name) || "").trim();
  if (!athleteName) {
    try { athleteName = resolveAthleteNameFromFields(cfMap, await athleteFieldIds(clientId)) || ""; } catch (_) {}
  }

  // Self-heal the portal contacts row with anything we just learned (fill-only,
  // never clobbers) so the Hawkeye Book-it card, deck names, and the booking
  // RPC stop asking staff for a name the lead already gave on a form.
  try {
    const heal = {};
    if (ghlLive && storeCfEmpty && Object.keys(cfMap).length) heal.custom_fields = cfMap;
    if (athleteName && !String(contact?.athlete_name || "").trim()) heal.athlete_name = athleteName;
    if (ghlLive && !contactName) {
      const nm = [ghlLive.firstName, ghlLive.lastName].filter(Boolean).join(" ").trim() || ghlLive.contactName || ghlLive.name || "";
      if (nm) heal.name = nm;
    }
    if (Object.keys(heal).length) {
      heal.updated_at = new Date().toISOString();
      await sb(`contacts?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(heal) });
    }
  } catch (_) { /* heal is a bonus — never block a draft */ }
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

  // Form answers → labels come from the live GHL defs AND the portal's own
  // custom_field_defs (so academies with no GHL token still resolve), plus
  // portal-native answers in contact_field_values (fields with no GHL bridge:
  // funnel wizard questions, checkout intake).
  try {
    const labels = (await fieldLabels(opts)) || {};
    let defs = [];
    try { defs = (await sb(`custom_field_defs?client_id=eq.${clientId}&archived=eq.false&select=id,ghl_field_id,label`)) || []; } catch (_) { defs = []; }
    for (const d of defs) if (d && d.ghl_field_id && d.label && !labels[String(d.ghl_field_id)]) labels[String(d.ghl_field_id)] = d.label;

    const formLines = [];
    const seenLabels = new Set();
    const pushLine = (label, val) => {
      if (!label || val == null || val === "") return;
      let v = Array.isArray(val) ? val.join(", ") : (typeof val === "object" ? JSON.stringify(val) : String(val));
      v = v.trim();
      if (!v) return;
      const key = String(label).toLowerCase();
      if (seenLabels.has(key)) return;
      seenLabels.add(key);
      formLines.push(`- ${label}: ${v.slice(0, 200)}`);
    };
    for (const [id, val] of Object.entries(cfMap)) {
      if (formLines.length >= 12) break;
      pushLine(labels[String(id)], val);   // no label = unmapped/opaque, skipped
    }
    // Portal-native values (keyed by custom_field_defs id, not a GHL id).
    if (contact && contact.id && formLines.length < 12) {
      try {
        const vals = (await sb(`contact_field_values?contact_id=eq.${encodeURIComponent(contact.id)}&select=field_id,value`)) || [];
        const byId = new Map(defs.map(d => [String(d.id), d]));
        for (const r of (Array.isArray(vals) ? vals : [])) {
          if (formLines.length >= 12) break;
          const d = byId.get(String(r.field_id));
          if (d) pushLine(d.label, r.value);
        }
      } catch (_) { /* portal-native values are a bonus */ }
    }
    if (formLines.length) { lines.push(`From their form submission:`); lines.push(...formLines); }
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
