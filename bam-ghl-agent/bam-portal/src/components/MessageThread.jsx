import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  listMessages, sendMessage, editMessage, deleteMessage, markRead, uploadAttachment,
} from "../services/messagesService";

const EDIT_DELETE_WINDOW_MS = 5 * 60 * 1000;
const TYPING_TIMEOUT_MS = 3000; // hide "typing..." if no broadcast for this long

// Generic message thread used by both the staff Inbox and per-client
// Messages tab. Caller passes a conversationId; the component handles
// loading, realtime subscription, typing dots, sending, edit/delete.
export default function MessageThread({ conversationId, tokens: t, session, me, emptyHint }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState([]);   // pending uploads {file, uploading, error, attachment?}
  const [editingId, setEditingId] = useState(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [typingUsers, setTypingUsers] = useState({});  // {userId: {name, expiresAt}}
  const channelRef = useRef(null);
  const typingDebounceRef = useRef(null);
  const scrollRef = useRef(null);
  const myUserId = session?.user?.id;
  const myName = me?.name || (session?.user?.email || "").split("@")[0] || "Someone";

  // Load initial messages whenever conversation changes
  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMessages(conversationId, { limit: 100 })
      .then(rows => { if (!cancelled) setMessages(rows); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [conversationId]);

  // Mark read whenever we view a non-empty conversation
  useEffect(() => {
    if (!conversationId || messages.length === 0) return;
    const latest = messages[messages.length - 1]?.created_at;
    markRead(conversationId, latest).catch(() => {});
  }, [conversationId, messages.length]);

  // Auto-scroll to bottom when messages arrive (only if user was near bottom)
  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length, typingUsers]);

  // Realtime: subscribe to new messages on this conversation + typing broadcasts
  useEffect(() => {
    if (!conversationId) return;
    // Tear down any previous channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMsg = payload.new;
          setMessages(prev => {
            // De-dupe if we already optimistically inserted (matched by id)
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = payload.new;
          setMessages(prev => prev.map(m => m.id === updated.id ? updated : m));
        }
      )
      .on("broadcast", { event: "typing" }, (payload) => {
        const { user_id, name } = payload.payload || {};
        if (!user_id || user_id === myUserId) return;
        setTypingUsers(prev => ({
          ...prev,
          [user_id]: { name: name || "Someone", expiresAt: Date.now() + TYPING_TIMEOUT_MS },
        }));
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [conversationId, myUserId]);

  // Garbage-collect expired typing entries every second
  useEffect(() => {
    if (Object.keys(typingUsers).length === 0) return;
    const id = setInterval(() => {
      const now = Date.now();
      setTypingUsers(prev => {
        const next = {};
        let changed = false;
        for (const [k, v] of Object.entries(prev)) {
          if (v.expiresAt > now) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [typingUsers]);

  const broadcastTyping = useCallback(() => {
    if (!channelRef.current || !myUserId) return;
    channelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: myUserId, name: myName },
    });
  }, [myUserId, myName]);

  const onComposerChange = (v) => {
    setComposer(v);
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    typingDebounceRef.current = setTimeout(broadcastTyping, 80);
  };

  const onPickFiles = async (fileList) => {
    if (!conversationId || !fileList || fileList.length === 0) return;
    const arr = Array.from(fileList);
    setFiles(prev => [...prev, ...arr.map(f => ({ file: f, uploading: true }))]);
    for (const f of arr) {
      try {
        const attachment = await uploadAttachment(f, conversationId);
        setFiles(prev => prev.map(p => p.file === f ? { ...p, uploading: false, attachment } : p));
      } catch (err) {
        setFiles(prev => prev.map(p => p.file === f ? { ...p, uploading: false, error: err.message } : p));
      }
    }
  };

  const removePending = (file) => setFiles(prev => prev.filter(p => p.file !== file));

  const onSend = async () => {
    if (sending) return;
    const text = composer.trim();
    const readyAttachments = files
      .filter(f => f.attachment && !f.error)
      .map(f => f.attachment);
    if (!text && readyAttachments.length === 0) return;
    setSending(true);
    try {
      const sent = await sendMessage({ conversation_id: conversationId, body: text, files: readyAttachments });
      // Optimistically append (realtime might also deliver it; de-dupe in handler)
      setMessages(prev => prev.some(m => m.id === sent.id) ? prev : [...prev, sent]);
      setComposer("");
      setFiles([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const startEdit = (m) => { setEditingId(m.id); setEditingDraft(m.body || ""); };
  const cancelEdit = () => { setEditingId(null); setEditingDraft(""); };
  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const updated = await editMessage(editingId, editingDraft.trim());
      setMessages(prev => prev.map(m => m.id === updated.id ? updated : m));
      cancelEdit();
    } catch (err) {
      setError(err.message);
    }
  };
  const onDelete = async (m) => {
    if (!confirm("Delete this message?")) return;
    try {
      await deleteMessage(m.id);
      setMessages(prev => prev.map(x => x.id === m.id ? { ...x, deleted_at: new Date().toISOString(), body: null, files: [] } : x));
    } catch (err) { setError(err.message); }
  };

  // ─── Render ──────────────────────────────────────────────────
  if (!conversationId) {
    return (
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        color: t.textMute, fontSize: 13, padding: 40, textAlign: "center",
      }}>
        {emptyHint || "Pick a conversation on the left to start."}
      </div>
    );
  }

  const typingNames = Object.values(typingUsers).map(u => u.name);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* Messages list */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: "auto", padding: "16px 22px",
          display: "flex", flexDirection: "column", gap: 14,
        }}
      >
        {loading && <div style={{ color: t.textMute, fontSize: 12, textAlign: "center" }}>Loading…</div>}
        {!loading && messages.length === 0 && (
          <div style={{ color: t.textMute, fontSize: 13, textAlign: "center", padding: 40 }}>
            No messages yet. Send the first one ↓
          </div>
        )}
        {messages.map((m) => {
          const isMine = m.author_auth_user_id === myUserId;
          const isStaff = !!m.author_staff_id;
          const ageMs = Date.now() - new Date(m.created_at).getTime();
          const canEdit = isMine && !m.deleted_at && ageMs < EDIT_DELETE_WINDOW_MS;
          const sideColor = isStaff ? t.accent : (t.green || "#7ED996");
          return (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: isMine ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "78%", padding: "9px 13px", borderRadius: 14,
                background: isMine ? `${sideColor}18` : t.surfaceEl,
                border: `1px solid ${isMine ? `${sideColor}44` : t.border}`,
                color: t.text, fontSize: 13.5, lineHeight: 1.5,
                wordBreak: "break-word", whiteSpace: "pre-wrap",
              }}>
                {m.deleted_at ? (
                  <span style={{ color: t.textMute, fontStyle: "italic" }}>(deleted)</span>
                ) : editingId === m.id ? (
                  <div>
                    <textarea
                      value={editingDraft}
                      onChange={e => setEditingDraft(e.target.value)}
                      style={{
                        width: "100%", minWidth: 220, minHeight: 60, padding: 6, fontSize: 13,
                        background: t.bg, color: t.text, border: `1px solid ${t.border}`,
                        borderRadius: 6, fontFamily: "inherit", resize: "vertical",
                      }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button onClick={saveEdit} style={btn(t, "primary")}>Save</button>
                      <button onClick={cancelEdit} style={btn(t, "ghost")}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {m.body}
                    {Array.isArray(m.files) && m.files.length > 0 && (
                      <div style={{ marginTop: m.body ? 8 : 0, display: "flex", flexDirection: "column", gap: 6 }}>
                        {m.files.map((f, i) => {
                          const isImage = (f.mime || "").startsWith("image/");
                          return isImage ? (
                            <a key={i} href={f.url} target="_blank" rel="noreferrer">
                              <img src={f.url} alt={f.name} style={{ maxWidth: 240, maxHeight: 240, borderRadius: 6, display: "block" }} />
                            </a>
                          ) : (
                            <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{
                              color: t.accent, fontSize: 12, textDecoration: "none",
                              padding: "5px 9px", border: `1px solid ${t.border}`, borderRadius: 6,
                              display: "inline-block", maxWidth: "100%",
                            }}>📎 {f.name}</a>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div style={{ fontSize: 10, color: t.textMute, marginTop: 3, padding: "0 4px", display: "flex", gap: 6, alignItems: "center" }}>
                <span>{formatTime(m.created_at)}</span>
                {m.edited_at && <span>(edited)</span>}
                {canEdit && editingId !== m.id && (
                  <>
                    <button onClick={() => startEdit(m)} style={inlineLink(t)}>edit</button>
                    <button onClick={() => onDelete(m)} style={inlineLink(t)}>delete</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {typingNames.length > 0 && (
          <div style={{ color: t.textMute, fontSize: 12, fontStyle: "italic", padding: "0 4px" }}>
            {typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.length} people typing…`}
          </div>
        )}
      </div>

      {/* Composer */}
      <div style={{ borderTop: `1px solid ${t.border}`, padding: "12px 16px", background: t.surface }}>
        {error && <div style={{ color: t.red, fontSize: 12, marginBottom: 6 }}>⚠ {error}</div>}
        {files.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {files.map((f, i) => (
              <div key={i} style={{
                fontSize: 11, padding: "4px 8px", borderRadius: 6,
                background: f.error ? `${t.red}15` : t.surfaceEl,
                border: `1px solid ${f.error ? t.red : t.border}`, color: t.text,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <span>{f.uploading ? "⏳" : f.error ? "⚠" : "📎"}</span>
                <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file.name}</span>
                <button onClick={() => removePending(f.file)} style={{
                  background: "none", border: "none", color: t.textMute, cursor: "pointer", padding: 0, fontSize: 14,
                }}>×</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <label style={{
            cursor: "pointer", padding: "8px 10px", borderRadius: 6,
            color: t.textMute, border: `1px solid ${t.border}`, background: "transparent",
            fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center",
          }} title="Attach files">
            <input type="file" multiple onChange={e => onPickFiles(e.target.files)} style={{ display: "none" }} />
            📎
          </label>
          <textarea
            value={composer}
            onChange={e => onComposerChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a message…   (Shift+Enter for new line)"
            rows={1}
            style={{
              flex: 1, padding: "9px 12px", fontSize: 13.5, lineHeight: 1.5,
              background: t.bg, color: t.text, border: `1px solid ${t.border}`,
              borderRadius: 8, fontFamily: "inherit", resize: "none", minHeight: 38, maxHeight: 140,
            }}
          />
          <button
            onClick={onSend}
            disabled={sending || (!composer.trim() && files.filter(f => f.attachment).length === 0)}
            style={{
              padding: "10px 18px", background: t.accent, color: "#0B0B0D",
              border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13,
              cursor: sending ? "wait" : "pointer",
              opacity: (!composer.trim() && files.filter(f => f.attachment).length === 0) ? 0.5 : 1,
            }}
          >{sending ? "…" : "Send"}</button>
        </div>
      </div>
    </div>
  );
}

function btn(t, kind) {
  if (kind === "primary") return {
    padding: "6px 12px", background: t.accent, color: "#0B0B0D",
    border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
  };
  return {
    padding: "6px 12px", background: "transparent", color: t.textSub,
    border: `1px solid ${t.border}`, borderRadius: 6, fontSize: 11, cursor: "pointer",
  };
}
function inlineLink(t) {
  return {
    background: "none", border: "none", color: t.textMute, cursor: "pointer",
    padding: 0, fontSize: 10, textDecoration: "underline",
  };
}
function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return d.toLocaleString(undefined, sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
