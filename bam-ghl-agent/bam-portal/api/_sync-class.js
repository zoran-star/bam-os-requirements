// sync_class resolver: "may this automation step's content travel to another
// academy?"
//
// Background in api/email-templates/sync-classes.js. Short version: the preset
// copies automated messages between academies, some content (real parent
// testimonials, academy-specific literals) must never travel, and the weekly
// drift checker that would have caught a mis-marking was cancelled in favour of
// this control. Nothing else detects a wrong answer here.
//
// THE RULE - THE STRICTEST WINS:
//
//     attributed  >  local  >  shared
//
// A step's effective class is the strictest of:
//   1. the step row's own sync_class (absent/null -> 'shared', the column default), and
//   2. the class of the TEMPLATE its body references, when body is "template:<key>".
//
// So a step row saying 'shared' whose body is "template:nurture-3" resolves to
// 'attributed'. A step row can only ever make its content STRICTER, never
// looser: an academy (or a bad seed, or a UI that forgets to send the field)
// cannot downgrade an attributed template by writing 'shared' on the row.
//
// Every unknown fails CLOSED - an unrecognized class string, or a template key
// with no declaration, resolves to 'attributed'. A wrong 'shared' is the bug
// this exists to prevent; a wrong 'attributed' only blocks a copy.

import {
  SYNC_CLASS_RANK,
  SYNC_CLASSES,
  DEFAULT_SYNC_CLASS,
  UNDECLARED_TEMPLATE_SYNC_CLASS,
  TEMPLATE_SYNC_CLASS,
  syncClassForTemplate,
} from "./email-templates/sync-classes.js";

export {
  SYNC_CLASSES,
  SYNC_CLASS_RANK,
  DEFAULT_SYNC_CLASS,
  TEMPLATE_SYNC_CLASS,
  syncClassForTemplate,
};

// The STRICTEST class - what everything unknown resolves to.
export const STRICTEST_SYNC_CLASS = SYNC_CLASSES.reduce(
  (a, b) => (SYNC_CLASS_RANK[b] > SYNC_CLASS_RANK[a] ? b : a),
  SYNC_CLASSES[0],
);

// MUST stay identical to the template-ref matcher in api/email-shells.js
// (renderEmail). If this matcher is looser or tighter than the one that decides
// what actually gets SENT, a body could render as a testimonial template while
// classifying as plain text - the exact failure mode this module prevents.
// api/_sync-class.test.mjs asserts the two agree on real bodies.
const TEMPLATE_REF = /^\s*template:([\w/-]+)\s*$/;

// The template key a step body references, or "" if the body is literal copy.
export function templateRefKey(body) {
  const m = String(body || "").match(TEMPLATE_REF);
  return m ? m[1] : "";
}

// Normalize one declared class value. null/undefined/"" is the absent case and
// means the column default ('shared'). Anything else that is not one of the
// three known values fails CLOSED to the strictest class rather than being
// ignored - a typo must not read as permission.
export function normalizeSyncClass(value) {
  if (value == null || String(value).trim() === "") return DEFAULT_SYNC_CLASS;
  const v = String(value).trim().toLowerCase();
  return SYNC_CLASS_RANK[v] === undefined ? STRICTEST_SYNC_CLASS : v;
}

// The strictest of any number of classes. Unknown inputs are normalized first,
// so they can only raise the result.
export function strictest(...classes) {
  let out = DEFAULT_SYNC_CLASS;
  for (const c of classes) {
    const n = normalizeSyncClass(c);
    if (SYNC_CLASS_RANK[n] > SYNC_CLASS_RANK[out]) out = n;
  }
  return out;
}

// The effective sync_class of an automation step.
//   resolveSyncClass({ body, sync_class }) -> 'shared' | 'local' | 'attributed'
// Accepts a raw automation_steps row. A missing row resolves to the strictest
// class (we cannot see what it carries, so we do not let it travel).
export function resolveSyncClass(step) {
  if (!step || typeof step !== "object") return STRICTEST_SYNC_CLASS;
  const declared = normalizeSyncClass(step.sync_class);
  const key = templateRefKey(step.body);
  // Literal body: the row's own class is the whole answer. Template body: the
  // template's class joins the comparison and can only raise it.
  const fromTemplate = key ? syncClassForTemplate(key) : DEFAULT_SYNC_CLASS;
  return strictest(declared, fromTemplate);
}

// The one question callers actually ask before copying a step into another
// academy. Only 'shared' content may travel.
export function mayCopyToAnotherAcademy(step) {
  return resolveSyncClass(step) === "shared";
}

export { UNDECLARED_TEMPLATE_SYNC_CLASS };
