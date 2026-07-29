import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { listConversations } from "../services/messagesService";
import MessageThread from "../components/MessageThread";
import ClientAvatar from "../components/ClientAvatar.jsx";
import { supabase } from "../lib/supabase";
import { useUrlState } from "../hooks/useUrlState";
import { SkelRows } from "../components/Skeleton.jsx";

// Staff inbox: list of every client conversation, sorted unread-first then by
// most recent activity. Click → opens the thread in the right pane. Realtime
// subscribed to the conversations table so the list updates without a refresh.
//
// 2026-07-27 pass (Cole): All/Unread toggle, avatars + presence dots, URL-
// persisted open thread (?conv=), owner-name search, sender-prefixed previews,
// richer thread header with "Open client", keyboard navigation (arrows+Enter),
// skeleton loading, live timestamps, "+ New message" client picker, and a
// narrow-screen list<->thread mode. Sidebar unread badge lives in App.jsx.
export default function InboxView({ tokens: tk, session, me, onOpenClient }) {
  const t = tk;
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useUrlState("conv", "");
  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [onlineMap, setOnlineMap] = useState({});
  const [showNewMsg, setShowNewMsg] = useState(false);
  const [, setClockTick] = useState(0); // re-render for live "3m ago" labels
  const autoOpened = useRef(false);
  const listRef = useRef(null);

  // Narrow mode: below 800px show either the list OR the thread.
  const [narrow, setNarrow] = useState(() => window.innerWidth < 800);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 799px)");
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", onChange) : mq.removeListener(onChange); };
  }, []);

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
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations" }, () => refresh())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversations" }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refresh]);

  // Presence dots - same RPC the Clients roster uses, 30s cadence.
  useEffect(() => {
    let stopped = false;
    const loadOnline = async () => {
      const { data } = await supabase.rpc("clients_online_status");
      if (stopped || !Array.isArray(data)) return;
      const map = {};
      data.forEach(r => { if (r.is_online) map[r.client_id] = true; });
      setOnlineMap(map);
    };
    loadOnline();
    const iv = setInterval(loadOnline, 30 * 1000);
    return () => { stopped = true; clearInterval(iv); };
  }, []);

  // Keep the relative timestamps ("3m ago") from going stale.
  useEffect(() => {
    const iv = setInterval(() => setClockTick(x => x + 1), 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  const filtered = useMemo(() => {
    let list = conversations;
    if (onlyUnread) list = list.filter(c => c.has_unread);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(c =>
        (c.business_name || "").toLowerCase().includes(q) ||
        (c.owner_name || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [conversations, onlyUnread, search]);

  const unreadCount = conversations.filter(c => c.has_unread).length;
  const active = conversations.find(c => c.id === activeId) || null;

  // Auto-open the most recent conversation on first load - but ONLY when
  // nothing is unread. Auto-opening an unread thread would silently mark it
  // read, which defeats triage; instead the empty pane says what's waiting.
  useEffect(() => {
    if (loading || autoOpened.current || activeId) return;
    autoOpened.current = true;
    if (unreadCount === 0 && conversations.length && !narrow) {
      setActiveId(conversations[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Keyboard navigation: up/down moves through the visible list, Enter opens.
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (!["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
      if (!filtered.length) return;
      const idx = filtered.findIndex(c => c.id === activeId);
      if (e.key === "Enter") { if (idx < 0 && filtered[0]) setActiveId(filtered[0].id); return; }
      e.preventDefault();
      const next = e.key === "ArrowDown"
        ? filtered[Math.min(idx + 1, filtered.length - 1)]
        : filtered[Math.max(idx - 1, 0)];
      if (next) setActiveId(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, activeId, setActiveId]);

  const showList = !narrow || !activeId;
  const showThread = !narrow || !!activeId;

  const senderPrefix = (c) => {
    if (!c.last_message_preview) return "";
    if (c.last_message_author_kind === "staff") return "You: ";
    if (c.last_message_author_kind === "client") {
      const first = (c.owner_name || "").split(/\s+/)[0];
      return first ? `${first}: ` : "";
    }
    return "";
  };

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 420, boxSizing: "border-box", color: t.text, overflow: "hidden" }}>
      {/* Conversation list (left) */}
      {showList && (
      <div style={{
        width: narrow ? "100%" : 320, flexShrink: 0, borderRight: narrow ? "none" : `1px solid ${t.border}`,
        display: "flex", flexDirection: "column", background: t.surface,
      }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search business or owner…"
              style={{
                flex: 1, padding: "8px 12px", fontSize: 13,
                background: t.bg, color: t.text,
                border: `1px solid ${t.border}`, borderRadius: 8,
                outline: "none", fontFamily: "inherit",
              }}
            />
            <button
              onClick={() => setShowNewMsg(true)}
              title="New message - pick a client"
              style={{
                flexShrink: 0, width: 34, borderRadius: 8, border: "none",
                background: t.accent, color: "#0B0B0D", fontSize: 18, fontWeight: 700, cursor: "pointer",
              }}
            >+</button>
          </div>
          <div style={{ display: "flex", background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: 2 }}>
            {[["all", "All"], ["unread", `Unread${unreadCount ? ` ${unreadCount}` : ""}`]].map(([v, label]) => {
              const on = (v === "unread") === onlyUnread;
              return (
                <button key={v} onClick={() => setOnlyUnread(v === "unread")}
                  style={{
                    flex: 1, padding: "5px 0", background: on ? t.surface : "transparent",
                    color: on ? t.text : t.textMute, border: "none", borderRadius: 8,
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>{label}</button>
              );
            })}
          </div>
        </div>
        <div ref={listRef} style={{ flex: 1, overflowY: "auto" }}>
          {loading && Array.from({ length: 7 }).map((_, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "13px 16px", borderBottom: `1px solid ${t.border}` }}>
              <div className="bp-skel" style={{ width: 30, height: 30, borderRadius: 8, background: t.border }} />
              <div style={{ flex: 1 }}>
                <div className="bp-skel" style={{ height: 11, width: "55%", borderRadius: 999, background: t.border, marginBottom: 7 }} />
                <div className="bp-skel" style={{ height: 9, width: "85%", borderRadius: 999, background: t.border }} />
              </div>
            </div>
          ))}
          {error && (
            <div style={{ padding: 20, fontSize: 13 }}>
              <div style={{ color: t.red, marginBottom: 10 }}>Couldn't load the inbox - {error}</div>
              <button onClick={() => { setLoading(true); refresh(); }}
                style={{ padding: "7px 14px", background: "transparent", color: t.text, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12, cursor: "pointer" }}>Retry</button>
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 20, color: t.textMute, fontSize: 13, fontStyle: "italic" }}>
              {onlyUnread ? "Nothing unread." : "No conversations."}
            </div>
          )}
          {!loading && filtered.map(c => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                padding: "11px 14px",
                borderBottom: `1px solid ${t.border}`,
                background: activeId === c.id ? t.surfaceHov || "rgba(255,255,255,0.04)" : "transparent",
                border: "none", borderLeft: activeId === c.id ? `3px solid ${t.accent}` : "3px solid transparent",
                cursor: "pointer", color: t.text, fontFamily: "inherit",
                transition: "background 0.12s",
              }}
              onMouseEnter={e => { if (activeId !== c.id) e.currentTarget.style.background = t.surfaceHov || "rgba(255,255,255,0.03)"; }}
              onMouseLeave={e => { if (activeId !== c.id) e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ position: "relative", flexShrink: 0 }}>
                <ClientAvatar client={c} tokens={t} size={32} />
                {onlineMap[c.client_id] && (
                  <span title="A client teammate is online now" style={{
                    position: "absolute", right: -2, bottom: -2, width: 9, height: 9,
                    borderRadius: "50%", background: "#22C55E", border: `2px solid ${t.surface}`,
                  }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3, gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: c.has_unread ? 700 : 500, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.business_name}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {c.last_message_at && <span style={{ fontSize: 10, color: c.has_unread ? t.accent : t.textMute }}>{formatRel(c.last_message_at)}</span>}
                    {c.has_unread && <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.accent }} />}
                  </span>
                </div>
                <div style={{
                  fontSize: 12, color: c.has_unread ? t.textSub : t.textMute, fontWeight: c.has_unread ? 600 : 400,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {c.last_message_preview
                    ? <>{senderPrefix(c) && <span style={{ color: t.textMute, fontWeight: 400 }}>{senderPrefix(c)}</span>}{c.last_message_preview}</>
                    : <span style={{ fontStyle: "italic" }}>No messages yet</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Active thread (right) */}
      {showThread && (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: t.bg }}>
        {active && (
          <div style={{
            padding: "10px 16px", borderBottom: `1px solid ${t.border}`,
            background: t.surface, display: "flex", alignItems: "center", gap: 12,
          }}>
            {narrow && (
              <button onClick={() => setActiveId("")} title="Back to conversations"
                style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, padding: "5px 10px", fontSize: 13, cursor: "pointer" }}>←</button>
            )}
            <ClientAvatar client={active} tokens={t} size={34} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{active.business_name}</div>
              {active.owner_name && <div style={{ fontSize: 11.5, color: t.textMute }}>{active.owner_name}{onlineMap[active.client_id] ? " · online now" : ""}</div>}
            </div>
            {onOpenClient && (
              <button onClick={() => onOpenClient(active.client_id)}
                style={{ flexShrink: 0, padding: "6px 13px", background: "transparent", color: t.accent, border: `1px solid ${t.accent}66`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Open client →
              </button>
            )}
          </div>
        )}
        {!activeId && !narrow && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 30 }}>
            <div style={{ textAlign: "center", maxWidth: 300 }}>
              {unreadCount > 0 ? (
                <>
                  <div style={{ fontSize: 30, fontWeight: 700, color: t.accent }}>{unreadCount}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: t.text, marginTop: 4 }}>unread conversation{unreadCount === 1 ? "" : "s"}</div>
                  <div style={{ fontSize: 12.5, color: t.textMute, marginTop: 8, lineHeight: 1.5 }}>Pick one on the left - they're sorted to the top.</div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: t.textMute, lineHeight: 1.6 }}>All caught up. Pick a conversation on the left, or start one with the + button.</div>
              )}
            </div>
          </div>
        )}
        {activeId && (
          <MessageThread
            conversationId={activeId}
            tokens={t}
            session={session}
            me={me}
            emptyHint="Pick a conversation on the left to start messaging."
          />
        )}
      </div>
      )}

      {showNewMsg && (
        <NewMessagePicker tokens={t} onClose={() => setShowNewMsg(false)}
          onPick={(convId) => { setShowNewMsg(false); setActiveId(convId); refresh(); }} />
      )}
    </div>
  );
}

// "+ New message": pick any client → jump to (or surface) their 'general'
// conversation. Every client is guaranteed one by the new-client DB trigger.
function NewMessagePicker({ tokens: t, onClose, onPick }) {
  const [clients, setClients] = useState(null);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    supabase.from("clients").select("id,business_name,owner_name,brand_data,archived_at")
      .is("archived_at", null).order("business_name").limit(500)
      .then(({ data, error }) => { if (error) setErr(error.message); setClients(data || []); });
  }, []);

  const pick = async (c) => {
    setBusyId(c.id); setErr(null);
    const { data, error } = await supabase.from("conversations")
      .select("id").eq("client_id", c.id).eq("kind", "general").maybeSingle();
    setBusyId(null);
    if (error) { setErr(error.message); return; }
    if (!data?.id) { setErr(`No conversation row for ${c.business_name} yet - refresh and try again.`); return; }
    onPick(data.id);
  };

  const list = (clients || []).filter(c => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (c.business_name || "").toLowerCase().includes(s) || (c.owner_name || "").toLowerCase().includes(s);
  });

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.surfaceEl || t.surface, border: `1px solid ${t.border}`, borderRadius: 16, width: "100%", maxWidth: 420, maxHeight: "70vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}>
        <div style={{ padding: "16px 18px 12px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.text, marginBottom: 10 }}>New message</div>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients…"
            style={{ width: "100%", padding: "9px 12px", fontSize: 13, background: t.bg, color: t.text, border: `1px solid ${t.border}`, borderRadius: 8, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
          {err && <div style={{ color: t.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
        </div>
        <div style={{ flex: 1, overflowY: "auto", borderTop: `1px solid ${t.border}` }}>
          {!clients && <SkelRows n={5} t={t} pad="10px 16px" />}
          {clients && list.length === 0 && <div style={{ padding: 16, color: t.textMute, fontSize: 13, fontStyle: "italic" }}>No clients match.</div>}
          {list.map(c => (
            <button key={c.id} onClick={() => pick(c)} disabled={busyId === c.id}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "10px 16px", background: "transparent", border: "none", borderBottom: `1px solid ${t.border}`, color: t.text, cursor: "pointer", fontFamily: "inherit" }}>
              <ClientAvatar client={c} tokens={t} size={28} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.business_name}</span>
                {c.owner_name && <span style={{ display: "block", fontSize: 11.5, color: t.textMute }}>{c.owner_name}</span>}
              </span>
              {busyId === c.id && <span style={{ fontSize: 11, color: t.textMute }}>Opening…</span>}
            </button>
          ))}
        </div>
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
