// Per-contact memory → a <contact_memory> block injected into the agent's
// system prompt so it personalizes per person. Assembled from:
//   • ghl_contacts mirror  (athlete name, tags)
//   • post_trial_reviews   (attended a trial? good fit? trainer? trial notes)
//   • agent_contact_notes  (freeform trainer/staff notes)
//
// `sb` is the caller's Supabase REST helper (returns parsed JSON or null).
// Returns "" when there's nothing known, else a prompt block to append.
export async function loadContactMemory(sb, clientId, contactId) {
  if (!clientId || !contactId) return "";
  const cid = encodeURIComponent(contactId);
  let contact = null, ptr = null, notes = [];
  try {
    [contact, ptr, notes] = await Promise.all([
      sb(`ghl_contacts?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&select=name,athlete_name,tags&limit=1`).then(r => (Array.isArray(r) ? r[0] : null)).catch(() => null),
      sb(`post_trial_reviews?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&select=showed_up,good_fit,trainer,notes,created_at&order=created_at.desc&limit=1`).then(r => (Array.isArray(r) ? r[0] : null)).catch(() => null),
      sb(`agent_contact_notes?client_id=eq.${clientId}&ghl_contact_id=eq.${cid}&active=eq.true&select=note,created_by,created_at&order=created_at.desc&limit=20`).then(r => (Array.isArray(r) ? r : [])).catch(() => []),
    ]);
  } catch (_) { /* best-effort — never block a draft */ }

  const lines = [];
  if (contact?.athlete_name) lines.push(`Athlete: ${contact.athlete_name}`);
  if (Array.isArray(contact?.tags) && contact.tags.length) lines.push(`Tags: ${contact.tags.join(", ")}`);

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
