import { useState, useEffect, useRef, useCallback } from "react";
import { fetchBoardItems, createBoardItem, updateBoardItem, deleteBoardItem } from "../services/boardService";

/* ─── Constants ─── */
const COLUMN_WIDTH = 300;
const CARD_WIDTH = 220;
const DEFAULT_COLUMNS = ["Investors", "Legal", "Devs", "Product", "GTM"];

const CARD_COLORS = {
  gold: "#C8A84E", red: "#ef4444", green: "#22c55e", blue: "#818cf8",
  purple: "#a78bfa", orange: "#f59e0b", pink: "#ec4899",
};

const DEFAULT_ITEMS = [
  { title: "Investor deck v2", column_name: "Investors", x: 30, y: 80, color: "gold", status: "active", owner: "Zoran", priority: "high", description: "", connections: [], pulse: false },
  { title: "Term sheet review", column_name: "Legal", x: 330, y: 80, color: "red", status: "active", owner: "Zoran", priority: "high", description: "", connections: [], pulse: false },
  { title: "Prototype polish", column_name: "Devs", x: 630, y: 80, color: "blue", status: "active", owner: "Cole", priority: "high", description: "", connections: [], pulse: true },
  { title: "Onboarding flow", column_name: "Product", x: 930, y: 80, color: "purple", status: "active", owner: "Cole", priority: "medium", description: "", connections: [], pulse: false },
  { title: "Content engine", column_name: "GTM", x: 1230, y: 80, color: "green", status: "active", owner: "Cole", priority: "medium", description: "", connections: [], pulse: false },
  { title: "Survey analysis", column_name: "Product", x: 930, y: 220, color: "purple", status: "done", owner: "Cole", priority: "low", description: "", connections: [], pulse: false },
  { title: "GHL workflows", column_name: "Devs", x: 630, y: 220, color: "blue", status: "active", owner: "Zoran", priority: "medium", description: "", connections: [], pulse: false },
  { title: "Landing page", column_name: "GTM", x: 1230, y: 220, color: "green", status: "paused", owner: "Cole", priority: "low", description: "", connections: [], pulse: false },
  { title: "Ad creative library", column_name: "GTM", x: 1230, y: 360, color: "orange", status: "active", owner: "Cole", priority: "high", description: "", connections: [], pulse: true },
  { title: "NDA + legal review", column_name: "Legal", x: 330, y: 220, color: "red", status: "done", owner: "Zoran", priority: "medium", description: "", connections: [], pulse: false },
];

const PRIORITY_DOT = { high: "#ef4444", medium: "#f59e0b", low: "#6b7280" };
const STATUS_DOT = { active: "#22c55e", blocked: "#ef4444", done: "#6b7280", paused: "#f59e0b" };

/* ─── Dashboard Helpers (kept from original) ─── */
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


/* ═══════════════════════════════════════════════════════════════════════
   MAIN VIEW — Canvas + Dashboard
   ═══════════════════════════════════════════════════════════════════════ */
export default function ChessboardView({ tokens, dark }) {
  /* ── Canvas state ── */
  const [items, setItems] = useState([]);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [boardLoading, setBoardLoading] = useState(true);

  /* ── Interaction state ── */
  const [dragging, setDragging] = useState(null); // { id, startX, startY, origX, origY }
  const [panning, setPanning] = useState(null); // { startX, startY, origPanX, origPanY }
  const [editingTitle, setEditingTitle] = useState(null);
  const [editingDesc, setEditingDesc] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // { id, x, y }
  const [colorSubmenu, setColorSubmenu] = useState(false);
  const [statusSubmenu, setStatusSubmenu] = useState(false);
  const [connectMode, setConnectMode] = useState(null); // sourceId
  const [ownerDropdown, setOwnerDropdown] = useState(null); // itemId
  const [filter, setFilter] = useState("All");
  const [filterOpen, setFilterOpen] = useState(false);

  /* ── Dashboard state ── */
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [dashData, setDashData] = useState(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState(null);
  const [showSage, setShowSage] = useState(false);

  const viewportRef = useRef(null);
  const saveTimers = useRef({});

  /* ── Load board items ── */
  useEffect(() => {
    (async () => {
      const { data, error } = await fetchBoardItems();
      if (error || !data || data.length === 0) {
        // Seed defaults
        const seeded = DEFAULT_ITEMS.map((it, i) => ({ ...it, id: `seed-${i}`, connections: it.connections || [] }));
        setItems(seeded);
        // Persist seeds
        for (const it of DEFAULT_ITEMS) {
          const { id: _id, ...rest } = { ...it };
          await createBoardItem(rest);
        }
        // Re-fetch to get real IDs
        const { data: fresh } = await fetchBoardItems();
        if (fresh && fresh.length > 0) {
          setItems(fresh.map(f => ({ ...f, connections: f.connections || [] })));
        }
      } else {
        setItems(data.map(d => ({ ...d, connections: d.connections || [] })));
      }
      setBoardLoading(false);
    })();
  }, []);

  /* ── Lazy-load dashboard ── */
  const loadDashboard = useCallback(() => {
    if (dashData || dashLoading) return;
    setDashLoading(true);
    fetch("/api/notion-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "all" }),
    })
      .then(r => r.json())
      .then(res => { setDashData(res.data); setDashLoading(false); })
      .catch(err => { setDashError(err.message); setDashLoading(false); });
  }, [dashData, dashLoading]);

  /* ── Debounced save ── */
  const debouncedSave = useCallback((id, fields) => {
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(() => {
      updateBoardItem(id, fields);
      delete saveTimers.current[id];
    }, 500);
  }, []);

  /* ── Item updater (local + persist) ── */
  const localUpdate = useCallback((id, fields) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...fields } : it));
  }, []);

  /* ── Zoom handler ── */
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom(z => Math.min(3, Math.max(0.3, z + delta)));
  }, []);

  /* ── Pan handlers ── */
  const handleCanvasMouseDown = useCallback((e) => {
    // Only pan on left click on empty canvas space
    if (e.button !== 0) return;
    setContextMenu(null);
    setOwnerDropdown(null);
    setFilterOpen(false);
    setPanning({ startX: e.clientX, startY: e.clientY, origPanX: panX, origPanY: panY });
  }, [panX, panY]);

  const handleMouseMove = useCallback((e) => {
    if (dragging) {
      const dx = (e.clientX - dragging.startX) / zoom;
      const dy = (e.clientY - dragging.startY) / zoom;
      localUpdate(dragging.id, { x: dragging.origX + dx, y: dragging.origY + dy });
    } else if (panning) {
      setPanX(panning.origPanX + (e.clientX - panning.startX));
      setPanY(panning.origPanY + (e.clientY - panning.startY));
    }
  }, [dragging, panning, zoom, localUpdate]);

  const handleMouseUp = useCallback(() => {
    if (dragging) {
      const item = items.find(i => i.id === dragging.id);
      if (item) debouncedSave(item.id, { x: item.x, y: item.y });
      setDragging(null);
    }
    setPanning(null);
  }, [dragging, items, debouncedSave]);

  /* ── Card drag start ── */
  const startDrag = useCallback((e, item) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (connectMode) {
      // Complete connection
      if (connectMode !== item.id) {
        const src = items.find(i => i.id === connectMode);
        if (src) {
          const newConns = [...(src.connections || []), { targetId: item.id }];
          localUpdate(connectMode, { connections: newConns });
          debouncedSave(connectMode, { connections: newConns });
        }
      }
      setConnectMode(null);
      return;
    }
    setDragging({ id: item.id, startX: e.clientX, startY: e.clientY, origX: item.x, origY: item.y });
  }, [connectMode, items, localUpdate, debouncedSave]);

  /* ── Context menu ── */
  const handleContextMenu = useCallback((e, item) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ id: item.id, x: e.clientX, y: e.clientY });
    setColorSubmenu(false);
    setStatusSubmenu(false);
  }, []);

  /* ── Add item ── */
  const addItem = useCallback(async () => {
    const vp = viewportRef.current;
    const w = vp ? vp.clientWidth : 800;
    const h = vp ? vp.clientHeight : 600;
    const cx = (-panX + w / 2) / zoom;
    const cy = (-panY + h / 2) / zoom;
    const newItem = {
      title: "New item", description: "", column_name: columns[0] || "Uncategorized",
      x: cx - CARD_WIDTH / 2, y: cy - 40, color: "gold", status: "active",
      owner: null, priority: "medium", pulse: false, connections: [],
    };
    const { data } = await createBoardItem(newItem);
    if (data) setItems(prev => [...prev, { ...data, connections: data.connections || [] }]);
    else setItems(prev => [...prev, { ...newItem, id: `temp-${Date.now()}` }]);
  }, [panX, panY, zoom, columns]);

  /* ── Fit view ── */
  const fitView = useCallback(() => {
    if (items.length === 0) return;
    const vp = viewportRef.current;
    if (!vp) return;
    const padding = 60;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    items.forEach(it => {
      if (it.x < minX) minX = it.x;
      if (it.y < minY) minY = it.y;
      if (it.x + CARD_WIDTH > maxX) maxX = it.x + CARD_WIDTH;
      if (it.y + 120 > maxY) maxY = it.y + 120;
    });
    const bw = maxX - minX + padding * 2;
    const bh = maxY - minY + padding * 2;
    const zx = vp.clientWidth / bw;
    const zy = vp.clientHeight / bh;
    const newZoom = Math.min(Math.max(Math.min(zx, zy), 0.3), 3);
    const newPanX = -minX * newZoom + (vp.clientWidth - (maxX - minX) * newZoom) / 2;
    const newPanY = -minY * newZoom + (vp.clientHeight - (maxY - minY) * newZoom) / 2;
    setZoom(newZoom);
    setPanX(newPanX);
    setPanY(newPanY);
  }, [items]);

  /* ── Delete item ── */
  const deleteItem = useCallback(async (id) => {
    setItems(prev => prev.filter(i => i.id !== id));
    await deleteBoardItem(id);
    setContextMenu(null);
  }, []);

  /* ── Add column ── */
  const addColumn = useCallback(() => {
    const name = prompt("Column name:");
    if (name && name.trim()) setColumns(prev => [...prev, name.trim()]);
  }, []);

  /* ── Close menus on outside click ── */
  useEffect(() => {
    const close = () => { setContextMenu(null); setOwnerDropdown(null); setFilterOpen(false); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  /* ── Dashboard data ── */
  const crlf = dashData?.openLoops?.find(l => l.status === "CRLF");
  const openLoops = dashData?.openLoops?.filter(l => l.status !== "CRLF") || [];
  const sessions = dashData?.sessions || [];
  const domains = dashData?.domains || [];
  const content = dashData?.content || {};
  const sessionsByStatus = {
    "To Do": sessions.filter(s => s.status === "To Do"),
    "In Progress": sessions.filter(s => s.status === "In Progress"),
    Complete: sessions.filter(s => s.status === "Complete"),
  };

  /* ── Render arrows SVG ── */
  const renderArrows = () => {
    const lines = [];
    items.forEach(src => {
      (src.connections || []).forEach((conn, ci) => {
        const tgt = items.find(i => i.id === conn.targetId);
        if (!tgt) return;
        const sx = src.x + CARD_WIDTH;
        const sy = src.y + 40;
        const tx = tgt.x;
        const ty = tgt.y + 40;
        const color = CARD_COLORS[src.color] || "#C8A84E";
        const pathD = `M ${sx} ${sy} C ${sx + 60} ${sy}, ${tx - 60} ${ty}, ${tx} ${ty}`;
        lines.push(
          <g key={`${src.id}-${conn.targetId}-${ci}`}>
            <defs>
              <marker id={`arrow-${src.id}-${ci}`} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill={color} opacity="0.6" />
              </marker>
            </defs>
            <path d={pathD} stroke={color} strokeWidth="2" fill="none" opacity="0.6"
              markerEnd={`url(#arrow-${src.id}-${ci})`} />
          </g>
        );
      });
    });
    return lines;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)", overflow: "hidden", position: "relative" }}>
      {/* Global styles */}
      <style>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }
        @keyframes pulse-glow { 0%, 100% { box-shadow: 0 0 8px rgba(200,168,78,0.2); } 50% { box-shadow: 0 0 24px rgba(200,168,78,0.5); } }
        @keyframes blocked-pulse { 0%, 100% { box-shadow: 0 0 8px rgba(239,68,68,0.2); } 50% { box-shadow: 0 0 20px rgba(239,68,68,0.4); } }
      `}</style>

      {/* ─── Toolbar ─── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "8px 16px",
        background: tokens.surface, borderBottom: `1px solid ${tokens.border}`,
        zIndex: 20, flexShrink: 0,
      }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: tokens.text, letterSpacing: "-0.02em", marginRight: 8 }}>
          ♟ Chessboard
        </span>

        <button onClick={addItem} style={{
          padding: "5px 12px", borderRadius: 8, border: `1px solid ${tokens.border}`,
          background: tokens.surfaceEl, color: tokens.text, fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit",
        }}>+ Add Item</button>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => setZoom(z => Math.max(0.3, z - 0.1))} style={{
            width: 24, height: 24, borderRadius: 6, border: `1px solid ${tokens.border}`,
            background: tokens.surfaceEl, color: tokens.text, fontSize: 14, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>-</button>
          <span style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, minWidth: 44, textAlign: "center" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.1))} style={{
            width: 24, height: 24, borderRadius: 6, border: `1px solid ${tokens.border}`,
            background: tokens.surfaceEl, color: tokens.text, fontSize: 14, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>+</button>
        </div>

        <button onClick={fitView} style={{
          padding: "5px 12px", borderRadius: 8, border: `1px solid ${tokens.border}`,
          background: tokens.surfaceEl, color: tokens.text, fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit",
        }}>Fit View</button>

        {/* Filter dropdown */}
        <div style={{ position: "relative" }}>
          <button onClick={(e) => { e.stopPropagation(); setFilterOpen(f => !f); }} style={{
            padding: "5px 12px", borderRadius: 8, border: `1px solid ${tokens.border}`,
            background: tokens.surfaceEl, color: tokens.text, fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}>Filter: {filter} ▾</button>
          {filterOpen && (
            <div style={{
              position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 50,
              background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.3)", overflow: "hidden", minWidth: 100,
            }} onClick={e => e.stopPropagation()}>
              {["All", "Cole", "Zoran"].map(f => (
                <div key={f} onClick={() => { setFilter(f); setFilterOpen(false); }} style={{
                  padding: "8px 14px", fontSize: 12, fontWeight: 600, color: filter === f ? tokens.accent : tokens.text,
                  cursor: "pointer", background: filter === f ? tokens.accent + "10" : "transparent",
                }}
                  onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
                  onMouseLeave={e => e.currentTarget.style.background = filter === f ? tokens.accent + "10" : "transparent"}
                >{f}</div>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <button onClick={() => setShowSage(true)} style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "5px 12px", borderRadius: 8,
          background: `linear-gradient(135deg, ${tokens.accent}20, ${tokens.accent}08)`,
          border: `1px solid ${tokens.accent}40`, color: tokens.accent,
          fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
        }}>✨ Sage</button>

        <button onClick={() => { setDashboardOpen(d => !d); if (!dashData) loadDashboard(); }} style={{
          padding: "5px 14px", borderRadius: 8,
          background: dashboardOpen ? tokens.accent + "20" : tokens.surfaceEl,
          border: `1px solid ${dashboardOpen ? tokens.accent + "40" : tokens.border}`,
          color: dashboardOpen ? tokens.accent : tokens.text, fontSize: 12, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit",
        }}>📊 Dashboard</button>
      </div>

      {/* ─── Canvas Viewport ─── */}
      <div
        ref={viewportRef}
        style={{
          flex: 1, overflow: "hidden", position: "relative",
          cursor: connectMode ? "crosshair" : panning ? "grabbing" : "grab",
          background: dark !== false ? "#0c0b09" : "#f5f5f0",
        }}
        onWheel={handleWheel}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Canvas transform layer */}
        <div style={{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transformOrigin: "0 0",
          position: "absolute", top: 0, left: 0,
          width: 1, height: 1, // anchor point; children are absolute
        }}>

          {/* ── Column guides ── */}
          {columns.map((col, i) => {
            const x = i * COLUMN_WIDTH;
            return (
              <div key={col} style={{ position: "absolute", left: x, top: 0, width: COLUMN_WIDTH, height: 2000, pointerEvents: "none" }}>
                {/* Band */}
                <div style={{
                  position: "absolute", inset: 0,
                  background: i % 2 === 0
                    ? (dark !== false ? "rgba(200,168,78,0.03)" : "rgba(0,0,0,0.02)")
                    : "transparent",
                }} />
                {/* Center dashed line */}
                <div style={{
                  position: "absolute", left: COLUMN_WIDTH / 2, top: 40, bottom: 0, width: 1,
                  borderLeft: `1px dashed ${dark !== false ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)"}`,
                }} />
                {/* Header */}
                <div style={{
                  position: "sticky", top: 0, zIndex: 5,
                  padding: "8px 12px", fontSize: 11, fontWeight: 700,
                  color: tokens.textMute, textTransform: "uppercase", letterSpacing: "0.08em",
                  textAlign: "center",
                }}>{col}</div>
              </div>
            );
          })}
          {/* Add column button */}
          <div
            style={{
              position: "absolute", left: columns.length * COLUMN_WIDTH + 10, top: 6,
              width: 28, height: 28, borderRadius: 8,
              border: `1px dashed ${tokens.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, color: tokens.textMute, cursor: "pointer", pointerEvents: "auto",
            }}
            onMouseDown={e => e.stopPropagation()}
            onClick={addColumn}
          >+</div>

          {/* ── SVG arrows ── */}
          <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
            {renderArrows()}
          </svg>

          {/* ── Board cards ── */}
          {items.map(item => {
            const cardColor = CARD_COLORS[item.color] || CARD_COLORS.gold;
            const statusColor = STATUS_DOT[item.status] || "#6b7280";
            const isDone = item.status === "done";
            const isFiltered = filter !== "All" && item.owner !== filter;
            const isPulse = item.pulse && !isDone;
            const isBlocked = item.status === "blocked";

            return (
              <div
                key={item.id}
                style={{
                  position: "absolute", left: item.x, top: item.y, width: CARD_WIDTH,
                  background: dark !== false ? "#1a1916" : "#ffffff",
                  border: `1px solid ${dark !== false ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)"}`,
                  borderLeft: `4px solid ${cardColor}`,
                  borderRadius: 10, padding: 12,
                  cursor: connectMode ? "crosshair" : dragging?.id === item.id ? "grabbing" : "grab",
                  userSelect: "none",
                  opacity: isFiltered ? 0.3 : 1,
                  transition: dragging?.id === item.id ? "none" : "opacity 0.2s",
                  animation: isPulse ? "pulse-glow 2s ease-in-out infinite" : isBlocked ? "blocked-pulse 1.5s ease-in-out infinite" : "none",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                }}
                onMouseDown={e => startDrag(e, item)}
                onContextMenu={e => handleContextMenu(e, item)}
              >
                {/* Status dot */}
                <div style={{
                  position: "absolute", top: 8, right: 8,
                  width: 8, height: 8, borderRadius: "50%",
                  background: statusColor,
                  animation: isBlocked ? "blocked-pulse 1.5s ease-in-out infinite" : "none",
                }} />

                {/* Title */}
                {editingTitle === item.id ? (
                  <input
                    autoFocus
                    defaultValue={item.title}
                    style={{
                      fontSize: 14, fontWeight: 700, color: tokens.text,
                      background: "transparent", border: `1px solid ${tokens.border}`,
                      borderRadius: 4, padding: "2px 4px", width: "calc(100% - 20px)",
                      outline: "none", fontFamily: "inherit",
                    }}
                    onMouseDown={e => e.stopPropagation()}
                    onBlur={e => {
                      const val = e.target.value.trim();
                      if (val && val !== item.title) {
                        localUpdate(item.id, { title: val });
                        debouncedSave(item.id, { title: val });
                      }
                      setEditingTitle(null);
                    }}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                  />
                ) : (
                  <div
                    onClick={e => { e.stopPropagation(); setEditingTitle(item.id); }}
                    onMouseDown={e => e.stopPropagation()}
                    style={{
                      fontSize: 14, fontWeight: 700, color: tokens.text,
                      marginBottom: 4, paddingRight: 16,
                      textDecoration: isDone ? "line-through" : "none",
                      opacity: isDone ? 0.5 : 1,
                      cursor: "text",
                    }}
                  >{item.title}</div>
                )}

                {/* Description */}
                {editingDesc === item.id ? (
                  <textarea
                    autoFocus
                    defaultValue={item.description || ""}
                    rows={2}
                    style={{
                      fontSize: 12, color: tokens.textSub, width: "100%",
                      background: "transparent", border: `1px solid ${tokens.border}`,
                      borderRadius: 4, padding: "2px 4px", resize: "vertical",
                      outline: "none", fontFamily: "inherit",
                    }}
                    onMouseDown={e => e.stopPropagation()}
                    onBlur={e => {
                      const val = e.target.value;
                      localUpdate(item.id, { description: val });
                      debouncedSave(item.id, { description: val });
                      setEditingDesc(null);
                    }}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) e.target.blur(); }}
                  />
                ) : (
                  <div
                    onClick={e => { e.stopPropagation(); setEditingDesc(item.id); }}
                    onMouseDown={e => e.stopPropagation()}
                    style={{
                      fontSize: 12, color: tokens.textSub, lineHeight: 1.4,
                      marginBottom: 8,
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                      cursor: "text", minHeight: 16,
                    }}
                  >{item.description || "Click to add description..."}</div>
                )}

                {/* Bottom pills */}
                <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                  {/* Owner pill */}
                  <div style={{ position: "relative" }}>
                    <span
                      onClick={e => { e.stopPropagation(); setOwnerDropdown(ownerDropdown === item.id ? null : item.id); }}
                      onMouseDown={e => e.stopPropagation()}
                      style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, cursor: "pointer",
                        background: item.owner === "Cole" ? "#C8A84E20" : item.owner === "Zoran" ? "#818cf820" : `${tokens.textMute}20`,
                        color: item.owner === "Cole" ? "#C8A84E" : item.owner === "Zoran" ? "#818cf8" : tokens.textMute,
                      }}
                    >{item.owner || "unassigned"}</span>
                    {ownerDropdown === item.id && (
                      <div style={{
                        position: "absolute", bottom: "100%", left: 0, marginBottom: 4, zIndex: 100,
                        background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 8,
                        boxShadow: "0 8px 24px rgba(0,0,0,0.3)", overflow: "hidden",
                      }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                        {["Cole", "Zoran", null].map(o => (
                          <div key={o || "none"} onClick={() => {
                            localUpdate(item.id, { owner: o });
                            debouncedSave(item.id, { owner: o });
                            setOwnerDropdown(null);
                          }} style={{
                            padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                            color: o === "Cole" ? "#C8A84E" : o === "Zoran" ? "#818cf8" : tokens.textMute,
                          }}
                            onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                          >{o || "unassigned"}</div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Priority dot */}
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: PRIORITY_DOT[item.priority] || "#6b7280",
                  }} title={item.priority} />

                  {/* Column tag */}
                  {item.column_name && (
                    <span style={{
                      fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                      background: dark !== false ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                      color: tokens.textMute,
                    }}>{item.column_name}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Connect mode indicator */}
        {connectMode && (
          <div style={{
            position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 30,
            padding: "6px 16px", borderRadius: 8, background: tokens.accent, color: "#0E0D0B",
            fontSize: 12, fontWeight: 700,
          }}>Click a card to connect &bull; ESC to cancel</div>
        )}
      </div>

      {/* ─── Context Menu ─── */}
      {contextMenu && (
        <div
          style={{
            position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 200,
            background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 10,
            boxShadow: "0 12px 40px rgba(0,0,0,0.4)", overflow: "hidden", minWidth: 170,
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Color submenu */}
          <div style={{ position: "relative" }}>
            <div
              onClick={() => { setColorSubmenu(c => !c); setStatusSubmenu(false); }}
              style={{ padding: "10px 14px", fontSize: 12, fontWeight: 600, color: tokens.text, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
              onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >🎨 Color ▸</div>
            {colorSubmenu && (
              <div style={{
                position: "absolute", left: "100%", top: 0, marginLeft: 2,
                background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.3)", padding: 8, display: "flex", gap: 6,
              }}>
                {Object.entries(CARD_COLORS).map(([name, hex]) => (
                  <div key={name} onClick={() => {
                    localUpdate(contextMenu.id, { color: name });
                    debouncedSave(contextMenu.id, { color: name });
                    setContextMenu(null);
                  }} style={{
                    width: 18, height: 18, borderRadius: "50%", background: hex, cursor: "pointer",
                    border: "2px solid transparent",
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#fff"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "transparent"}
                    title={name}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Status submenu */}
          <div style={{ position: "relative" }}>
            <div
              onClick={() => { setStatusSubmenu(s => !s); setColorSubmenu(false); }}
              style={{ padding: "10px 14px", fontSize: 12, fontWeight: 600, color: tokens.text, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
              onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >📌 Status ▸</div>
            {statusSubmenu && (
              <div style={{
                position: "absolute", left: "100%", top: 0, marginLeft: 2,
                background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.3)", overflow: "hidden",
              }}>
                {["active", "blocked", "done", "paused"].map(s => (
                  <div key={s} onClick={() => {
                    localUpdate(contextMenu.id, { status: s });
                    debouncedSave(contextMenu.id, { status: s });
                    setContextMenu(null);
                  }} style={{
                    padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    color: STATUS_DOT[s], textTransform: "capitalize",
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >{s}</div>
                ))}
              </div>
            )}
          </div>

          {/* Connect */}
          <div
            onClick={() => { setConnectMode(contextMenu.id); setContextMenu(null); }}
            style={{ padding: "10px 14px", fontSize: 12, fontWeight: 600, color: tokens.text, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
            onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >🔗 Connect</div>

          {/* Toggle pulse */}
          <div
            onClick={() => {
              const item = items.find(i => i.id === contextMenu.id);
              if (item) {
                localUpdate(item.id, { pulse: !item.pulse });
                debouncedSave(item.id, { pulse: !item.pulse });
              }
              setContextMenu(null);
            }}
            style={{ padding: "10px 14px", fontSize: 12, fontWeight: 600, color: tokens.text, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
            onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >⭐ Toggle Pulse</div>

          {/* Delete */}
          <div
            onClick={() => deleteItem(contextMenu.id)}
            style={{ padding: "10px 14px", fontSize: 12, fontWeight: 600, color: "#ef4444", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
            onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >🗑 Delete</div>
        </div>
      )}

      {/* ─── Dashboard Panel ─── */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: dashboardOpen ? "40vh" : 0,
        background: dark !== false ? "rgba(14,13,11,0.96)" : "rgba(255,255,255,0.96)",
        backdropFilter: "blur(12px)",
        borderTop: dashboardOpen ? `1px solid ${tokens.border}` : "none",
        transition: "height 0.3s ease",
        overflow: "hidden",
        zIndex: 15,
      }}>
        <div style={{ height: "100%", overflow: "auto", padding: 24 }}>
          {dashLoading && (
            <div style={{ display: "grid", gap: 16 }}>
              {[1, 2, 3].map(i => <SkeletonCard key={i} tokens={tokens} />)}
            </div>
          )}
          {dashError && (
            <div style={{ padding: 20, borderRadius: 14, background: tokens.redSoft || "#7f1d1d20", color: "#ef4444", fontSize: 13 }}>
              Failed to load: {dashError}
            </div>
          )}
          {dashData && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {crlf && (
                <div>
                  <SectionHeader title="Current Focus" icon="🎯" tokens={tokens} />
                  <CRLFCard item={crlf} tokens={tokens} />
                </div>
              )}
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
              <div>
                <SectionHeader title="Domains" icon="🗂" count={domains.length} tokens={tokens} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
                  {domains.map((d, i) => <DomainCard key={d.id} domain={d} tokens={tokens} index={i} />)}
                </div>
              </div>
              <div>
                <SectionHeader title="Sessions" icon="📋" count={sessions.length} tokens={tokens}
                  action={<a href="https://www.notion.so/4e5492be5027427cbbc8994bcd73905c" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: tokens.accent, textDecoration: "none" }}>View all →</a>}
                />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                  {Object.entries(sessionsByStatus).map(([status, sitems]) => (
                    <div key={status}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLORS[status]?.pill || tokens.textMute, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                        {status} ({sitems.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {sitems.slice(0, 5).map((s, i) => <SessionCard key={s.id} item={s} tokens={tokens} index={i} />)}
                        {sitems.length === 0 && <div style={{ fontSize: 12, color: tokens.textMute, fontStyle: "italic" }}>None</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <SectionHeader title="Content Pipeline" icon="🎬" tokens={tokens} />
                <ContentSummary data={content} tokens={tokens} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ESC to cancel connect mode */}
      {connectMode && (
        <div style={{ position: "fixed", inset: 0, zIndex: 0 }}
          onKeyDown={e => { if (e.key === "Escape") setConnectMode(null); }}
          tabIndex={0}
          ref={el => el?.focus()}
        />
      )}

      {/* Sage Modal */}
      {showSage && <AskSageModal tokens={tokens} onClose={() => setShowSage(false)} context={{ openLoops, sessions, content }} />}
    </div>
  );
}
