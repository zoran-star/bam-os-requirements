import { useState, useRef } from "react";
import { submitFeedback } from "../services/feedbackService";

export default function FeedbackWidget({ tokens, currentPage, userName }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);

  const handleSubmit = async (source = "text", body = "") => {
    const content = body || text.trim();
    if (!content) return;
    setSending(true);
    await submitFeedback({
      body: content,
      source,
      page: currentPage,
      author: userName || "Mike",
    });
    setSending(false);
    setSent(true);
    setText("");
    setTimeout(() => { setSent(false); setOpen(false); }, 2000);
  };

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition not supported."); return; }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map(r => r[0].transcript).join(" ");
      handleSubmit("voice", transcript);
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const handleOpen = () => {
    setOpen(true);
    setSent(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  return (
    <>
      {/* Floating button */}
      {!open && (
        <div onClick={handleOpen} style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 1800,
          width: 48, height: 48, borderRadius: 14,
          background: tokens.accent, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", boxShadow: `0 4px 20px rgba(0,0,0,0.25), ${tokens.accentGlow}`,
          transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
          onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08) translateY(-2px)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
          title="Send feedback"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            <line x1="9" y1="10" x2="15" y2="10"/>
          </svg>
        </div>
      )}

      {/* Expanded panel */}
      {open && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 1800,
          width: 360, borderRadius: 16,
          background: tokens.surface, border: `1px solid ${tokens.border}`,
          boxShadow: `0 16px 48px rgba(0,0,0,0.3), ${tokens.accentGlow}`,
          animation: "cardIn 0.25s cubic-bezier(0.22, 1, 0.36, 1) both",
          overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between",
            borderBottom: `1px solid ${tokens.border}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: listening ? tokens.red : tokens.accent,
                animation: listening ? "gentlePulse 1s ease-in-out infinite" : "none",
              }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>
                {listening ? "Listening..." : "Send Feedback"}
              </span>
            </div>
            <div onClick={() => { setOpen(false); setListening(false); recognitionRef.current?.stop(); }} style={{
              width: 28, height: 28, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: tokens.textMute, fontSize: 16,
              transition: "background 0.12s",
            }}
              onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >&times;</div>
          </div>

          {sent ? (
            <div style={{
              padding: "32px 18px", textAlign: "center",
              animation: "cardIn 0.3s ease both",
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>&#10003;</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: tokens.green }}>Sent to Coleman</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 4 }}>He'll review it on Slack</div>
            </div>
          ) : (
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 12, color: tokens.textMute, marginBottom: 10 }}>
                What should we build, fix, or change? Type or use voice.
              </div>
              <textarea
                ref={inputRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                placeholder="e.g. Add a chart to the financials page..."
                rows={3}
                style={{
                  width: "100%", fontSize: 14, padding: "10px 14px", borderRadius: 10,
                  border: `1px solid ${tokens.border}`, background: tokens.surfaceEl,
                  color: tokens.text, fontFamily: "inherit", outline: "none",
                  resize: "vertical", lineHeight: 1.5,
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={toggleVoice} style={{
                  width: 40, height: 40, borderRadius: 10,
                  border: `1px solid ${listening ? tokens.red : tokens.border}`,
                  background: listening ? tokens.redSoft : tokens.surfaceEl,
                  color: listening ? tokens.red : tokens.textMute,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s ease",
                  animation: listening ? "gentlePulse 1s ease-in-out infinite" : "none",
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                </button>
                <div style={{ flex: 1 }} />
                <button onClick={() => handleSubmit()} disabled={!text.trim() || sending} style={{
                  fontSize: 13, fontWeight: 600, padding: "10px 20px", borderRadius: 10,
                  border: "none", background: tokens.accent, color: "#fff",
                  cursor: !text.trim() || sending ? "default" : "pointer",
                  fontFamily: "inherit", opacity: !text.trim() || sending ? 0.4 : 1,
                  display: "flex", alignItems: "center", gap: 6,
                  transition: "all 0.2s ease",
                }}>
                  {sending ? "Sending..." : "Send"}
                  {!sending && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
