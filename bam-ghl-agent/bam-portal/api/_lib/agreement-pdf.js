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

// Agreement body — MUST match the on-screen waiver the parent reads + signs in
// the funnel (gta/enroll.jsx EN_CLAUSES). The signed PDF is the legal record, so
// the text here and on screen have to stay identical. Wording is BAM GTA's
// Athlete Participation, Waiver & Media Release (clause 6 billing added because
// this is a recurring charge). Keep both in sync if either changes.
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
  clauses = null,   // optional clause override; defaults to sampleClauses(academyName)
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
  page.drawText("PARTICIPATION & WAIVER AGREEMENT", { x: M, y, size: 16, font: bold, color: INK });
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
  for (const [h, body] of (clauses || sampleClauses(academyName))) {
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
