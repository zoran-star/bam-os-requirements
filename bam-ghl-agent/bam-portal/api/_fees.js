// THE one place money math lives (shared by match-prices.js for target
// building / drift and create-price.js for the actual charge).
//
// Build T of the money model (docs/money-model-plan.md, 2026-07-24): tax is a
// TEMPLATE on the academy (clients.tax_config = { label, pct }), and each
// price/commitment row carries taxable yes/no instead of retyping "13% HST"
// as free text. resolveFee() below is the precedence rule every caller uses.
//
// The legacy free-text parser stays for rows that predate the template: an
// academy with typed "13% HST" strings and no tax_config behaves exactly as
// before until it is migrated. parseFee formats:
//   "+13% HST" / "13% HST" / "13%"  -> { kind:'percent', pct:13, label:'13% HST' }
//   "$25" / "25" / "$25 admin"      -> { kind:'flat', cents:2500, label:'$25 admin' }
//   "" / null / "HST" (no number)   -> null  (no fee applied)

export function parseFee(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;

  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) {
    const p = parseFloat(pct[1]);
    if (!(p > 0)) return null;
    const rest = s.replace(/[+\-]?\s*\d+(?:\.\d+)?\s*%/, "").replace(/^[\s+\-]+/, "").trim();
    const num = Number.isInteger(p) ? String(p) : String(p);
    return { kind: "percent", pct: p, label: rest ? `${num}% ${rest}` : `${num}%` };
  }

  const flat = s.match(/(\d+(?:\.\d+)?)/);
  if (flat) {
    const v = parseFloat(flat[1]);
    if (!(v > 0)) return null;
    const rest = s.replace(/[+\-]?\s*\$?\s*\d+(?:\.\d+)?/, "").replace(/^[\s+\-]+/, "").trim();
    const label = `$${Number.isInteger(v) ? String(v) : v.toFixed(2)}`;
    return { kind: "flat", cents: Math.round(v * 100), label: rest ? `${label} ${rest}` : label };
  }

  return null;
}

// Academy tax template (clients.tax_config { label, pct }) -> a percent fee,
// or null when there is no usable template. Same shape parseFee returns, so
// applyFee/feeLabel work unchanged.
export function taxFee(taxConfig) {
  const pct = Number(taxConfig && taxConfig.pct);
  if (!isFinite(pct) || pct <= 0) return null;
  const name = String((taxConfig && taxConfig.label) || "").trim();
  const num = Number.isInteger(pct) ? String(pct) : String(pct);
  return { kind: "percent", pct, label: name ? `${num}% ${name}` : `${num}%` };
}

// THE precedence rule (logic scan #1: setting the template IS the explicit
// opt-in; per-row taxable then defaults to yes, "No" is the per-row exemption):
//
//   template set  + row taxable "No"/false  -> null (exempt row)
//   template set  + anything else           -> the template's percent
//   no template                             -> legacy free-text parseFee(text)
//
// So an academy with no template keeps its typed strings working exactly as
// before, and an academy WITH a template never depends on free text again.
export function resolveFee({ taxConfig, taxable, legacyText } = {}) {
  const t = taxFee(taxConfig);
  if (t) {
    const v = String(taxable == null ? "" : taxable).trim().toLowerCase();
    return (v === "no" || v === "false") ? null : t;
  }
  // A CONFIRMED NO beats a stale typed string. { charges_tax: false } is the
  // owner's deliberate "I do not charge tax" from the price workbook - a value,
  // not an absence - so it must not fall through to a legacy "13% HST" someone
  // typed before he answered. Only a genuinely never-asked academy (null)
  // keeps its free text working.
  if (taxConfig && taxConfig.charges_tax === false) return null;
  return parseFee(legacyText);
}

// base (cents) + fee -> all-in (cents). No fee -> base unchanged.
export function applyFee(baseCents, fee) {
  const base = Math.round(Number(baseCents) || 0);
  if (!fee || base <= 0) return base;
  if (fee.kind === "percent") return Math.round(base * (1 + fee.pct / 100));
  if (fee.kind === "flat") return base + Math.round(fee.cents || 0);
  return base;
}

export function feeLabel(fee) { return fee ? fee.label : null; }
