// Commission report PDF (pdf-lib, mirrors api/_lib/agreement-pdf.js conventions).
// One PDF per report batch: Growth Percentage clients only, one table row per
// client cycle, with the figures the Agreement's growth-share clause needs -
// Baseline, Gross Revenue, Growth $, Growth Share Fee, Total BAM Payment,
// Assigned SM, SM Commission. Emailed to Anna + Cole by api/commissions.js
// (?action=cron-reports); SM payout is handled manually off this report.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const GOLD = rgb(0.831, 0.714, 0.361); // #D4B65C
const INK = rgb(0.12, 0.12, 0.13);
const MUTE = rgb(0.45, 0.45, 0.47);
const LINE = rgb(0.85, 0.84, 0.82);

const W = 612, H = 792, M = 44; // US Letter

function money(n) {
  const v = Number(n || 0);
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Column layout: [label, width, align]
const COLS = [
  ["Client", 92, "left"],
  ["Baseline", 66, "right"],
  ["Gross rev", 66, "right"],
  ["Growth $", 66, "right"],
  ["Share fee", 62, "right"],
  ["Total BAM", 66, "right"],
  ["SM", 60, "left"],
  ["SM comm.", 62, "right"],
];

export async function renderCommissionReportPdf({ batchLabel, windowLabel, generatedOn, rows }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([W, H]);
  let y = H - M;

  const drawText = (text, x, yy, { f = font, size = 9, color = INK, maxW = 0, align = "left", colW = 0 } = {}) => {
    let t = String(text == null ? "" : text);
    if (maxW > 0) {
      while (t.length > 1 && f.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -1);
    }
    let tx = x;
    if (align === "right" && colW) tx = x + colW - f.widthOfTextAtSize(t, size);
    page.drawText(t, { x: tx, y: yy, size, font: f, color });
  };

  const header = () => {
    drawText("BAM Commission Report", M, y, { f: bold, size: 16 });
    y -= 20;
    drawText(`${batchLabel}${windowLabel ? "  ·  " + windowLabel : ""}`, M, y, { size: 10, color: MUTE });
    drawText(`Generated ${generatedOn}`, M + 330, y, { size: 10, color: MUTE });
    y -= 10;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: GOLD });
    y -= 18;
    tableHead();
  };

  const tableHead = () => {
    let x = M;
    for (const [label, w, align] of COLS) {
      drawText(label, x, y, { f: bold, size: 8, color: MUTE, align, colW: w - 6, maxW: w - 6 });
      x += w;
    }
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
    y -= 12;
  };

  const newPageIfNeeded = () => {
    if (y < M + 40) {
      page = doc.addPage([W, H]);
      y = H - M;
      tableHead();
    }
  };

  header();

  if (!rows.length) {
    drawText("No growth-percentage cycles in this batch.", M, y, { size: 10, color: MUTE });
    y -= 16;
  }

  for (const r of rows) {
    newPageIfNeeded();
    const cells = [
      [r.client_name || "-", "left"],
      [money(r.baseline_revenue), "right"],
      [money(r.gross_revenue), "right"],
      [money(r.growth_amount), "right"],
      [money(r.growth_share_fee), "right"],
      [money(r.total_bam_payment), "right"],
      [r.sm_name || "-", "left"],
      [money(r.sm_commission), "right"],
    ];
    let x = M;
    cells.forEach(([text, align], i) => {
      const w = COLS[i][1];
      drawText(text, x, y, { size: 8.5, align, colW: w - 6, maxW: w - 6 });
      x += w;
    });
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: LINE });
    y -= 10;
  }

  // Totals row
  newPageIfNeeded();
  y -= 4;
  const sum = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  let x = M;
  const totals = [
    [`Totals (${rows.length} client${rows.length === 1 ? "" : "s"})`, "left"],
    ["", "right"], ["", "right"],
    [money(sum("growth_amount")), "right"],
    [money(sum("growth_share_fee")), "right"],
    [money(sum("total_bam_payment")), "right"],
    ["", "left"],
    [money(sum("sm_commission")), "right"],
  ];
  totals.forEach(([text, align], i) => {
    const w = COLS[i][1];
    drawText(text, x, y, { f: bold, size: 8.5, align, colW: w - 6, maxW: w - 6 });
    x += w;
  });
  y -= 22;
  drawText("SM commission = $250 + 25% of the Growth Share Fee, only for cycles with growth above baseline.", M, y, { size: 8, color: MUTE });
  y -= 12;
  drawText("Payout is handled manually by Anna/Cole - this report is the calculation record, not a payment trigger.", M, y, { size: 8, color: MUTE });

  return doc.save();
}
