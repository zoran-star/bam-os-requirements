import { useState, useRef, useEffect, useCallback } from "react";
import { statusColor } from "../../tokens/tokens";
import Avatar from "../primitives/Avatar";

const NAV_COMMANDS = [
  { label: "Dashboard", key: "dashboard", type: "navigate" },
  { label: "Clients", key: "clients", type: "navigate" },
  { label: "Tasks", key: "tasks", type: "navigate" },
  { label: "Calendar", key: "calendar", type: "navigate" },
  { label: "Knowledge Base", key: "knowledge", type: "navigate" },
  { label: "Financials", key: "financials", type: "navigate" },
  { label: "Communication", key: "communication", type: "navigate" },
];

const TIPS = [
  "Search clients, SOPs, tasks, or ask a question…",
  "Try: \"How do we onboard a new client?\"",
  "Try: \"What's the SOP for billing?\"",
  "Try: \"Show me at-risk clients\"",
];

export default function SearchOverlay({ tokens, dark, onClose, allClients, onNavigate, actionItems = [], sopCategories = [] }) {
  const [q, setQ] = useState("");
  const [aiAnswer, setAiAnswer] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [tipFade, setTipFade] = useState(true);
  const [closing, setClosing] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const aiAbortRef = useRef(null);

  // Cycle placeholder tips
  useEffect(() => {
    if (q) return;
    const interval = setInterval(() => {
      setTipFade(false);
      setTimeout(() => {
        setTipIndex((i) => (i + 1) % TIPS.length);
        setTipFade(true);
      }, 300);
    }, 3500);
    return () => clearInterval(interval);
  }, [q]);

  // Auto-focus input
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // Close with animation
  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => onClose(), 200);
  }, [onClose]);

  // Escape to close
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [handleClose]);

  // ── Local search results ──
  const lq = q.toLowerCase().trim();

  const clientResults = lq
    ? allClients.filter((c) => c.name.toLowerCase().includes(lq)).slice(0, 5)
    : [];

  const actionResults = lq
    ? actionItems.filter(
        (a) =>
          a.action.toLowerCase().includes(lq) ||
          a.client.toLowerCase().includes(lq)
      ).slice(0, 5)
    : [];

  const sopResults = lq
    ? sopCategories.filter((s) => s.label.toLowerCase().includes(lq)).slice(
        0,
        4
      )
    : [];

  const navResults = lq
    ? NAV_COMMANDS.filter((n) => n.label.toLowerCase().includes(lq))
    : [];

  const hasLocal =
    clientResults.length ||
    actionResults.length ||
    sopResults.length ||
    navResults.length;

  // Collect all results for keyboard nav
  const allResults = [
    ...clientResults.map((c, i) => ({ type: "client", item: c, key: `c-${i}` })),
    ...actionResults.map((a, i) => ({ type: "action", item: a, key: `a-${i}` })),
    ...sopResults.map((s, i) => ({ type: "sop", item: s, key: `s-${i}` })),
    ...navResults.map((n, i) => ({ type: "nav", item: n, key: `n-${i}` })),
  ];

  // Reset focused index when query changes
  useEffect(() => {
    setFocusedIndex(-1);
  }, [q]);

  // ── AI search ──
  const runAiSearch = useCallback(
    async (query) => {
      if (!query.trim()) return;
      setAiLoading(true);
      setAiAnswer(null);

      if (aiAbortRef.current) aiAbortRef.current.abort();
      const controller = new AbortController();
      aiAbortRef.current = controller;

      try {
        // Build context from all searchable data
        const sopContext = sopCategories.map(
          (s) => `## ${s.label}\n${s.description || s.label}`
        ).join("\n\n");
        const clientContext = allClients
          .map(
            (c) =>
              `Client: ${c.name} | Manager: ${c.manager} | Health: ${c.health} (${c.healthStatus}) | Alerts: ${c.alerts?.join(", ") || "none"}`
          )
          .join("\n");
        const taskContext = actionItems.map(
          (a) =>
            `Task: ${a.action} | Client: ${a.client} | Status: ${a.status} | Urgency: ${a.urgency}`
        ).join("\n");

        const context = `${sopContext}\n\n## Active Clients\n${clientContext}\n\n## Action Items\n${taskContext}`;

        const res = await fetch("/api/ai/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, context }),
          signal: controller.signal,
        });

        const data = await res.json();
        if (!controller.signal.aborted) {
          setAiAnswer(data);
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          setAiAnswer({
            answer: "Search unavailable right now. Try again in a moment.",
            sources: [],
          });
        }
      } finally {
        if (!controller.signal.aborted) setAiLoading(false);
      }
    },
    [allClients]
  );

  // Handle Enter to trigger AI search
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && q.trim()) {
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < allResults.length) {
        const r = allResults[focusedIndex];
        if (r.type === "nav") {
          onNavigate?.(r.item.key);
          handleClose();
        }
      } else {
        runAiSearch(q);
      }
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, allResults.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, -1));
    }
  };

  // ── Voice transcription ──
  const toggleListening = () => {
    const SR =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join("");
      setQ(transcript);
    };

    recognition.onend = () => {
      setListening(false);
      // Auto-trigger AI search when voice stops
      if (inputRef.current?.value?.trim()) {
        runAiSearch(inputRef.current.value);
      }
    };

    recognition.onerror = () => {
      setListening(false);
    };

    recognition.start();
    setListening(true);
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      if (aiAbortRef.current) aiAbortRef.current.abort();
    };
  }, []);

  const hasSpeech = !!(
    window.SpeechRecognition || window.webkitSpeechRecognition
  );

  // ── Styles ──
  const sectionHeader = (label) => (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: tokens.textMute,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        padding: "16px 28px 6px",
      }}
    >
      {label}
    </div>
  );

  const typeLabel = (text) => (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: tokens.textMute,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        padding: "3px 8px",
        borderRadius: 6,
        background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
      }}
    >
      {text}
    </span>
  );

  const rowStyle = (isFocused) => ({
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "13px 28px",
    cursor: "pointer",
    transition: "background 0.12s",
    background: isFocused
      ? tokens.surfaceHov
      : "transparent",
    borderLeft: isFocused
      ? `2px solid ${tokens.accent}`
      : "2px solid transparent",
  });

  const handleHover = (e, on) => {
    e.currentTarget.style.background = on
      ? tokens.surfaceHov
      : "transparent";
  };

  let resultIndex = -1;
  const nextIndex = () => ++resultIndex;

  return (
    <div
      onClick={handleClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: dark ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        backdropFilter: "blur(20px) saturate(1.4)",
        animation: closing
          ? "searchOverlayOut 0.2s cubic-bezier(0.22, 1, 0.36, 1) forwards"
          : "searchOverlayIn 0.25s cubic-bezier(0.22, 1, 0.36, 1) both",
      }}
    >
      <style>{`
        @keyframes searchOverlayIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes searchOverlayOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes searchCardIn {
          from { opacity: 0; transform: translateY(24px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes searchCardOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to { opacity: 0; transform: translateY(12px) scale(0.98); }
        }
        @keyframes searchGlow {
          0%, 100% { box-shadow: 0 0 40px ${dark ? "rgba(212,207,138,0.08)" : "rgba(107,98,32,0.06)"}, 0 0 80px ${dark ? "rgba(212,207,138,0.03)" : "rgba(107,98,32,0.02)"}; }
          50% { box-shadow: 0 0 60px ${dark ? "rgba(212,207,138,0.15)" : "rgba(107,98,32,0.10)"}, 0 0 120px ${dark ? "rgba(212,207,138,0.05)" : "rgba(107,98,32,0.03)"}; }
        }
        @keyframes micPulse {
          0%, 100% { box-shadow: 0 0 0 0 ${dark ? "rgba(251,113,133,0.4)" : "rgba(220,38,38,0.3)"}; }
          50% { box-shadow: 0 0 0 10px ${dark ? "rgba(251,113,133,0)" : "rgba(220,38,38,0)"}; }
        }
        @keyframes aiDot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        @keyframes aiAnswerIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 680,
          background: tokens.surface,
          border: `1px solid ${tokens.borderMed}`,
          borderRadius: 20,
          overflow: "hidden",
          maxHeight: "72vh",
          display: "flex",
          flexDirection: "column",
          animation: closing
            ? "searchCardOut 0.2s cubic-bezier(0.22, 1, 0.36, 1) forwards"
            : "searchCardIn 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
          animationDelay: closing ? "0s" : "0.05s",
          boxShadow: `0 40px 100px rgba(0,0,0,${dark ? 0.6 : 0.2})`,
        }}
      >
        {/* ── Search input area ── */}
        <div
          style={{
            padding: "28px 32px 24px",
            borderBottom: `1px solid ${tokens.border}`,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "16px 22px",
              borderRadius: 14,
              border: `1px solid ${listening ? (dark ? "rgba(251,113,133,0.4)" : "rgba(220,38,38,0.3)") : tokens.borderMed}`,
              background: dark
                ? "rgba(255,255,255,0.03)"
                : "rgba(0,0,0,0.02)",
              transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
              animation: "searchGlow 4s ease-in-out infinite",
            }}
          >
            {/* Search icon */}
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke={listening ? tokens.red : tokens.accent}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                flexShrink: 0,
                transition: "stroke 0.3s",
                opacity: 0.8,
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>

            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder=""
              style={{
                flex: 1,
                background: "none",
                border: "none",
                outline: "none",
                fontSize: 20,
                color: tokens.text,
                fontFamily: "inherit",
                fontWeight: 400,
                letterSpacing: "-0.01em",
                lineHeight: 1.4,
              }}
            />

            {/* Animated placeholder (sits behind input when empty) */}
            {!q && (
              <div
                style={{
                  position: "absolute",
                  left: 92,
                  fontSize: 20,
                  color: tokens.textMute,
                  fontFamily: "inherit",
                  fontWeight: 400,
                  letterSpacing: "-0.01em",
                  pointerEvents: "none",
                  opacity: tipFade ? 0.6 : 0,
                  transition: "opacity 0.3s ease",
                }}
              >
                {TIPS[tipIndex]}
              </div>
            )}

            {/* Voice button */}
            {hasSpeech && (
              <button
                onClick={toggleListening}
                title={listening ? "Stop listening" : "Voice search"}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  border: listening
                    ? `1px solid ${tokens.red}`
                    : `1px solid ${tokens.borderMed}`,
                  background: listening
                    ? dark
                      ? "rgba(251,113,133,0.12)"
                      : "rgba(220,38,38,0.08)"
                    : "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
                  animation: listening
                    ? "micPulse 1.5s ease-in-out infinite"
                    : "none",
                }}
                onMouseEnter={(e) => {
                  if (!listening) {
                    e.currentTarget.style.borderColor = tokens.accent;
                    e.currentTarget.style.background = tokens.accentGhost;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!listening) {
                    e.currentTarget.style.borderColor = tokens.borderMed;
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill={listening ? tokens.red : "none"}
                  stroke={listening ? tokens.red : tokens.textSub}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}

            {/* Keyboard hint */}
            <div
              style={{
                display: "flex",
                gap: 6,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: tokens.textMute,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: `1px solid ${tokens.border}`,
                  fontFamily: "inherit",
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                }}
              >
                ESC
              </span>
            </div>
          </div>

          {/* Hint text below input */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 12,
              padding: "0 6px",
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: tokens.textMute,
                opacity: 0.7,
              }}
            >
              {listening ? (
                <span style={{ color: tokens.red, fontWeight: 500 }}>
                  Listening…
                </span>
              ) : (
                <>
                  Press <strong>Enter</strong> to ask AI &middot; results
                  update as you type
                </>
              )}
            </span>
            <span
              style={{
                fontSize: 11,
                color: tokens.textMute,
                opacity: 0.5,
              }}
            >
              {allClients.length} clients &middot; {actionItems.length}{" "}
              tasks &middot; {sopCategories.length} SOPs
            </span>
          </div>
        </div>

        {/* ── Results area ── */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {/* AI Answer */}
          {aiLoading && (
            <div
              style={{
                padding: "24px 28px",
                borderBottom: `1px solid ${tokens.border}`,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: tokens.accentGhost,
                  border: `1px solid ${tokens.accentBorder}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={tokens.accent}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: tokens.accent,
                      animation: `aiDot 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
                <span
                  style={{
                    fontSize: 13,
                    color: tokens.textMute,
                    marginLeft: 6,
                  }}
                >
                  Thinking…
                </span>
              </div>
            </div>
          )}

          {aiAnswer && !aiLoading && (
            <div
              style={{
                padding: "24px 28px",
                borderBottom: `1px solid ${tokens.border}`,
                animation:
                  "aiAnswerIn 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: tokens.accentGhost,
                    border: `1px solid ${tokens.accentBorder}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={tokens.accent}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      lineHeight: 1.65,
                      color: tokens.text,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {aiAnswer.answer}
                  </div>
                  {aiAnswer.sources?.length > 0 && (
                    <div
                      style={{
                        marginTop: 10,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                      }}
                    >
                      {aiAnswer.sources.map((s, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 11,
                            color: tokens.accent,
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: tokens.accentGhost,
                            border: `1px solid ${tokens.accentBorder}`,
                            fontWeight: 500,
                          }}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!lq && !aiAnswer && !aiLoading && (
            <div
              style={{
                padding: "40px 28px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 40,
                  marginBottom: 12,
                  opacity: 0.15,
                  lineHeight: 1,
                }}
              >
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={tokens.textMute}
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ margin: "0 auto" }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <div
                style={{ fontSize: 14, color: tokens.textMute, opacity: 0.7 }}
              >
                Search anything across your portal
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: tokens.textMute,
                  opacity: 0.4,
                  marginTop: 6,
                }}
              >
                Clients &middot; Tasks &middot; SOPs &middot; Navigation
                &middot; AI answers
              </div>
            </div>
          )}

          {/* No local results */}
          {lq && !hasLocal && !aiAnswer && !aiLoading && (
            <div
              style={{
                padding: "28px",
                textAlign: "center",
                color: tokens.textMute,
                fontSize: 14,
              }}
            >
              No instant results — press{" "}
              <strong style={{ color: tokens.textSub }}>Enter</strong> to ask
              AI
            </div>
          )}

          {/* Clients */}
          {clientResults.length > 0 && (
            <>
              {sectionHeader("Clients")}
              {clientResults.map((client, i) => {
                const idx = nextIndex();
                return (
                  <div
                    key={`client-${i}`}
                    style={rowStyle(focusedIndex === idx)}
                    onMouseEnter={(e) => {
                      setFocusedIndex(idx);
                      handleHover(e, true);
                    }}
                    onMouseLeave={(e) => handleHover(e, false)}
                  >
                    <Avatar name={client.manager} size={30} dark={dark} />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 500,
                          color: tokens.text,
                        }}
                      >
                        {client.name}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: tokens.textMute,
                          marginTop: 2,
                        }}
                      >
                        {client.manager}
                      </div>
                    </div>
                    {typeLabel("Client")}
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: statusColor(client.healthStatus, tokens),
                      }}
                    >
                      {client.health}
                    </span>
                  </div>
                );
              })}
            </>
          )}

          {/* Action Items */}
          {actionResults.length > 0 && (
            <>
              {sectionHeader("Tasks")}
              {actionResults.map((item, i) => {
                const idx = nextIndex();
                return (
                  <div
                    key={`action-${i}`}
                    style={rowStyle(focusedIndex === idx)}
                    onMouseEnter={(e) => {
                      setFocusedIndex(idx);
                      handleHover(e, true);
                    }}
                    onMouseLeave={(e) => handleHover(e, false)}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={
                        item.urgency === "Urgent"
                          ? tokens.red || "#e74c3c"
                          : tokens.textMute
                      }
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 11 12 14 22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: tokens.text,
                        }}
                      >
                        {item.action}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: tokens.textMute,
                          marginTop: 2,
                        }}
                      >
                        {item.client}
                      </div>
                    </div>
                    {typeLabel("Task")}
                  </div>
                );
              })}
            </>
          )}

          {/* SOPs */}
          {sopResults.length > 0 && (
            <>
              {sectionHeader("SOPs")}
              {sopResults.map((sop, i) => {
                const idx = nextIndex();
                return (
                  <div
                    key={`sop-${i}`}
                    style={rowStyle(focusedIndex === idx)}
                    onMouseEnter={(e) => {
                      setFocusedIndex(idx);
                      handleHover(e, true);
                    }}
                    onMouseLeave={(e) => handleHover(e, false)}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={tokens.textMute}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: tokens.text,
                        }}
                      >
                        {sop.label}
                      </div>
                    </div>
                    {typeLabel("SOP")}
                  </div>
                );
              })}
            </>
          )}

          {/* Navigation */}
          {navResults.length > 0 && (
            <>
              {sectionHeader("Navigate")}
              {navResults.map((nav, i) => {
                const idx = nextIndex();
                return (
                  <div
                    key={`nav-${i}`}
                    style={rowStyle(focusedIndex === idx)}
                    onClick={() => {
                      onNavigate?.(nav.key);
                      handleClose();
                    }}
                    onMouseEnter={(e) => {
                      setFocusedIndex(idx);
                      handleHover(e, true);
                    }}
                    onMouseLeave={(e) => handleHover(e, false)}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={tokens.textMute}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: tokens.text,
                        }}
                      >
                        {nav.label}
                      </div>
                    </div>
                    {typeLabel("Navigate")}
                  </div>
                );
              })}
            </>
          )}

          {/* Bottom padding */}
          <div style={{ height: 8 }} />
        </div>
      </div>
    </div>
  );
}
