import { useState, useEffect, useMemo } from "react";
import { fetchLocations, fetchContacts, fetchConversations, fetchPipelines } from "../services/ghlService";
import Avatar from "../components/primitives/Avatar";

function getInitials(name) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMessageTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/* ───── Summary Stats Bar ───── */
function StatsBar({ tokens, leads, conversations }) {
  const totalLeads = leads.length;
  const unread = conversations.reduce((s, c) => s + c.unreadCount, 0);
  const won = leads.filter(l => l.stage === "Won").length;
  const lost = leads.filter(l => l.stage === "Lost").length;
  const conversion = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const newThisWeek = leads.filter(l => new Date(l.createdAt) >= weekAgo).length;

  const stats = [
    { label: "Total Leads", value: totalLeads },
    { label: "Unread Messages", value: unread, color: unread > 0 ? tokens.amber : undefined },
    { label: "Pipeline Conversion", value: `${conversion}%`, color: tokens.green },
    { label: "New This Week", value: newThisWeek, color: tokens.accent },
  ];

  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 28 }}>
      {stats.map((s, i) => (
        <div key={i} style={{
          flex: 1, padding: "18px 22px", borderRadius: 14,
          background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
          animation: `cardIn 0.3s ease ${i * 50}ms both`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 8 }}>{s.label.toUpperCase()}</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: s.color || tokens.text, letterSpacing: "-0.03em" }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ───── Conversations Tab ───── */
function ConversationsPanel({ tokens, dark, conversations, leads }) {
  const sorted = useMemo(() =>
    [...conversations].sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp)),
  [conversations]);

  const [selectedId, setSelectedId] = useState(null);
  const [localConvos, setLocalConvos] = useState(sorted);
  const [compose, setCompose] = useState("");

  // Reset when conversations prop changes (location switch)
  useEffect(() => {
    const s = [...conversations].sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp));
    setLocalConvos(s);
    setSelectedId(s[0]?.id || null);
  }, [conversations]);

  const selected = localConvos.find(c => c.id === selectedId);

  const handleSend = () => {
    if (!compose.trim() || !selectedId) return;
    const newMsg = {
      id: `m-local-${Date.now()}`,
      direction: "outbound",
      body: compose.trim(),
      timestamp: new Date().toISOString(),
      status: "sent",
      type: "whatsapp",
    };
    setLocalConvos(prev => prev.map(c =>
      c.id === selectedId
        ? { ...c, messages: [...c.messages, newMsg], lastMessage: newMsg.body, lastTimestamp: newMsg.timestamp }
        : c
    ));
    setCompose("");
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 300px)", minHeight: 480, borderRadius: 16, overflow: "hidden", border: `1px solid ${tokens.border}`, animation: "cardIn 0.3s ease both" }}>
      {/* Left — conversation list */}
      <div style={{ width: 320, minWidth: 320, borderRight: `1px solid ${tokens.border}`, overflowY: "auto", background: tokens.surface }}>
        {localConvos.map(c => {
          const isActive = c.id === selectedId;
          const lead = leads.find(l => l.id === c.contactId);
          return (
            <div key={c.id} onClick={() => setSelectedId(c.id)} style={{
              display: "flex", gap: 12, padding: "16px 18px", cursor: "pointer",
              background: isActive ? tokens.accentGhost : "transparent",
              borderBottom: `1px solid ${tokens.border}`,
              transition: "background 0.12s",
            }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = tokens.surfaceHov; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = isActive ? tokens.accentGhost : "transparent"; }}
            >
              {/* Avatar circle */}
              <div style={{
                width: 40, height: 40, borderRadius: 20, flexShrink: 0,
                background: tokens.accentGhost, border: `1px solid ${tokens.accentBorder}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 600, color: tokens.accent,
              }}>{getInitials(c.clientName)}</div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{c.clientName}</span>
                  <span style={{ fontSize: 11, color: tokens.textMute, flexShrink: 0 }}>{formatTime(c.lastTimestamp)}</span>
                </div>
                <div style={{ fontSize: 12, color: tokens.textMute, marginBottom: 2 }}>{c.client}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    fontSize: 13, color: tokens.textSub, flex: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{c.lastMessage}</span>
                  {c.unreadCount > 0 && (
                    <span style={{
                      minWidth: 20, height: 20, borderRadius: 10, flexShrink: 0,
                      background: tokens.accent, color: "#08080A",
                      fontSize: 11, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      padding: "0 6px",
                    }}>{c.unreadCount}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Right — message thread */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: tokens.bg }}>
        {selected ? (
          <>
            {/* Thread header */}
            <div style={{
              padding: "18px 24px", borderBottom: `1px solid ${tokens.border}`,
              display: "flex", alignItems: "center", gap: 12, background: tokens.surface,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 18, flexShrink: 0,
                background: tokens.accentGhost, border: `1px solid ${tokens.accentBorder}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 600, color: tokens.accent,
              }}>{getInitials(selected.clientName)}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text }}>{selected.clientName}</div>
                <div style={{ fontSize: 12, color: tokens.textMute }}>{selected.client}</div>
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px", display: "flex", flexDirection: "column", gap: 10 }}>
              {selected.messages.map(msg => {
                const isOut = msg.direction === "outbound";
                return (
                  <div key={msg.id} style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start" }}>
                    <div style={{
                      maxWidth: "65%", padding: "12px 16px", borderRadius: 14,
                      background: isOut ? tokens.accentGhost : tokens.surfaceEl,
                      border: `1px solid ${isOut ? tokens.accentBorder : tokens.border}`,
                    }}>
                      <div style={{ fontSize: 14, color: tokens.text, lineHeight: 1.55 }}>{msg.body}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, justifyContent: "flex-end" }}>
                        <span style={{ fontSize: 11, color: tokens.textMute }}>{formatMessageTime(msg.timestamp)}</span>
                        {isOut && (
                          <span style={{
                            fontSize: 11, fontWeight: 500,
                            color: msg.status === "read" ? tokens.accent : msg.status === "delivered" ? tokens.blue : tokens.textMute,
                          }}>
                            {msg.status === "read" ? "\u2713\u2713" : msg.status === "delivered" ? "\u2713\u2713" : "\u2713"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Compose bar */}
            <div style={{
              padding: "14px 20px", borderTop: `1px solid ${tokens.border}`,
              display: "flex", gap: 10, alignItems: "center", background: tokens.surface,
            }}>
              <input
                value={compose}
                onChange={e => setCompose(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Type a message..."
                style={{
                  flex: 1, padding: "12px 16px", borderRadius: 10,
                  background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
                  color: tokens.text, fontSize: 14, fontFamily: "inherit", outline: "none",
                }}
              />
              <button onClick={handleSend} style={{
                padding: "12px 24px", borderRadius: 10, border: "none", cursor: "pointer",
                background: tokens.accent, color: "#08080A", fontSize: 14,
                fontWeight: 600, fontFamily: "inherit", transition: "opacity 0.12s",
                opacity: compose.trim() ? 1 : 0.5,
              }}>Send</button>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: tokens.textMute, fontSize: 14 }}>
            Select a conversation
          </div>
        )}
      </div>
    </div>
  );
}

/* ───── Pipeline Tab (Kanban) ───── */
function PipelinePanel({ tokens, leads, pipelineStages }) {
  return (
    <div style={{ display: "flex", gap: 14, overflowX: "auto", animation: "cardIn 0.3s ease both" }}>
      {pipelineStages.map((stage, ci) => {
        const cards = leads.filter(l => l.stage === stage);
        const isDimmed = stage === "Won" || stage === "Lost";
        return (
          <div key={stage} style={{ flex: 1, minWidth: 180, opacity: isDimmed ? 0.6 : 1, transition: "opacity 0.2s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "0 4px" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: tokens.textMute }}>{stage}</span>
              <span style={{ fontSize: 12, color: tokens.textMute }}>{cards.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 120 }}>
              {cards.map((lead, ti) => (
                <div key={lead.id} style={{
                  background: tokens.surfaceEl, borderRadius: 12,
                  padding: "16px 18px", border: `1px solid ${tokens.border}`,
                  transition: "all 0.15s",
                  animation: `cardIn 0.3s ease ${ti * 40}ms both`,
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceHov; e.currentTarget.style.borderColor = tokens.borderStr; }}
                  onMouseLeave={e => { e.currentTarget.style.background = tokens.surfaceEl; e.currentTarget.style.borderColor = tokens.border; }}
                >
                  <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text, marginBottom: 4, letterSpacing: "-0.01em" }}>{lead.name}</div>
                  <div style={{ fontSize: 13, color: tokens.textSub, marginBottom: 10 }}>{lead.client}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
                      padding: "3px 8px", borderRadius: 5,
                      color: tokens.textSub, background: tokens.surfaceAlt,
                    }}>{lead.source}</span>
                    <div style={{ flex: 1 }} />
                    <Avatar name={lead.assignedSM} size={22} />
                  </div>
                  <div style={{ fontSize: 11, color: tokens.textMute, marginTop: 10 }}>{lead.lastActivity}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───── Contacts Tab (Table) ───── */
function ContactsPanel({ tokens, leads }) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const filtered = useMemo(() => {
    if (!search) return leads;
    const q = search.toLowerCase();
    return leads.filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.email.toLowerCase().includes(q) ||
      l.phone.includes(q) ||
      l.client.toLowerCase().includes(q) ||
      l.source.toLowerCase().includes(q) ||
      l.stage.toLowerCase().includes(q)
    );
  }, [search, leads]);

  function stageBadge(stage) {
    const color = stage === "Won" ? tokens.green : stage === "Lost" ? tokens.red : tokens.accent;
    const bg = stage === "Won" ? tokens.greenSoft : stage === "Lost" ? tokens.redSoft : tokens.accentGhost;
    return { color, background: bg, padding: "3px 10px", borderRadius: 5, fontSize: 12, fontWeight: 600 };
  }

  const cols = ["NAME", "PHONE", "EMAIL", "SOURCE", "STAGE", "SM", "LAST ACTIVITY"];

  return (
    <div style={{ animation: "cardIn 0.3s ease both" }}>
      {/* Search */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 20px",
        background: tokens.surfaceEl, borderRadius: 12, marginBottom: 20,
        border: `1px solid ${tokens.border}`,
      }}>
        <span style={{ fontSize: 14, color: tokens.textMute }}>{"\u2315"}</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search leads..."
          style={{
            flex: 1, background: "none", border: "none", outline: "none",
            fontSize: 14, color: tokens.text, fontFamily: "inherit",
          }}
        />
      </div>

      {/* Table header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1.4fr 1fr 1.4fr 0.8fr 0.8fr 0.5fr 0.8fr",
        gap: 12, padding: "10px 20px", marginBottom: 4,
      }}>
        {cols.map(c => (
          <span key={c} style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.06em" }}>{c}</span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {filtered.map((lead, ri) => {
          const expanded = expandedId === lead.id;
          return (
            <div key={lead.id} style={{ animation: `cardIn 0.3s ease ${ri * 30}ms both` }}>
              <div
                onClick={() => setExpandedId(expanded ? null : lead.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1fr 1.4fr 0.8fr 0.8fr 0.5fr 0.8fr",
                  gap: 12, padding: "14px 20px", cursor: "pointer",
                  alignItems: "center", borderRadius: expanded ? "12px 12px 0 0" : 12,
                  background: expanded ? tokens.surfaceAlt : "transparent",
                  transition: "background 0.12s",
                }}
                onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = tokens.surfaceEl; }}
                onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = expanded ? tokens.surfaceAlt : "transparent"; }}
              >
                <span style={{ fontSize: 14, fontWeight: 600, color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.name}</span>
                <span style={{ fontSize: 13, color: tokens.textSub, fontFamily: "monospace" }}>{lead.phone}</span>
                <span style={{ fontSize: 13, color: tokens.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.email}</span>
                <span style={{
                  fontSize: 12, fontWeight: 500, color: tokens.textMute,
                  padding: "3px 8px", borderRadius: 5, background: tokens.surfaceEl,
                  textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{lead.source}</span>
                <span style={stageBadge(lead.stage)}>{lead.stage}</span>
                <Avatar name={lead.assignedSM} size={24} />
                <span style={{ fontSize: 12, color: tokens.textMute }}>{lead.lastActivity}</span>
              </div>

              {/* Expanded notes */}
              {expanded && (
                <div style={{
                  background: tokens.surfaceEl, borderRadius: "0 0 12px 12px",
                  padding: "16px 24px", borderTop: `1px solid ${tokens.border}`,
                  animation: "cardIn 0.2s ease both",
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 8 }}>NOTES</div>
                  <div style={{ fontSize: 14, color: tokens.textSub, lineHeight: 1.7 }}>{lead.notes}</div>
                  <div style={{ display: "flex", gap: 20, marginTop: 14 }}>
                    <span style={{ fontSize: 12, color: tokens.textMute }}>Created: {lead.createdAt}</span>
                    <span style={{ fontSize: 12, color: tokens.textMute }}>Client: {lead.client}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───── Main View ───── */
export default function LeadsCRMView({ tokens, dark }) {
  const [subTab, setSubTab] = useState("conversations");
  const subTabs = ["conversations", "pipeline", "contacts"];

  // Location selector state
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [loadingLocations, setLoadingLocations] = useState(true);

  // Live data state
  const [leads, setLeads] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [pipelineStages, setPipelineStages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isMock, setIsMock] = useState(true);

  // Fetch locations on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingLocations(true);
      const { data } = await fetchLocations();
      if (!cancelled) {
        setLocations(data || []);
        // Default to "By Any Means Business" (internal CRM), fallback to first
        const preferred = data?.find(l => l.name === "By Any Means Business");
        if (preferred) setSelectedLocation(preferred.name);
        else if (data && data.length > 0) setSelectedLocation(data[0].name);
        setLoadingLocations(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch contacts, conversations, pipelines when location changes
  useEffect(() => {
    if (!selectedLocation) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const [contactsRes, convosRes, pipelinesRes] = await Promise.all([
        fetchContacts(selectedLocation),
        fetchConversations(selectedLocation),
        fetchPipelines(selectedLocation),
      ]);

      if (cancelled) return;

      // Contacts → leads (merge with mock shape if needed)
      const hasLiveContacts = contactsRes.data && contactsRes.data.length > 0;
      const hasLiveConvos = convosRes.data && convosRes.data.length > 0;
      setIsMock(!hasLiveContacts && !hasLiveConvos);

      if (contactsRes.data && contactsRes.data.length > 0) {
        setLeads(contactsRes.data.map(c => ({
          id: c.id || c.contactId || c.name,
          name: c.name || c.contactName || "",
          phone: c.phone || "",
          email: c.email || "",
          source: c.source || c.tags?.[0] || "GHL",
          stage: c.stage || c.pipelineStage || "New",
          assignedSM: c.assignedTo || c.assignedSM || "",
          client: c.companyName || c.client || selectedLocation,
          lastActivity: c.lastActivity || "",
          createdAt: c.dateAdded || c.createdAt || "",
          notes: c.notes || c.customFields?.notes || "",
        })));
      } else {
        setLeads([]);
      }

      // Conversations
      if (convosRes.data && convosRes.data.length > 0) {
        setConversations(convosRes.data.map(cv => ({
          id: cv.id || cv.conversationId,
          contactId: cv.contactId || "",
          clientName: cv.contactName || cv.clientName || "",
          client: cv.locationName || cv.client || selectedLocation,
          lastMessage: cv.lastMessageBody || cv.lastMessage || "",
          lastTimestamp: cv.lastMessageDate || cv.lastTimestamp || new Date().toISOString(),
          unreadCount: cv.unreadCount ?? 0,
          messages: cv.messages || [],
        })));
      } else {
        setConversations([]);
      }

      // Pipeline stages
      if (pipelinesRes.data && pipelinesRes.data.pipelines && pipelinesRes.data.pipelines.length > 0) {
        const stageNames = pipelinesRes.data.pipelines[0].stages?.map(s => s.name) || [];
        setPipelineStages(stageNames);
      } else {
        setPipelineStages([]);
      }

      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [selectedLocation]);

  return (
    <div>
      {/* Empty state placeholder */}
      {leads.length === 0 && conversations.length === 0 && !loading && (
        <div style={{ padding: "60px 0", textAlign: "center", opacity: 0.4 }}>
          <div style={{ fontSize: 16, color: tokens.textMute }}>No leads data loaded</div>
        </div>
      )}

      {/* Location selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>LOCATION</label>
        <select
          value={selectedLocation}
          onChange={e => setSelectedLocation(e.target.value)}
          disabled={loadingLocations || locations.length === 0}
          style={{
            padding: "10px 16px", borderRadius: 10, fontSize: 14, fontFamily: "inherit",
            background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
            color: tokens.text, outline: "none", cursor: "pointer", minWidth: 220,
            appearance: "auto",
          }}
        >
          {loadingLocations && <option value="">Loading locations...</option>}
          {!loadingLocations && locations.length === 0 && <option value="">No locations found</option>}
          {locations.map(loc => (
            <option key={loc.name} value={loc.name}>{loc.name}</option>
          ))}
        </select>
        {loading && (
          <span style={{ fontSize: 12, color: tokens.textMute, fontStyle: "italic" }}>Syncing...</span>
        )}
      </div>

      {/* Summary stats */}
      <StatsBar tokens={tokens} leads={leads} conversations={conversations} />

      {/* Sub-tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 32 }}>
        {subTabs.map(t => (
          <button key={t} onClick={() => setSubTab(t)} style={{
            padding: "10px 22px", borderRadius: 8, fontSize: 14, cursor: "pointer",
            background: subTab === t ? tokens.accentGhost : "transparent",
            border: "none", color: subTab === t ? tokens.accent : tokens.textMute,
            fontFamily: "inherit", fontWeight: subTab === t ? 600 : 400,
            textTransform: "uppercase", letterSpacing: "0.04em", transition: "all 0.12s",
          }}>{t}</button>
        ))}
      </div>

      {subTab === "conversations" && <ConversationsPanel tokens={tokens} dark={dark} conversations={conversations} leads={leads} />}
      {subTab === "pipeline" && <PipelinePanel tokens={tokens} leads={leads} pipelineStages={pipelineStages} />}
      {subTab === "contacts" && <ContactsPanel tokens={tokens} leads={leads} />}
    </div>
  );
}
