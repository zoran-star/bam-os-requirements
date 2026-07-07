// Parse an academy's free-text "added fees" (offer wizard, per offering + per
// commitment) into a structured fee, and apply it to a pre-tax base price.
//
// This replaces the old hardcoded 13% Ontario HST: nothing is added unless the
// academy typed a fee. US academies who type nothing charge the base price;
// a CA academy who types "+13% HST" gets it applied. Shared by match-prices.js
// (target building / drift) and create-price.js (the actual charge) so the
// money math lives in ONE place.
//
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

// base (cents) + fee -> all-in (cents). No fee -> base unchanged.
export function applyFee(baseCents, fee) {
  const base = Math.round(Number(baseCents) || 0);
  if (!fee || base <= 0) return base;
  if (fee.kind === "percent") return Math.round(base * (1 + fee.pct / 100));
  if (fee.kind === "flat") return base + Math.round(fee.cents || 0);
  return base;
}

export function feeLabel(fee) { return fee ? fee.label : null; }
