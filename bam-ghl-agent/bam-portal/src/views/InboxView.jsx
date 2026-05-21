import { useState, useEffect, useCallback } from "react";
import { listConversations } from "../services/messagesService";
import MessageThread from "../components/MessageThread";
import { supabase } from "../lib/supabase";

// Staff inbox: list of every client conversation, sorted by most recent
// activity. Click → opens the thread in the right pane. Realtime subscribed
// to the conversations table so the inbox list updates without a refresh.
export default function InboxView({ tokens: tk, session, me }) {
  const t = tk;
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    try {
      const rows = await listConversations();
      setConversations(rows);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Subscribe to conversation row updates (last_message_at refresh, etc.)
  // so the inbox list re-sorts in real time when a new message arrives.
  useEffect(() => {
    const channel = supabase
      .channel("inbox:conversations")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations" },
        () => refresh()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations" },
        () => refresh()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refresh]);

  const filtered = search.trim()
    ? conversations.filter(c => (c.business_name || "").toLowerCase().includes(search.trim().toLowerCase()))
    : conversations;

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 420, boxSizing: "border-box", color: t.text, overflow: "hidden" }}>
      {/* Conversation list (left) */}
      <div style={{
        width: 320, flexShrink: 0, borderRight: `1px solid ${t.border}`,
        display: "flex", flexDirection: "column", background: t.surface,
      }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${t.border}` }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients…"
            style={{
              width: "100%", padding: "8px 12px", fontSize: 13,
              background: t.bg, color: t.text,
              border: `1px solid ${t.border}`, borderRadius: 8,
              outline: "none", fontFamily: "inherit",
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && <div style={{ padding: 20, color: t.textMute, fontSize: 13 }}>Loading…</div>}
          {error && <div style={{ padding: 20, color: t.red, fontSize: 13 }}>⚠ {error}</div>}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 20, color: t.textMute, fontSize: 13, fontStyle: "italic" }}>
              No conversations.
            </div>
          )}
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "12px 16px",
                borderBottom: `1px solid ${t.border}`,
                background: activeId === c.id ? t.surfaceHov || "rgba(255,255,255,0.04)" : "transparent",
                border: "none", borderLeft: activeId === c.id ? `3px solid ${t.accent}` : "3px solid transparent",
                cursor: "pointer", color: t.text, fontFamily: "inherit",
                transition: "background 0.12s",
              }}
              onMouseEnter={e => { if (activeId !== c.id) e.currentTarget.style.background = t.surfaceHov || "rgba(255,255,255,0.03)"; }}
              onMouseLeave={e => { if (activeId !== c.id) e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: c.has_unread ? 700 : 500, color: t.text }}>
                  {c.business_name}
                </span>
                {c.has_unread && (
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.accent }} />
                )}
              </div>
              <div style={{
                fontSize: 12, color: t.textMute,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {c.last_message_preview || <span style={{ fontStyle: "italic" }}>No messages yet</span>}
              </div>
              {c.last_message_at && (
                <div style={{ fontSize: 10, color: t.textMute, marginTop: 4 }}>
                  {formatRel(c.last_message_at)}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Active thread (right) */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: t.bg }}>
        {activeId && (
          <div style={{
            padding: "12px 22px", borderBottom: `1px solid ${t.border}`,
            background: t.surface, fontSize: 15, fontWeight: 600,
          }}>
            {conversations.find(c => c.id === activeId)?.business_name || "Conversation"}
          </div>
        )}
        <MessageThread
          conversationId={activeId}
          tokens={t}
          session={session}
          me={me}
          emptyHint="Pick a conversation on the left to start messaging."
        />
      </div>
    </div>
  );
}

function formatRel(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
