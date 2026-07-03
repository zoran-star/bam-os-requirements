// Helpers for the BAM MASTER Twilio account (agency model): auth, REST calls,
// and per-academy subaccounts. Used by provision.js / start-migration.js /
// migration-watch.js.

export function masterAuth() {
  const sid = process.env.TWILIO_MASTER_API_KEY_SID;
  const secret = process.env.TWILIO_MASTER_API_KEY_SECRET;
  if (!sid || !secret) return null;
  return "Basic " + Buffer.from(`${sid}:${secret}`).toString("base64");
}

export async function tw(auth, method, path, form) {
  const r = await fetch(`https://api.twilio.com/2010-04-01${path}`, {
    method,
    headers: { Authorization: auth, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Twilio ${r.status} ${path}: ${j.message || j.code || "error"}`);
  return j;
}

// Find (by friendly name) or create the academy's subaccount. Returns the
// account object - includes sid + auth_token on both paths.
export async function findOrCreateSubaccount(auth, masterSid, businessName, { dryRun = false } = {}) {
  const subName = `academy: ${businessName}`.slice(0, 64);
  const found = await tw(auth, "GET", `/Accounts.json?FriendlyName=${encodeURIComponent(subName)}&Status=active&PageSize=1`);
  let sub = (found.accounts || [])[0] || null;
  if (sub && sub.sid === masterSid) sub = null; // never target the master itself
  if (!sub && !dryRun) sub = await tw(auth, "POST", `/Accounts.json`, { FriendlyName: subName });
  return { sub, subName, created: !!sub && !(found.accounts || [])[0] };
}
