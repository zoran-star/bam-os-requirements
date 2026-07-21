import { useEffect, useMemo, useRef, useState } from "react";
import StatusPill from "../../components/v2rail/StatusPill";
import StatusLadder from "../../components/v2rail/StatusLadder";
import { REQUEST_KINDS } from "../contentv2/utils";
import ThreadDrawer from "./ThreadDrawer";
import {
  pagePath, ticketAnnotations, dominantDevice, sandboxSrc, metricChips, initials, ticketApi,
} from "./utils";

/* The sandbox (locked mockup 3): the client's live page on the LEFT (iframe,
   Phone/Computer tabs, true-viewport scaling like the client annotator) and
   the client's notes + metric snapshot + actions on the RIGHT.

   Section highlight: hovering / selecting a note posts a best-effort
   fc-annotate highlight message into the iframe. The shipped bam-client-sites
   bridge (annotate.js) only posts OUTWARD (steps / section-click) and listens
   for fc-preview set-step, so until it learns an inbound highlight the
   guaranteed path is the parent-side overlay label naming the section. */

function Chevron() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>;
}
function PhoneIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></svg>;
}
function MonitorIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="1.5" /><path d="M9 21h6M12 17v4" /></svg>;
}

// Status-menu options available from a given current status (house recipe).
function statusOptions(status) {
  const opts = [];
  if (status === "new" || status === "waiting_client") opts.push({ v: "in_progress", label: "Move to In progress" });
  if (status !== "resolved" && status !== "closed") opts.push({ v: "resolved", label: "Mark resolved" });
  if (status !== "closed") opts.push({ v: "closed", label: "Close ticket" });
  if (status === "resolved" || status === "closed") opts.push({ v: "new", label: "Reopen" });
  return opts;
}

// True-viewport widths, same as the client annotator (_v2ApplyDevice).
const LOGICAL_W = { desktop: 1280, mobile: 390 };

export default function WebsiteSandbox({ ticket, academyName, staffList = [], session, dark = true, onMutated }) {
  const staffMap = useMemo(() => {
    const m = {};
    for (const s of staffList) m[s.id] = s.name;
    return m;
  }, [staffList]);

  const ticketId = ticket?.id || null;
  const notes = useMemo(() => ticketAnnotations(ticket), [ticket]);
  const pageUrl = ticket?.context?.page_url || null;
  const src = sandboxSrc(pageUrl);
  const metrics = metricChips(ticket?.context?.metric_snapshot);
  const pending = ticket?.intake?.pending_request || null;

  // ── device tabs (default = the device the client annotated on) ──
  const [device, setDevice] = useState(() => dominantDevice(notes));
  useEffect(() => { setDevice(dominantDevice(ticketAnnotations(ticket))); }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── stage scaling: render at the true viewport width, scale down to fit ──
  const stageRef = useRef(null);
  const frameRef = useRef(null);
  const [stageBox, setStageBox] = useState({ w: 0, h: 620 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageBox({ w: el.clientWidth, h: el.clientHeight || 620 });
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [ticketId]);
  const logicalW = LOGICAL_W[device] || LOGICAL_W.desktop;
  const scale = stageBox.w ? Math.min(1, stageBox.w / logicalW) : 1;
  const scalerStyle = {
    width: logicalW,
    height: Math.round(stageBox.h / scale),
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    left: device === "mobile" ? Math.max(0, Math.round((stageBox.w - logicalW * scale) / 2)) : 0,
  };

  // ── note highlight: hover is transient, click sticks ──
  const [hoverIdx, setHoverIdx] = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(null);
  useEffect(() => { setHoverIdx(null); setSelectedIdx(null); }, [ticketId]);
  const activeIdx = hoverIdx != null ? hoverIdx : selectedIdx;
  const activeNote = activeIdx != null ? notes[activeIdx] : null;

  // Best-effort bridge call: ask the page to outline the section. Harmless if
  // the annotate.js bridge does not handle it yet (see the header comment).
  useEffect(() => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage({
        type: "fc-annotate",
        action: "highlight-section",
        section: activeNote?.section || null,
        index: activeIdx,
      }, "*");
    } catch (_) { /* cross-origin or unmounted frame - overlay label covers it */ }
  }, [activeIdx, activeNote]);

  const selectNote = (i) => {
    setSelectedIdx((cur) => (cur === i ? null : i));
    // Jump the stage to the device the note was made on.
    if (notes[i]?.device === "mobile" || notes[i]?.device === "desktop") setDevice(notes[i].device);
  };

  // ── mutations (status / reassign / ask the client) ──
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null); // { kind:'ok'|'err', text }
  const bannerTimer = useRef(null);
  const flash = (kind, text) => {
    setBanner({ kind, text });
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), 4000);
  };
  useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current); }, []);

  const [statusOpen, setStatusOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [reqKind, setReqKind] = useState(null);
  const [reqMsg, setReqMsg] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setStatusOpen(false); setReassignOpen(false); setThreadOpen(false);
    setAskOpen(false); setAiOpen(false); setReqKind(null); setReqMsg(""); setCopied(false);
  }, [ticketId]);

  async function run(fn, okMsg) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (okMsg) flash("ok", okMsg);
      onMutated?.();
    } catch (e) {
      flash("err", e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const doStatus = (status) => {
    setStatusOpen(false);
    run(() => ticketApi(session, ticketId, "status", { status }), "Status updated.");
  };
  const doReassign = (staffId) => {
    setReassignOpen(false);
    run(() => ticketApi(session, ticketId, "reassign", { assigned_to: staffId || null }),
      staffId ? `Reassigned to ${staffMap[staffId] || "staff"}.` : "Set to unassigned.");
  };
  const doAsk = () => {
    if (!reqKind || !reqMsg.trim()) return;
    run(async () => {
      await ticketApi(session, ticketId, "request-client-action", { kind: reqKind, message: reqMsg.trim() });
      setReqKind(null); setReqMsg(""); setAskOpen(false);
    }, "Request sent to the client.");
  };

  const fixCommand = `/website-fix ${ticketId || ""}`.trim();
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(fixCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      flash("err", "Could not copy - select the command and copy it manually.");
    }
  };

  if (!ticket) return null;
  const ownerName = ticket.assigned_to ? (staffMap[ticket.assigned_to] || "Assigned") : null;

  return (
    <section className="w2-sandbox">
      {/* ── Header strip: academy + page, ladder, status + owner + menus ── */}
      <div className="w2-strip">
        <div className="w2-strip-id">
          <span className="w2-strip-avatar">{initials(academyName)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="w2-strip-academy">{academyName || "Academy"}</div>
            {pageUrl
              ? <a className="w2-strip-page" href={pageUrl} target="_blank" rel="noreferrer" title={pageUrl}>{pagePath(pageUrl)}</a>
              : <span className="w2-strip-page">No page URL on this ticket</span>}
          </div>
        </div>
        <StatusLadder status={ticket.status} dark={dark} />
        <div className="w2-strip-controls">
          <StatusPill status={ticket.status} dark={dark} />
          <div className="w2-menuwrap">
            <button type="button" className="w2-mini" disabled={busy} onClick={() => { setReassignOpen((v) => !v); setStatusOpen(false); }}>
              {ownerName || "Unassigned"} <Chevron />
            </button>
            {reassignOpen && (
              <>
                <div className="w2-menu-backdrop" onClick={() => setReassignOpen(false)} />
                <div className="w2-menu">
                  <div className="w2-menu-label">Reassign owner</div>
                  <button type="button" className={`w2-menu-item${!ticket.assigned_to ? " is-current" : ""}`} onClick={() => doReassign(null)}>Unassigned</button>
                  {staffList.map((s) => (
                    <button key={s.id} type="button" className={`w2-menu-item${ticket.assigned_to === s.id ? " is-current" : ""}`} onClick={() => doReassign(s.id)}>
                      {s.name}{s.role ? ` · ${s.role.replace(/_/g, " ")}` : ""}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="w2-menuwrap">
            <button type="button" className="w2-mini" disabled={busy} onClick={() => { setStatusOpen((v) => !v); setReassignOpen(false); }}>
              Status <Chevron />
            </button>
            {statusOpen && (
              <>
                <div className="w2-menu-backdrop" onClick={() => setStatusOpen(false)} />
                <div className="w2-menu">
                  <div className="w2-menu-label">Move ticket</div>
                  {statusOptions(ticket.status).map((o) => (
                    <button key={o.v} type="button" className="w2-menu-item" onClick={() => doStatus(o.v)}>{o.label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button type="button" className="w2-mini" onClick={() => setThreadOpen(true)}>Thread</button>
        </div>
      </div>

      {banner && <div className={`w2-banner w2-banner-${banner.kind}`}>{banner.text}</div>}

      {/* ── Body: live page (left) + notes rail (right) ── */}
      <div className="w2-body">
        <div className="w2-stage-col">
          <div className="w2-devtabs">
            <button type="button" className={`w2-devtab${device === "desktop" ? " is-active" : ""}`} onClick={() => setDevice("desktop")}>
              <MonitorIcon /> Computer
            </button>
            <button type="button" className={`w2-devtab${device === "mobile" ? " is-active" : ""}`} onClick={() => setDevice("mobile")}>
              <PhoneIcon /> Phone
            </button>
            {pageUrl && <span className="w2-devtabs-hint">{pagePath(pageUrl)}</span>}
          </div>
          <div className="w2-stage" ref={stageRef}>
            {src ? (
              <>
                <div className="w2-scaler" style={scalerStyle}>
                  <iframe ref={frameRef} src={src} title={`${academyName || "Client"} page`} />
                </div>
                {activeNote && (
                  <div className="w2-hl">
                    <span className="w2-hl-idx">{activeIdx + 1}</span>
                    <span className="w2-hl-sec">{activeNote.section || "Whole page"}</span>
                    <span className="w2-hl-dev">{activeNote.device === "mobile" ? "Phone" : "Computer"}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="w2-stage-empty">
                We do not have this page's link on the ticket. Ask the client for the page URL, or open the thread.
              </div>
            )}
          </div>
        </div>

        <aside className="w2-side">
          {/* Notes */}
          <div className="w2-side-block">
            <div className="w2-side-label">Client notes ({notes.length})</div>
            {notes.length === 0 ? (
              <div className="w2-side-muted">No section notes on this ticket. Check the thread for the ask.</div>
            ) : (
              <div className="w2-notes">
                {notes.map((n, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`w2-note${activeIdx === i ? " is-active" : ""}`}
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx(null)}
                    onFocus={() => setHoverIdx(i)}
                    onBlur={() => setHoverIdx(null)}
                    onClick={() => selectNote(i)}
                  >
                    <span className="w2-note-idx">{i + 1}</span>
                    <span className="w2-note-body">
                      <span className="w2-note-meta">
                        <span className="w2-note-dev">{n.device === "mobile" ? <PhoneIcon /> : <MonitorIcon />}</span>
                        <span className="w2-note-sec">{n.section || "Whole page"}</span>
                      </span>
                      <span className="w2-note-txt">{n.note || "(no text)"}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Metric snapshot */}
          <div className="w2-side-block">
            <div className="w2-side-label">Page numbers</div>
            {metrics.length === 0 ? (
              <div className="w2-side-muted">No metric snapshot on this ticket.</div>
            ) : (
              <div className="w2-metrics">
                {metrics.map((m) => (
                  <span className="w2-metric" key={m.key}>
                    <span className="w2-metric-key">{m.label}</span>
                    <span className="w2-metric-val">{m.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="w2-side-block">
            <div className="w2-side-label">Actions</div>
            {pending && (
              <div className="w2-pendinghint">
                <span className="w2-pendinghint-head">Waiting on client: {pending.kind}</span>
                {pending.message && <span className="w2-pendinghint-msg">{pending.message}</span>}
              </div>
            )}
            <div className="w2-actions">
              <button type="button" className="v2r-btn v2r-btn-primary" onClick={() => setAiOpen(true)}>
                Draft the fix with AI
              </button>
              <button type="button" className="v2r-btn v2r-btn-secondary" disabled={busy || !!pending} onClick={() => setAskOpen(true)}
                title={pending ? "Already waiting on the client" : undefined}>
                Ask the client
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* ── Draft-the-fix handoff modal ── */}
      {aiOpen && (
        <div className="w2-modal-overlay" onClick={() => setAiOpen(false)}>
          <div className="w2-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Draft the fix with AI">
            <div className="w2-modal-head">
              <div>
                <div className="w2-modal-title">Draft the fix with AI</div>
                <div className="w2-modal-sub">Hands this ticket to the /website-fix skill.</div>
              </div>
              <button type="button" className="w2-modal-close" onClick={() => setAiOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="w2-modal-body is-padded">
              <div className="w2-modal-note">
                Run this command in Claude Code (bam-os-requirements repo). The skill reads the
                ticket's notes, page and numbers, implements the change in bam-client-sites,
                previews it on computer + phone, and updates the ticket when it ships.
              </div>
              <div className="w2-cmd">
                <span className="w2-cmd-text">{fixCommand}</span>
                <button type="button" className="w2-mini" onClick={copyCommand}>{copied ? "Copied" : "Copy"}</button>
              </div>
            </div>
            <div className="w2-modal-foot">
              <button type="button" className="v2r-btn v2r-btn-secondary" onClick={() => setAiOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Ask-the-client modal (request-client-action) ── */}
      {askOpen && (
        <div className="w2-modal-overlay" onClick={() => setAskOpen(false)}>
          <div className="w2-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Ask the client">
            <div className="w2-modal-head">
              <div>
                <div className="w2-modal-title">Ask the client</div>
                <div className="w2-modal-sub">Parks the ticket with the client until they answer.</div>
              </div>
              <button type="button" className="w2-modal-close" onClick={() => setAskOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="w2-modal-body is-padded">
              <div className="w2-kinds">
                {REQUEST_KINDS.map((k) => (
                  <button key={k.id} type="button" className={`w2-kind${reqKind === k.id ? " is-active" : ""}`} onClick={() => setReqKind(k.id)}>{k.label}</button>
                ))}
              </div>
              <textarea className="w2-textarea" placeholder="What do you need from the client?" value={reqMsg} onChange={(e) => setReqMsg(e.target.value)} />
            </div>
            <div className="w2-modal-foot">
              <button type="button" className="v2r-btn v2r-btn-secondary" onClick={() => setAskOpen(false)}>Cancel</button>
              <button type="button" className="v2r-btn v2r-btn-primary" disabled={busy || !reqKind || !reqMsg.trim()} onClick={doAsk}>Send request</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Thread drawer ── */}
      <ThreadDrawer
        open={threadOpen}
        ticket={ticket}
        academyName={academyName}
        session={session}
        dark={dark}
        onClose={() => setThreadOpen(false)}
        onMutated={onMutated}
      />
    </section>
  );
}
