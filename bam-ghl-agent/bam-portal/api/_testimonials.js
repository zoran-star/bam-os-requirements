// THE testimonial resolver - the one function answering "which testimonials
// should this academy show", for every consumer: the website cards
// (api/website/testimonials.js), the testimonial emails at seed time, and the
// agent's social_proof fact. If two surfaces answer that question differently,
// that is the two-sources-of-truth bug the store exists to kill - so nothing
// else may re-implement this ordering.
//
// THE HIERARCHY (Zoran, tier 1, locked, no per-academy reordering):
//   1. pinned (starred) Google reviews
//   2. pinned typed quotes
//   3. remaining Google reviews, highest rating down, newest first within a tie
//   4. remaining typed quotes, newest first
// Google rows under 4 stars NEVER leave the owner's card: excluded here, which
// excludes them everywhere.
//
// A typed (manual) quote never carries a rating, a "Google review" badge or a
// date - the rows physically cannot hold those fields (testimonials_guard_source
// raises), and this resolver additionally never emits them for manual rows, so
// a future bug upstream cannot leak review framing onto a typed quote.
//
// The AGGREGATE comes from the clients columns (google_rating +
// google_review_count + google_rating_checked_at): a point-in-time reading off
// the owner's Business Profile, both-or-neither enforced in the DB. Typed
// quotes never move it. No aggregate on file = aggregate: null = no rating
// renders anywhere.
//
// EMPTY STATES (do not collapse them): zero rows means "we never asked";
// rows-but-none-starred means "they gave us quotes and chose not to feature
// any". Both mean the testimonials email does not ship (decided at seed time,
// not render time); only the first is a reason to go back to the academy.
// `starredCount` is returned so seed-time logic can tell them apart.

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

async function sbReq(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// Hierarchy comparator over raw rows. Google under-4s must already be gone.
function hierarchyRank(row) {
  if (row.starred && row.source === "google") return 0;
  if (row.starred) return 1;
  if (row.source === "google") return 2;
  return 3;
}

function compareRows(a, b) {
  const ra = hierarchyRank(a), rb = hierarchyRank(b);
  if (ra !== rb) return ra - rb;
  if (a.source === "google" && b.source === "google") {
    const dr = (b.rating ?? 0) - (a.rating ?? 0);
    if (dr) return dr;
    return new Date(b.review_created_at || 0) - new Date(a.review_created_at || 0);
  }
  return new Date(b.created_at || 0) - new Date(a.created_at || 0);
}

// What each consumer receives per row. Manual rows NEVER carry rating/date -
// enforced here as well as in the DB, deliberately twice.
function publicShape(row) {
  if (row.source === "google") {
    return {
      quote: row.quote,
      author: row.author || "Parent",
      source: "google",
      rating: row.rating,
      date: row.review_created_at,
    };
  }
  return { quote: row.quote, author: row.author || "Parent", source: "manual" };
}

/**
 * Resolve an academy's displayable testimonials + aggregate.
 * @returns {Promise<{aggregate: {rating:string,count:number,checked_at:string}|null,
 *   testimonials: Array, starredCount: number}>}
 */
export async function resolveTestimonials(clientId) {
  const [client] = (await sbReq(
    `clients?id=eq.${clientId}&select=google_rating,google_review_count,google_rating_checked_at`
  )) || [];

  const rows = (await sbReq(
    `testimonials?client_id=eq.${clientId}` +
    `&select=quote,author,source,rating,starred,review_created_at,created_at`
  )) || [];

  // Under-4-star Google reviews never leave the owner's card.
  const displayable = rows.filter(
    (r) => r.source !== "google" || (r.rating != null && r.rating >= 4)
  );
  displayable.sort(compareRows);

  const aggregate =
    client && client.google_rating != null && client.google_review_count != null
      ? {
          rating: client.google_rating,
          count: client.google_review_count,
          checked_at: client.google_rating_checked_at,
        }
      : null;

  return {
    aggregate,
    testimonials: displayable.map(publicShape),
    starredCount: displayable.filter((r) => r.starred).length,
  };
}
