// ── Derived brand stats + website resolver ────────────────────────────────
//
// brand_data used to carry three things it had no business storing:
//
//   stats        free text the owner typed once at onboarding and never
//                revisited. BAM GTA's said "Mon/Wed/Fri evening training" and
//                "43+ active members". Its live schedule_slots are Mon/Tue/Wed/
//                Thu/Sat (it has never trained on a Friday) and it has 47
//                members. Stored prose about live data is stale by definition.
//   domain       duplicate of website_setup.domain
//   website_url  duplicate of website_setup.domain
//
// Everything here is derived at read time from the tables that own the truth:
// members, schedule_slots, clients.address and website_setup.
//
// `sb` is the caller's PostgREST helper: sb(path) -> rows.

// The domain wizard (api/website/domain-setup.js) owns clients.website_setup,
// and website_setup.domain is the single place a client's site lives. Returns a
// clickable absolute URL, or "" when the client has no site on file.
export function resolveClientWebsite(client) {
  const raw = client && client.website_setup && typeof client.website_setup.domain === "string"
    ? client.website_setup.domain.trim()
    : "";
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

// Bare host form (no scheme), for places that print a domain rather than link it.
export function resolveClientDomain(client) {
  const url = resolveClientWebsite(client);
  return url ? url.replace(/^https?:\/\//i, "").replace(/\/+$/, "") : "";
}

// A member row counts as active unless it has been ended. Cancellations are
// moved out of `members` entirely today, so this matches the raw row count for
// every current academy - but it keeps counting honestly if ended rows ever
// start being retained in place.
const ENDED_MEMBER_STATUSES = new Set(["cancelled", "canceled", "churned", "inactive", "ended"]);

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function weekdayIn(iso, tz) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "short" }).format(d);
  } catch (_) {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(d);
  }
}

// Pull a locality out of the free-text mailing address, conservatively. Returns
// "" whenever the address is only a street line, which is the honest answer -
// better an omitted line than an invented one. (BAM GTA's address is
// "2205 Rosemount Cres", so GTA legitimately gets no location line.)
const ADDRESS_NOISE = /^(united states|usa|us|united kingdom|uk|canada|australia)$/i;
const POSTAL_ONLY = /^[\d\s-]+$/;
const SUITE = /\b(suite|ste|apt|apartment|unit|#)\b/i;
const STATE_ONLY = /^[A-Z]{2}$/;

export function localityFromAddress(address) {
  if (!address || typeof address !== "string") return "";
  const parts = address.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return "";                 // street line only
  const rest = parts.slice(1).filter(p => !ADDRESS_NOISE.test(p) && !POSTAL_ONLY.test(p) && !SUITE.test(p));
  if (!rest.length) return "";
  // Strip a trailing postal code / country off the candidate.
  const clean = (s) => s.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, "")   // UK
                        .replace(/\b\d{5}(-\d{4})?\b/, "")                        // US ZIP
                        .replace(/\b(united states|usa|united kingdom|canada|australia)\b/i, "")
                        .replace(/\s{2,}/g, " ").trim().replace(/[,\s]+$/, "");
  const city = clean(rest[0]);
  // "FL" alone is a state, not a place worth printing.
  if (!city || STATE_ONLY.test(city)) return "";
  const next = rest[1] ? clean(rest[1]) : "";
  return STATE_ONLY.test(next) ? `${city}, ${next}` : city;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derive brand stats for a set of clients.
 * @param {(path: string) => Promise<any[]>} sb  PostgREST helper
 * @param {Array<{id:string,address?:string,time_zone?:string}>} clients
 * @returns {Promise<Record<string,{member_count:number,weekdays:string[],locality:string,lines:string[]}>>}
 */
export async function deriveBrandStats(sb, clients) {
  const rows = (clients || []).filter(c => c && c.id);
  const out = {};
  for (const c of rows) out[c.id] = { member_count: 0, weekdays: [], locality: localityFromAddress(c.address), lines: [] };
  if (!rows.length) return out;

  const ids = rows.map(c => c.id);
  const inList = `in.(${ids.join(",")})`;
  // Look back 60 days for the training pattern, and forward 30 so an academy
  // whose season has not started yet still reports the days it will run.
  const since = new Date(Date.now() - 60 * DAY_MS).toISOString();
  const until = new Date(Date.now() + 30 * DAY_MS).toISOString();

  const [members, slots] = await Promise.all([
    sb(`members?client_id=${inList}&select=client_id,status&limit=20000`).catch(() => []),
    sb(`schedule_slots?tenant_id=${inList}&is_cancelled=eq.false&start_time=gte.${encodeURIComponent(since)}&start_time=lte.${encodeURIComponent(until)}&select=tenant_id,start_time&limit=20000`).catch(() => []),
  ]);

  for (const m of members || []) {
    const bucket = out[m.client_id];
    if (bucket && !ENDED_MEMBER_STATUSES.has(String(m.status || "").toLowerCase())) bucket.member_count++;
  }

  const tzById = Object.fromEntries(rows.map(c => [c.id, c.time_zone]));
  const daysById = {};
  for (const s of slots || []) {
    const d = weekdayIn(s.start_time, tzById[s.tenant_id]);
    if (!d) continue;
    (daysById[s.tenant_id] ||= new Set()).add(d);
  }
  for (const id of ids) {
    const set = daysById[id];
    if (set) out[id].weekdays = DAY_ORDER.filter(d => set.has(d));
  }

  for (const id of ids) {
    const b = out[id];
    b.lines = statLines(b);
  }
  return out;
}

// The three lines that replace the old free-text `stats` blob.
export function statLines(b) {
  const lines = [];
  if (b.member_count > 0) lines.push(`${b.member_count} active member${b.member_count === 1 ? "" : "s"}`);
  if (b.weekdays.length) lines.push(`${b.weekdays.join("/")} training`);
  if (b.locality) lines.push(b.locality);
  return lines;
}
