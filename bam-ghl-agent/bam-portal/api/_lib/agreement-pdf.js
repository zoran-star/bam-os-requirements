// Renders a signed enrollment-agreement PDF and stores it privately.
//
// Used by api/website/checkout.js: after the parent reads + signs the agreement
// in the funnel, we generate a flattened PDF (sample contract text for now +
// the parent/athlete names + plan + the drawn signature image + a timestamp)
// and upload it to the private `member-files` bucket. The returned storage path
// is saved on members.agreement_pdf_path and opened from the staff member popup
// via a signed URL.
//
// `_`-prefixed path so Vercel does not treat this as an HTTP endpoint.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const INK = rgb(0.04, 0.04, 0.05);
const MUTE = rgb(0.4, 0.4, 0.42);
const GOLD = rgb(0.886, 0.867, 0.624); // #E2DD9F (BAM gold)

// Sample agreement body. Real per-academy contract text replaces this later;
// for now every academy gets this placeholder so the flow is end-to-end.
function sampleClauses(academyName) {
  return [
    ["1. Membership", `This agreement enrolls the athlete named below into a recurring training membership with ${academyName}. Billing recurs automatically on the cycle shown until cancelled in writing.`],
    ["2. Payment & cancellation", "The card on file is charged each billing cycle. You may cancel with written notice before the next billing date. Fees already charged are non-refundable except where required by law."],
    ["3. Assumption of risk", "Basketball training involves physical activity and inherent risk of injury. The parent/guardian confirms the athlete is medically fit to participate and assumes responsibility for these risks."],
    ["4. Liability waiver", `To the extent permitted by law, the parent/guardian releases ${academyName}, its coaches and staff from liability for ordinary-negligence injury or loss arising from participation.`],
    ["5. Media release", `The parent/guardian grants ${academyName} permission to use photos and video of the athlete for promotional purposes, and may revoke this in writing at any time.`],
    ["6. Code of conduct", "The athlete and family agree to respect coaches, teammates, and facilities. Conduct that endangers others may end the membership without refund."],
  ];
}

function dataUrlToBytes(dataUrl) {
  const m = /^data:(image\/(png|jpeg|jpg));base64,(.+)$/i.exec(String(dataUrl || "").trim());
  if (!m) return null;
  return { mime: m[1].toLowerCase(), bytes: Buffer.from(m[3], "base64"), isPng: /png/.test(m[1]) };
}

// Build the PDF bytes (Uint8Array).
export async function renderAgreementPdf({
  academyName = "By Any Means",
  parentName = "",
  athleteName = "",
  planLabel = "",
  priceText = "",
  signaturePngDataUrl = null,
  signedAtIso = null,
} = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 612, H = 792, M = 56;
  let page = doc.addPage([W, H]);
  let y = H - M;

  const line = (text, { f = font, size = 11, color = INK, gap = 6, indent = 0 } = {}) => {
    // Word-wrap to the content width.
    const maxW = W - M * 2 - indent;
    const words = String(text).split(/\s+/);
    let cur = "";
    const flush = () => {
      if (y < M + 80) { page = doc.addPage([W, H]); y = H - M; }
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

  // Header
  page.drawText("ENROLLMENT AGREEMENT", { x: M, y, size: 20, font: bold, color: INK });
  y -= 26;
  page.drawText(academyName, { x: M, y, size: 12, font, color: MUTE });
  y -= 10;
  page.drawRectangle({ x: M, y, width: W - M * 2, height: 2, color: GOLD });
  y -= 24;

  // Parties / plan summary
  const kv = (k, v) => { line(`${k}:  ${v || "n/a"}`, { size: 11, gap: 4 }); };
  kv("Athlete", athleteName);
  kv("Parent / guardian", parentName);
  if (planLabel) kv("Plan", planLabel);
  if (priceText) kv("Price", priceText);
  y -= 10;

  // Clauses
  for (const [h, body] of sampleClauses(academyName)) {
    line(h, { f: bold, size: 12, gap: 4 });
    line(body, { size: 10.5, color: INK, gap: 8 });
  }

  // Signature block
  y -= 8;
  if (y < M + 140) { page = doc.addPage([W, H]); y = H - M; }
  page.drawRectangle({ x: M, y, width: W - M * 2, height: 1, color: MUTE });
  y -= 18;
  line("Signature", { f: bold, size: 12, gap: 6 });

  const sig = signaturePngDataUrl ? dataUrlToBytes(signaturePngDataUrl) : null;
  if (sig) {
    try {
      const img = sig.isPng ? await doc.embedPng(sig.bytes) : await doc.embedJpg(sig.bytes);
      const dims = img.scaleToFit(220, 70);
      if (y - dims.height < M) { page = doc.addPage([W, H]); y = H - M; }
      page.drawImage(img, { x: M, y: y - dims.height, width: dims.width, height: dims.height });
      y -= dims.height + 6;
    } catch { /* bad signature image — fall through to typed line */ }
  }
  page.drawRectangle({ x: M, y, width: 240, height: 1, color: INK });
  y -= 14;
  line(`Signed by ${parentName || "parent/guardian"} on behalf of ${athleteName || "the athlete"}.`, { size: 10, color: MUTE, gap: 4 });
  const when = signedAtIso ? new Date(signedAtIso) : new Date();
  line(`Date: ${when.toISOString().slice(0, 10)}  (${when.toUTCString()})`, { size: 10, color: MUTE });

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
