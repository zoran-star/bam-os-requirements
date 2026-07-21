import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TicketDrawer from "../../components/v2rail/TicketDrawer";
import StatusLadder from "../../components/v2rail/StatusLadder";
import { supabase } from "../../lib/supabase";
import * as api from "./api";
import {
  MODES, resolveMode, money, campaignLabel, isVideo, isImage, isAudio,
  fileSize, MARKETING_OWNER_ROLES,
} from "./intake";

// ── small presentational helpers ─────────────────────────────
function FieldRows({ rows }) {
  const shown = rows.filter((r) => r && r.v != null && String(r.v).trim() !== "");
  if (!shown.length) return null;
  return (
    <div className="v2r-mkt-fields">
      {shown.map((r) => (
        <div className="v2r-mkt-field" key={r.k}>
          <span className="v2r-mkt-field-k">{r.k}</span>
          <span className={`v2r-mkt-field-v${r.mono ? " is-mono" : ""}`}>
            {r.link ? (
              <a href={r.v} target="_blank" rel="noopener noreferrer" style={{ color: "var(--gold)" }}>{r.v}</a>
            ) : r.v}
          </span>
        </div>
      ))}
    </div>
  );
}

function timeLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ── the creative preview (post mode) ─────────────────────────
function CreativePreview({ files }) {
  if (!Array.isArray(files) || !files.length) {
    return <div className="v2r-mkt-nofile">No finished creative attached yet.</div>;
  }
  return (
    <>
      {files.map((f, i) => (
        <div className="v2r-mkt-preview" key={(f.url || "") + i}>
          {isVideo(f) ? (
            <video src={f.url} controls playsInline preload="metadata" />
          ) : isImage(f) ? (
            <img src={f.url} alt={f.name || "creative"} />
          ) : isAudio(f) ? (
            <audio src={f.url} controls preload="metadata" style={{ width: "100%" }} />
          ) : (
            <div className="v2r-mkt-nofile" style={{ border: "none", margin: 0 }}>
              {f.name || "Attachment"}
            </div>
          )}
          <div className="v2r-mkt-preview-meta">
            <span className="v2r-mkt-preview-name">{f.name || "creative"}</span>
            {fileSize(f.size) && <span className="v2r-mkt-preview-size">{fileSize(f.size)}</span>}
          </div>
        </div>
      ))}
    </>
  );
}

// Download every final file to the staff device (real anchor download; falls
// back to a direct anchor if a cross-origin blob fetch is blocked).
async function downloadFiles(files) {
  for (const f of files) {
    if (!f?.url) continue;
    const name = f.name || "creative";
    try {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (_) {
      const a = document.createElement("a");
      a.href = f.url;
      a.download = name;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }
}

export default function MarketingDrawer({
  ticket, clientName, ownerName, owners = [], onClose, onMutated, msgBump = 0, dark = true,
}) {
  const [messages, setMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState("");       // which action is running
  const [note, setNote] = useState(null);     // { kind:'ok'|'err', text }
  const [reassignOpen, setReassignOpen] = useState(false);
  const threadEndRef = useRef(null);

  const id = ticket?.id;
  const mode = ticket ? resolveMode(ticket) : "generic";
  const modeCfg = MODES[mode] || MODES.generic;
  const intake = ticket?.intake || {};
  const context = ticket?.context || {};
  const finals = Array.isArray(intake.final_files) ? intake.final_files : [];
  const blockedBy = context.blocked_by || intake.blocked_by || null;
  const resolved = ticket?.status === "resolved" || ticket?.status === "closed";
  const archived = Array.isArray(intake.archived_asset_ids) && intake.archived_asset_ids.length > 0;

  // Reads via supabase-js (RLS is_staff()). Refetch on ticket change + on the
  // parent's realtime message bump.
  const loadThread = useCallback(async () => {
    if (!id) return;
    setThreadLoading(true);
    const { data, error } = await supabase
      .from("v2_ticket_messages")
      .select("*")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true });
    if (!error) setMessages(data || []);
    setThreadLoading(false);
  }, [id]);

  useEffect(() => { setNote(null); setReplyText(""); setReassignOpen(false); }, [id]);
  useEffect(() => { loadThread(); }, [loadThread, msgBump]);
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function run(label, fn, okText) {
    setBusy(label); setNote(null);
    try {
      await fn();
      if (okText) setNote({ kind: "ok", text: okText });
      onMutated?.();
    } catch (e) {
      setNote({ kind: "err", text: e.message || String(e) });
    } finally {
      setBusy("");
    }
  }

  async function sendReply() {
    const body = replyText.trim();
    if (!body) return;
    setBusy("reply"); setNote(null);
    try {
      await api.reply(id, body);
      setReplyText("");
      await loadThread();
      onMutated?.();
    } catch (e) {
      setNote({ kind: "err", text: e.message || String(e) });
    } finally {
      setBusy("");
    }
  }

  // ── per-mode intake body ──
  const intakeBody = useMemo(() => {
    if (!ticket) return null;
    const campaign = campaignLabel(ticket);
    const brief = intake.brief || intake.note || intake.description || "";
    const preset = intake.preset || intake.sales_preset || "";
    const offer = intake.offer || intake.offer_name || "";
    const angle = intake.angle || "";

    if (mode === "post") {
      return (
        <>
          <div className="v2r-mkt-section">
            <span className="v2r-microlabel v2r-mkt-drawer-label">Finished creative</span>
            <CreativePreview files={finals} />
          </div>
          <div className="v2r-mkt-section">
            <span className="v2r-microlabel v2r-mkt-drawer-label">Brief</span>
            <FieldRows rows={[
              { k: "Campaign", v: campaign },
              { k: "Offer", v: offer },
              { k: "Sales preset", v: preset },
              { k: "Angle", v: angle },
              { k: "Notes", v: brief },
            ]} />
          </div>
        </>
      );
    }

    if (mode === "budget") {
      const current = money(intake.current_spend ?? intake.current ?? intake.old_spend);
      const next = money(intake.new_spend ?? intake.new_budget ?? intake.budget ?? intake.next_spend);
      return (
        <>
          <div className="v2r-mkt-section">
            <span className="v2r-microlabel v2r-mkt-drawer-label">Budget change</span>
            <div className="v2r-mkt-spend">
              <div className="v2r-mkt-spend-col">
                <span className="v2r-mkt-spend-k">Current</span>
                <span className="v2r-mkt-spend-v">{current || "-"}</span>
              </div>
              <span className="v2r-mkt-spend-arrow" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
              </span>
              <div className="v2r-mkt-spend-col">
                <span className="v2r-mkt-spend-k">New</span>
                <span className="v2r-mkt-spend-v is-new">{next || "-"}</span>
              </div>
            </div>
          </div>
          <FieldRows rows={[
            { k: "Campaign", v: campaign },
            { k: "Reason", v: intake.reason || intake.note || brief },
          ]} />
        </>
      );
    }

    if (mode === "remove") {
      return (
        <div className="v2r-mkt-section">
          <span className="v2r-microlabel v2r-mkt-drawer-label">Remove creative</span>
          <FieldRows rows={[
            { k: "Campaign", v: campaign },
            // intake.creative may be an OBJECT ({id,name,cpl,...}) from the V2 remove flow - never render it raw
            { k: "Creative", v: (typeof intake.creative === "string" ? intake.creative : intake.creative?.name) || intake.creative_name || intake.asset || intake.ad || "" },
            { k: "Reason", v: intake.reason || intake.note || brief },
          ]} />
        </div>
      );
    }

    if (mode === "campaign") {
      const landing = intake.landing_page || intake.landing_url || intake.landing || "";
      return (
        <div className="v2r-mkt-section">
          <span className="v2r-microlabel v2r-mkt-drawer-label">New campaign</span>
          <FieldRows rows={[
            { k: "Offer", v: offer },
            { k: "Sales preset", v: preset },
            { k: "Spend", v: money(intake.spend ?? intake.budget ?? intake.new_spend), mono: true },
            { k: "Landing page", v: landing, link: /^https?:\/\//i.test(String(landing)) },
            { k: "Note", v: brief },
          ]} />
        </div>
      );
    }

    // generic fallback: render the raw intake without dropping anything
    const HIDE = new Set(["mode", "kind", "origin_ticket_id", "final_files", "archived_asset_ids", "pending_request"]);
    const rows = Object.entries(intake)
      .filter(([k, v]) => !HIDE.has(k) && v != null && typeof v !== "object")
      .map(([k, v]) => ({ k: k.replace(/_/g, " "), v: String(v) }));
    return (
      <div className="v2r-mkt-section">
        <span className="v2r-microlabel v2r-mkt-drawer-label">Details</span>
        {rows.length ? <FieldRows rows={rows} /> : <div className="v2r-mkt-nofile">No structured intake on this ticket.</div>}
      </div>
    );
  }, [ticket, mode, intake, finals]);

  if (!ticket) return null;

  // ── footer actions (per mode) ──
  const footer = (
    <>
      {mode === "post" && (
        <>
          <button
            type="button"
            className="v2r-btn v2r-btn-secondary"
            disabled={!finals.length || busy === "download"}
            onClick={() => run("download", () => downloadFiles(finals))}
          >
            {busy === "download" ? "Downloading..." : "Download creative"}
          </button>
          <button
            type="button"
            className="v2r-btn v2r-btn-primary"
            disabled={resolved || busy === "live"}
            onClick={() => run("live", () => api.markLive(id), "Ad marked live. Archived to the Ads library.")}
          >
            {resolved ? "Live" : busy === "live" ? "Marking..." : "Mark live"}
          </button>
        </>
      )}

      {mode === "budget" && (
        <button
          type="button"
          className="v2r-btn v2r-btn-primary"
          disabled={resolved || busy === "done"}
          onClick={() => run("done", () => api.setStatus(id, "resolved"), "Marked done.")}
        >
          {resolved ? "Done" : busy === "done" ? "Saving..." : "Apply in Meta, mark done"}
        </button>
      )}

      {mode === "remove" && (
        <button
          type="button"
          className="v2r-btn v2r-btn-primary"
          disabled={resolved || busy === "done"}
          onClick={() => run("done", () => api.setStatus(id, "resolved"), "Marked done.")}
        >
          {resolved ? "Done" : busy === "done" ? "Saving..." : "Pause/remove, mark done"}
        </button>
      )}

      {mode === "campaign" && (
        <button
          type="button"
          className="v2r-btn v2r-btn-primary"
          disabled={resolved || !!blockedBy || busy === "done"}
          title={blockedBy ? "Blocked: landing page not live" : undefined}
          onClick={() => run("done", () => api.setStatus(id, "resolved"), "Campaign launched, marked done.")}
        >
          {resolved ? "Launched" : busy === "done" ? "Launching..." : "Launch, mark done"}
        </button>
      )}

      {mode === "generic" && (
        <button
          type="button"
          className="v2r-btn v2r-btn-primary"
          disabled={resolved || busy === "done"}
          onClick={() => run("done", () => api.setStatus(id, "resolved"), "Marked done.")}
        >
          {resolved ? "Done" : busy === "done" ? "Saving..." : "Mark done"}
        </button>
      )}
    </>
  );

  const header = (
    <div className="v2r-mkt-head">
      <div className="v2r-drawer-title">{modeCfg.title}</div>
      {ticket.title && ticket.title !== modeCfg.title && (
        <div className="v2r-mkt-head-sub">{ticket.title}</div>
      )}
      <div className="v2r-mkt-head-sub" style={{ marginTop: 4 }}>{clientName}</div>
      <div style={{ marginTop: 12 }}>
        <StatusLadder status={ticket.status} dark={dark} />
      </div>
      <div className="v2r-mkt-metarow">
        <span className="v2r-mkt-ownerrole">Scaling manager</span>
        <button
          type="button"
          className="v2r-mkt-ownerbtn"
          onClick={() => setReassignOpen((o) => !o)}
          aria-expanded={reassignOpen}
        >
          {ownerName || "Unassigned"}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
      </div>
      {reassignOpen && (
        <div className="v2r-mkt-reassign">
          <select
            className="v2r-mkt-select"
            value={ticket.assigned_to || ""}
            onChange={(e) => {
              const to = e.target.value || null;
              run("reassign", () => api.reassign(id, { assigned_to: to }), "Owner updated.");
              setReassignOpen(false);
            }}
          >
            <option value="">Unassigned</option>
            {owners.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );

  return (
    <TicketDrawer open={!!ticket} onClose={onClose} header={header} footer={footer} dark={dark}>
      {note && (
        <div className={`v2r-mkt-note ${note.kind === "ok" ? "is-ok" : "is-err"}`}>{note.text}</div>
      )}

      {mode === "post" && resolved && archived && (
        <div className="v2r-mkt-note is-ok">Archived to the client's Ads library.</div>
      )}

      {intakeBody}

      {mode === "campaign" && blockedBy && (
        <div className="v2r-mkt-blocked">
          <div className="v2r-mkt-blocked-head">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            Blocked: landing page not live
          </div>
          <div className="v2r-mkt-blocked-body">
            Launch is held until the landing page ships. Tracked on Systems ticket{" "}
            <span className="v2r-mkt-blocked-id">{String(blockedBy).slice(0, 8)}</span>.
          </div>
          <div className="v2r-mkt-blocked-actions">
            <button
              type="button"
              className="v2r-btn v2r-btn-secondary"
              disabled={busy === "ping"}
              onClick={() => run(
                "ping",
                () => api.reply(id, `Pinged Systems about the landing-page blocker (ticket ${String(blockedBy).slice(0, 8)}).`, true),
                "Pinged Systems. Note added to the thread."
              )}
            >
              {busy === "ping" ? "Pinging..." : "Ping Systems"}
            </button>
          </div>
        </div>
      )}

      <div className="v2r-mkt-section">
        <span className="v2r-microlabel v2r-mkt-drawer-label">Conversation</span>
        <div className="v2r-mkt-thread">
          {threadLoading && !messages.length && (
            <div className="v2r-mkt-thread-empty">Loading conversation...</div>
          )}
          {!threadLoading && !messages.length && (
            <div className="v2r-mkt-thread-empty">No messages yet.</div>
          )}
          {messages.map((m) => {
            if (m.author_kind === "system") {
              return <div className="v2r-mkt-sys" key={m.id}>{m.body}</div>;
            }
            const staffSide = m.author_kind === "staff" || m.author_kind === "agent";
            return (
              <div
                key={m.id}
                className={`v2r-mkt-msg ${staffSide ? "is-staff" : "is-client"}${m.internal ? " is-internal" : ""}`}
              >
                <span className="v2r-mkt-msg-meta">
                  {m.author_name || (staffSide ? "Staff" : "Client")}
                  {m.internal ? " · Internal" : ""} · {timeLabel(m.created_at)}
                </span>
                <div className="v2r-mkt-msg-bubble">{m.body}</div>
              </div>
            );
          })}
          <div ref={threadEndRef} />
        </div>
      </div>

      <div className="v2r-mkt-composer">
        <textarea
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Reply to the academy..."
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); sendReply(); }
          }}
        />
        <div className="v2r-mkt-composer-row">
          <button
            type="button"
            className="v2r-btn v2r-btn-primary"
            disabled={!replyText.trim() || busy === "reply"}
            onClick={sendReply}
          >
            {busy === "reply" ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </TicketDrawer>
  );
}

export { MARKETING_OWNER_ROLES };
