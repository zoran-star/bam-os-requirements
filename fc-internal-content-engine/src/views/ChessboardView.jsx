import { useState, useEffect, useRef } from "react";

/* ─── Helpers ─── */
const STATUS_COLORS = {
  CRLF: { bg: "#7f1d1d", border: "#ef4444", text: "#fca5a5", pill: "#ef4444" },
  Open: { bg: "#78350f", border: "#f59e0b", text: "#fde68a", pill: "#f59e0b" },
  Closed: { bg: "#14532d", border: "#22c55e", text: "#86efac", pill: "#22c55e" },
  "To Do": { bg: "#1e1b4b", border: "#818cf8", text: "#c7d2fe", pill: "#818cf8" },
  "In Progress": { bg: "#78350f", border: "#f59e0b", text: "#fde68a", pill: "#f59e0b" },
  Complete: { bg: "#14532d", border: "#22c55e", text: "#86efac", pill: "#22c55e" },
};

const PRIORITY_COLORS = { High: "#ef4444", Medium: "#f59e0b", Low: "#6b7280" };

function StatusPill({ status, tokens }) {
  const c = STATUS_COLORS[status] || { pill: tokens.textMute, text: tokens.text };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
      background: c.pill + "20", color: c.pill, textTransform: "uppercase", letterSpacing: "0.04em",
    }}>{status}</span>
  );
}

function OwnerBadge({ name, tokens }) {
  const colors = { Cole: "#C8A84E", Coleman: "#C8A84E", Zoran: "#818cf8" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
      background: (colors[name] || tokens.textMute) + "20",
      color: colors[name] || tokens.textMute,
    }}>{name}</span>
  );
}

function SectionHeader({ title, icon, count, tokens, action }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      marginBottom: 14, paddingBottom: 8, borderBottom: `1px solid ${tokens.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: tokens.text, textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</span>
        {count !== undefined && (
          <span style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute }}>({count})</span>
        )}
      </div>
      {action}
    </div>
  );
}

function SkeletonCard({ tokens }) {
  return (
    <div style={{
      padding: 20, borderRadius: 14, background: tokens.surface,
      animation: "pulse 1.5s ease-in-out infinite",
    }}>
      <div style={{ height: 14, width: "60%", borderRadius: 6, background: tokens.surfaceHov, marginBottom: 10 }} />
      <div style={{ height: 10, width: "80%", borderRadius: 4, background: tokens.surfaceHov, marginBottom: 6 }} />
      <div style={{ height: 10, width: "40%", borderRadius: 4, background: tokens.surfaceHov }} />
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }`}</style>
    </div>
  );
}

/* ─── CRLF Card ─── */
function CRLFCard({ item, tokens }) {
  if (!item) return null;
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
      <div style={{
        padding: 20, borderRadius: 16,
        background: "linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)",
        border: "1px solid #ef444460",
        boxShadow: "0 0 30px rgba(239,68,68,0.15), 0 4px 16px rgba(0,0,0,0.2)",
        cursor: "pointer", transition: "transform 0.2s, box-shadow 0.2s",
      }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 0 40px rgba(239,68,68,0.25), 0 8px 24px rgba(0,0,0,0.3)"; }}
        onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 0 30px rgba(239,68,68,0.15), 0 4px 16px rgba(0,0,0,0.2)"; }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.08em" }}>🔴 Critical Blocker</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#fca5a5", marginBottom: 6 }}>{item.title}</div>
        {item.description && (
          <div style={{ fontSize: 13, color: "#fca5a580", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {item.description}
          </div>
        )}
      </div>
    </a>
  );
}

/* ─── Open Loop Card ─── */
function LoopCard({ item, tokens, index }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      padding: 16, borderRadius: 14, background: tokens.surface,
      border: `1px solid transparent`,
      cursor: "pointer", transition: "all 0.2s",
      animation: `fadeSlideUp 0.3s ease ${index * 50}ms both`,
    }}
      onClick={() => setExpanded(!expanded)}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = `0 6px 20px rgba(200,168,78,0.08)`; e.currentTarget.style.borderColor = `${tokens.accent}30`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; e.currentTarget.style.borderColor = "transparent"; }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, lineHeight: 1.35 }}>{item.title}</div>
        {item.priority && (
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: PRIORITY_COLORS[item.priority] || tokens.textMute, flexShrink: 0, marginTop: 4 }} title={item.priority} />
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <StatusPill status={item.status} tokens={tokens} />
      </div>
      {expanded && item.description && (
        <div style={{ fontSize: 12, color: tokens.textSub, marginTop: 10, lineHeight: 1.6, paddingTop: 10, borderTop: `1px solid ${tokens.border}` }}>
          {item.description}
          <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ display: "block", marginTop: 8, fontSize: 11, color: tokens.accent, textDecoration: "none" }}>
            Open in Notion →
          </a>
        </div>
      )}
    </div>
  );
}

/* ─── Session Card ─── */
function SessionCard({ item, tokens, index }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
      <div style={{
        padding: 14, borderRadius: 12, background: tokens.surface,
        border: `1px solid transparent`,
        cursor: "pointer", transition: "all 0.2s",
        animation: `fadeSlideUp 0.3s ease ${index * 50}ms both`,
      }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = `${tokens.accent}30`; }}
        onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.borderColor = "transparent"; }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text, marginBottom: 6, lineHeight: 1.3 }}>{item.title}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <StatusPill status={item.status} tokens={tokens} />
          {item.assignedTo && <OwnerBadge name={item.assignedTo} tokens={tokens} />}
          {item.sessionType && (
            <span style={{ fontSize: 10, color: tokens.textMute, fontWeight: 500 }}>{item.sessionType}</span>
          )}
        </div>
      </div>
    </a>
  );
}

/* ─── Domain Card ─── */
function DomainCard({ domain, tokens, index }) {
  return (
    <a href={`https://www.notion.so/${domain.id.replace(/-/g, "")}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
      <div style={{
        padding: 14, borderRadius: 12, background: tokens.surface,
        border: `1px solid transparent`,
        textAlign: "center", cursor: "pointer", transition: "all 0.2s",
        animation: `fadeSlideUp 0.3s ease ${index * 40}ms both`,
      }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px) scale(1.02)"; e.currentTarget.style.borderColor = `${tokens.accent}30`; e.currentTarget.style.boxShadow = `0 6px 16px rgba(200,168,78,0.08)`; }}
        onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.boxShadow = ""; }}
      >
        <div style={{ fontSize: 22, marginBottom: 4 }}>{domain.icon}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: tokens.text }}>{domain.name}</div>
        <div style={{ fontSize: 10, color: tokens.textMute, marginTop: 2 }}>{domain.prefix}-xxx</div>
      </div>
    </a>
  );
}

/* ─── Content Summary Card ─── */
function ContentSummary({ data, tokens }) {
  return (
    <a href="/content" style={{ textDecoration: "none", display: "block" }}>
      <div style={{
        padding: 20, borderRadius: 14, background: tokens.surface,
        border: `1px solid transparent`, cursor: "pointer", transition: "all 0.2s",
        display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap",
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = `${tokens.accent}30`; e.currentTarget.style.transform = "translateY(-2px)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.transform = ""; }}
      >
        {[
          { label: "Themes", value: data.themes, color: tokens.accent },
          { label: "Creatives", value: data.creatives, color: tokens.blue },
          { label: "Draft", value: data.draft, color: tokens.amber },
          { label: "Published", value: data.published, color: tokens.green },
        ].map(s => (
          <div key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: tokens.textMute, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</div>
          </div>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: tokens.accent }}>
          Open Content Engine →
        </div>
      </div>
    </a>
  );
}

/* ─── Ask Sage Modal ─── */
function AskSageModal({ tokens, onClose, context }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const ask = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setAnswer("");
    try {
      const res = await fetch("/api/content/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creative: {
            title: "Sage Advisor Query",
            notes: `CONTEXT: The user is asking Sage (the AI advisor) a strategic question about their FullControl business. Here is the current state:\n\n` +
              `Open Loops: ${context.openLoops?.length || 0} items\n` +
              `Sessions: ${context.sessions?.length || 0} recent\n` +
              `Content: ${context.content?.themes || 0} themes, ${context.content?.creatives || 0} creatives\n\n` +
              `Open Loop titles: ${(context.openLoops || []).map(l => `- ${l.title} (${l.status}, ${l.priority})`).join("\n")}\n\n` +
              `Recent Session titles: ${(context.sessions || []).map(s => `- ${s.title} (${s.status})`).join("\n")}\n\n` +
              `USER QUESTION: ${question}\n\nProvide a strategic, actionable answer. Be specific and reference the actual items above where relevant. Keep it concise but thorough.`,
            psych_lever: "",
            video_style: "talking_head",
            phase: 0,
            mode: "paid",
            tone: "Strategic",
          },
          feedback: [],
          version: 1,
        }),
      });
      const data = await res.json();
      setAnswer(data.script || data.error || "No response");
    } catch (err) {
      setAnswer("Error: " + err.message);
    }
    setLoading(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }} onClick={onClose}>
      <div style={{
        background: tokens.surface, borderRadius: 20, padding: 28,
        width: "100%", maxWidth: 600, maxHeight: "80vh", overflow: "auto",
        boxShadow: "0 24px 80px rgba(0,0,0,0.4)",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>✨</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: tokens.text }}>Ask Sage</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: tokens.textMute, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <textarea
            ref={inputRef}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
            placeholder="What should we prioritize next? What's blocking progress? What are we missing?"
            rows={3}
            style={{
              flex: 1, padding: 12, borderRadius: 12, border: `1px solid ${tokens.border}`,
              background: tokens.surfaceEl, color: tokens.text, fontSize: 14,
              fontFamily: "inherit", resize: "vertical", outline: "none",
            }}
          />
        </div>
        <button onClick={ask} disabled={loading || !question.trim()} style={{
          width: "100%", padding: "12px 20px", borderRadius: 12,
          background: tokens.accent, color: "#0E0D0B", border: "none",
          fontSize: 14, fontWeight: 700, cursor: loading ? "wait" : "pointer",
          fontFamily: "inherit", opacity: loading || !question.trim() ? 0.6 : 1,
        }}>
          {loading ? "Thinking..." : "Ask Sage"}
        </button>

        {answer && (
          <div style={{
            marginTop: 20, padding: 16, borderRadius: 12,
            background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
            fontSize: 13, color: tokens.textSub, lineHeight: 1.7, whiteSpace: "pre-wrap",
          }}>
            {answer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ MAIN VIEW ═══ */
export default function ChessboardView({ tokens }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showSage, setShowSage] = useState(false);

  useEffect(() => {
    fetch("/api/notion-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "all" }),
    })
      .then(r => r.json())
      .then(res => { setData(res.data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const crlf = data?.openLoops?.find(l => l.status === "CRLF");
  const openLoops = data?.openLoops?.filter(l => l.status !== "CRLF") || [];
  const sessions = data?.sessions || [];
  const domains = data?.domains || [];
  const content = data?.content || {};

  const sessionsByStatus = {
    "To Do": sessions.filter(s => s.status === "To Do"),
    "In Progress": sessions.filter(s => s.status === "In Progress"),
    Complete: sessions.filter(s => s.status === "Complete"),
  };

  return (
    <div>
      <style>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: tokens.text, margin: 0, letterSpacing: "-0.02em" }}>
            ♟ Chessboard
          </h1>
          <p style={{ fontSize: 13, color: tokens.textMute, margin: "4px 0 0" }}>
            Everything at a glance. Click to explore.
          </p>
        </div>
        <button onClick={() => setShowSage(true)} style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "10px 18px", borderRadius: 12,
          background: `linear-gradient(135deg, ${tokens.accent}20, ${tokens.accent}08)`,
          border: `1px solid ${tokens.accent}40`, color: tokens.accent,
          fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          transition: "all 0.2s",
        }}
          onMouseEnter={e => { e.currentTarget.style.background = `linear-gradient(135deg, ${tokens.accent}30, ${tokens.accent}12)`; e.currentTarget.style.transform = "translateY(-1px)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = `linear-gradient(135deg, ${tokens.accent}20, ${tokens.accent}08)`; e.currentTarget.style.transform = ""; }}
        >
          <span>✨</span> Ask Sage
        </button>
      </div>

      {loading && (
        <div style={{ display: "grid", gap: 16 }}>
          {[1, 2, 3].map(i => <SkeletonCard key={i} tokens={tokens} />)}
        </div>
      )}

      {error && (
        <div style={{ padding: 20, borderRadius: 14, background: tokens.redSoft, color: tokens.red, fontSize: 13 }}>
          Failed to load: {error}
        </div>
      )}

      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>

          {/* CRLF */}
          {crlf && (
            <div>
              <SectionHeader title="Current Focus" icon="🎯" tokens={tokens} />
              <CRLFCard item={crlf} tokens={tokens} />
            </div>
          )}

          {/* Open Loops */}
          {openLoops.length > 0 && (
            <div>
              <SectionHeader title="Open Loops" icon="🔓" count={openLoops.length} tokens={tokens}
                action={<a href="https://www.notion.so/1eb460ed0646424d8ca7a4c33ceca9fc" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: tokens.accent, textDecoration: "none" }}>View all →</a>}
              />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                {openLoops.map((loop, i) => <LoopCard key={loop.id} item={loop} tokens={tokens} index={i} />)}
              </div>
            </div>
          )}

          {/* Domains */}
          <div>
            <SectionHeader title="Domains" icon="🗂" count={domains.length} tokens={tokens} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
              {domains.map((d, i) => <DomainCard key={d.id} domain={d} tokens={tokens} index={i} />)}
            </div>
          </div>

          {/* Sessions */}
          <div>
            <SectionHeader title="Sessions" icon="📋" count={sessions.length} tokens={tokens}
              action={<a href="https://www.notion.so/4e5492be5027427cbbc8994bcd73905c" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: tokens.accent, textDecoration: "none" }}>View all →</a>}
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {Object.entries(sessionsByStatus).map(([status, items]) => (
                <div key={status}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLORS[status]?.pill || tokens.textMute, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    {status} ({items.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {items.slice(0, 5).map((s, i) => <SessionCard key={s.id} item={s} tokens={tokens} index={i} />)}
                    {items.length === 0 && <div style={{ fontSize: 12, color: tokens.textMute, fontStyle: "italic" }}>None</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Content Pipeline */}
          <div>
            <SectionHeader title="Content Pipeline" icon="🎬" tokens={tokens} />
            <ContentSummary data={content} tokens={tokens} />
          </div>
        </div>
      )}

      {/* Sage Modal */}
      {showSage && <AskSageModal tokens={tokens} onClose={() => setShowSage(false)} context={{ openLoops, sessions, content }} />}
    </div>
  );
}
