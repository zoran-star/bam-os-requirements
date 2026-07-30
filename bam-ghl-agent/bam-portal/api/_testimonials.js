// THE testimonial resolver - the one function answering "which testimonials
// should this academy show", for every consumer. If two surfaces answer that
// question differently, that is the two-sources-of-truth bug the store exists
// to kill - so nothing else may re-implement this ordering.
//
// ═══ ADDING A NEW CONSUMER: READ THIS, YOU DO NOT NEED TO ASK ANYONE ═══
//
// TWO SEAMS. Pick by where your code lives:
//   • INSIDE this monorepo → import { resolveTestimonials } from "../_testimonials.js"
//   • OUTSIDE it (bam-client-sites, an app, a new site) → GET
//     /api/website/testimonials?client_id=<uuid>, CORS-gated by
//     clients.allowed_domains. Never reach the database directly from outside;
//     never add an HTTP hop from inside.
//
// ONE SHAPE, ALWAYS. This returns the same three facts to everybody:
//   { aggregate: {rating,count,checked_at}|null, testimonials: [...], starredCount }
// CONSUMERS FORMAT; THE RESOLVER DOES NOT. The page wants cards, the agent
// wants a sentence, an email wants a block - each renders these facts its own
// way. Do NOT add resolveForAgent()/resolveForPage() variants: the moment this
// grows per-consumer shapes it has forked, and consumer #5 needs shape #5.
//
// TESTIMONIALS ARE A SALES-SIDE FACT (Zoran, 2026-07-29). They exist to bring
// prospects in: websites, sales copy, the agent. People who have already
// joined do not need them. Asking members FOR reviews is deferred to the
// Google-API era and is not this seam's job.
//
// THE THREE FACTS, and what a consumer may do with them:
//   aggregate     - the academy's real Google rating + count, read at
//                   checked_at. A POINT-IN-TIME READING, not live: label it
//                   with its date, never as current. null = render no rating.
//   testimonials  - already ordered by the locked hierarchy and already
//                   filtered. Render top-N; do not re-sort, do not re-filter.
//                   A row with source 'manual' has NO rating and NO date keys,
//                   so review framing (stars, "Google review", a date) is
//                   physically unavailable for typed quotes. Do not add it.
//   starredCount  - only for telling the two empty states apart, below.
//
// A NEW CONSUMER IS ENFORCED, NOT TRUSTED: scripts/check-testimonial-hardcodes.mjs
// FAILS when a surface renders testimonial-shaped markup without referencing one
// of the two seams. A page that hardcodes quotes cannot pass by being novel.
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
// ⚠️ THREE STATES, NOT TWO - and callers must not collapse them:
//   1. zero rows                  → { testimonials: [] }   "we never asked"
//   2. rows but none starred      → starredCount === 0     "they chose not to feature any"
//   3. the resolver CANNOT ANSWER → this function THROWS.  An outage, not a fact.
// Zoran approved "empty store means the email is dropped". He did NOT approve
// "a failed lookup means the email is dropped" - that is an outage presenting
// as a feature. So seed-time callers MUST let the throw propagate (or fail the
// seed loudly), never catch-and-treat-as-empty. The website endpoint maps the
// throw to a 500, which its consumers already render as "section absent" -
// acceptable for a marketing section, wrong for a seed decision.

// ═══ DISPLAY TYPOGRAPHY: WHY THE STORED ROW IS NEVER TOUCHED ═══════════════
//
// ⛔ DO NOT "CLEAN" THE `testimonials` TABLE. There is no migration, no UPDATE
// and no scrub-on-write behind this, on purpose. These rows are a REAL PARENT'S
// WORDS. If anyone ever reads a row to answer "what did this family actually
// say about us", the answer has to be the truth, byte for byte, not our house
// style applied to someone else's sentence. The store is the record; this
// function is the render.
//
// WHAT IT DOES. The repo bans the em dash from person-facing output (see the
// root CLAUDE.md). That rule was written about OUR copy, and our copy is the
// easy case. A parent typed one into a Google review, and that review now ships
// on the free-trial page and inside the nurture-3 email. So the character is
// substituted on the way OUT: long dashes become a hyphen, spaced so the
// sentence still reads ("a trainer<em-dash>he's a mentor" renders as
// "a trainer - he's a mentor", never "a trainer-he's").
//
// ⛔ TYPOGRAPHY ONLY. NEVER WORDS. This is deliberately incapable of changing,
// reordering or dropping a word, and that is the property that makes editing
// someone else's quote defensible at all:
//   - the pattern matches ONLY spaces, tabs and four dash code points
//     (U+2012 figure, U+2013 en, U+2014 em, U+2015 horizontal bar)
//   - the replacement contains ONLY spaces and "-"
// so no letter, digit or apostrophe can be added, removed or moved. Anything
// that cannot be proved word-preserving that cheaply does NOT belong here. In
// particular this is NOT a place to add a general rewriting, tidying or
// "improve the grammar" pass over a customer's sentence.
//
// CONSIDERED AND DELIBERATELY LEFT ALONE: smart quotes (U+2018/19/1C/1D) and
// the ellipsis (U+2026). None are present in any stored row today, none are
// banned, and all render fine. Flattening a curly double quote would also nest
// a straight quote inside the straight quotes the email already wraps a quote
// in, which reads worse than leaving it. If a future row needs one of them,
// add it here with the same one-character-for-one-character proof, and nowhere
// else.
//
// WHY HERE AND NOT AT EACH RENDER SITE. This is THE seam. Four consumers
// already read it (the website endpoint, the nurture-3 / onboarding-testimonials
// email via api/_academy-facts.js, the agent's social_proof fact, the seed
// path), and scripts/check-testimonial-hardcodes.mjs ENFORCES that a new
// person-facing surface goes through this seam or the HTTP one in front of it.
// So the seam is the only place with a coverage guarantee that survives
// consumer #5 arriving. Doing it per renderer means three copies today, a
// missed copy tomorrow, and an em dash reaching a parent through whichever
// surface was written last.
// It does NOT fork this module: the rule the header forbids is per-consumer
// SHAPES (resolveForAgent/resolveForPage). This transform is identical for
// every consumer, so it cannot grow variants.
//
// ⚠️ THE COST, STATED PLAINLY SO NOBODY IS SURPRISED BY IT. What this function
// returns is now DISPLAY TEXT, not the archived sentence. Two consequences:
//   1. An audit asking "what did this parent write" must read
//      `testimonials.quote` directly. Never quote this resolver as evidence of
//      what somebody said.
//   2. scripts/snapshots/bam-gta.json is a CAPTURED COPY of this function's
//      output, used by the GTA message lock. Changing the transform makes that
//      snapshot stale, and a stale snapshot means the lock is green about a
//      reality that moved. Re-take it deliberately, with the golden diff read
//      by a human, never as a side effect.
// Written as escapes on purpose: the literal characters must not appear in this
// repo's source, and an escape cannot be mistaken for a typo either.
const LONG_DASH_RUN = /[ \t]*[\u2012\u2013\u2014\u2015][ \t]*/g;
const EN_DASH = "\u2013";

/**
 * Substitute banned dash characters for a hyphen, preserving every word.
 * Display layer only - the stored row keeps the parent's exact text.
 * @param {string} text
 * @returns {string}
 */
export function normalizeTypography(text) {
  const s = String(text == null ? "" : text);
  return s.replace(LONG_DASH_RUN, (m, offset) => {
    const dash = m.trim();
    const tight = m.length === dash.length;
    const before = offset > 0 ? s[offset - 1] : "";
    const after = s[offset + m.length] === undefined ? "" : s[offset + m.length];
    // A tight en dash between digits is a RANGE ("6<en-dash>8"), and a range
    // reads wrong with spaces around the hyphen.
    if (tight && dash === EN_DASH && /[0-9]/.test(before) && /[0-9]/.test(after)) return "-";
    const atLineStart = offset === 0 || before === "\n";
    const atLineEnd = after === "" || after === "\n";
    if (atLineStart && atLineEnd) return "-";
    if (atLineStart) return "- ";
    if (atLineEnd) return " -";
    return " - ";
  });
}

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
//
// `quote` and `author` are the DISPLAY forms: same words as the stored row,
// with long dashes substituted (see normalizeTypography above). The row itself
// is never written to and never modified in place.
function publicShape(row) {
  const quote = normalizeTypography(row.quote);
  const author = normalizeTypography(row.author) || "Parent";
  if (row.source === "google") {
    return {
      quote,
      author,
      source: "google",
      rating: row.rating,
      date: row.review_created_at,
    };
  }
  return { quote, author, source: "manual" };
}

/**
 * Resolve an academy's displayable testimonials + aggregate.
 * @returns {Promise<{aggregate: {rating:string,count:number,checked_at:string}|null,
 *   testimonials: Array, starredCount: number}>}
 */
export async function resolveTestimonials(clientId, reader) {
  // ONE function, with an OPTIONAL reader rather than a second entry point.
  // api/_academy-facts.js already holds a PostgREST reader of exactly this shape
  // and has no credentials of its own, so it injects it. A resolveForEmails()
  // variant would be the fork this module's header forbids.
  const read = reader || sbReq;

  const [client] = (await read(
    `clients?id=eq.${clientId}&select=google_rating,google_review_count,google_rating_checked_at`
  )) || [];

  const rows = (await read(
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
