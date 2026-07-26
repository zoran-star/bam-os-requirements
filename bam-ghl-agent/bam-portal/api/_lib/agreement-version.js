// Version stamping for enrollment agreements - the "wax seal".
//
// version_id = sha256 over the CANONICAL form of a terms document. Any change
// to any word produces a different id, so a member's stored version_id proves
// exactly which wording they signed, and editing the agreement later can never
// alter what a past member agreed to.
//
// Canonical form = the document with `version_id` removed (it cannot hash
// itself) and object keys sorted, so re-serializing or reordering the JSON file
// without changing a word keeps the same id.
//
// `_`-prefixed path so Vercel does not treat this as an HTTP endpoint.

import { createHash } from "crypto";

// Deterministic JSON: object keys sorted, arrays left in order (order is
// meaningful in a contract - section 3 must stay section 3).
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function canonicalTerms(doc) {
  const copy = { ...(doc || {}) };
  delete copy.version_id;      // a document cannot contain its own hash
  return canonical(copy);
}

export function versionIdFor(doc) {
  return createHash("sha256").update(canonicalTerms(doc), "utf8").digest("hex");
}

// A terms document has to be renderable and identifiable before it is worth
// stamping. Returns an array of problems; empty means good to publish.
const BLOCK_TYPES = new Set(["p", "list", "fields", "consent", "ack", "note", "signature"]);

export function validateTerms(doc) {
  const errs = [];
  if (!doc || typeof doc !== "object") return ["terms is not an object"];
  if (!doc.doc_id) errs.push("missing doc_id");
  if (!doc.title) errs.push("missing title");
  if (!Array.isArray(doc.sections) || !doc.sections.length) errs.push("no sections");

  const consentKeys = new Set();
  (doc.sections || []).forEach((s, si) => {
    const where = `section ${s.n || si + 1}`;
    if (!s.h) errs.push(`${where}: missing heading`);
    if (!Array.isArray(s.blocks)) { errs.push(`${where}: blocks is not an array`); return; }
    s.blocks.forEach((b, bi) => {
      const at = `${where} block ${bi + 1}`;
      if (!BLOCK_TYPES.has(b.t)) { errs.push(`${at}: unknown block type "${b.t}"`); return; }
      if (b.t === "p" && !b.html) errs.push(`${at}: empty paragraph`);
      if (b.t === "note" && !b.text) errs.push(`${at}: empty note`);
      if (b.t === "list" && !(b.items || []).length) errs.push(`${at}: empty list`);
      if (b.t === "ack" && !(b.items || []).length) errs.push(`${at}: empty acknowledgement`);
      if (b.t === "fields") {
        (b.fields || []).forEach((f) => {
          if (!f.key) errs.push(`${at}: a field has no key`);
          if (!f.label) errs.push(`${at}: field "${f.key}" has no label`);
        });
      }
      if (b.t === "consent") {
        if (!b.key) errs.push(`${at}: consent has no key`);
        if (consentKeys.has(b.key)) errs.push(`${at}: duplicate consent key "${b.key}"`);
        consentKeys.add(b.key);
        if ((b.choices || []).length < 2) errs.push(`${at}: consent "${b.key}" needs at least two choices`);
        (b.choices || []).forEach((c) => {
          if (!c.value) errs.push(`${at}: a choice in "${b.key}" has no value`);
          if (!c.label) errs.push(`${at}: choice "${c.value}" in "${b.key}" has no label`);
        });
      }
    });
  });

  // Repo-wide rule: no em dash in anything a person reads.
  if (JSON.stringify(doc).includes("—")) errs.push("contains an em dash (U+2014); use a hyphen");

  return errs;
}

// The consent keys a signed record MUST answer for this document.
export function requiredConsentKeys(doc) {
  const keys = [];
  ((doc && doc.sections) || []).forEach((s) => {
    (s.blocks || []).forEach((b) => { if (b.t === "consent" && b.required) keys.push(b.key); });
  });
  return keys;
}
