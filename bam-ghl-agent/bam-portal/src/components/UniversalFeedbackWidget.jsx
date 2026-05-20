import { useState, useRef } from "react";
import { supabase } from "../lib/supabase";

// Universal Bug / Feature feedback widget.
// Always visible in the bottom-right corner of the staff portal. Any staff
// user can submit. The widget calls /api/clients?action=submit-feedback
// which lands in the portal_feedback table. Only Zoran sees submissions
// (via the email-gated Feedback tab).
export default function UniversalFeedbackWidget({ tokens, session }) {
  const t = tokens;
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("bug");
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [btnHover, setBtnHover] = useState(false);
  const fileInputRef = useRef(null);

  const handleOpen = () => {
    setOpen(true);
    setSent(false);
    setErr("");
    setKind("bug");
    setText("");
    setFile(null);
  };

  const handleClose = () => {
    setOpen(false);
    setSent(false);
    setErr("");
    setText("");
    setFile(null);
  };

  const handleSubmit = async () => {
    if (!text.trim()) { setErr("Type something first."); return; }
    setSending(true);
    setErr("");

    let fileUrl = null;
    let fileName = null;
    try {
      if (file) {
        const uid = (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
        const safe = (file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `feedback/${uid}-${safe}`;
        const { error: upErr } = await supabase.storage
          .from("ticket-files")
          .upload(path, file, { contentType: file.type || "application/octet-stream", cacheControl: "3600" });
        if (upErr) throw new Error(upErr.message);
        const { data: urlData } = supabase.storage.from("ticket-files").getPublicUrl(path);
        fileUrl = urlData.publicUrl;
        fileName = file.name;
      }

      const tok = session?.access_token;
      const headers = { "Content-Type": "application/json" };
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const res = await fetch("/api/clients?action=submit-feedback", {
        method: "POST",
        headers,
        body: JSON.stringify({
          body: text.trim(),
          kind,
          file_url: fileUrl,
          file_name: fileName,
          page: window.location.pathname + window.location.search,
          portal: "staff",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSent(true);
      setSending(false);
      setText(""); setFile(null);
      setTimeout(handleClose, 1600);
    } catch (e) {
      setErr(e.message || "Failed to send. Try again.");
      setSending(false);
    }
  };

  const bodyLabel = kind === "bug" ? "What's the bug?" : "What's the feature?";
  const bodyPh = kind === "bug"
    ? "What you saw, what you expected, what page you were on..."
    : "What would you like to be able to do? Who needs it, why...";

  return (
    <>
      {/* Floating button (always visible) */}
      {!open && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1800 }}>
          {/* Hover tooltip */}
          <div style={{
            position: "absolute", bottom: "calc(100% + 12px)", right: 0,
            background: "#131318", color: "#F5F5F7",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 8, padding: "8px 13px",
            fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
            boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
            opacity: btnHover ? 1 : 0,
            transform: btnHover ? "translateY(0)" : "translateY(5px)",
            pointerEvents: "none",
            transition: "opacity 0.18s ease, transform 0.18s ease",
          }}>
            help zoran out...
            <span style={{
              position: "absolute", top: "100%", right: 22,
              borderWidth: 6, borderStyle: "solid",
              borderColor: "#131318 transparent transparent transparent",
            }} />
          </div>
          <button
            type="button"
            onClick={handleOpen}
            aria-label="Send feedback"
            onMouseEnter={e => { setBtnHover(true); e.currentTarget.style.transform = "translateY(-2px) scale(1.06)"; }}
            onMouseLeave={e => { setBtnHover(false); e.currentTarget.style.transform = "translateY(0) scale(1)"; }}
            style={{
              width: 56, height: 56, borderRadius: "50%",
              padding: 0, overflow: "hidden", cursor: "pointer",
              border: `2px solid ${t.accent}`,
              background: t.accent,
              display: "block",
              boxShadow: "0 6px 20px rgba(232,197,71,0.40), 0 2px 6px rgba(0,0,0,0.35)",
              transition: "transform 0.18s ease, box-shadow 0.18s ease",
            }}
          >
            <img src="/help-zoran.png" alt="Send feedback" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </button>
        </div>
      )}

      {/* Expanded panel */}
      {open && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 1800,
          width: 380, maxWidth: "calc(100vw - 32px)",
          borderRadius: 12, background: t.surface,
          border: `1px solid ${t.border}`,
          boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
          animation: "cardIn 0.25s cubic-bezier(0.22, 1, 0.36, 1) both",
          padding: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: t.text, letterSpacing: "-0.01em" }}>Got feedback?</div>
            <button onClick={handleClose} style={{
              background: "transparent", border: 0, color: t.textMute,
              fontSize: 22, lineHeight: 1, cursor: "pointer", padding: "0 4px",
            }} aria-label="Close">&times;</button>
          </div>
          <div style={{ fontSize: 12, color: t.textMute, marginBottom: 14, lineHeight: 1.5 }}>
            Tell us about a bug or a feature. Goes straight to Zoran.
          </div>

          {sent ? (
            <div style={{ padding: "28px 0 8px", textAlign: "center" }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.green || "#7ED996" }}>Sent. Thanks.</div>
            </div>
          ) : (
            <>
              {/* Bug / Feature toggle */}
              <div style={{
                display: "flex", padding: 4, marginBottom: 14,
                background: t.surfaceEl, border: `1px solid ${t.border}`, borderRadius: 8,
              }}>
                {[
                  { key: "bug", label: "🐛 Bug" },
                  { key: "feature", label: "✨ Feature" },
                ].map(o => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setKind(o.key)}
                    role="radio"
                    aria-checked={kind === o.key}
                    style={{
                      flex: 1, padding: "8px 12px", border: 0, borderRadius: 5,
                      background: kind === o.key ? t.accent : "transparent",
                      color: kind === o.key ? "#0A0A0B" : t.textSub,
                      fontWeight: 600, fontSize: 13, cursor: "pointer",
                      fontFamily: "inherit",
                      transition: "background 0.18s, color 0.18s",
                    }}
                  >{o.label}</button>
                ))}
              </div>

              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: t.textMute, marginBottom: 6 }}>
                {bodyLabel}
              </div>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={bodyPh}
                rows={4}
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: 8,
                  border: `1px solid ${t.border}`, background: t.surfaceEl,
                  color: t.text, fontFamily: "inherit", fontSize: 13,
                  lineHeight: 1.55, resize: "vertical", outline: "none",
                  boxSizing: "border-box", marginBottom: 12,
                }}
              />

              {/* File pick */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: "7px 12px", background: "transparent",
                    color: t.text, border: `1px solid ${t.border}`,
                    borderRadius: 6, fontSize: 12, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >Choose file</button>
                <span style={{ fontSize: 12, color: t.textMute, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : "No file selected"}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={e => setFile(e.target.files?.[0] || null)}
                />
              </div>

              {err && <div style={{ fontSize: 12, color: t.red || "#ED7969", marginBottom: 10 }}>{err}</div>}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={handleClose}
                  style={{
                    padding: "9px 16px", background: "transparent",
                    border: `1px solid ${t.border}`, borderRadius: 6,
                    color: t.textSub, fontSize: 13, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >Cancel</button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={sending || !text.trim()}
                  style={{
                    padding: "9px 18px",
                    background: sending || !text.trim() ? `${t.accent}55` : t.accent,
                    color: "#0A0A0B", border: 0, borderRadius: 6,
                    fontSize: 13, fontWeight: 700,
                    cursor: sending || !text.trim() ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >{sending ? "Sending…" : "Send →"}</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
