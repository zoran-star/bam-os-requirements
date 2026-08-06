// Meta writes its error messages for API developers, and our API forwards them
// straight through (`fbJson.error.message`). A marketing coordinator opening a
// client's Marketing tab was shown this, verbatim, twice on one screen:
//
//   (#200) Ad account owner has NOT grant ads_management or ads_read
//   permission, refer to https://developers.facebook.com/docs/... for details.
//
// She could not act on it. This module turns the failures that actually happen
// into one sentence with the action attached. The raw text is never thrown
// away: <MetaError> keeps it one click behind a "Show details" toggle.
//
// The API only forwards Meta's message string, never the numeric code, so the
// classification has to read the text. Meta prefixes many messages with the
// code in parentheses, e.g. "(#200)", which is the most reliable signal.

// Token is dead: expired, revoked, or the user dropped our app. Code 190,
// subcode 463 for a plain expiry. Someone has to reconnect.
const RE_EXPIRED = /\(#(190|102|463)\)|session has expired|error validating access token|access token[^.]*(expire|revoke)|token (has )?(expired|been revoked)|has not authorized application|could not be decrypted|malformed or otherwise invalid/i;
// The connection is fine, this particular ad account never granted our Meta
// user access to its ad data. Code 200 / 10. Different action: someone with
// rights on that ad account has to grant it.
const RE_PERMISSION = /\(#(200|10|3|272|294|298)\)|ads_management|ads_read|not grant|not granted|does not have permission|do not have permission|not have (the )?permission|no permission/i;
// Meta throttling us. Nothing is broken, it just needs a minute.
const RE_RATE = /\(#(4|17|32|613|80\d{3})\)|rate limit|too many calls|request limit reached|please reduce the amount of data/i;
// Deliberately narrow: this rule may only fire on OUR OWN signals, never on
// Meta's prose. A bare "not connected" used to match here, which swallowed
// Meta's real Instagram error - "(#200) The Instagram account is not connected
// to the Facebook Page." - and told staff to reconnect a Meta connection that
// was working fine. So: the API's reason code, and our own canonical sentence
// mapping back to itself so a site that already knows the connection is
// missing doesn't get its copy flattened into the generic line.
const RE_NOT_CONNECTED = /\bno_staff_token\b|\bno staff token\b|\bmeta (is ?n['’]?o?t|not) connected\b/i;

// Exported so the sites that already KNOW the connection is missing (the API
// tells them with reason "no_staff_token") can set this exact string. Matching
// the canonical copy keeps the "Show details" toggle off, since repeating our
// own sentence back as a technical detail helps nobody.
export const META_NOT_CONNECTED = "Meta isn't connected. Go to Settings → Connect Meta.";

const EXPIRED = "Our Meta connection has expired. Reconnect Meta in Settings → Connect Meta, then reload this page.";
const PERMISSION = "This ad account hasn't given us access to its ad data. Its owner needs to grant access to our Meta user, then reload this page.";
const RATE_LIMIT = "Meta is turning our requests away for a moment because we asked too often. Wait a few minutes, then reload this page.";
const UNKNOWN = "We couldn't read the ad numbers from Meta. That is not the same as zero. Try again in a minute, and if it keeps happening pass the details to the tech team.";

// For callers whose failure did NOT necessarily come from Meta. A whole-page
// fetch can fail because our own server erred, the login timed out, or the
// laptop dropped off wifi. None of those are Meta's doing, and naming Meta
// there would be the same confident wrong story this module exists to kill.
// Says what we know - the page has no numbers - and blames nobody.
export const LOAD_FAILED = "We couldn't load this page's numbers just now. That is not the same as zero. Reload the page, and if it keeps happening pass the details to the tech team.";

// Which failure this is, or "unknown" when the text tells us nothing. Exported
// so a caller can ask "do we actually know Meta did this?" before letting
// copy say so.
export function metaErrorKind(raw) {
  const s = String(raw?.message || raw || "").trim();
  if (!s) return "unknown";
  if (RE_NOT_CONNECTED.test(s)) return "not_connected";
  if (RE_EXPIRED.test(s)) return "expired";
  if (RE_PERMISSION.test(s)) return "permission";
  if (RE_RATE.test(s)) return "rate_limit";
  return "unknown";
}

// Meta's failure, in a sentence a marketing coordinator can act on. Anything we
// don't recognise gets the safe generic line, never the raw string.
export function metaErrorText(raw) {
  switch (metaErrorKind(raw)) {
    case "not_connected": return META_NOT_CONNECTED;
    case "expired": return EXPIRED;
    case "permission": return PERMISSION;
    case "rate_limit": return RATE_LIMIT;
    default: return UNKNOWN;
  }
}
