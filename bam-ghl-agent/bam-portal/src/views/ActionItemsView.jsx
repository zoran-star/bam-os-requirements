import { useState, useEffect, useMemo } from "react";
import { fetchActionItems, createActionItem, updateActionItem } from "../services/notionService";

const CATEGORIES = ["Digital Marketing", "Systems", "Content", "Operations", "General"];
const OWNERS = ["SM", "Client", "Both"];
const URGENCIES = ["Urgent", "Standard"];
const STATUSES = ["Open", "Done"];

function Badge({ label, color, bg }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
      padding: "3px 8px", borderRadius: 5, color, background: bg,
      whiteSpace: "nowrap",
    }}>{label}</span>
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
      {/* Total open */}
      <div style={{
        background: tokens.surfaceEl, borderRadius: 14, padding: "20px 28px",
        border: `1px solid ${tokens.border}`, minWidth: 140, flex: "0 0 auto",
        transition: "all 0.15s ease",
      }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.borderColor = tokens.borderStr; }}
        onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = tokens.border; }}
      >
        <div style={{ fontSize: 32, fontWeight: 700, color: tokens.text, letterSpacing: "-0.03em", lineHeight: 1 }}>{open.length}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginTop: 6, letterSpacing: "0.04em" }}>OPEN ITEMS</div>
      </div>
      {/* Urgent */}
      <div style={{
        background: tokens.surfaceEl, borderRadius: 14, padding: "20px 28px",
        border: `1px solid ${tokens.border}`, minWidth: 120, flex: "0 0 auto",
        transition: "all 0.15s ease",
      }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.borderColor = tokens.borderStr; }}
        onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = tokens.border; }}
      >
        <div style={{ fontSize: 32, fontWeight: 700, color: tokens.red, letterSpacing: "-0.03em", lineHeight: 1 }}>{urgent.length}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginTop: 6, letterSpacing: "0.04em" }}>URGENT</div>
      </div>
      {/* Category breakdown */}
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
          display: "flex", alignItems: "center", gap: 16,
          padding: "14px 20px", cursor: "pointer",
          background: expanded ? tokens.surfaceAlt : "transparent",
          borderRadius: expanded ? "12px 12px 0 0" : 12,
          borderLeft,
          transition: "all 0.15s",
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = tokens.surfaceEl; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = "transparent"; }}
      >
        {/* Action */}
        <div style={{ flex: 2, minWidth: 0, fontSize: 14, fontWeight: 500, color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.action}
        </div>
        {/* Client (conditional) */}
        {showClient && (
          <div style={{ width: 140, minWidth: 140, flexShrink: 0, fontSize: 13, color: tokens.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.client}
          </div>
        )}
        {/* Status */}
        <div style={{ width: 70, flexShrink: 0 }}>
          <Badge label={item.status} color={statusColor} bg={statusBg} />
        </div>
        {/* Urgency */}
        <div style={{ width: 80, flexShrink: 0 }}>
          <Badge label={item.urgency} color={urgColor} bg={urgBg} />
        </div>
        {/* Category */}
        <div style={{ width: 120, flexShrink: 0, fontSize: 12, color: tokens.textMute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.category}
        </div>
        {/* Owner */}
        <div style={{ width: 60, flexShrink: 0, fontSize: 12, fontWeight: 600, color: item.owner === "SM" ? tokens.accent : item.owner === "Client" ? tokens.blue : tokens.textSub }}>
          {item.owner}
        </div>
        {/* Reminder */}
        <div style={{ width: 90, flexShrink: 0, fontSize: 12, color: tokens.textMute, fontFamily: "monospace" }}>
          {item.reminderDate}
        </div>
        {/* Chevron */}
        <div style={{ fontSize: 14, color: expanded ? tokens.accent : tokens.textMute, transition: "all 0.12s", transform: expanded ? "rotate(90deg)" : "rotate(0)", flexShrink: 0 }}>{"\u2192"}</div>
      </div>

      {/* Expanded detail */}
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

export default function ActionItemsView({ tokens, dark }) {
  const [subTab, setSubTab] = useState("by-client");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedItem, setExpandedItem] = useState(null);

  // Load from Notion service on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchActionItems().then(({ data, error }) => {
      if (!cancelled && data) setItems(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);
  const [collapsedClients, setCollapsedClients] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  // Filters
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
      return true;
    });
  }, [items, filterStatus, filterUrgency, filterCategory, filterOwner]);

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

  const subTabs = [
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
    transition: "all 0.12s", whiteSpace: "nowrap",
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
      display: "flex", alignItems: "center", gap: 16,
      padding: "10px 20px", marginBottom: 4,
    }}>
      <div style={{ flex: 2, minWidth: 0, ...colHeaderStyle("action") }} onClick={() => handleSort("action")}>
        ACTION {sortCol === "action" ? (sortAsc ? "\u2191" : "\u2193") : ""}
      </div>
      {subTab !== "by-client" && (
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
      {/* Header row: sub-tabs + add button */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 24 }}>
        {/* Sub-tab bar */}
        <div style={{ display: "flex", gap: 4, flex: 1 }}>
          {subTabs.map(t => (
            <button key={t.key} onClick={() => setSubTab(t.key)} style={{
              padding: "10px 22px", borderRadius: 8, fontSize: 14, cursor: "pointer",
              background: subTab === t.key ? tokens.accentGhost : "transparent",
              border: "none", color: subTab === t.key ? tokens.accent : tokens.textMute,
              fontFamily: "inherit", fontWeight: subTab === t.key ? 600 : 400,
              textTransform: "uppercase", letterSpacing: "0.04em", transition: "all 0.12s",
            }}>{t.label}</button>
          ))}
        </div>
        {/* Add button */}
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

        {/* Status */}
        {STATUSES.map(s => (
          <button key={s} onClick={() => toggleFilter(filterStatus, s, setFilterStatus)} style={pillStyle(filterStatus === s)}>{s}</button>
        ))}
        <span style={{ width: 1, height: 18, background: tokens.border, margin: "0 4px" }} />

        {/* Urgency */}
        {URGENCIES.map(u => (
          <button key={u} onClick={() => toggleFilter(filterUrgency, u, setFilterUrgency)} style={pillStyle(filterUrgency === u)}>{u}</button>
        ))}
        <span style={{ width: 1, height: 18, background: tokens.border, margin: "0 4px" }} />

        {/* Category */}
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => toggleFilter(filterCategory, c, setFilterCategory)} style={pillStyle(filterCategory === c)}>{c}</button>
        ))}
        <span style={{ width: 1, height: 18, background: tokens.border, margin: "0 4px" }} />

        {/* Owner */}
        {OWNERS.map(o => (
          <button key={o} onClick={() => toggleFilter(filterOwner, o, setFilterOwner)} style={pillStyle(filterOwner === o)}>{o}</button>
        ))}

        {/* Clear all */}
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
      {subTab === "by-client" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {byClient.map(([client, clientItems], ci) => {
            const collapsed = collapsedClients[client];
            const openCount = clientItems.filter(i => i.status === "Open").length;
            return (
              <div key={client} style={{ animation: `cardIn 0.3s ease ${ci * 40}ms both` }}>
                {/* Client header */}
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
                {/* Client items */}
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
      {subTab === "all-items" && (
        <div>
          {renderColumnHeaders()}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {sorted.map((item, i) => (
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
      {subTab === "my-items" && (
        <div>
          {renderColumnHeaders()}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {myItems.map((item, i) => (
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
