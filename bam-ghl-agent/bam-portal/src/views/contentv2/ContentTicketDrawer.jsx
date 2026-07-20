import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import TicketDrawer from "../../components/v2rail/TicketDrawer";
import StatusPill from "../../components/v2rail/StatusPill";
import StatusLadder from "../../components/v2rail/StatusLadder";
import {
  ageShort, fmtBytes, relTime, assetPublicUrl, isImage, isVideo, isAudio, modeLabel, REQUEST_KINDS,
} from "./utils";

/* ── tiny feather-style icons (stroke SVGs, no emojis) ── */
function Chevron() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>;
}
function UploadIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>;
}
function FileIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></svg>;
}

// Status-menu options available from a given current status.
function statusOptions(status) {
  const opts = [];
  if (status === "new" || status === "waiting_client") opts.push({ v: "in_progress", label: "Move to In progress" });
  if (status !== "resolved" && status !== "closed") opts.push({ v: "resolved", label: "Mark resolved" });
  if (status !== "closed") opts.push({ v: "closed", label: "Close ticket" });
  if (status === "resolved" || status === "closed") opts.push({ v: "new", label: "Reopen" });
  return opts;
}

// One creative reference (edit = ad to edit, replace = failing ad). intake.replacing
// may be an object ({name/label/preview_url/thumbnail/url}) or a plain string.
function ReferenceCard({ mode, replacing, note }) {
  if (!replacing && !note) return null;
  const obj = replacing && typeof replacing === "object" ? replacing : null;
  const name = obj ? (obj.name || obj.label || obj.title || obj.ad_name || obj.id || "Referenced ad")
    : (replacing ? String(replacing) : "Referenced ad");
  const thumb = obj ? (obj.thumbnail || obj.preview_url || obj.thumb || obj.image || obj.url) : null;
  const kind = mode === "replace" ? "Failing ad" : "Ad to edit";
  return (
    <div className="c2-ref">
      {thumb && /^https?:\/\//.test(String(thumb))
        ? <img className="c2-ref-thumb" src={thumb} alt="" />
        : null}
      <div className="c2-ref-body">
        <div className="c2-ref-kind">{kind}</div>
        <div className="c2-ref-name">{name}</div>
        {note && <div className="c2-ref-note">{note}</div>}
      </div>
    </div>
  );
}

// A media thumbnail that opens the file in a new tab.
function Thumb({ url, name, mime }) {
  const label = name || "file";
  if (!url) {
    return <div className="c2-thumb" title={label}><div className="c2-thumb-file">{label}</div></div>;
  }
  const video = isVideo(mime, name);
  const image = isImage(mime, name);
  const audio = isAudio(mime, name);
  if (audio) {
    return (
      <div className="c2-thumb c2-thumb-audio" title={label}>
        <audio controls preload="metadata" src={url} />
      </div>
    );
  }
  return (
    <a className="c2-thumb" href={url} target="_blank" rel="noreferrer" title={label}>
      {image ? <img src={url} alt={label} loading="lazy" />
        : video ? (<><video src={url} muted preload="metadata" /><span className="c2-thumb-badge">Video</span></>)
        : <div className="c2-thumb-file">{label}</div>}
    </a>
  );
}

export default function ContentTicketDrawer({
  open, ticket, dark = true, session, staffList = [], academyName, onClose, onMutated,
}) {
  const staffMap = useMemo(() => {
    const m = {};
    for (const s of staffList) m[s.id] = s.name;
    return m;
  }, [staffList]);

  // ── thread + client-asset previews (read via supabase-js; realtime below) ──
  const [thread, setThread] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [assets, setAssets] = useState([]);

  // ── local UI state ──
  const [banner, setBanner] = useState(null); // { kind:'ok'|'err', text }
  const [busy, setBusy] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [composer, setComposer] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [reqKind, setReqKind] = useState(null);
  const [reqMsg, setReqMsg] = useState("");
  const [reviewFirst, setReviewFirst] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [upDone, setUpDone] = useState(0);
  const [upTotal, setUpTotal] = useState(0);
  const fileRef = useRef(null);
  const bannerTimer = useRef(null);

  const ticketId = ticket?.id || null;
  const intake = ticket?.intake || {};
  const finals = Array.isArray(intake.final_files) ? intake.final_files : [];
  const pending = intake.pending_request || null;
  const assetIds = Array.isArray(intake.asset_ids) ? intake.asset_ids : [];
  const mode = intake.mode || (intake.replacing ? "edit" : "new");

  function flash(kind, text) {
    setBanner({ kind, text });
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), 4000);
  }
  useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current); }, []);

  // Reset transient UI when a different ticket opens.
  useEffect(() => {
    setBanner(null); setComposer(""); setInternalNote(false);
    setReqKind(null); setReqMsg(""); setReviewFirst(false);
    setReassignOpen(false); setStatusOpen(false);
  }, [ticketId]);

  // ── Thread: load + realtime (messages for this ticket) ──
  async function loadThread() {
    if (!ticketId) return;
    setThreadLoading(true);
    const { data, error } = await supabase
      .from("v2_ticket_messages")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    if (!error) setThread(data || []);
    setThreadLoading(false);
  }
  useEffect(() => {
    if (!ticketId) { setThread([]); return; }
    loadThread();
    const ch = supabase
      .channel(`c2-thread-${ticketId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "v2_ticket_messages", filter: `ticket_id=eq.${ticketId}` },
        () => loadThread())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  // ── Client-content previews: resolve intake.asset_ids -> client_assets ──
  const assetKey = JSON.stringify(assetIds);
  useEffect(() => {
    if (!assetIds.length) { setAssets([]); return; }
    let cancelled = false;
    supabase
      .from("client_assets")
      .select("id,label,category,storage_path,link_url,mime_type")
      .in("id", assetIds)
      .then(({ data }) => { if (!cancelled) setAssets(data || []); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetKey]);

  // ── Mutations all go through the API (Bearer token) ──
  async function api(action, body) {
    const { data: { session: fresh } } = await supabase.auth.getSession();
    const token = fresh?.access_token || session?.access_token;
    const res = await fetch(`/api/v2-tickets?action=${action}&id=${encodeURIComponent(ticketId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (_) { /* non-JSON error */ }
    if (!res.ok) throw new Error(json.error || (text ? text.slice(0, 180) : `HTTP ${res.status}`));
    return json;
  }

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

  const doReassign = (staffId) => {
    setReassignOpen(false);
    run(() => api("reassign", { assigned_to: staffId || null }),
      staffId ? `Reassigned to ${staffMap[staffId] || "staff"}.` : "Set to unassigned.");
  };
  const doStatus = (status) => {
    setStatusOpen(false);
    run(() => api("status", { status }), "Status updated.");
  };
  const doReply = () => {
    const body = composer.trim();
    if (!body) return;
    run(async () => {
      await api("reply", { body, internal: internalNote });
      setComposer(""); setInternalNote(false);
      await loadThread();
    });
  };
  const doRequest = () => {
    if (!reqKind || !reqMsg.trim()) return;
    run(async () => {
      await api("request-client-action", { kind: reqKind, message: reqMsg.trim() });
      setReqKind(null); setReqMsg("");
    }, "Request sent to the client.");
  };
  const doSendToMarketing = () => {
    if (!finals.length) return;
    run(() => api("send-to-marketing", { review_requested: reviewFirst }),
      reviewFirst ? "Sent to the client for review." : "Handed off to marketing.");
  };

  // ── Upload finished creative -> ticket-files bucket -> upload-final ──
  async function uploadFinals(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || uploading) return;
    setUploading(true); setUpTotal(files.length); setUpDone(0);
    try {
      const results = new Array(files.length);
      let next = 0;
      async function worker() {
        for (;;) {
          const i = next++;
          if (i >= files.length) return;
          const file = files[i];
          const uid = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = `content-v2/${ticketId}/${uid}-${safe}`;
          const { error: upErr } = await supabase.storage.from("ticket-files")
            .upload(path, file, { contentType: file.type || "application/octet-stream", cacheControl: "3600" });
          if (upErr) throw new Error(`Upload failed (${file.name}): ${upErr.message}`);
          const { data: urlData } = supabase.storage.from("ticket-files").getPublicUrl(path);
          results[i] = { name: file.name, url: urlData.publicUrl, size: file.size || 0, mime: file.type || "" };
          setUpDone((d) => d + 1);
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
      const uploaded = results.filter(Boolean);
      await api("upload-final", { files: uploaded });
      flash("ok", `Uploaded ${uploaded.length} file${uploaded.length === 1 ? "" : "s"}.`);
      onMutated?.();
    } catch (e) {
      flash("err", e?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer?.files?.length) uploadFinals(e.dataTransfer.files);
  };

  const downloadAll = (list) => {
    (list || []).forEach((f, i) => {
      const url = f.url || assetPublicUrl(f);
      if (!url) return;
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = url; a.target = "_blank"; a.rel = "noreferrer";
        if (f.name) a.download = f.name;
        document.body.appendChild(a); a.click(); a.remove();
      }, i * 150);
    });
  };

  if (!open || !ticket) {
    return <TicketDrawer open={false} onClose={onClose} dark={dark} />;
  }

  const ownerName = ticket.assigned_to ? (staffMap[ticket.assigned_to] || "Assigned") : null;
  const offerVal = intake.offer ?? intake.offer_id;
  const presetVal = intake.sales_preset ?? intake.preset;
  const angleVal = intake.angle;
  const editNote = mode === "edit"
    ? (intake.replacing?.note || intake.note || intake.edit_note || "")
    : "";
  const replaceNote = mode === "replace"
    ? (intake.replacing?.why || intake.why || intake.reason || intake.replacing?.note || "")
    : "";

  // ── Header (title + academy, ladder, status pill, owner + reassign, status menu) ──
  const header = (
    <div className="c2-head">
      <div>
        <div className="c2-head-title">{ticket.title || "Content ask"}</div>
        <div className="c2-head-academy">
          {academyName || "Academy"}{modeLabel(mode) ? ` · ${modeLabel(mode)}` : ""}
        </div>
      </div>
      <StatusLadder status={ticket.status} dark={dark} />
      <div className="c2-head-controls">
        <StatusPill status={ticket.status} dark={dark} />
        <div className="c2-menuwrap">
          <button type="button" className="c2-mini" disabled={busy} onClick={() => { setReassignOpen((v) => !v); setStatusOpen(false); }}>
            {ownerName || "Unassigned"} <Chevron />
          </button>
          {reassignOpen && (
            <>
              <div className="c2-menu-backdrop" onClick={() => setReassignOpen(false)} />
              <div className="c2-menu">
                <div className="c2-menu-label">Reassign owner</div>
                <button type="button" className={`c2-menu-item${!ticket.assigned_to ? " is-current" : ""}`} onClick={() => doReassign(null)}>Unassigned</button>
                {staffList.map((s) => (
                  <button key={s.id} type="button" className={`c2-menu-item${ticket.assigned_to === s.id ? " is-current" : ""}`} onClick={() => doReassign(s.id)}>
                    {s.name}{s.role ? ` · ${s.role.replace(/_/g, " ")}` : ""}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="c2-menuwrap">
          <button type="button" className="c2-mini" disabled={busy} onClick={() => { setStatusOpen((v) => !v); setReassignOpen(false); }}>
            Status <Chevron />
          </button>
          {statusOpen && (
            <>
              <div className="c2-menu-backdrop" onClick={() => setStatusOpen(false)} />
              <div className="c2-menu">
                <div className="c2-menu-label">Move ticket</div>
                {statusOptions(ticket.status).map((o) => (
                  <button key={o.v} type="button" className="c2-menu-item" onClick={() => doStatus(o.v)}>{o.label}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // ── Footer (review checkbox + send-to-marketing primary) ──
  const footer = (
    <>
      <label className="c2-foot-review">
        <input type="checkbox" checked={reviewFirst} disabled={busy} onChange={(e) => setReviewFirst(e.target.checked)} />
        Send for client review first
      </label>
      <button type="button" className="v2r-btn v2r-btn-secondary" onClick={onClose}>Close</button>
      <button type="button" className="v2r-btn v2r-btn-primary" disabled={busy || !finals.length} onClick={doSendToMarketing}
        title={!finals.length ? "Upload the finished creative first" : undefined}>
        Send to marketing
      </button>
    </>
  );

  return (
    <TicketDrawer open={open} onClose={onClose} dark={dark} header={header} footer={footer}>
      {banner && <div className={`c2-banner c2-banner-${banner.kind}`}>{banner.text}</div>}

      {/* Intake */}
      <div className="c2-block">
        <div className="c2-block-label">Intake</div>
        {(offerVal || presetVal || angleVal) ? (
          <div className="c2-chips">
            {offerVal && <span className="c2-chip"><span className="c2-chip-key">Offer</span><span className="c2-chip-val">{String(offerVal)}</span></span>}
            {presetVal && <span className="c2-chip"><span className="c2-chip-key">Preset</span><span className="c2-chip-val">{String(presetVal)}</span></span>}
            {angleVal && <span className="c2-chip"><span className="c2-chip-key">Angle</span><span className="c2-chip-val">{String(angleVal)}</span></span>}
          </div>
        ) : <div className="c2-muted">No offer, preset or angle on this ask.</div>}
        {(mode === "edit" || mode === "replace") && (
          <ReferenceCard mode={mode} replacing={intake.replacing} note={mode === "replace" ? replaceNote : editNote} />
        )}
      </div>

      {/* Client content */}
      <div className="c2-block">
        <div className="c2-block-row">
          <div className="c2-block-label">Client content</div>
          {assets.some((a) => assetPublicUrl(a)) && (
            <button type="button" className="c2-linkbtn" onClick={() => downloadAll(assets.map((a) => ({ url: assetPublicUrl(a), name: a.label })))}>Download all</button>
          )}
        </div>
        {assetIds.length > 0 ? (
          assets.length > 0 ? (
            <div className="c2-thumbs">
              {assets.map((a) => <Thumb key={a.id} url={assetPublicUrl(a)} name={a.label || a.category} mime={a.mime_type} />)}
            </div>
          ) : <div className="c2-muted">{assetIds.length} file{assetIds.length === 1 ? "" : "s"} attached (preview unavailable).</div>
        ) : null}
        {intake.brief ? <div className="c2-brief">{String(intake.brief)}</div>
          : (assetIds.length === 0 && <div className="c2-muted">No client content attached.</div>)}
      </div>

      {/* Finished creative */}
      <div className="c2-block">
        <div className="c2-block-row">
          <div className="c2-block-label">Finished creative</div>
          {finals.length > 0 && (
            <button type="button" className="c2-linkbtn" onClick={() => downloadAll(finals)}>Download all</button>
          )}
        </div>
        <div
          className={`c2-drop${dragOver ? " is-over" : ""}${uploading ? " is-busy" : ""}`}
          onClick={() => !uploading && fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!uploading) fileRef.current?.click(); } }}
        >
          <UploadIcon />
          {uploading
            ? <span>Uploading {upDone}/{upTotal}...</span>
            : <><span className="c2-drop-strong">Drop the finished creative</span><span>or click to choose files</span></>}
        </div>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: "none" }}
          onChange={(e) => { uploadFinals(e.target.files); if (fileRef.current) fileRef.current.value = ""; }} />
        {finals.length > 0 && (
          <div className="c2-files">
            {finals.map((f, i) => (
              <div className="c2-file" key={`${f.url || f.name}-${i}`}>
                <span className="c2-file-icon"><FileIcon /></span>
                <span className="c2-file-name">{f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.name || "final"}</a> : (f.name || "final")}</span>
                {fmtBytes(f.size) && <span className="c2-file-size">{fmtBytes(f.size)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Request from client */}
      <div className="c2-block">
        <div className="c2-block-label">Request from client</div>
        {pending ? (
          <div className="c2-pending">
            <span className="c2-pending-head">Waiting on client: {pending.kind}</span>
            {pending.message && <span className="c2-pending-msg">{pending.message}</span>}
          </div>
        ) : (
          <>
            <div className="c2-kinds">
              {REQUEST_KINDS.map((k) => (
                <button key={k.id} type="button" className={`c2-kind${reqKind === k.id ? " is-active" : ""}`} onClick={() => setReqKind(k.id)}>{k.label}</button>
              ))}
            </div>
            <textarea className="c2-textarea" placeholder="What do you need from the client?" value={reqMsg} onChange={(e) => setReqMsg(e.target.value)} />
            <div>
              <button type="button" className="v2r-btn v2r-btn-secondary" disabled={busy || !reqKind || !reqMsg.trim()} onClick={doRequest}>Send request</button>
            </div>
          </>
        )}
      </div>

      {/* Thread */}
      <div className="c2-block">
        <div className="c2-block-label">Thread</div>
        {threadLoading && thread.length === 0 ? (
          <div className="c2-muted">Loading conversation...</div>
        ) : thread.length === 0 ? (
          <div className="c2-muted">No messages yet.</div>
        ) : (
          <div className="c2-thread">
            {thread.map((m) => {
              if (m.author_kind === "system") {
                return <div className="c2-msg c2-msg-system" key={m.id}><div className="c2-sys">{m.body}</div></div>;
              }
              const cls = m.author_kind === "staff" ? "c2-msg-staff" : m.author_kind === "agent" ? "c2-msg-agent" : "c2-msg-client";
              const atts = Array.isArray(m.attachments) ? m.attachments : [];
              return (
                <div className={`c2-msg ${cls}${m.internal ? " c2-msg-internal" : ""}`} key={m.id}>
                  <div className="c2-msg-bubble">{m.body}</div>
                  {atts.length > 0 && (
                    <div className="c2-msg-att">
                      {atts.map((a, i) => <a key={i} href={a.url || "#"} target="_blank" rel="noreferrer">{a.name || "attachment"}</a>)}
                    </div>
                  )}
                  <div className="c2-msg-meta">
                    {m.internal && <span className="c2-msg-tag">Internal</span>}
                    <span>{m.author_name || m.author_kind}</span>
                    <span>{relTime(m.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Composer */}
        <div className="c2-composer">
          <textarea className="c2-textarea" placeholder={internalNote ? "Internal note (staff only)..." : "Reply to the client..."} value={composer} onChange={(e) => setComposer(e.target.value)} />
          <div className="c2-composer-row">
            <label className="c2-toggle">
              <input type="checkbox" checked={internalNote} onChange={(e) => setInternalNote(e.target.checked)} />
              Internal note
            </label>
            <button type="button" className="v2r-btn v2r-btn-primary" disabled={busy || !composer.trim()} onClick={doReply}>
              {internalNote ? "Add note" : "Send reply"}
            </button>
          </div>
        </div>
      </div>
    </TicketDrawer>
  );
}
