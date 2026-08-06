import { useState } from "react";
import { metaErrorText, metaErrorKind } from "../lib/metaError.js";

// One Meta failure, said in plain English, with Meta's own words one click away.
// Every staff surface that can surface a Meta error renders this, so the roster
// and the per-client tab tell the same story. The mapping itself lives in
// ../lib/metaError.js.
//
// Sites vary in size and padding, so pass `style` for the container and `size`
// for the type scale.
//
// `unknownText` is for callers whose failure may not have come from Meta at
// all - a whole-page fetch that could equally be our own server, an expired
// login, or a dropped connection. They pass LOAD_FAILED, and it is used ONLY
// when the text carries no recognisable Meta signature. A real Meta message
// arriving at such a site still gets its proper sentence.
export default function MetaError({ tokens, raw, style, size = 13, unknownText }) {
  const t = tokens;
  const [showRaw, setShowRaw] = useState(false);
  const text = (unknownText && metaErrorKind(raw) === "unknown") ? unknownText : metaErrorText(raw);
  const detail = String(raw?.message || raw || "").trim();
  // Nothing to reveal when the raw text IS the sentence we are already showing.
  const hasDetail = detail.length > 0 && detail !== text;

  return (
    <div title={hasDetail ? detail : undefined} style={{ fontSize: size, color: t.red, lineHeight: 1.5, ...style }}>
      {text}
      {hasDetail && (
        <>
          {" "}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowRaw(v => !v); }}
            style={{
              background: "transparent", border: "none", padding: 0, cursor: "pointer",
              color: t.accent, fontSize: Math.max(11, size - 1), fontWeight: 600,
              fontFamily: "inherit", textDecoration: "underline",
            }}
          >
            {showRaw ? "Hide details" : "Show details"}
          </button>
          {showRaw && (
            <div style={{
              marginTop: 6, padding: "8px 10px", borderRadius: 8,
              background: t.surfaceEl, border: `1px solid ${t.border}`,
              fontSize: 11, color: t.textMute, fontFamily: "monospace", wordBreak: "break-word",
            }}>
              {detail}
            </div>
          )}
        </>
      )}
    </div>
  );
}
