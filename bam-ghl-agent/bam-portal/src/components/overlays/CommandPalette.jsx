import { useState, useRef, useEffect } from "react";
import { statusColor } from '../../tokens/tokens';
import Avatar from '../primitives/Avatar';

const NAV_COMMANDS = [
  { label: "Dashboard", key: "dashboard", type: "navigate" },
  { label: "Clients", key: "clients", type: "navigate" },
  { label: "Tasks", key: "tasks", type: "navigate" },
  { label: "Calendar", key: "calendar", type: "navigate" },
  { label: "Knowledge Base", key: "knowledge", type: "navigate" },
  { label: "Financials", key: "financials", type: "navigate" },
];

export default function CommandPalette({ tokens, dark, onClose, allClients, onNavigate, actionItems = [], sopCategories = [] }) {
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const lq = q.toLowerCase();

  // Client results
  const clientResults = q
    ? allClients.filter(c => c.name.toLowerCase().includes(lq))
    : allClients.slice(0, 4);

  // Action item results
  const actionResults = q
    ? actionItems.filter(a => a.action.toLowerCase().includes(lq) || a.client.toLowerCase().includes(lq))
    : [];

  // SOP results
  const sopResults = q
    ? sopCategories.filter(s => s.label.toLowerCase().includes(lq))
    : [];

  // Navigation results — always show matching, or all if no query
  const navResults = q
    ? NAV_COMMANDS.filter(n => n.label.toLowerCase().includes(lq))
    : NAV_COMMANDS;

  const hasResults = clientResults.length || actionResults.length || sopResults.length || navResults.length;

  const sectionHeader = (label) => (
    <div style={{
      fontSize: 11, fontWeight: 600, color: tokens.textMute, textTransform: "uppercase",
      letterSpacing: "0.06em", padding: "10px 22px 4px",
    }}>{label}</div>
  );

  const typeLabel = (text) => (
    <span style={{
      fontSize: 10, fontWeight: 600, color: tokens.textMute, textTransform: "uppercase",
      letterSpacing: "0.04em", padding: "2px 7px", borderRadius: 4,
      background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
    }}>{text}</span>
  );

  const rowStyle = {
    display: "flex", alignItems: "center", gap: 14, padding: "12px 22px",
    borderBottom: `1px solid ${tokens.border}`, cursor: "pointer", transition: "background 0.1s",
  };

  const handleHover = (e, on) => {
    e.currentTarget.style.background = on ? tokens.surfaceHov : "transparent";
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: dark ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.25)",
      display: "flex",
      alignItems: "flex-start", justifyContent: "center",
      paddingTop: 120, backdropFilter: "blur(12px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 560, background: tokens.surface,
        border: `1px solid ${tokens.borderMed}`, borderRadius: 16,
        boxShadow: `0 32px 80px rgba(0,0,0,${dark ? 0.5 : 0.18})`,
        overflow: "hidden", maxHeight: "70vh", display: "flex", flexDirection: "column",
      }}>
        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "22px 24px", borderBottom: `1px solid ${tokens.border}`, flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input ref={ref} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search clients, tasks, SOPs, or navigate\u2026"
            style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 18, color: tokens.text, fontFamily: "inherit", fontWeight: 400 }}
          />
          <span style={{ fontSize: 11, color: tokens.textMute, fontFamily: "inherit", padding: "3px 8px", borderRadius: 5, border: `1px solid ${tokens.border}`, letterSpacing: "0.03em" }}>ESC</span>
        </div>

        {/* Scrollable results */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {!hasResults && (
            <div style={{ padding: "24px 22px", textAlign: "center", color: tokens.textMute, fontSize: 14 }}>
              No results found
            </div>
          )}

          {/* Clients */}
          {clientResults.length > 0 && (
            <>
              {sectionHeader("Clients")}
              {clientResults.map((client, i) => (
                <div key={`client-${i}`} style={rowStyle}
                  onMouseEnter={e => handleHover(e, true)}
                  onMouseLeave={e => handleHover(e, false)}
                >
                  <Avatar name={client.manager} size={28} dark={dark} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: tokens.text }}>{client.name}</div>
                    <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 1 }}>{client.manager}</div>
                  </div>
                  {typeLabel("Client")}
                  <span style={{ fontSize: 14, fontWeight: 700, color: statusColor(client.healthStatus, tokens) }}>{client.health}</span>
                </div>
              ))}
            </>
          )}

          {/* Action Items */}
          {actionResults.length > 0 && (
            <>
              {sectionHeader("Action Items")}
              {actionResults.slice(0, 6).map((item, i) => (
                <div key={`action-${i}`} style={rowStyle}
                  onMouseEnter={e => handleHover(e, true)}
                  onMouseLeave={e => handleHover(e, false)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={item.urgency === "Urgent" ? tokens.red || "#e74c3c" : tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                  </svg>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: tokens.text }}>{item.action}</div>
                    <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 1 }}>{item.client}</div>
                  </div>
                  {typeLabel("Action Item")}
                </div>
              ))}
            </>
          )}

          {/* SOPs */}
          {sopResults.length > 0 && (
            <>
              {sectionHeader("SOPs")}
              {sopResults.map((sop, i) => (
                <div key={`sop-${i}`} style={rowStyle}
                  onMouseEnter={e => handleHover(e, true)}
                  onMouseLeave={e => handleHover(e, false)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: tokens.text }}>{sop.label}</div>
                  </div>
                  {typeLabel("SOP")}
                </div>
              ))}
            </>
          )}

          {/* Navigation */}
          {navResults.length > 0 && (
            <>
              {sectionHeader("Navigate")}
              {navResults.map((nav, i) => (
                <div key={`nav-${i}`} style={rowStyle}
                  onClick={() => { onNavigate?.(nav.key); onClose?.(); }}
                  onMouseEnter={e => handleHover(e, true)}
                  onMouseLeave={e => handleHover(e, false)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: tokens.text }}>{nav.label}</div>
                  </div>
                  {typeLabel("Navigate")}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
