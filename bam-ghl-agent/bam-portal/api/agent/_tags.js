// Shared GHL contact-tag helpers.
//
// The sales-crew model has exactly ONE true dead end: 🚫 Unqualified (opt-out /
// invalid / spam / hard-no / clearly-not-a-fit). Marking a lead Unqualified stamps
// a GHL `unqualified` tag so the state MIRRORS a portal switch (bidirectional) and
// the lead stays filterable/segmentable inside GHL. Everyone else who's "Lost" is
// NOT unqualified — they flow into 💔 Lead Nurture instead (see nurtureStage in
// _stage.js). Keep the tag name in ONE place so the portal + agents agree.
import { ghl } from "../ghl/_core.js";

export const UNQUALIFIED_TAG = "unqualified";

// Add one or more tags to a GHL contact. Best-effort by nature: GHL dedupes, so
// re-adding an existing tag is a no-op, not an error.
export async function addContactTags(token, contactId, tags) {
  const list = (Array.isArray(tags) ? tags : [tags]).map(t => String(t || "").trim()).filter(Boolean);
  if (!contactId || !list.length) return;
  await ghl("POST", `/contacts/${encodeURIComponent(contactId)}/tags`, { token, body: { tags: list } });
}

export async function removeContactTags(token, contactId, tags) {
  const list = (Array.isArray(tags) ? tags : [tags]).map(t => String(t || "").trim()).filter(Boolean);
  if (!contactId || !list.length) return;
  await ghl("DELETE", `/contacts/${encodeURIComponent(contactId)}/tags`, { token, body: { tags: list } });
}

// Convenience wrappers for the Unqualified switch.
export const markUnqualified   = (token, contactId) => addContactTags(token, contactId, UNQUALIFIED_TAG);
export const unmarkUnqualified = (token, contactId) => removeContactTags(token, contactId, UNQUALIFIED_TAG);

// Is this contact currently flagged Unqualified? Reads from an already-fetched
// tag list (e.g. ghl_contacts.tags synced by cron-sync-contacts, or a contact
// payload's tags) — case-insensitive. No network call.
export function isUnqualified(tags) {
  const list = Array.isArray(tags) ? tags : [];
  return list.some(t => String(typeof t === "string" ? t : (t?.name || t?.tag || "")).trim().toLowerCase() === UNQUALIFIED_TAG);
}
