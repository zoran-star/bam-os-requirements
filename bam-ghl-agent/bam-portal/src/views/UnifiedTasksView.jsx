import { useState, useEffect, useMemo, useCallback } from "react";
import { fetchActionItems } from "../services/notionService";
import { fetchComments, addComment, fetchSubtasks, addSubtask } from "../services/asanaService";
import Avatar from "../components/primitives/Avatar";
import { useIsMobile } from '../hooks/useMediaQuery';

// ─── Constants ───────────────────────────────────────────────────────
const CATEGORIES = ["Digital Marketing", "Systems", "Content", "Operations", "General"];
const OWNERS = ["SM", "Client", "Both"];
const URGENCIES = ["Urgent", "Standard"];
const STATUSES = ["Open", "Done"];
const SM_OPTIONS = ["Mike", "Zoran", "Silva", "Graham", "Coleman"];

// ─── Shared sub-components ──────────────────────────────────────────

function Badge({ label, color, bg }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
      padding: "3px 8px", borderRadius: 5, color, background: bg,
      whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

function SkeletonBlock({ tokens, width, height, style }) {
  return (
    <div style={{
      width: width || "100%",
      height: height || 16,
      borderRadius: 8,
      background: tokens.surfaceAlt,
      animation: "pulse 1.5s ease-in-out infinite",
      ...style,
    }} />
  );
}

function SkeletonRows({ tokens, count = 7 }) {
  // Checklist Cascade — checkboxes appear one by one with checkmark draw animation
  const barWidths = ["72%", "58%", "65%", "48%", "70%", "55%", "62%"];
  const tagWidths = [68, 54, 72, 60, 0, 66, 0]; // 0 = no tag for that row

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "40vh", padding: "40px 0",
    }}>
      <style>{`
        @keyframes checkRowIn {
          0% { opacity: 0; transform: translateX(-16px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes checkDraw {
          0% { stroke-dashoffset: 20; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes checkboxPop {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes checkGlow {
          0%, 100% { box-shadow: none; }
          50% { box-shadow: 0 0 12px ${tokens.accent}40; }
        }
        @keyframes barShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes taskTextFade {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.65; }
        }
      `}</style>

      <div style={{ width: "100%", maxWidth: 560 }}>
        {Array.from({ length: count }).map((_, i) => {
          const checkDelay = i * 180;
          const drawDelay = checkDelay + 300;
          const isChecked = i < 3; // first 3 get checked off

          return (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "13px 18px", borderRadius: 10, marginBottom: 6,
              background: tokens.surfaceEl,
              border: `1px solid ${tokens.border}`,
              animation: `checkRowIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) ${checkDelay}ms both`,
            }}>
              {/* Checkbox */}
              <div style={{
                width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                border: `2px solid ${isChecked ? tokens.accent : tokens.borderStr}`,
                background: isChecked ? tokens.accentGhost : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: `checkboxPop 0.35s cubic-bezier(0.22, 1, 0.36, 1) ${checkDelay + 100}ms both${isChecked ? `, checkGlow 1.5s ease ${drawDelay + 400}ms 1` : ""}`,
                transition: "all 0.3s ease",
              }}>
                {isChecked && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2.5 6.5L5 9L9.5 3.5"
                      stroke={tokens.accent}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        strokeDasharray: 20,
                        strokeDashoffset: 20,
                        animation: `checkDraw 0.4s cubic-bezier(0.22, 1, 0.36, 1) ${drawDelay}ms forwards`,
                      }}
                    />
                  </svg>
                )}
              </div>

              {/* Text bar with shimmer */}
              <div style={{
                flex: 1, height: 13, borderRadius: 5,
                background: isChecked
                  ? `linear-gradient(90deg, ${tokens.borderMed} 0%, ${tokens.accent}15 50%, ${tokens.borderMed} 100%)`
                  : `linear-gradient(90deg, ${tokens.borderMed} 0%, ${tokens.borderStr} 50%, ${tokens.borderMed} 100%)`,
                backgroundSize: "200% 100%",
                animation: `barShimmer 2s ease-in-out ${checkDelay + 200}ms infinite, taskTextFade 2s ease ${checkDelay + 200}ms infinite`,
                width: barWidths[i % barWidths.length],
                opacity: isChecked ? 0.5 : 1,
                textDecoration: isChecked ? "line-through" : "none",
              }} />

              {/* Optional tag placeholder */}
              {tagWidths[i % tagWidths.length] > 0 && (
                <div style={{
                  width: tagWidths[i % tagWidths.length], height: 20, borderRadius: 5, flexShrink: 0,
                  background: tokens.borderMed,
                  animation: `taskTextFade 2s ease ${checkDelay + 400}ms infinite`,
                }} />
              )}

              {/* Due date placeholder */}
              <div style={{
                width: 56, height: 11, borderRadius: 4, flexShrink: 0,
                background: tokens.borderMed,
                animation: `taskTextFade 2s ease ${checkDelay + 300}ms infinite`,
                opacity: isChecked ? 0.4 : 0.7,
              }} />
            </div>
          );
        })}
      </div>

      {/* Loading text */}
      <div style={{
        marginTop: 28, fontSize: 13, fontWeight: 500,
        color: tokens.textMute, letterSpacing: "0.04em",
        animation: "taskTextFade 2s ease infinite",
      }}>
        Syncing with Asana...
      </div>
    </div>
  );
}

function SkeletonCards({ tokens, count = 6 }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      gap: 16,
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{
          background: tokens.surfaceEl, borderRadius: 14, padding: "20px 24px",
          border: `1px solid ${tokens.border}`,
          animation: `cardIn 0.3s ease ${i * 60}ms both`,
        }}>
          <SkeletonBlock tokens={tokens} width="70%" height={16} style={{ marginBottom: 12 }} />
          <SkeletonBlock tokens={tokens} width="40%" height={12} style={{ marginBottom: 8 }} />
          <SkeletonBlock tokens={tokens} width="50%" height={12} style={{ marginBottom: 8 }} />
          <SkeletonBlock tokens={tokens} width="30%" height={12} />
        </div>
      ))}
    </div>
  );
}

function SummaryStats({ items, tokens }) {
  const open = items.filter(i => i.status === "Open");
  const urgent = open.filter(i => i.urgency === "Urgent");
  const byCat = CATEGORIES.reduce((acc, c) => {
    acc[c] = open.filter(i => i.category === c).length;
    return acc;
  }, {});

  return (
    <div style={{
      display: "flex", gap: 16, marginBottom: 28, flexWrap: "wrap",
      animation: "cardIn 0.3s ease both",
    }}>
      <div style={{
        background: tokens.surfaceEl, borderRadius: 14, padding: "20px 28px",
        border: `1px solid ${tokens.border}`, minWidth: 140, flex: "0 0 auto",
        transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        cursor: "default",
      }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.borderColor = tokens.borderStr; e.currentTarget.style.boxShadow = tokens.cardHover; }}
        onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.boxShadow = "none"; }}
      >
        <div style={{ fontSize: 32, fontWeight: 700, color: tokens.text, letterSpacing: "-0.03em", lineHeight: 1 }}>{open.length}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginTop: 6, letterSpacing: "0.04em" }}>OPEN ITEMS</div>
      </div>
      <div style={{
        background: tokens.surfaceEl, borderRadius: 14, padding: "20px 28px",
        border: `1px solid ${tokens.border}`, minWidth: 120, flex: "0 0 auto",
        transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        cursor: "default",
      }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.borderColor = tokens.borderStr; e.currentTarget.style.boxShadow = tokens.cardHover; }}
        onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.boxShadow = "none"; }}
      >
        <div style={{ fontSize: 32, fontWeight: 700, color: tokens.red, letterSpacing: "-0.03em", lineHeight: 1 }}>{urgent.length}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginTop: 6, letterSpacing: "0.04em" }}>URGENT</div>
      </div>
      <div style={{
        background: tokens.surfaceEl, borderRadius: 14, padding: "20px 28px",
        border: `1px solid ${tokens.border}`, flex: 1, minWidth: 280,
        display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap",
      }}>
        {CATEGORIES.map(c => (
          <div key={c} style={{ textAlign: "center", minWidth: 60 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: byCat[c] > 0 ? tokens.text : tokens.textMute, lineHeight: 1 }}>{byCat[c]}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: tokens.textMute, marginTop: 4, letterSpacing: "0.03em" }}>{c.toUpperCase()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddItemForm({ tokens, onAdd, onCancel, clients }) {
  const [action, setAction] = useState("");
  const [client, setClient] = useState(clients[0] || "");
  const [urgency, setUrgency] = useState("Standard");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [notes, setNotes] = useState("");

  const inputStyle = {
    width: "100%", padding: "10px 14px", borderRadius: 8, fontSize: 14,
    background: tokens.surfaceAlt, border: `1px solid ${tokens.borderMed}`,
    color: tokens.text, fontFamily: "inherit", outline: "none",
    boxSizing: "border-box",
  };
  const selectStyle = { ...inputStyle, cursor: "pointer" };

  const handleSubmit = () => {
    if (!action.trim()) return;
    onAdd({
      id: "ai-" + Date.now(),
      action: action.trim(),
      client,
      status: "Open",
      urgency,
      owner: "SM",
      category,
      callDate: new Date().toISOString().slice(0, 10),
      reminderDate: new Date().toISOString().slice(0, 10),
      sourceCall: "Manual Entry",
      notes: notes.trim(),
    });
  };

  return (
    <div style={{
      background: tokens.surfaceEl, borderRadius: 14, padding: "24px 28px",
      border: `1px solid ${tokens.accentBorder}`, marginBottom: 20,
      animation: "cardIn 0.25s ease both",
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: tokens.accent, marginBottom: 16, letterSpacing: "-0.01em" }}>New Action Item</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <input value={action} onChange={e => setAction(e.target.value)} placeholder="Action item description..." style={inputStyle} autoFocus />
        </div>
        <select value={client} onChange={e => setClient(e.target.value)} style={selectStyle}>
          {clients.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={urgency} onChange={e => setUrgency(e.target.value)} style={selectStyle}>
          {URGENCIES.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)} style={selectStyle}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)..." rows={2} style={{ ...inputStyle, resize: "vertical", marginBottom: 14 }} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{
          padding: "8px 20px", borderRadius: 8, fontSize: 13, cursor: "pointer",
          background: "transparent", border: `1px solid ${tokens.border}`,
          color: tokens.textMute, fontFamily: "inherit", fontWeight: 500,
        }}>Cancel</button>
        <button onClick={handleSubmit} style={{
          padding: "8px 20px", borderRadius: 8, fontSize: 13, cursor: "pointer",
          background: tokens.accentGhost, border: `1px solid ${tokens.accentBorder}`,
          color: tokens.accent, fontFamily: "inherit", fontWeight: 600,
        }}>Add Item</button>
      </div>
    </div>
  );
}

function ItemRow({ item, tokens, showClient, expanded, onToggle }) {
  const isMobile = useIsMobile();
  const urgColor = item.urgency === "Urgent" ? tokens.red : tokens.textMute;
  const urgBg = item.urgency === "Urgent" ? tokens.redSoft : tokens.accentGhost;
  const statusColor = item.status === "Open" ? tokens.amber : tokens.green;
  const statusBg = item.status === "Open" ? tokens.amberSoft : tokens.greenSoft;
  const borderLeft = item.urgency === "Urgent" ? `3px solid ${tokens.red}` : `1px solid ${tokens.border}`;

  return (
    <div style={{ animation: "cardIn 0.3s ease both" }}>
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: isMobile ? 8 : 16,
          padding: isMobile ? "10px 12px" : "14px 20px", cursor: "pointer",
          background: expanded ? tokens.surfaceAlt : "transparent",
          borderRadius: expanded ? "12px 12px 0 0" : 12,
          borderLeft,
          transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
          flexWrap: isMobile ? "wrap" : "nowrap",
        }}
        onMouseEnter={e => { if (!expanded) { e.currentTarget.style.background = tokens.surfaceEl; e.currentTarget.style.transform = "translateX(3px)"; } }}
        onMouseLeave={e => { if (!expanded) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "translateX(0)"; } }}
      >
        <div style={{ flex: 2, minWidth: 0, fontSize: 14, fontWeight: 500, color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...(isMobile ? { flex: "1 1 100%" } : {}) }}>
          {item.action}
        </div>
        {showClient && !isMobile && (
          <div style={{ width: 140, minWidth: 140, flexShrink: 0, fontSize: 13, color: tokens.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.client}
          </div>
        )}
        <div style={{ width: isMobile ? "auto" : 70, flexShrink: 0 }}>
          <Badge label={item.status} color={statusColor} bg={statusBg} />
        </div>
        <div style={{ width: isMobile ? "auto" : 80, flexShrink: 0 }}>
          <Badge label={item.urgency} color={urgColor} bg={urgBg} />
        </div>
        {!isMobile && (
          <div style={{ width: 120, flexShrink: 0, fontSize: 12, color: tokens.textMute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.category}
          </div>
        )}
        {!isMobile && (
          <div style={{ width: 60, flexShrink: 0, fontSize: 12, fontWeight: 600, color: item.owner === "SM" ? tokens.accent : item.owner === "Client" ? tokens.blue : tokens.textSub }}>
            {item.owner}
          </div>
        )}
        {!isMobile && (
          <div style={{ width: 90, flexShrink: 0, fontSize: 12, color: tokens.textMute, fontFamily: "monospace" }}>
            {item.reminderDate}
          </div>
        )}
        <div style={{ fontSize: 14, color: expanded ? tokens.accent : tokens.textMute, transition: "all 0.12s", transform: expanded ? "rotate(90deg)" : "rotate(0)", flexShrink: 0 }}>{"\u2192"}</div>
      </div>

      {expanded && (
        <div style={{
          background: tokens.surfaceEl, borderRadius: "0 0 12px 12px",
          padding: "20px 24px", borderLeft,
          animation: "cardIn 0.2s ease both",
        }}>
          <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginBottom: 8, letterSpacing: "0.04em" }}>NOTES</div>
              <div style={{ fontSize: 14, color: tokens.textSub, lineHeight: 1.7 }}>{item.notes || "No notes."}</div>
            </div>
            <div style={{ minWidth: 180 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginBottom: 8, letterSpacing: "0.04em" }}>SOURCE CALL</div>
              <div style={{ fontSize: 14, color: tokens.text, fontWeight: 500, marginBottom: 12 }}>{item.sourceCall}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginBottom: 8, letterSpacing: "0.04em" }}>CALL DATE</div>
              <div style={{ fontSize: 14, color: tokens.textSub, fontFamily: "monospace" }}>{item.callDate}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Action Items Sub-tab (For Clients) ─────────────────────────────

function ActionItemsPanel({ tokens, selectedSM, clientSMMap }) {
  const isMobile = useIsMobile();
  const [innerTab, setInnerTab] = useState("by-client");
  const [items, setItems] = useState([]);
  const [expandedItem, setExpandedItem] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchActionItems().then(({ data }) => {
      if (!cancelled && data) setItems(data);
    });
    return () => { cancelled = true; };
  }, []);

  const [collapsedClients, setCollapsedClients] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  const [filterStatus, setFilterStatus] = useState(null);
  const [filterUrgency, setFilterUrgency] = useState(null);
  const [filterCategory, setFilterCategory] = useState(null);
  const [filterOwner, setFilterOwner] = useState(null);

  const clients = useMemo(() => [...new Set(items.map(i => i.client))].sort(), [items]);

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (filterStatus && i.status !== filterStatus) return false;
      if (filterUrgency && i.urgency !== filterUrgency) return false;
      if (filterCategory && i.category !== filterCategory) return false;
      if (filterOwner && i.owner !== filterOwner) return false;
      if (selectedSM && clientSMMap && clientSMMap[i.client] !== selectedSM) return false;
      return true;
    });
  }, [items, filterStatus, filterUrgency, filterCategory, filterOwner, selectedSM, clientSMMap]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortCol] || "";
      const bv = b[sortCol] || "";
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return copy;
  }, [filtered, sortCol, sortAsc]);

  const myItems = useMemo(() => sorted.filter(i => i.owner === "SM"), [sorted]);

  const byClient = useMemo(() => {
    const groups = {};
    filtered.forEach(i => {
      if (!groups[i.client]) groups[i.client] = [];
      groups[i.client].push(i);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const handleAdd = (newItem) => {
    setItems(prev => [newItem, ...prev]);
    setShowAddForm(false);
  };

  const toggleClient = (client) => {
    setCollapsedClients(prev => ({ ...prev, [client]: !prev[client] }));
  };

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  const innerTabs = [
    { key: "by-client", label: "By Client" },
    { key: "all-items", label: "All Items" },
    { key: "my-items", label: "My Items" },
  ];

  const pillStyle = (active) => ({
    padding: "6px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
    background: active ? tokens.accentGhost : "transparent",
    border: active ? `1px solid ${tokens.accentBorder}` : `1px solid ${tokens.border}`,
    color: active ? tokens.accent : tokens.textMute,
    fontFamily: "inherit", fontWeight: active ? 600 : 400,
    transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)", whiteSpace: "nowrap",
    boxShadow: active ? tokens.accentGlow : "none",
  });

  const toggleFilter = (current, value, setter) => {
    setter(current === value ? null : value);
  };

  const colHeaderStyle = (col) => ({
    fontSize: 11, fontWeight: 600, color: sortCol === col ? tokens.accent : tokens.textMute,
    letterSpacing: "0.04em", cursor: "pointer", userSelect: "none",
    transition: "color 0.12s",
  });

  const renderColumnHeaders = () => (
    <div style={{
      display: isMobile ? "none" : "flex", alignItems: "center", gap: 16,
      padding: "10px 20px", marginBottom: 4,
    }}>
      <div style={{ flex: 2, minWidth: 0, ...colHeaderStyle("action") }} onClick={() => handleSort("action")}>
        ACTION {sortCol === "action" ? (sortAsc ? "\u2191" : "\u2193") : ""}
      </div>
      {innerTab !== "by-client" && (
        <div style={{ width: 140, minWidth: 140, flexShrink: 0, ...colHeaderStyle("client") }} onClick={() => handleSort("client")}>
          CLIENT {sortCol === "client" ? (sortAsc ? "\u2191" : "\u2193") : ""}
        </div>
      )}
      <div style={{ width: 70, flexShrink: 0, ...colHeaderStyle("status") }} onClick={() => handleSort("status")}>
        STATUS {sortCol === "status" ? (sortAsc ? "\u2191" : "\u2193") : ""}
      </div>
      <div style={{ width: 80, flexShrink: 0, ...colHeaderStyle("urgency") }} onClick={() => handleSort("urgency")}>
        URGENCY {sortCol === "urgency" ? (sortAsc ? "\u2191" : "\u2193") : ""}
      </div>
      <div style={{ width: 120, flexShrink: 0, ...colHeaderStyle("category") }} onClick={() => handleSort("category")}>
        CATEGORY {sortCol === "category" ? (sortAsc ? "\u2191" : "\u2193") : ""}
      </div>
      <div style={{ width: 60, flexShrink: 0, ...colHeaderStyle("owner") }} onClick={() => handleSort("owner")}>
        OWNER {sortCol === "owner" ? (sortAsc ? "\u2191" : "\u2193") : ""}
      </div>
      <div style={{ width: 90, flexShrink: 0, ...colHeaderStyle("reminderDate") }} onClick={() => handleSort("reminderDate")}>
        REMINDER {sortCol === "reminderDate" ? (sortAsc ? "\u2191" : "\u2193") : ""}
      </div>
      <div style={{ width: 14, flexShrink: 0 }} />
    </div>
  );

  return (
    <div>
      {/* Header row: inner sub-tabs + add button */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 4, flex: 1 }}>
          {innerTabs.map(t => (
            <button key={t.key} onClick={() => setInnerTab(t.key)} style={{
              padding: "10px 22px", borderRadius: 8, fontSize: 14, cursor: "pointer",
              background: innerTab === t.key ? tokens.accentGhost : "transparent",
              border: "none", color: innerTab === t.key ? tokens.accent : tokens.textMute,
              fontFamily: "inherit", fontWeight: innerTab === t.key ? 600 : 400,
              textTransform: "uppercase", letterSpacing: "0.04em", transition: "all 0.12s",
            }}>{t.label}</button>
          ))}
        </div>
        <button onClick={() => setShowAddForm(!showAddForm)} style={{
          padding: "10px 22px", borderRadius: 8, fontSize: 13, cursor: "pointer",
          background: showAddForm ? tokens.redSoft : tokens.accentGhost,
          border: `1px solid ${showAddForm ? tokens.red : tokens.accentBorder}`,
          color: showAddForm ? tokens.red : tokens.accent,
          fontFamily: "inherit", fontWeight: 600, transition: "all 0.15s",
        }}>{showAddForm ? "Cancel" : "+ Add Action Item"}</button>
      </div>

      {/* Summary stats */}
      <SummaryStats items={items} tokens={tokens} />

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginRight: 6 }}>FILTERS</span>

        {STATUSES.map(s => (
          <button key={s} onClick={() => toggleFilter(filterStatus, s, setFilterStatus)} style={pillStyle(filterStatus === s)}>{s}</button>
        ))}
        <span style={{ width: 1, height: 18, background: tokens.border, margin: "0 4px" }} />

        {URGENCIES.map(u => (
          <button key={u} onClick={() => toggleFilter(filterUrgency, u, setFilterUrgency)} style={pillStyle(filterUrgency === u)}>{u}</button>
        ))}
        <span style={{ width: 1, height: 18, background: tokens.border, margin: "0 4px" }} />

        {CATEGORIES.map(c => (
          <button key={c} onClick={() => toggleFilter(filterCategory, c, setFilterCategory)} style={pillStyle(filterCategory === c)}>{c}</button>
        ))}
        <span style={{ width: 1, height: 18, background: tokens.border, margin: "0 4px" }} />

        {OWNERS.map(o => (
          <button key={o} onClick={() => toggleFilter(filterOwner, o, setFilterOwner)} style={pillStyle(filterOwner === o)}>{o}</button>
        ))}

        {(filterStatus || filterUrgency || filterCategory || filterOwner) && (
          <button onClick={() => { setFilterStatus(null); setFilterUrgency(null); setFilterCategory(null); setFilterOwner(null); }} style={{
            padding: "6px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
            background: tokens.redSoft, border: `1px solid ${tokens.red}33`,
            color: tokens.red, fontFamily: "inherit", fontWeight: 600,
            transition: "all 0.12s", marginLeft: 4,
          }}>Clear All</button>
        )}
      </div>

      {/* Add form */}
      {showAddForm && (
        <AddItemForm
          tokens={tokens}
          clients={clients}
          onAdd={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* BY CLIENT TAB */}
      {innerTab === "by-client" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {byClient.map(([client, clientItems], ci) => {
            const collapsed = collapsedClients[client];
            const openCount = clientItems.filter(i => i.status === "Open").length;
            return (
              <div key={client} style={{ animation: `cardIn 0.3s ease ${ci * 40}ms both` }}>
                <div
                  onClick={() => toggleClient(client)}
                  style={{
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "14px 20px", cursor: "pointer",
                    background: tokens.surfaceEl, borderRadius: collapsed ? 12 : "12px 12px 0 0",
                    border: `1px solid ${tokens.border}`,
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = tokens.borderStr}
                  onMouseLeave={e => e.currentTarget.style.borderColor = tokens.border}
                >
                  <div style={{ fontSize: 14, color: collapsed ? tokens.textMute : tokens.accent, transition: "all 0.12s", transform: collapsed ? "rotate(0)" : "rotate(90deg)", flexShrink: 0 }}>{"\u2192"}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text, letterSpacing: "-0.01em", flex: 1 }}>{client}</div>
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: openCount > 0 ? tokens.accent : tokens.textMute,
                    padding: "3px 10px", borderRadius: 10,
                    background: openCount > 0 ? tokens.accentGhost : "transparent",
                  }}>{openCount} open</span>
                </div>
                {!collapsed && (
                  <div style={{
                    background: tokens.surfaceAlt, borderRadius: "0 0 12px 12px",
                    borderLeft: `1px solid ${tokens.border}`,
                    borderRight: `1px solid ${tokens.border}`,
                    borderBottom: `1px solid ${tokens.border}`,
                    overflow: "hidden",
                  }}>
                    {clientItems.map(item => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        tokens={tokens}
                        showClient={false}
                        expanded={expandedItem === item.id}
                        onToggle={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {byClient.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: tokens.textMute, fontSize: 14 }}>No items match your filters.</div>
          )}
        </div>
      )}

      {/* ALL ITEMS TAB */}
      {innerTab === "all-items" && (
        <div>
          {renderColumnHeaders()}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {sorted.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                tokens={tokens}
                showClient={true}
                expanded={expandedItem === item.id}
                onToggle={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
              />
            ))}
            {sorted.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: tokens.textMute, fontSize: 14 }}>No items match your filters.</div>
            )}
          </div>
        </div>
      )}

      {/* MY ITEMS TAB */}
      {innerTab === "my-items" && (
        <div>
          {renderColumnHeaders()}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {myItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                tokens={tokens}
                showClient={true}
                expanded={expandedItem === item.id}
                onToggle={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
              />
            ))}
            {myItems.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: tokens.textMute, fontSize: 14 }}>No items match your filters.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Task Detail Panel (Asana full detail) ──────────────────────────

function TaskDetailPanel({ task, tokens, dark, onUpdateTask, onClose }) {
  const [comments, setComments] = useState([]);
  const [subtasks, setSubtasks] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [newSubtask, setNewSubtask] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(task.notes || "");
  const [editingDate, setEditingDate] = useState(false);
  const [dueDate, setDueDate] = useState(task.dueDate || "");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (task.id && !task.id.startsWith("mock")) {
      fetchComments(task.id).then(({ data }) => { if (data) setComments(data); });
      fetchSubtasks(task.id).then(({ data }) => { if (data) setSubtasks(data); });
    }
  }, [task.id]);

  const handleAddComment = async () => {
    if (!newComment.trim() || sending) return;
    setSending(true);
    const { data } = await addComment(task.id, newComment.trim());
    if (data) setComments(prev => [...prev, data]);
    setNewComment("");
    setSending(false);
  };

  const handleAddSubtask = async () => {
    if (!newSubtask.trim()) return;
    const { data } = await addSubtask(task.id, newSubtask.trim());
    if (data) setSubtasks(prev => [...prev, data]);
    setNewSubtask("");
  };

  const handleSaveNotes = () => {
    onUpdateTask(task.id, { notes });
    setEditingNotes(false);
  };

  const handleSaveDate = () => {
    onUpdateTask(task.id, { dueDate });
    setEditingDate(false);
  };

  const fmtCommentDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const inputStyle = {
    width: "100%", padding: "10px 14px", borderRadius: 8, fontSize: 13,
    background: tokens.surfaceAlt, border: `1px solid ${tokens.borderMed}`,
    color: tokens.text, fontFamily: "inherit", outline: "none",
    boxSizing: "border-box", transition: "all 0.2s",
  };

  return (
    <div style={{
      background: tokens.surfaceEl, borderRadius: 16,
      border: `1px solid ${tokens.accentBorder}`,
      animation: "scaleIn 0.25s cubic-bezier(0.22, 1, 0.36, 1) both",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "20px 24px 16px", display: "flex", alignItems: "flex-start", gap: 14,
        borderBottom: `1px solid ${tokens.border}`,
      }}>
        <div
          onClick={() => onUpdateTask(task.id, { completed: !task.completed, status: task.completed ? "todo" : "done" })}
          style={{
            width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 2,
            border: `2px solid ${task.completed ? tokens.green : tokens.accent}`,
            background: task.completed ? tokens.green : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", transition: "all 0.2s",
          }}
        >
          {task.completed && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>{"\u2713"}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: tokens.text, lineHeight: 1.3, letterSpacing: "-0.01em" }}>{task.title}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
            {task.project && <span style={{ fontSize: 11, fontWeight: 500, color: tokens.textMute, padding: "2px 8px", borderRadius: 6, background: tokens.surfaceAlt }}>{task.project}</span>}
            {task.assignee && <Avatar name={task.assignee} size={18} dark={dark} />}
            {task.assignee && <span style={{ fontSize: 12, color: tokens.textSub }}>{task.assignee}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          {task.permalink && (
            <a href={task.permalink} target="_blank" rel="noopener noreferrer" style={{
              fontSize: 11, fontWeight: 600, color: tokens.textMute, padding: "4px 10px",
              borderRadius: 6, border: `1px solid ${tokens.border}`, textDecoration: "none",
              transition: "all 0.2s",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.accentBorder; e.currentTarget.style.color = tokens.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.color = tokens.textMute; }}
            >Open in Asana</a>
          )}
          <div onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: tokens.textMute, fontSize: 18, transition: "all 0.2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceAlt; e.currentTarget.style.color = tokens.text; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = tokens.textMute; }}
          >{"\u00d7"}</div>
        </div>
      </div>

      <div style={{ padding: "20px 24px", display: "flex", gap: 24, flexWrap: "wrap" }}>
        {/* Left column: description + subtasks */}
        <div style={{ flex: 2, minWidth: 280 }}>
          {/* Due Date */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 8 }}>DUE DATE</div>
            {editingDate ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ ...inputStyle, width: 180 }} />
                <button onClick={handleSaveDate} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, background: tokens.accentGhost, border: `1px solid ${tokens.accentBorder}`, color: tokens.accent, fontFamily: "inherit", fontWeight: 600, cursor: "pointer" }}>Save</button>
                <button onClick={() => { setEditingDate(false); setDueDate(task.dueDate || ""); }} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, background: "transparent", border: `1px solid ${tokens.border}`, color: tokens.textMute, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
              </div>
            ) : (
              <div onClick={() => setEditingDate(true)} style={{
                fontSize: 14, color: task.dueDate ? tokens.text : tokens.textMute,
                cursor: "pointer", padding: "6px 0", transition: "color 0.15s",
              }}
                onMouseEnter={e => e.currentTarget.style.color = tokens.accent}
                onMouseLeave={e => e.currentTarget.style.color = task.dueDate ? tokens.text : tokens.textMute}
              >
                {task.dueDate || "No due date — click to set"}
              </div>
            )}
          </div>

          {/* Description / Notes */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>DESCRIPTION</div>
              {!editingNotes && (
                <div onClick={() => setEditingNotes(true)} style={{ fontSize: 11, color: tokens.accent, cursor: "pointer", fontWeight: 600 }}>Edit</div>
              )}
            </div>
            {editingNotes ? (
              <div>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical" }} />
                <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => { setEditingNotes(false); setNotes(task.notes || ""); }} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, background: "transparent", border: `1px solid ${tokens.border}`, color: tokens.textMute, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
                  <button onClick={handleSaveNotes} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, background: tokens.accentGhost, border: `1px solid ${tokens.accentBorder}`, color: tokens.accent, fontFamily: "inherit", fontWeight: 600, cursor: "pointer" }}>Save</button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: notes ? tokens.textSub : tokens.textMute, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {notes || "No description."}
              </div>
            )}
          </div>

          {/* Subtasks */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 10 }}>
              SUBTASKS {subtasks.length > 0 && <span style={{ color: tokens.accent }}>({subtasks.filter(s => s.completed).length}/{subtasks.length})</span>}
            </div>
            {subtasks.map((st, i) => (
              <div key={st.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                borderBottom: i < subtasks.length - 1 ? `1px solid ${tokens.border}` : "none",
              }}>
                <div
                  onClick={() => onUpdateTask(st.id, { completed: !st.completed })}
                  style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                    border: `1.5px solid ${st.completed ? tokens.green : tokens.borderStr}`,
                    background: st.completed ? tokens.green : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", transition: "all 0.2s",
                  }}
                >
                  {st.completed && <span style={{ color: "#fff", fontSize: 8, fontWeight: 700 }}>{"\u2713"}</span>}
                </div>
                <span style={{
                  fontSize: 13, color: st.completed ? tokens.textMute : tokens.text,
                  textDecoration: st.completed ? "line-through" : "none",
                  flex: 1,
                }}>{st.title}</span>
                {st.dueDate && <span style={{ fontSize: 11, color: tokens.textMute, fontFamily: "monospace" }}>{st.dueDate}</span>}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                value={newSubtask}
                onChange={e => setNewSubtask(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleAddSubtask(); }}
                placeholder="Add subtask..."
                style={{ ...inputStyle, flex: 1 }}
              />
              <button onClick={handleAddSubtask} style={{
                padding: "8px 14px", borderRadius: 8, fontSize: 12, background: tokens.surfaceAlt,
                border: `1px solid ${tokens.border}`, color: tokens.textSub, fontFamily: "inherit",
                cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", transition: "all 0.2s",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.accentBorder; e.currentTarget.style.color = tokens.accent; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.color = tokens.textSub; }}
              >+ Add</button>
            </div>
          </div>
        </div>

        {/* Right column: comments */}
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 12 }}>
            COMMENTS {comments.length > 0 && `(${comments.length})`}
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto", marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {comments.length === 0 && <div style={{ fontSize: 12, color: tokens.textMute, padding: "8px 0" }}>No comments yet.</div>}
            {comments.map(c => (
              <div key={c.id} style={{
                padding: "10px 12px", borderRadius: 10, background: tokens.surfaceAlt,
                animation: "cardIn 0.2s ease both",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: tokens.text }}>{c.author}</span>
                  <span style={{ fontSize: 10, color: tokens.textMute }}>{fmtCommentDate(c.createdAt)}</span>
                </div>
                <div style={{ fontSize: 13, color: tokens.textSub, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{c.text}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
              placeholder="Add a comment..."
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={handleAddComment} disabled={sending} style={{
              padding: "8px 14px", borderRadius: 8, fontSize: 12,
              background: newComment.trim() ? tokens.accentGhost : tokens.surfaceAlt,
              border: `1px solid ${newComment.trim() ? tokens.accentBorder : tokens.border}`,
              color: newComment.trim() ? tokens.accent : tokens.textMute,
              fontFamily: "inherit", cursor: "pointer", fontWeight: 600,
              transition: "all 0.2s", whiteSpace: "nowrap",
            }}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── My To-Do Sub-tab (Asana tasks) ─────────────────────────────────

function MyToDoPanel({ tokens, dark, tasks, onCreateTask, onUpdateTask, isLoading }) {
  const [quickAdd, setQuickAdd] = useState("");
  const [selectedTask, setSelectedTask] = useState(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + (7 - today.getDay()));

  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);

  const grouped = useMemo(() => {
    const groups = {
      overdue: [],
      today: [],
      thisWeek: [],
      later: [],
      noDueDate: [],
      oldTasks: [],
    };

    (tasks || []).forEach(task => {
      if (task.completed) return;
      if (!task.dueDate) {
        groups.noDueDate.push(task);
        return;
      }
      const due = new Date(task.dueDate);
      due.setHours(0, 0, 0, 0);
      if (due < sevenDaysAgo) {
        groups.oldTasks.push(task);
      } else if (due < today) {
        groups.overdue.push(task);
      } else if (due.getTime() === today.getTime()) {
        groups.today.push(task);
      } else if (due <= endOfWeek) {
        groups.thisWeek.push(task);
      } else {
        groups.later.push(task);
      }
    });

    // Sort each group by due date
    const sortByDue = (a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    };
    groups.overdue.sort(sortByDue);
    groups.today.sort(sortByDue);
    groups.thisWeek.sort(sortByDue);
    groups.later.sort(sortByDue);
    groups.oldTasks.sort((a, b) => b.dueDate.localeCompare(a.dueDate)); // newest old first

    return groups;
  }, [tasks, today.getTime(), endOfWeek.getTime(), sevenDaysAgo.getTime()]);

  const handleQuickAdd = () => {
    if (!quickAdd.trim()) return;
    onCreateTask({ title: quickAdd.trim(), assignee: "Mike", dueDate: new Date().toISOString().slice(0, 10) });
    setQuickAdd("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleQuickAdd();
  };

  const [showOldTasks, setShowOldTasks] = useState(false);

  const sections = [
    { key: "overdue", label: "Overdue", color: tokens.red, bg: tokens.redSoft, items: grouped.overdue },
    { key: "today", label: "Due Today", color: tokens.amber, bg: tokens.amberSoft, items: grouped.today },
    { key: "thisWeek", label: "This Week", color: tokens.blue || tokens.accent, bg: tokens.blueSoft || tokens.accentGhost, items: grouped.thisWeek },
    { key: "later", label: "Later", color: tokens.textMute, bg: tokens.surfaceAlt, items: grouped.later },
    { key: "noDueDate", label: "No Due Date", color: tokens.textMute, bg: tokens.surfaceAlt, items: grouped.noDueDate },
  ];

  if (isLoading) {
    return <SkeletonRows tokens={tokens} count={8} />;
  }

  return (
    <div>
      {/* Quick-add input */}
      <div style={{
        display: "flex", gap: 10, marginBottom: 28,
        animation: "cardIn 0.3s ease both",
      }}>
        <input
          value={quickAdd}
          onChange={e => setQuickAdd(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Quick add task..."
          style={{
            flex: 1, padding: "12px 16px", borderRadius: 10, fontSize: 14,
            background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
            color: tokens.text, fontFamily: "inherit", outline: "none",
            transition: "border-color 0.15s",
          }}
          onFocus={e => e.currentTarget.style.borderColor = tokens.accentBorder}
          onBlur={e => e.currentTarget.style.borderColor = tokens.border}
        />
        <button onClick={handleQuickAdd} style={{
          padding: "12px 22px", borderRadius: 10, fontSize: 13, cursor: "pointer",
          background: tokens.accent, border: "none", color: "#fff",
          fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap",
          opacity: quickAdd.trim() ? 1 : 0.5,
          transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
          onMouseEnter={e => { if (quickAdd.trim()) { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = tokens.accentGlow; } }}
          onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
        >+ Add</button>
      </div>

      {/* Task Detail Panel */}
      {selectedTask && (
        <div style={{ marginBottom: 24 }}>
          <TaskDetailPanel
            task={selectedTask}
            tokens={tokens}
            dark={dark}
            onUpdateTask={(id, fields) => {
              onUpdateTask(id, fields);
              setSelectedTask(prev => prev ? { ...prev, ...fields } : null);
            }}
            onClose={() => setSelectedTask(null)}
          />
        </div>
      )}

      {/* Grouped sections */}
      {sections.map(({ key, label, color, bg, items: sectionItems }) => {
        if (sectionItems.length === 0) return null;
        return (
          <div key={key} style={{ marginBottom: 28, animation: "cardIn 0.3s ease both" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
            }}>
              <div style={{
                width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0,
              }} />
              <span style={{
                fontSize: 14, fontWeight: 600, color, letterSpacing: "-0.01em",
              }}>{label}</span>
              <span style={{
                fontSize: 12, fontWeight: 600, color,
                padding: "2px 8px", borderRadius: 8, background: bg,
              }}>{sectionItems.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {sectionItems.map((task, i) => (
                <div key={task.id} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "12px 18px", borderRadius: 10,
                  background: "transparent", cursor: "pointer",
                  borderLeft: `3px solid ${color}`,
                  animation: `cardIn 0.3s ease ${i * 25}ms both`,
                  transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceEl; e.currentTarget.style.transform = "translateX(4px)"; e.currentTarget.style.boxShadow = tokens.cardShadow; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "translateX(0)"; e.currentTarget.style.boxShadow = "none"; }}
                >
                  {/* Checkbox */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateTask(task.id, { completed: true, status: "done" });
                    }}
                    style={{
                      width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                      border: `2px solid ${color}`, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = bg; e.currentTarget.style.transform = "scale(1.15)"; e.currentTarget.style.boxShadow = `0 0 12px ${color}40`; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
                  />
                  {/* Title */}
                  <div
                    onClick={(e) => { e.stopPropagation(); setSelectedTask(selectedTask?.id === task.id ? null : task); }}
                    style={{
                      flex: 1, fontSize: 14, fontWeight: 500, color: selectedTask?.id === task.id ? tokens.accent : tokens.text,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      lineHeight: "20px", cursor: "pointer", transition: "color 0.15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = tokens.accent}
                    onMouseLeave={e => { if (selectedTask?.id !== task.id) e.currentTarget.style.color = tokens.text; }}
                  >{task.title}</div>
                  {/* Project name */}
                  {task.project && (
                    <span style={{
                      fontSize: 11, fontWeight: 500, color: tokens.textMute,
                      padding: "2px 8px", borderRadius: 6,
                      background: tokens.surfaceAlt, whiteSpace: "nowrap",
                    }}>{task.project}</span>
                  )}
                  {/* Assignee */}
                  <Avatar name={task.assignee || "?"} size={20} dark={dark} />
                  {/* Due date */}
                  <span style={{
                    fontSize: 12, color: key === "overdue" ? tokens.red : tokens.textMute,
                    fontFamily: "monospace", fontWeight: key === "overdue" ? 600 : 400,
                    whiteSpace: "nowrap", minWidth: 80, textAlign: "right",
                  }}>{task.dueDate || "\u2014"}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Old Tasks (>7 days overdue) — collapsed by default */}
      {grouped.oldTasks.length > 0 && (
        <div style={{ marginBottom: 28, animation: "cardIn 0.3s ease both" }}>
          <div
            onClick={() => setShowOldTasks(p => !p)}
            style={{
              display: "flex", alignItems: "center", gap: 10, marginBottom: showOldTasks ? 12 : 0,
              cursor: "pointer", padding: "8px 0",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: showOldTasks ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            <span style={{ fontSize: 14, fontWeight: 600, color: tokens.textMute, letterSpacing: "-0.01em" }}>Old Tasks</span>
            <span style={{
              fontSize: 12, fontWeight: 600, color: tokens.textMute,
              padding: "2px 8px", borderRadius: 8, background: tokens.surfaceAlt,
            }}>{grouped.oldTasks.length}</span>
            <span style={{ fontSize: 11, color: tokens.textMute, opacity: 0.6 }}>over 7 days overdue</span>
          </div>
          {showOldTasks && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {grouped.oldTasks.map((task, i) => (
                <div key={task.id} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "12px 18px", borderRadius: 10,
                  background: "transparent", cursor: "pointer",
                  borderLeft: `3px solid ${tokens.textMute}`,
                  opacity: 0.6,
                  animation: `cardIn 0.3s ease ${i * 25}ms both`,
                  transition: "all 0.25s cubic-bezier(0.22, 1, 0.36, 1)",
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceEl; e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateX(4px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.opacity = "0.6"; e.currentTarget.style.transform = "translateX(0)"; }}
                >
                  <div
                    onClick={(e) => { e.stopPropagation(); onUpdateTask(task.id, { completed: true, status: "done" }); }}
                    style={{
                      width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                      border: `2px solid ${tokens.textMute}`, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceAlt; e.currentTarget.style.transform = "scale(1.15)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "scale(1)"; }}
                  />
                  <div
                    onClick={(e) => { e.stopPropagation(); setSelectedTask(selectedTask?.id === task.id ? null : task); }}
                    style={{
                      flex: 1, fontSize: 14, fontWeight: 500, color: tokens.textSub,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      cursor: "pointer",
                    }}
                  >{task.title}</div>
                  {task.project && (
                    <span style={{
                      fontSize: 11, fontWeight: 500, color: tokens.textMute,
                      padding: "2px 8px", borderRadius: 6,
                      background: tokens.surfaceAlt, whiteSpace: "nowrap",
                    }}>{task.project}</span>
                  )}
                  <Avatar name={task.assignee || "?"} size={20} dark={dark} />
                  <span style={{
                    fontSize: 12, color: tokens.textMute,
                    fontFamily: "monospace", whiteSpace: "nowrap", minWidth: 80, textAlign: "right",
                  }}>{task.dueDate || "\u2014"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(tasks || []).filter(t => !t.completed).length === 0 && (
        <div style={{
          padding: 60, textAlign: "center", color: tokens.textMute, fontSize: 14,
          animation: "cardIn 0.3s ease both",
        }}>
          All clear! No tasks pending.
        </div>
      )}
    </div>
  );
}

// ─── Pulse Check Sub-tab ─────────────────────────────────────────────

function PulseCheckPanel({ tokens, allClients, allReminders, actionItems, selectedSM, clientSMMap, isLoading }) {
  const clientCards = useMemo(() => {
    const clients = (allClients || []).map(c => {
      const name = c.business_name;
      const sm = c.manager || "\u2014";
      const health = typeof c.health === "number" ? c.health : (typeof c.healthScore === "number" ? c.healthScore : null);
      const lastCall = c.lastCallDate || c.lastCall || null;

      // Count open action items for this client
      const openItems = (actionItems || []).filter(
        ai => ai.client === name && ai.status === "Open"
      ).length;

      // Count reminders for this client
      const clientReminders = (allReminders || []).filter(r => r.client === name);
      const recurringTasks = clientReminders.filter(r => r.type === "recurring");
      const recurringDone = recurringTasks.filter(r => r.done || r.completed);

      return {
        name,
        sm,
        health,
        lastCall,
        openItems,
        recurringTotal: recurringTasks.length,
        recurringDone: recurringDone.length,
        remindersCount: clientReminders.length,
      };
    });

    // Filter by SM
    let filtered = clients;
    if (selectedSM) {
      filtered = clients.filter(c => clientSMMap[c.business_name] === selectedSM);
    }

    // Sort by health ascending (worst first), nulls at end
    filtered.sort((a, b) => {
      if (a.health === null && b.health === null) return 0;
      if (a.health === null) return 1;
      if (b.health === null) return -1;
      return a.health - b.health;
    });

    return filtered;
  }, [allClients, allReminders, actionItems, selectedSM, clientSMMap]);

  const getHealthColor = (health) => {
    if (health === null || health === undefined) return tokens.textMute;
    if (health >= 75) return tokens.green;
    if (health >= 50) return tokens.amber;
    return tokens.red;
  };

  const getHealthBg = (health) => {
    if (health === null || health === undefined) return tokens.surfaceAlt;
    if (health >= 75) return tokens.greenSoft;
    if (health >= 50) return tokens.amberSoft;
    return tokens.redSoft;
  };

  const getHealthBorder = (health) => {
    if (health === null || health === undefined) return tokens.border;
    if (health >= 75) return tokens.green + "44";
    if (health >= 50) return tokens.amber + "44";
    return tokens.red + "44";
  };

  if (isLoading) {
    return <SkeletonCards tokens={tokens} count={8} />;
  }

  return (
    <div>
      {/* Summary bar */}
      <div style={{
        display: "flex", gap: 16, marginBottom: 28, flexWrap: "wrap",
        animation: "cardIn 0.3s ease both",
      }}>
        {[
          { label: "TOTAL CLIENTS", value: clientCards.length, color: tokens.text },
          { label: "NEEDS ATTENTION", value: clientCards.filter(c => c.health !== null && c.health < 50).length, color: tokens.red },
          { label: "MODERATE", value: clientCards.filter(c => c.health !== null && c.health >= 50 && c.health < 75).length, color: tokens.amber },
          { label: "HEALTHY", value: clientCards.filter(c => c.health !== null && c.health >= 75).length, color: tokens.green },
        ].map(stat => (
          <div key={stat.label} style={{
            background: tokens.surfaceEl, borderRadius: 14, padding: "16px 24px",
            border: `1px solid ${tokens.border}`, minWidth: 120,
            transition: "all 0.15s ease",
          }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: stat.color, letterSpacing: "-0.03em", lineHeight: 1 }}>{stat.value}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, marginTop: 6, letterSpacing: "0.04em" }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Client cards grid */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 14,
      }}>
        {clientCards.map((client, i) => (
          <div key={client.name} style={{
            background: tokens.surfaceEl, borderRadius: 14,
            padding: "20px 22px",
            border: `1px solid ${getHealthBorder(client.health)}`,
            borderLeft: `4px solid ${getHealthColor(client.health)}`,
            animation: `cardIn 0.3s ease ${i * 30}ms both`,
            transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
            cursor: "default",
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px) scale(1.01)"; e.currentTarget.style.boxShadow = tokens.cardHover; e.currentTarget.style.borderColor = getHealthColor(client.health) + "66"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0) scale(1)"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = getHealthBorder(client.health); }}
          >
            {/* Header: name + health */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {client.name}
              </div>
              <div style={{
                fontSize: 16, fontWeight: 700, color: getHealthColor(client.health),
                padding: "4px 12px", borderRadius: 10,
                background: getHealthBg(client.health),
                flexShrink: 0, marginLeft: 10,
              }}>
                {client.health !== null ? `${client.health}%` : "\u2014"}
              </div>
            </div>

            {/* SM */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>SM</span>
              <span style={{ fontSize: 13, color: tokens.textSub, fontWeight: 500 }}>{client.sm}</span>
            </div>

            {/* Stats row */}
            <div style={{
              display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12,
            }}>
              <div style={{
                padding: "6px 10px", borderRadius: 8, background: tokens.surfaceAlt,
                fontSize: 12, color: tokens.textSub, display: "flex", alignItems: "center", gap: 4,
              }}>
                <span style={{ fontWeight: 600, color: client.openItems > 0 ? tokens.amber : tokens.green }}>{client.openItems}</span>
                <span>open items</span>
              </div>
              {client.recurringTotal > 0 && (
                <div style={{
                  padding: "6px 10px", borderRadius: 8, background: tokens.surfaceAlt,
                  fontSize: 12, color: tokens.textSub, display: "flex", alignItems: "center", gap: 4,
                }}>
                  <span style={{ fontWeight: 600, color: client.recurringDone === client.recurringTotal ? tokens.green : tokens.amber }}>
                    {client.recurringDone}/{client.recurringTotal}
                  </span>
                  <span>recurring</span>
                </div>
              )}
            </div>

            {/* Last call */}
            <div style={{
              fontSize: 12, color: tokens.textMute, display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ fontWeight: 600, letterSpacing: "0.02em" }}>Last call:</span>
              <span style={{ fontFamily: "monospace" }}>{client.lastCall || "\u2014"}</span>
            </div>
          </div>
        ))}
      </div>

      {clientCards.length === 0 && (
        <div style={{
          padding: 60, textAlign: "center", color: tokens.textMute, fontSize: 14,
          animation: "cardIn 0.3s ease both",
        }}>
          No clients to show. {selectedSM ? `No clients assigned to ${selectedSM}.` : ""}
        </div>
      )}
    </div>
  );
}

// ─── SM Filter Dropdown ──────────────────────────────────────────────

function SMFilterDropdown({ tokens, selectedSM, onSelect }) {
  return (
    <select
      value={selectedSM || ""}
      onChange={e => onSelect(e.target.value || null)}
      style={{
        padding: "8px 16px", borderRadius: 8, fontSize: 13,
        background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
        color: selectedSM ? tokens.accent : tokens.textMute,
        fontFamily: "inherit", fontWeight: selectedSM ? 600 : 400,
        cursor: "pointer", outline: "none",
        transition: "all 0.12s",
        minWidth: 140,
      }}
    >
      <option value="">All SMs</option>
      {SM_OPTIONS.map(sm => (
        <option key={sm} value={sm}>{sm}</option>
      ))}
    </select>
  );
}

// ─── Main Unified View ──────────────────────────────────────────────

export default function UnifiedTasksView({ tokens, dark, tasks, onCreateTask, onUpdateTask, allReminders, onboardingClients, activeClients, onFilterSM, currentUser }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("my-todo");
  const defaultSM = useMemo(() => {
    if (!currentUser) return null;
    const first = String(currentUser).trim().split(/\s+/)[0];
    return SM_OPTIONS.find(sm => sm.toLowerCase() === first.toLowerCase()) || null;
  }, [currentUser]);
  const [selectedSM, setSelectedSM] = useState(defaultSM);

  const allClients = useMemo(() => [...(onboardingClients || []), ...(activeClients || [])], [onboardingClients, activeClients]);

  // Build client-to-SM map for filtering
  const clientSMMap = useMemo(() => {
    const map = {};
    allClients.forEach(c => { if (c.manager) map[c.business_name] = c.manager; });
    return map;
  }, [allClients]);

  // Sync initial default SM to parent
  useEffect(() => {
    if (defaultSM && onFilterSM) onFilterSM(defaultSM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSM]);

  // Handle SM filter change
  const handleSMChange = (sm) => {
    setSelectedSM(sm);
    if (onFilterSM) onFilterSM(sm);
  };

  // Filter reminders by SM
  const filteredReminders = useMemo(() => {
    if (!selectedSM) return allReminders || [];
    return (allReminders || []).filter(r => clientSMMap[r.client] === selectedSM);
  }, [allReminders, selectedSM, clientSMMap]);

  // Filter tasks by SM (assignee)
  const filteredTasks = useMemo(() => {
    if (!selectedSM) return tasks || [];
    return (tasks || []).filter(t => t.assignee === selectedSM);
  }, [tasks, selectedSM]);

  // Determine loading states
  const tasksLoading = !tasks;
  const remindersLoading = !allReminders;

  // Fetch action items for Pulse Check
  const [actionItems, setActionItems] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetchActionItems().then(({ data }) => {
      if (!cancelled && data) setActionItems(data);
    });
    return () => { cancelled = true; };
  }, []);

  const topTabs = [
    { key: "my-todo", label: "My To-Do", count: (() => {
      const now = new Date();
      const sevenAgo = new Date(); sevenAgo.setDate(now.getDate() - 7);
      const threeOut = new Date(); threeOut.setDate(now.getDate() + 3);
      const s7 = sevenAgo.toISOString().split("T")[0];
      const s3 = threeOut.toISOString().split("T")[0];
      return (filteredTasks || []).filter(t => !t.completed && t.dueDate && t.dueDate >= s7 && t.dueDate <= s3).length;
    })() },
    { key: "for-clients", label: "For Clients" },
    { key: "pulse-check", label: "Pulse Check" },
  ];

  return (
    <div>
      {/* Header: title + SM filter dropdown */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 20,
      }}>
        <div style={{ flex: 1 }} />
        <SMFilterDropdown tokens={tokens} selectedSM={selectedSM} onSelect={handleSMChange} />
      </div>

      {/* Top-level sub-tab bar */}
      <div style={{ display: "flex", gap: 4, background: tokens.surfaceAlt, borderRadius: 12, padding: 4, marginBottom: 24, overflowX: isMobile ? "auto" : "visible", whiteSpace: isMobile ? "nowrap" : "normal", WebkitOverflowScrolling: "touch" }}>
        {topTabs.map(t => {
          const isActive = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: isMobile ? "8px 14px" : "10px 24px", borderRadius: 9, fontSize: isMobile ? 13 : 14, cursor: "pointer",
              background: isActive ? tokens.surfaceEl : "transparent",
              border: "none", color: isActive ? tokens.text : tokens.textMute,
              fontFamily: "inherit", fontWeight: isActive ? 600 : 400,
              transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
              boxShadow: isActive ? `0 2px 8px rgba(0,0,0,0.12), ${tokens.accentGlow}` : "none",
              display: "flex", alignItems: "center", gap: 8,
              position: "relative",
            }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.color = tokens.textSub; e.currentTarget.style.background = tokens.surfaceHov; } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.color = tokens.textMute; e.currentTarget.style.background = "transparent"; } }}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: isActive ? tokens.accent : tokens.textMute,
                  padding: "1px 7px", borderRadius: 8,
                  background: isActive ? tokens.accentGhost : tokens.surfaceAlt,
                  transition: "all 0.2s",
                }}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Panel content */}
      {tab === "my-todo" && (
        <MyToDoPanel
          tokens={tokens}
          dark={dark}
          tasks={filteredTasks}
          onCreateTask={onCreateTask}
          onUpdateTask={onUpdateTask}
          isLoading={tasksLoading}
        />
      )}
      {tab === "for-clients" && (
        <ActionItemsPanel
          tokens={tokens}
          dark={dark}
          selectedSM={selectedSM}
          clientSMMap={clientSMMap}
        />
      )}
      {tab === "pulse-check" && (
        <PulseCheckPanel
          tokens={tokens}
          allClients={allClients}
          allReminders={filteredReminders}
          actionItems={actionItems}
          selectedSM={selectedSM}
          clientSMMap={clientSMMap}
          isLoading={remindersLoading && allClients.length === 0}
        />
      )}

      {/* Inject pulse animation keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
