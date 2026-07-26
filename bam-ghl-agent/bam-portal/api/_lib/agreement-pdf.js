// Renders the signed enrollment agreement as a PDF and stores it privately.
//
// THE RULE: this renders the SAME terms document the parent read on screen.
// The academy's agreement.html renders clients/<slug>/agreement.terms.json for
// the parent; this renders the published copy of that exact version. The two
// cannot drift, because there is only one document.
//
// (Before 2026-07-25 this file carried its own hardcoded clause text - BAM
// GTA's waiver - and filed it for every academy regardless of what the parent
// had actually read. buildClauses()/sampleClauses() are retained ONLY to
// re-render agreements signed under that old path; nothing new uses them.)
//
// Output is a complete artifact: the terms, the parent's filled-in data, their
// opt-in choices, the signature image, the date, and the version id.
//
// `_`-prefixed path so Vercel does not treat this as an HTTP endpoint.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const INK = rgb(0.04, 0.04, 0.05);
const MUTE = rgb(0.4, 0.4, 0.42);
const RULE = rgb(0.72, 0.72, 0.74);
const GOLD = rgb(0.886, 0.867, 0.624); // #E2DD9F (BAM gold)

/* ═══════════════════════════════════════════════════════════════════════
   LEGACY clause builders - agreements signed before the terms-document
   engine. Kept so an old member's PDF can be re-rendered as it was filed.
   Do NOT use these for new signatures.
   ═══════════════════════════════════════════════════════════════════════ */

function sampleClauses(academyName) {
  return [
    ["1. Participation acknowledgment", "By signing, the participant and/or the parent or legal guardian of the minor participant (“Participant”) affirms their intention to participate in athletic training, games, practices, skills training, strength and conditioning, yoga, psychological training, and other related activities organized by By Any Means GTA and its partners, affiliates, and associated organizations (the “Program Providers”), including By Any Means Basketball, ADAPT Academy, and other affiliate members. If signing for a minor, the undersigned confirms they are the lawful parent or legal guardian with full authority to consent on the minor's behalf."],
    ["2. Acknowledgment of risk and medical consent", "Participation involves inherent risks of injury, illness (including communicable diseases such as COVID-19, MRSA, and influenza), disability, or death. The Participant knowingly accepts and assumes all such risks, known and unknown, and accepts full responsibility for their participation or that of their minor child. The Participant authorizes the Program Providers and their staff to obtain medical treatment deemed necessary in an emergency, and agrees to bear full financial responsibility for resulting medical expenses regardless of insurance. The Participant certifies the athlete has valid accident or medical insurance and proper medical care for any current condition."],
    ["3. Release of liability and indemnification", "In consideration of participation, the Participant, on behalf of themselves and/or their minor child, releases and discharges the Program Providers and their officers, directors, agents, officials, volunteers, employees, affiliates, sponsors, advertisers, and facility owners from any and all claims for illness, disability, death, personal injury, or property damage, even if arising from the active or passive negligence of the Program Providers or others; and agrees to defend and indemnify the Program Providers against any such claims connected to their participation. The Participant agrees to comply with all rules and safety protocols, and acknowledges that failure to do so may result in dismissal without refund."],
    ["4. Parent or guardian certification (minors only)", "For participants under 18 at registration, the undersigned certifies they have read and explained this agreement to the athlete, including all risks, responsibilities, and expectations, and that the athlete understands and accepts these risks. As parent or legal guardian, the undersigned agrees to all terms and releases and indemnifies the Program Providers to the fullest extent allowed by law, even if arising from negligence."],
    ["5. Media release", "The Participant grants the Program Providers permission to photograph or video the athlete during events and activities and to use these materials in marketing, social media, publications, and online platforms without compensation or right of approval, and waives any right to inspect or approve the final product."],
    ["6. Membership, billing and cancellation", `This enrolls the athlete in a recurring membership with ${academyName}. The card on file is charged automatically each billing cycle at the price shown (taxes included) until cancelled. You may cancel by written notice to info@byanymeanstoronto.ca before your next billing date, which stops future charges. Fees already charged are non-refundable except where required by law.`],
    ["7. Electronic signature consent", "By signing electronically, the Participant agrees their electronic signature is the legal equivalent of a handwritten signature, confirming full understanding and acceptance of all terms, and is legally binding to the fullest extent allowed by law."],
  ];
}

// LEGACY. Built the 7 clauses from an offer's Policy section. Superseded by
// per-academy terms documents; retained for re-rendering old agreements.
export function buildClauses({ academyName = "By Any Means", cancelContact = "", policy = null } = {}) {
  const acad = academyName || "the academy";
  const p = policy || {};

  const clause1 =
    `By signing, the participant and/or the parent or legal guardian of the minor participant (“Participant”) ` +
    `affirms their intention to participate in athletic training, games, practices, skills training, strength ` +
    `and conditioning, and other related activities organized by ${acad} and its partners, affiliates, and ` +
    `associated organizations (the “Program Providers”). If signing for a minor, the undersigned confirms they ` +
    `are the lawful parent or legal guardian with full authority to consent on the minor’s behalf.`;

  const notifyTo = cancelContact ? `to ${cancelContact}` : "to the academy";
  const amt = Number(p.cancel_notice_amount);
  let cancelClause;
  if (p.cancellation === "Notice required" && amt > 0) {
    const unit = p.cancel_notice_unit === "hours" ? "hours" : "days";
    const u = amt === 1 ? unit.replace(/s$/, "") : unit;
    cancelClause = `To cancel, provide ${amt} ${u} written notice ${notifyTo} before your next billing date, which stops future charges.`;
  } else {
    cancelClause = `To cancel, provide written notice ${notifyTo} at any time before your next billing date, which stops future charges.`;
  }

  let pauseClause = "";
  if (p.pause_allowed === "Yes") {
    const mn = Number(p.pause_min_days), mx = Number(p.pause_max_days);
    let len;
    if (mn > 0 && mx > 0 && mn < mx) len = `for ${mn} to ${mx} days at a time`;
    else if (mx > 0) len = `for up to ${mx} days at a time`;
    else len = "at a time";
    const per = Number(p.pause_per_year);
    const freq = per === 1 ? ", once per year" : per === 2 ? ", twice per year" : per > 0 ? `, ${per} times per year` : "";
    pauseClause = ` Memberships may be paused ${len}${freq}.`;
  }

  const refundWindow = Number(p.refund_window_days);
  const refundClause = (p.refund_policy === "Refundable within a window" && refundWindow > 0)
    ? ` Fees already charged are refundable within ${refundWindow} days of purchase, and otherwise non-refundable except where required by law.`
    : ` Fees already charged are non-refundable except where required by law.`;

  const clause6 =
    `This enrolls the athlete in a recurring membership with ${acad}. The card on file is charged automatically ` +
    `each billing cycle at the price shown (taxes included) until cancelled.${pauseClause} ${cancelClause}${refundClause}`;

  const clauses = sampleClauses(acad);
  clauses[0] = ["1. Participation acknowledgment", clause1];
  clauses[5] = ["6. Membership, billing and cancellation", clause6];
  return clauses;
}

/* ═══════════════════════════════════════════════════════════════════════
   Rendering
   ═══════════════════════════════════════════════════════════════════════ */

function dataUrlToBytes(dataUrl) {
  const m = /^data:(image\/(png|jpeg|jpg));base64,(.+)$/i.exec(String(dataUrl || "").trim());
  if (!m) return null;
  return { mime: m[1].toLowerCase(), bytes: Buffer.from(m[3], "base64"), isPng: /png/.test(m[1]) };
}

// The terms document allows <strong>/<em> for on-screen emphasis. The PDF is a
// single-weight document, so drop the tags and decode the few entities that can
// appear. Nothing a parent types is ever in these strings.
function plain(html) {
  return String(html == null ? "" : html)
    .replace(/<\/?(strong|em)>/gi, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// pdf-lib's standard fonts are WinAnsi: characters outside that set throw on
// draw. The terms use typographic quotes and a middot, so fold what we can and
// drop anything else rather than fail to produce the record.
function winAnsi(s) {
  return String(s)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .replace(/\u00A0/g, " ")
    // Keep printable ASCII + Latin-1 (WinAnsi); drop the rest rather than throw.
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "");
}

// Build the PDF bytes (Uint8Array).
//
//   terms   the published terms document (preferred - this is the record)
//   filled  { <field_key>: value } the parent's data, as shown on screen
//   consents{ <consent_key>: value } the opt-in choices they made
//   clauses LEGACY fallback for agreements signed before terms documents
export async function renderAgreementPdf({
  academyName = "By Any Means",
  parentName = "",
  athleteName = "",
  planLabel = "",
  priceText = "",
  signaturePngDataUrl = null,
  signedAtIso = null,
  terms = null,
  filled = null,
  consents = null,
  versionId = null,
  clauses = null,
} = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const W = 612, H = 792, M = 56;
  let page = doc.addPage([W, H]);
  let y = H - M;

  const newPageIfNeeded = (need) => { if (y - need < M) { page = doc.addPage([W, H]); y = H - M; } };

  const line = (text, { f = font, size = 11, color = INK, gap = 6, indent = 0 } = {}) => {
    const maxW = W - M * 2 - indent;
    const words = winAnsi(text).split(/\s+/).filter(Boolean);
    if (!words.length) { y -= size + gap; return; }
    let cur = "";
    const flush = () => {
      newPageIfNeeded(size + gap);
      page.drawText(cur, { x: M + indent, y, size, font: f, color });
      y -= size + gap;
      cur = "";
    };
    for (const w of words) {
      const trial = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(trial, size) > maxW && cur) flush();
      cur = cur ? cur + " " + w : w;
    }
    if (cur) flush();
  };

  const rule = (color = RULE, width = W - M * 2) => {
    newPageIfNeeded(10);
    page.drawRectangle({ x: M, y, width, height: 0.8, color });
    y -= 12;
  };

  /* ── Header ── */
  const title = (terms && terms.title) || "Participation & Waiver Agreement";
  page.drawText(winAnsi(title.toUpperCase()), { x: M, y, size: 16, font: bold, color: INK });
  y -= 26;
  page.drawText(winAnsi(academyName), { x: M, y, size: 12, font, color: MUTE });
  y -= 10;
  page.drawRectangle({ x: M, y, width: W - M * 2, height: 2, color: GOLD });
  y -= 18;
  if (terms && terms.entity_line) { line(terms.entity_line, { size: 9.5, color: MUTE, gap: 4 }); }
  y -= 6;

  /* ── Parties / plan summary (always present, even when the document has its
        own fields block, so the key facts are on page 1) ── */
  const kv = (k, v) => line(`${k}:  ${v || "n/a"}`, { size: 11, gap: 4 });
  kv("Athlete", athleteName);
  kv("Parent / guardian", parentName);
  if (planLabel) kv("Plan", planLabel);
  if (priceText) kv("Price", priceText);
  y -= 10;

  if (terms) {
    /* ── The document the parent read ── */
    const fills = filled || {};
    const picks = consents || {};

    // Notices (draft banners, legal-status holds) are part of what was shown.
    for (const n of terms.notices || []) {
      newPageIfNeeded(40);
      line((n.title || "").toUpperCase(), { f: bold, size: 9.5, color: MUTE, gap: 4 });
      for (const b of n.body || []) line(plain(b), { size: 9, color: MUTE, gap: 3 });
      y -= 6;
    }

    if (terms.intro) { line(plain(terms.intro), { size: 10, color: INK, gap: 8 }); y -= 4; }

    for (const s of terms.sections || []) {
      newPageIfNeeded(46);
      line(`${s.n}. ${s.h}`, { f: bold, size: 12, gap: 5 });
      for (const b of s.blocks || []) {
        if (b.t === "p") {
          line(plain(b.html), { size: 10.5, gap: 7 });
        } else if (b.t === "note") {
          line(plain(b.text), { f: italic, size: 9, color: MUTE, gap: 7 });
        } else if (b.t === "list") {
          for (const it of b.items || []) line("- " + plain(it), { size: 10.5, gap: 4, indent: 12 });
          y -= 4;
        } else if (b.t === "ack") {
          for (const it of b.items || []) line("[x] " + plain(it), { size: 10, gap: 4, indent: 12 });
          y -= 4;
        } else if (b.t === "fields") {
          // The parent's own data, exactly as it appeared on screen.
          for (const f of b.fields || []) {
            const v = fills[f.key];
            line(`${f.label}:  ${v ? String(v) : "________________"}`, { size: 10, gap: 4, indent: 12 });
          }
          y -= 4;
        } else if (b.t === "consent") {
          // The choice they actually made, marked. This is the whole point of
          // recording consent: the filed document shows which box was ticked.
          const chosen = picks[b.key];
          for (const c of b.choices || []) {
            const mark = chosen === c.value ? "[X]" : "[ ]";
            line(`${mark} ${plain(c.label)}`, {
              f: chosen === c.value ? bold : font,
              size: 10, gap: 4, indent: 12,
            });
          }
          if (!chosen) line("(no choice recorded)", { f: italic, size: 9, color: MUTE, gap: 4, indent: 12 });
          y -= 4;
        } else if (b.t === "signature") {
          // Rendered once, in the signature block at the end.
        }
      }
      y -= 4;
    }

    if (terms.footer) { y -= 4; rule(); line(plain(terms.footer), { size: 9, color: MUTE, gap: 4 }); }
  } else {
    /* ── LEGACY path: agreements signed before terms documents ── */
    for (const [h, body] of (clauses || sampleClauses(academyName))) {
      line(h, { f: bold, size: 12, gap: 4 });
      line(body, { size: 10.5, color: INK, gap: 8 });
    }
  }

  /* ── Signature block ── */
  y -= 8;
  newPageIfNeeded(150);
  rule(MUTE);
  y -= 6;
  line("Signature", { f: bold, size: 12, gap: 6 });

  const sig = signaturePngDataUrl ? dataUrlToBytes(signaturePngDataUrl) : null;
  if (sig) {
    try {
      const img = sig.isPng ? await doc.embedPng(sig.bytes) : await doc.embedJpg(sig.bytes);
      const dims = img.scaleToFit(220, 70);
      newPageIfNeeded(dims.height + 20);
      page.drawImage(img, { x: M, y: y - dims.height, width: dims.width, height: dims.height });
      y -= dims.height + 6;
    } catch { /* bad signature image - fall through to the typed line */ }
  }
  page.drawRectangle({ x: M, y, width: 240, height: 1, color: INK });
  y -= 14;
  line(`Signed by ${parentName || "parent/guardian"} on behalf of ${athleteName || "the athlete"}.`, { size: 10, color: MUTE, gap: 4 });
  const when = signedAtIso ? new Date(signedAtIso) : new Date();
  line(`Date: ${when.toISOString().slice(0, 10)}  (${when.toUTCString()})`, { size: 10, color: MUTE, gap: 4 });

  /* ── Version stamp: which exact wording this is ── */
  if (versionId) {
    line(`Agreement version ${versionId}${terms && terms.revision ? `  (revision ${terms.revision})` : ""}`,
      { size: 8, color: MUTE, gap: 3 });
    line("This id identifies the exact wording signed. A later change to the agreement does not alter this record.",
      { f: italic, size: 8, color: MUTE, gap: 3 });
  }

  return await doc.save(); // Uint8Array
}

// Upload PDF bytes to the private member-files bucket, under the same
// "<client>/<member>/<kind>/..." layout the staff portal's member documents
// use (so it lists alongside manual uploads). Returns { path, size }.
export async function uploadAgreementPdf({ sbUrl, sbKey, clientId, memberId, bytes }) {
  const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const path = `${clientId}/${memberId}/waiver/${stamp}-enrollment-agreement.pdf`;
  const r = await fetch(`${sbUrl}/storage/v1/object/member-files/${path}`, {
    method: "POST",
    headers: {
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      "Content-Type": "application/pdf",
      "x-upsert": "true",
    },
    body: Buffer.from(bytes),
  });
  if (!r.ok) throw new Error(`Storage upload ${r.status}: ${await r.text()}`);
  return { path, size: bytes.length || bytes.byteLength || 0 };
}

// Store the raw signature image alongside the PDF, so the drawn signature
// survives independently of the rendered document.
export async function uploadSignaturePng({ sbUrl, sbKey, clientId, memberId, dataUrl }) {
  const parsed = dataUrlToBytes(dataUrl);
  if (!parsed) return null;
  const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const ext = parsed.isPng ? "png" : "jpg";
  const path = `${clientId}/${memberId}/waiver/${stamp}-signature.${ext}`;
  const r = await fetch(`${sbUrl}/storage/v1/object/member-files/${path}`, {
    method: "POST",
    headers: {
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      "Content-Type": parsed.mime,
      "x-upsert": "true",
    },
    body: Buffer.from(parsed.bytes),
  });
  if (!r.ok) return null; // non-fatal: the signature is embedded in the PDF too
  return path;
}
