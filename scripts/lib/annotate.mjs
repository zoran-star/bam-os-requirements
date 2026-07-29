// Mark up a rendered email so every piece of text carries a verdict.
//
// Extracted from the old render-gta-emails.mjs so there is ONE renderer
// (scripts/render-messages.mjs) and annotation is an optional layer on top of it
// rather than a second script that renders the same thing again.
//
// Full coverage is the point: unmarked text reads as "already fine" when usually
// it just has not been looked at.

export const STYLE = `<style>
.zh{border-radius:3px;padding:0 2px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.10)}
.zh-p{background:#C9EBD8}.zh-s{background:#FBE9BC}.zh-c{background:#FBCFC4}
.zn{display:inline-block;min-width:15px;height:15px;line-height:15px;border-radius:999px;font:700 10px/15px Arial,sans-serif;text-align:center;color:#fff;margin-right:3px;vertical-align:middle}
.zn-p{background:#2E8B5F}.zn-s{background:#B07908}.zn-c{background:#C1462B}
#zkey{font:13px/1.55 -apple-system,Segoe UI,Arial,sans-serif;background:#15151A;color:#D8D8DC;padding:16px 18px}
#zkey h4{margin:0 0 4px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8A8A94}
#zkey .zbase{margin:0 0 12px;padding:9px 11px;border-radius:7px;font-size:12.5px}
#zkey ol{margin:0;padding:0}
#zkey li{margin-bottom:7px;list-style:none}
#zkey b{color:#fff}
.zprop{margin-top:5px;padding:7px 10px;border:1px dashed #B8912F;border-radius:6px;background:rgba(184,145,47,.12);color:#F0DFA8;font-size:12.5px}
.zprop em{font-style:normal;font-weight:800;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:#E0B84A;margin-right:6px}
.zproptop{margin:0 0 12px;padding:11px 13px;font-size:13px}
</style>`;

// Classify EVERY text run. Rules win where they match; everything else falls to
// the email's base verdict, so no text is left unmarked.
export function annotate(html, spec) {
  if (!spec) return { html, found: [] };
  const [baseSt, baseNote] = spec.base;
  const found = [];
  const seen = new Map();
  const num = (st, text, note, proposal) => {
    const id = note + "|" + text;
    let f = seen.get(id);
    if (!f) { f = { n: found.length + 1, st, text, note, proposal, hits: 0 }; seen.set(id, f); found.push(f); }
    f.hits++;
    return f.n;
  };
  const wrap = (st, n, t) => `<span class="zh zh-${st}"><span class="zn zn-${st}">${n}</span>${t}</span>`;
  // Base runs get the tint but NO badge - a number on every fragment is unreadable,
  // and the base verdict is stated once at the top of the key instead.
  const wrapBase = (st, t) => `<span class="zh zh-${st}">${t}</span>`;

  const bodyAt = html.search(/<body[^>]*>/i);
  const head = bodyAt > 0 ? html.slice(0, bodyAt) : "";
  let bodyHtml = bodyAt > 0 ? html.slice(bodyAt) : html;

  // Whole-line pass first: when a line is custom, ALL of it is custom, including
  // the numbering and the link inside it. Runs on <p> blocks and on any CTA
  // button whose link points at the same thing.
  const lineOwner = new Map();
  for (const lr of spec.lineRules || []) {
    bodyHtml = bodyHtml.replace(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?<\/p>/gi, (blk) => {
      if (lineOwner.has(blk)) return blk;
      const plain = blk.replace(/<[^>]*>/g, " ");
      if (!lr.re.test(plain)) return blk;
      const n = num(lr.st, plain.replace(/\s+/g, " ").trim().slice(0, 46), lr.note, lr.proposal);
      const marked = blk.replace(/(>)([^<]+)(<)/g, (mm, a, txt, b) =>
        /[A-Za-z0-9]/.test(txt) ? a + wrap(lr.st, n, txt) + b : mm);
      lineOwner.set(marked, true);
      return marked;
    });
    // The gold CTA button that repeats the same link.
    bodyHtml = bodyHtml.replace(/<table\b[^>]*>(?:(?!<\/table>)[\s\S])*?<\/table>/gi, (blk) => {
      const plain = blk.replace(/<[^>]*>/g, " ");
      if (!lr.re.test(plain) || !/<a\s/i.test(blk)) return blk;
      const n = num(lr.st, plain.replace(/\s+/g, " ").trim().slice(0, 46), lr.note);
      return blk.replace(/(>)([^<]+)(<)/g, (mm, a, txt, b) =>
        /[A-Za-z0-9]/.test(txt) ? a + wrap(lr.st, n, txt) + b : mm);
    });
  }

  const parts = bodyHtml.split(/(<[^>]*>)/);

  for (let i = 0; i < parts.length; i++) {
    const txt = parts[i];
    if (txt.startsWith("<") || !txt.trim() || !/[A-Za-z0-9]/.test(txt)) continue;
    if (i > 0 && /class="zh zh-/.test(parts[i - 1])) continue; // already marked by a line rule
    // Collect non-overlapping rule matches, earliest first.
    const hits = [];
    for (const r of spec.rules) {
      for (const m of txt.matchAll(new RegExp(r.re.source, r.re.flags.includes("g") ? r.re.flags : r.re.flags + "g"))) {
        hits.push({ start: m.index, end: m.index + m[0].length, text: m[0], st: r.st, note: r.note });
      }
    }
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    const keep = [];
    let last = -1;
    for (const h of hits) { if (h.start >= last) { keep.push(h); last = h.end; } }

    let out = "", cur = 0;
    for (const h of keep) {
      const gap = txt.slice(cur, h.start);
      if (gap) { if (/[A-Za-z0-9]/.test(gap)) { num(baseSt, "the rest of this email", baseNote); out += wrapBase(baseSt, gap); } else out += gap; }
      out += wrap(h.st, num(h.st, h.text, h.note), h.text);
      cur = h.end;
    }
    const tail = txt.slice(cur);
    if (tail) { if (/[A-Za-z0-9]/.test(tail)) { num(baseSt, "the rest of this email", baseNote); out += wrapBase(baseSt, tail); } else out += tail; }
    parts[i] = out;
  }

  const BASE_BG = { p: "#1B3328;color:#BFE8D3", s: "#33290F;color:#F2E2AC", c: "#3A211B;color:#F2BCAE" };
  const baseEntry = found.find((f) => f.note === baseNote);
  const rest = found.filter((f) => f.note !== baseNote);
  const key = `<div id="zkey">
    <h4>Everything in this email is marked</h4>
    ${spec.proposal ? `<p class="zprop zproptop"><em>Proposed</em> ${spec.proposal}</p>` : ""}
    ${baseEntry ? `<p class="zbase" style="background:${BASE_BG[baseSt]}"><b>Everything shaded like this</b> ${baseNote}</p>` : ""}
    <ol>${rest.map((f) => `<li><span class="zn zn-${f.st}">${f.n}</span> <b>${f.text.slice(0, 46)}</b>` +
      (f.hits > 1 ? ` <span style="color:#8A8A94">&times;${f.hits}</span>` : "") + ` ${f.note}` + (f.proposal ? `<div class="zprop"><em>Proposed</em> ${f.proposal}</div>` : "") + `</li>`).join("")}</ol>
  </div>`;

  let outHtml = head + parts.join("");
  outHtml = outHtml.includes("</head>") ? outHtml.replace("</head>", STYLE + "</head>") : STYLE + outHtml;
  outHtml = outHtml.replace(/(<body[^>]*>)/i, `$1${key}`);
  return { html: outHtml, found };
}
