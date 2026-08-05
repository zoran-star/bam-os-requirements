// Does the message TEXT agree with the slot it is stamped with?
//
// Why this exists (Julie Boulton, BAM GTA, 2026-08-04). A pending Booking card
// offered her: "the first open spot the week of Aug 18 is Monday the 18th at
// 7:00 PM". Its stamped `book_slot_at` was 2026-08-18T23:00Z, which in Toronto is
// TUESDAY the 18th. Monday was the 17th. Right date, right time, right class,
// wrong weekday - and if she had planned around "Monday" she'd have shown up a
// day early with a sick kid she'd just rearranged a week around.
//
// The card was labelled as carrying a VERIFIED slot the whole time, because
// normalizeProposal (api/agent-approvals.js) checks exactly one thing: that the
// ISO timestamp is a genuinely open slot. It never reads the sentence. So the
// half of the claim that reaches the parent - the words - was never checked by
// the thing whose entire job is to make the claim trustworthy.
//
// This module checks the other half. It does NOT try to repair the text: when
// the words and the timestamp disagree we cannot know which one the model meant
// (Monday the 17th? Tuesday the 18th?), so guessing would just replace a visible
// error with an invisible one. A human is already approving every one of these
// cards. Tell them, and refuse the send until one side is fixed.
//
// FALSE POSITIVES ARE THE REAL RISK here, because a conflict blocks a send. So
// every rule below only fires on an UNAMBIGUOUS date reference, and anything it
// is unsure about is treated as agreement.

const DAYS = [
  ["sunday", "sun"],
  ["monday", "mon"],
  ["tuesday", "tue", "tues"],
  ["wednesday", "wed", "weds"],
  ["thursday", "thu", "thur", "thurs"],
  ["friday", "fri"],
  ["saturday", "sat"],
];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
const DAY_RE = "(?:sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)[a-z]*";

// The slot written the way a human would say it, in the academy's timezone, or
// null. THIS is what the agent should be handed instead of a raw ISO string.
//
// The prevention half of the Julie Boulton fix: check_availability used to return
// bare timestamps, so writing "Monday the 18th" meant the model converting
// 2026-08-18T23:00Z from UTC to Toronto AND deriving a weekday from the result,
// in its head, mid-sentence. It got the weekday wrong. Handing it "Tuesday,
// August 18th at 7:00 PM" removes the arithmetic rather than checking it.
export function slotWhenLabel(slotIso, timeZone) {
  const p = slotLocalParts(slotIso, timeZone);
  return p ? p.label : null;
}

// The slot, as the parent's academy would say it. Intl does the timezone work;
// a bad timezone or unparseable date returns null and the caller stands down.
export function slotLocalParts(slotIso, timeZone) {
  const t = new Date(slotIso);
  if (!slotIso || isNaN(t.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "America/Toronto",
      weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
    }).formatToParts(t).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    const weekday = String(parts.weekday || "").toLowerCase();
    const month = String(parts.month || "").toLowerCase();
    const day = Number(parts.day);
    if (!weekday || !month || !Number.isFinite(day)) return null;
    return {
      weekday, month, day,
      weekdayIndex: DAYS.findIndex(g => g[0] === weekday),
      monthIndex: MONTHS.indexOf(month),
      label: `${parts.weekday}, ${parts.month} ${ord(parts.day)} at ${parts.hour}:${parts.minute}${parts.dayPeriod ? " " + parts.dayPeriod : ""}`,
      dayLabel: `${parts.weekday} the ${ord(parts.day)}`,
    };
  } catch (_) { return null; }
}

// 18 -> "18th". Staff reads this sentence under time pressure; "the 18" reads
// like a typo and makes the warning itself look unreliable.
const ord = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  const t = v % 100;
  if (t >= 11 && t <= 13) return `${v}th`;
  return `${v}${({ 1: "st", 2: "nd", 3: "rd" })[v % 10] || "th"}`;
};

const dayGroupFor = (word) => {
  const w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
  return DAYS.findIndex(g => g.some(v => w === v || w === v + "s" || w === g[0] || w === g[0] + "s"));
};

/**
 * Compare a drafted message against the slot it claims. Returns null when they
 * agree (or when nothing definite was said), else a human sentence naming the
 * disagreement - written to be shown to staff on the card and returned as a
 * refusal on send.
 *
 * Two rules, both deliberately narrow:
 *
 *   WEEKDAY - the text names one or more weekdays and the slot's weekday is not
 *     among them. Naming several ("Monday or Tuesday") is fine as long as the
 *     stamped one is in the list, because the parent is being offered a choice.
 *
 *   DATE - a day number that is UNAMBIGUOUSLY a date, meaning it sits right next
 *     to a weekday ("Monday the 18th") or a month ("Aug 18"). A bare ordinal is
 *     ignored on purpose: "your 1st session" is not a date, and treating it as
 *     one would block a perfectly good card.
 *
 * Clock times are not checked at all. Messages say "7-8pm", "around 7", "after
 * 6", and every attempt to read those as a claim about the slot produces more
 * wrong answers than it catches.
 */
export function slotTextConflict(text, slotIso, timeZone) {
  const msg = String(text || "");
  if (!msg.trim()) return null;
  const slot = slotLocalParts(slotIso, timeZone);
  if (!slot || slot.weekdayIndex < 0) return null;
  const low = msg.toLowerCase();

  const namedDays = [];
  for (const m of low.matchAll(new RegExp(`\\b${DAY_RE}\\b`, "g"))) {
    const g = dayGroupFor(m[0]);
    if (g >= 0 && !namedDays.includes(g)) namedDays.push(g);
  }
  if (namedDays.length && !namedDays.includes(slot.weekdayIndex)) {
    const said = namedDays.map(i => DAYS[i][0]).map(d => d[0].toUpperCase() + d.slice(1));
    return `The message says ${said.join(" / ")}, but the slot it books is ${slot.dayLabel}. Fix the message or pick a different slot before sending.`;
  }

  // "Monday the 18th" / "Mon 18" / "Aug 18" / "August 18th"
  const dates = [];
  for (const m of low.matchAll(new RegExp(`\\b(?:${DAY_RE}|${MONTH_RE})\\b[\\s,]*(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b`, "g"))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 31 && !dates.includes(n)) dates.push(n);
  }
  if (dates.length && !dates.includes(slot.day)) {
    return `The message says the ${dates.map(ord).join(" / ")}, but the slot it books is ${slot.dayLabel}. Fix the message or pick a different slot before sending.`;
  }

  return null;
}
