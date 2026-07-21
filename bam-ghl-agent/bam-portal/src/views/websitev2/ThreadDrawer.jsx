import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import TicketDrawer from "../../components/v2rail/TicketDrawer";
import { relTime } from "../contentv2/utils";
import { ticketApi } from "./utils";

/* Conversation drawer for a website_change ticket: the shared v2 thread
   (v2_ticket_messages) + reply composer with the internal-note toggle.
   Opens from the sandbox header strip; reads via supabase-js with realtime,
   replies via /api/v2-tickets?action=reply (same recipe as ContentTicketDrawer). */

export default function ThreadDrawer({ open, ticket, academyName, session, dark = true, onClose, onMutated }) {
  const ticketId = ticket?.id || null;

  const [thread, setThread] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [composer, setComposer] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadThread() {
    if (!ticketId) return;
    setThreadLoading(true);
    const { data, error: err } = await supabase
      .from("v2_ticket_messages")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    if (!err) setThread(data || []);
    setThreadLoading(false);
  }

  useEffect(() => {
    if (!ticketId || !open) { setThread([]); return; }
    loadThread();
    const ch = supabase
      .channel(`w2-thread-${ticketId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "v2_ticket_messages", filter: `ticket_id=eq.${ticketId}` },
        () => loadThread())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, open]);

  // Reset transient state when a different ticket opens.
  useEffect(() => { setComposer(""); setInternalNote(false); setError(""); }, [ticketId]);

  async function doReply() {
    const body = composer.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    try {
      await ticketApi(session, ticketId, "reply", { body, internal: internalNote });
      setComposer("");
      setInternalNote(false);
      await loadThread();
      onMutated?.();
    } catch (e) {
      setError(e?.message || "Could not send the reply.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TicketDrawer
      open={open && !!ticket}
      onClose={onClose}
      dark={dark}
      title={`Thread · ${academyName || "Academy"}`}
    >
      {error && <div className="w2-banner w2-banner-err" style={{ margin: 0 }}>{error}</div>}

      {threadLoading && thread.length === 0 ? (
        <div className="w2-side-muted">Loading conversation...</div>
      ) : thread.length === 0 ? (
        <div className="w2-side-muted">No messages yet.</div>
      ) : (
        <div className="w2-thread">
          {thread.map((m) => {
            if (m.author_kind === "system") {
              return <div className="w2-msg w2-msg-system" key={m.id}><div className="w2-sys">{m.body}</div></div>;
            }
            const cls = m.author_kind === "staff" ? "w2-msg-staff" : m.author_kind === "agent" ? "w2-msg-agent" : "w2-msg-client";
            const atts = Array.isArray(m.attachments) ? m.attachments : [];
            return (
              <div className={`w2-msg ${cls}${m.internal ? " w2-msg-internal" : ""}`} key={m.id}>
                <div className="w2-msg-bubble">{m.body}</div>
                {atts.length > 0 && (
                  <div className="w2-msg-att">
                    {atts.map((a, i) => <a key={i} href={a.url || "#"} target="_blank" rel="noreferrer">{a.name || "attachment"}</a>)}
                  </div>
                )}
                <div className="w2-msg-meta">
                  {m.internal && <span className="w2-msg-tag">Internal</span>}
                  <span>{m.author_name || m.author_kind}</span>
                  <span>{relTime(m.created_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="w2-composer">
        <textarea
          className="w2-textarea"
          placeholder={internalNote ? "Internal note (staff only)..." : "Reply to the client..."}
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
        />
        <div className="w2-composer-row">
          <label className="w2-toggle">
            <input type="checkbox" checked={internalNote} onChange={(e) => setInternalNote(e.target.checked)} />
            Internal note
          </label>
          <button type="button" className="v2r-btn v2r-btn-primary" disabled={busy || !composer.trim()} onClick={doReply}>
            {internalNote ? "Add note" : "Send reply"}
          </button>
        </div>
      </div>
    </TicketDrawer>
  );
}
