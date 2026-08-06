import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import StatusPill from "../../components/v2rail/StatusPill";
import { ageShort } from "../contentv2/utils";

// Right-side drawer for one backlog ticket (the house detail idiom, per
// design-system/DESIGN.md section 5: no bottom sheets).
//
// The client typed into ONE free-text box and optionally attached a file, so
// this drawer's job is mostly to show what they actually said, unedited, and
// then move the ticket somewhere it will be worked.
//
// THE PRIMARY ACTION IS "SEND TO A TEAM", not "reply". A backlog ticket that
// stays in backlog is a ticket nobody owns.

// Triage targets. Each sets BOTH the lane and the type, deliberately: a `fix`
// dropped into the systems lane renders as an unclickable row on Website V2
// (TicketPicker disables type='fix'), so re-laning without re-typing produces a
// ticket that is technically moved and practically invisible. That exact
// half-move is what this list exists to prevent.
const TRIAGE = [
  { label: "Website change", role: "systems", type: "website_change", hint: "A page needs editing" },
  { label: "Billing fix", role: "systems", type: "billing_fix", hint: "Payments or invoices" },
  { label: "Data fix", role: "systems", type: "data_fix", hint: "Wrong or missing records" },
  { label: "Build request", role: "systems", type: "build_ask", hint: "Something new to build" },
  { label: "Marketing", role: "marketing", type: "marketing_ask", hint: "Campaigns and ad spend" },
  { label: "Content", role: "content", type: "content_ask", hint: "Creative and ads content" },
  { label: "Agent correction", role: "agent_supervision", type: "agent_correction", hint: "The agent got something wrong" },
];

function statusOptions(status) {
  const opts = [];
  if (status === "new" || status === "waiting_client") opts.push({ v: "in_progress", label: "Move to In progress" });
  if (status !== "resolved" && status !== "closed") opts.push({ v: "resolved", label: "Mark resolved" });
  if (status !== "closed") opts.push({ v: "closed", label: "Close ticket" });
  if (status === "resolved" || status === "closed") opts.push({ v: "new", label: "Reopen" });
  return opts;
}

const isImage = (name = "") => /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(String(name));

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
  );
}

export default function BacklogTicketDrawer({
  open, ticket, dark = true, session, staffList = [], academyName, onClose, onMutated,
}) {
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);
  const [triageOpen, setTriageOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const bannerTimer = useRef(null);

  const ticketId = ticket?.id || null;
  const staffMap = useMemo(() => {
    const m = {};
    for (const s of staffList) m[s.id] = s.name;
    return m;
  }, [staffList]);

  // Every menu closes when the drawer moves to a different ticket, otherwise a
  // menu opened on the previous one stays open over the new one.
  useEffect(() => {
    setTriageOpen(false); setStatusOpen(false); setOwnerOpen(false); setBanner(null);
  }, [ticketId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current); }, []);

  const flash = (kindOfBanner, text) => {
    setBanner({ kind: kindOfBanner, text });
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), 4000);
  };

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

  const doTriage = (target) => {
    setTriageOpen(false);
    run(
      () => api("reassign", { assignee_role: target.role, type: target.type }),
      `Sent to ${target.label}. It is out of the backlog now.`,
    );
  };
  const doStatus = (status) => {
    setStatusOpen(false);
    run(() => api("status", { status }), "Status updated.");
  };
  const doOwner = (staffId) => {
    setOwnerOpen(false);
    run(() => api("reassign", { assigned_to: staffId || null }),
      staffId ? `Assigned to ${staffMap[staffId] || "staff"}.` : "Set to unassigned.");
  };

  if (!open || !ticket) return null;

  const intake = ticket.intake || {};
  const trail = intake.context || {};
  const description = (intake.description || "").trim();
  const fileUrl = intake.file_url || null;
  const fileName = intake.file_name || "Attachment";
  const clicks = Array.isArray(trail.clicks) ? trail.clicks : [];
  const errors = Array.isArray(trail.errors) ? trail.errors : [];
  const ownerName = ticket.assigned_to ? (staffMap[ticket.assigned_to] || "Assigned") : null;

  const facts = [
    ["Academy", academyName || "Academy"],
    ["Kind", ticket.type === "fix" ? "Bug report" : "Feature idea"],
    ["Submitted", ageShort(ticket.created_at) ? `${ageShort(ticket.created_at)} ago` : "just now"],
    ["From", trail.view ? `the ${trail.view} view` : (intake.page || "the portal")],
    ["Device", trail.viewport ? `${trail.viewport.w} by ${trail.viewport.h}` : null],
    ["Time on page", trail.seconds_on_page ? `${trail.seconds_on_page}s` : null],
    // The count only, because the error TEXT gets its own block below: on a bug
    // report the actual exception is the most useful thing in the payload and
    // burying it in a definition list wastes it.
    ["Errors on screen", errors.length ? `${errors.length}` : "none"],
  ].filter(([, v]) => v);

  return (
    <div className="bl2-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <aside className="bl2-drawer" role="dialog" aria-modal="true" aria-label="Backlog ticket">
        <header className="bl2-head">
          <div className="bl2-head-main">
            <div className="bl2-head-academy">{academyName || "Academy"}</div>
            <h2 className="bl2-head-title">{ticket.title || "Request"}</h2>
          </div>
          <StatusPill status={ticket.status} dark={dark} />
          <button type="button" className="bl2-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </header>

        {banner && <div className={`bl2-banner bl2-banner-${banner.kind}`}>{banner.text}</div>}

        <div className="bl2-body">
          {/* The client's own words, verbatim. The title above is auto-cut at
              60 characters, so this is the only complete record of the ask. */}
          <section className="bl2-block">
            <div className="bl2-label">What they wrote</div>
            {description
              ? <p className="bl2-said">{description}</p>
              : <p className="bl2-said bl2-said-empty">They attached a file without typing anything.</p>}
          </section>

          {fileUrl && (
            <section className="bl2-block">
              <div className="bl2-label">Attached</div>
              {isImage(fileName)
                ? (
                  <a href={fileUrl} target="_blank" rel="noreferrer" className="bl2-shot">
                    <img src={fileUrl} alt={fileName} loading="lazy" />
                  </a>
                )
                : (
                  <a href={fileUrl} target="_blank" rel="noreferrer" className="bl2-filelink">{fileName}</a>
                )}
            </section>
          )}

          <section className="bl2-block">
            <div className="bl2-label">Where they were</div>
            <dl className="bl2-facts">
              {facts.map(([k, v]) => (
                <div key={k} className="bl2-fact">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          {errors.length > 0 && (
            <section className="bl2-block">
              <div className="bl2-label">What the page threw</div>
              <ul className="bl2-errors">
                {errors.slice(0, 5).map((e, i) => (
                  <li key={i}>{typeof e === "string" ? e : (e?.message || JSON.stringify(e))}</li>
                ))}
              </ul>
            </section>
          )}

          {clicks.length > 0 && (
            <section className="bl2-block">
              <div className="bl2-label">What they tapped first</div>
              {/* The intake records the taps leading up to the report. It is
                  often the fastest way to tell WHICH thing on the page they
                  meant, when the words alone are ambiguous. */}
              <ol className="bl2-trail">
                {clicks.slice(0, 8).map((c, i) => (
                  <li key={i}>
                    <span className="bl2-trail-t">{c.t}s</span>
                    <span className="bl2-trail-el">{c.el}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <footer className="bl2-foot">
          <div className="bl2-menuwrap">
            <button
              type="button"
              className="bl2-primary"
              disabled={busy}
              onClick={() => { setTriageOpen((v) => !v); setStatusOpen(false); setOwnerOpen(false); }}
            >
              Send to a team <Chevron />
            </button>
            {triageOpen && (
              <>
                <div className="bl2-menu-backdrop" onClick={() => setTriageOpen(false)} />
                <div className="bl2-menu bl2-menu-up">
                  <div className="bl2-menu-label">Who owns this work</div>
                  {TRIAGE.map((t) => (
                    <button key={t.label} type="button" className="bl2-menu-item" onClick={() => doTriage(t)}>
                      <span className="bl2-menu-item-main">{t.label}</span>
                      <span className="bl2-menu-item-hint">{t.hint}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="bl2-menuwrap">
            <button
              type="button"
              className="bl2-mini"
              disabled={busy}
              onClick={() => { setOwnerOpen((v) => !v); setTriageOpen(false); setStatusOpen(false); }}
            >
              {ownerName || "Unassigned"} <Chevron />
            </button>
            {ownerOpen && (
              <>
                <div className="bl2-menu-backdrop" onClick={() => setOwnerOpen(false)} />
                <div className="bl2-menu bl2-menu-up">
                  <div className="bl2-menu-label">Assign owner</div>
                  <button type="button" className={`bl2-menu-item${!ticket.assigned_to ? " is-current" : ""}`} onClick={() => doOwner(null)}>
                    <span className="bl2-menu-item-main">Unassigned</span>
                  </button>
                  {staffList.map((s) => (
                    <button key={s.id} type="button" className={`bl2-menu-item${ticket.assigned_to === s.id ? " is-current" : ""}`} onClick={() => doOwner(s.id)}>
                      <span className="bl2-menu-item-main">{s.name}</span>
                      {s.role && <span className="bl2-menu-item-hint">{s.role.replace(/_/g, " ")}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="bl2-menuwrap">
            <button
              type="button"
              className="bl2-mini"
              disabled={busy}
              onClick={() => { setStatusOpen((v) => !v); setTriageOpen(false); setOwnerOpen(false); }}
            >
              Status <Chevron />
            </button>
            {statusOpen && (
              <>
                <div className="bl2-menu-backdrop" onClick={() => setStatusOpen(false)} />
                <div className="bl2-menu bl2-menu-up">
                  <div className="bl2-menu-label">Move ticket</div>
                  {statusOptions(ticket.status).map((o) => (
                    <button key={o.v} type="button" className="bl2-menu-item" onClick={() => doStatus(o.v)}>
                      <span className="bl2-menu-item-main">{o.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </footer>
      </aside>
    </div>
  );
}
