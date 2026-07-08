import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import AgentSessionsPanel from "./AgentSessionsPanel";
import AppErrorsPanel from "./AppErrorsPanel";

// ─── Feedback tab ────────────────────────────────────────────────────────────
// ADMIN-ONLY view that lists all submissions from portal_feedback.
// Sources of submissions: universal floating Bug/Feature widget on
//   - client portal (client-portal.html)
//   - signup page  (onboarding.html)
//   - staff portal (UniversalFeedbackWidget mounted in App.jsx)
// Each row shows kind (Bug/Feature), body, file, who/where/when, and a
// checkbox to mark it resolved (or un-resolve). Items not yet resolved
// float to the top; resolved items sink to the bottom and dim out.
// ────────────────────────────────────────────────────────────────────────────

export default function FeedbackView({ tokens, dark, session }) {
  const t = tokens;
  // Top-level switcher: 'feedback' (default) | 'sessions' | 'app-errors'
  const [section, setSection] = useState("feedback");
  const [feedback, setFeedback] = useState([]);
  const [staffMap, setStaffMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [kindFilter, setKindFilter] = useState("all");     // all | bug | feature
  const [portalFilter, setPortalFilter] = useState("all"); // all | client | staff | signup
  const [statusFilter, setStatusFilter] = useState("open"); // open | resolved | all (default to open — what Zoran cares about)
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const tok = session?.access_token;
        const portalQs = portalFilter === "all" ? "" : `&portal=${portalFilter}`;
        const kindQs = kindFilter === "all" ? "" : `&kind=${kindFilter}`;
        // CRITICAL: method MUST be POST. The list-feedback action lives inside
        // the api/clients.js POST handler. A GET falls through to the catch-all
        // that returns the clients list instead, silently swapping the data.
        const res = await fetch(`/api/clients?action=list-feedback&limit=300${portalQs}${kindQs}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setFeedback(json.data || []);

        const staffIds = Array.from(new Set((json.data || []).map(f => f.author_id).filter(Boolean)));
        if (staffIds.length) {
          const { data: rows } = await supabase
            .from("staff")
            .select("id,name,email")
            .in("id", staffIds);
          if (!cancelled && rows) {
            setStaffMap(Object.fromEntries(rows.map(r => [r.id, r])));
          }
        }
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setErr(e.message);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session, kindFilter, portalFilter, refresh]);

  // Apply status filter client-side (simpler than another query param)
  const visible = useMemo(() => {
    if (statusFilter === "open") return feedback.filter(f => !f.resolved_at);
    if (statusFilter === "resolved") return feedback.filter(f => f.resolved_at);
    return feedback;
  }, [feedback, statusFilter]);

  const counts = useMemo(() => {
    const open = feedback.filter(f => !f.resolved_at).length;
    const resolved = feedback.filter(f => f.resolved_at).length;
    const bugs = feedback.filter(f => f.kind === "bug").length;
    const features = feedback.filter(f => f.kind === "feature").length;
    return { total: feedback.length, open, resolved, bugs, features };
  }, [feedback]);

  // Toggle a single item's resolved state via the API. Optimistically update
  // local state so the row moves immediately; revert on error.
  const toggleResolved = async (item) => {
    const willResolve = !item.resolved_at;
    const tok = session?.access_token;
    // Optimistic update
    setFeedback(prev => prev.map(f => f.id === item.id
      ? { ...f, resolved_at: willResolve ? new Date().toISOString() : null }
      : f));
    try {
      const undo = willResolve ? "" : "&undo=1";
      const res = await fetch(`/api/clients?action=resolve-feedback&id=${encodeURIComponent(item.id)}${undo}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    } catch (e) {
      // Revert
      setFeedback(prev => prev.map(f => f.id === item.id
        ? { ...f, resolved_at: item.resolved_at }
        : f));
      alert(`Failed to update: ${e.message}`);
    }
  };

  // "Build spec" — turn a feedback item into a ready-to-build GitHub issue
  // (Claude writes the spec). Stores the issue URL on the row so it isn't redone.
  const specItem = async (item) => {
    const tok = session?.access_token;
    const res = await fetch(`/api/clients?action=feedback-spec&id=${encodeURIComponent(item.id)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}` },
    });
    const j = await res.json().catch(() => ({}));
    if (j.reason === "github_not_configured") {
      alert("GitHub isn't connected yet — an admin needs to set GITHUB_TOKEN + GITHUB_REPO in Vercel.");
      return;
    }
    if (!res.ok || !j.url) {
      alert("Couldn't create the spec: " + (j.error || res.statusText));
      return;
    }
    setFeedback(prev => prev.map(f => (f.id === item.id ? { ...f, github_issue_url: j.url } : f)));
    window.open(j.url, "_blank");
  };

  return (
    <div>
      {/* Section switcher: Feedback vs Agent Sessions */}
      <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
        {[
          { key: "feedback", label: "Feedback" },
          { key: "ship", label: "🚀 Ship queue" },
          { key: "app-errors", label: "App errors" },
          { key: "sessions", label: "Agent sessions" },
        ].map(s => {
          const active = section === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border: `1px solid ${active ? t.accent : t.border}`,
                background: active ? t.accent : "transparent",
                color: active ? "#000" : t.textMute,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {section === "sessions" ? (
        <AgentSessionsPanel tokens={t} dark={dark} />
      ) : section === "app-errors" ? (
        <AppErrorsPanel tokens={t} session={session} />
      ) : section === "ship" ? (
        <ShipQueuePanel tokens={t} session={session} />
      ) : (<>
      {/* Header counts */}
      <div style={{ display: "flex", gap: 32, marginBottom: 24, alignItems: "baseline", flexWrap: "wrap" }}>
        <Stat label="Open" value={counts.open} tokens={t} accent={counts.open > 0 ? t.amber : t.text} />
        <Stat label="Resolved" value={counts.resolved} tokens={t} accent={t.green} />
        <Stat label="Bugs" value={counts.bugs} tokens={t} />
        <Stat label="Features" value={counts.features} tokens={t} />
      </div>

      {/* Filter rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        <FilterRow
          tokens={t}
          label="Status"
          options={[
            { value: "open", label: `Open ${counts.open}` },
            { value: "resolved", label: `Resolved ${counts.resolved}` },
            { value: "all", label: `All ${counts.total}` },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <FilterRow
          tokens={t}
          label="Kind"
          options={[
            { value: "all", label: `All` },
            { value: "bug", label: `🐛 Bug ${counts.bugs}` },
            { value: "feature", label: `✨ Feature ${counts.features}` },
          ]}
          value={kindFilter}
          onChange={setKindFilter}
        />
        <FilterRow
          tokens={t}
          label="Source"
          options={[
            { value: "all", label: `All` },
            { value: "client", label: `Client portal` },
            { value: "staff", label: `Staff portal` },
            { value: "signup", label: `Signup page` },
            { value: "spec", label: `Offer spec` },
          ]}
          value={portalFilter}
          onChange={setPortalFilter}
          extra={
            <button
              onClick={() => setRefresh(x => x + 1)}
              style={{
                marginLeft: "auto", padding: "6px 12px", background: "transparent",
                color: t.textSub, border: `1px solid ${t.border}`, borderRadius: 6,
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}
            >Refresh</button>
          }
        />
      </div>

      {loading && <div style={{ color: t.textMute, padding: 24 }}>Loading feedback…</div>}
      {err && <div style={{ color: t.red, padding: 24 }}>Error: {err}</div>}
      {!loading && !err && visible.length === 0 && (
        <div style={{ color: t.textMute, padding: 48, textAlign: "center", fontStyle: "italic" }}>
          {statusFilter === "resolved" ? "No resolved feedback yet." : "Nothing here. Feedback widget submissions land in this tab."}
        </div>
      )}

      {!loading && !err && visible.length > 0 && (
        <div style={{ display: "grid", gap: 12 }}>
          {visible.map(f => (
            <FeedbackRow key={f.id} f={f} staff={staffMap[f.author_id]} tokens={t} onToggleResolved={() => toggleResolved(f)} onSpec={() => specItem(f)} />
          ))}
        </div>
      )}
      </>)}
    </div>
  );
}

function FilterRow({ tokens, label, options, value, onChange, extra }) {
  const t = tokens;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <div style={{ width: 64, fontSize: 11, fontWeight: 600, color: t.textMute, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: "7px 14px",
            background: value === o.value ? t.surface : t.surfaceEl,
            color: value === o.value ? t.text : t.textMute,
            border: `1px solid ${value === o.value ? (t.borderStr || t.border) : t.border}`,
            borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}
        >{o.label}</button>
      ))}
      {extra}
    </div>
  );
}

// Auto-captured context snapshot attached by the client-portal widget:
// tier, active view, click path, view trail, JS errors, device. Collapsed
// to a one-line summary until expanded. Read alongside /v2-tickets triage.
function ContextPanel({ ctx, t }) {
  const [open, setOpen] = useState(false);
  const clicks = Array.isArray(ctx.clicks) ? ctx.clicks : [];
  const views = Array.isArray(ctx.view_trail) ? ctx.view_trail : [];
  const errors = Array.isArray(ctx.errors) ? ctx.errors : [];
  const summary = [
    ctx.tier ? ctx.tier.toUpperCase() : null,
    ctx.view ? `view: ${ctx.view}` : null,
    clicks.length ? `${clicks.length} clicks` : null,
    errors.length ? `${errors.length} JS error${errors.length > 1 ? "s" : ""}` : null,
    ctx.native_app ? "native app" : null,
  ].filter(Boolean).join(" · ");
  const mono = { fontFamily: "JetBrains Mono, monospace" };

  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6,
          border: `1px solid ${t.border}`, background: t.surface,
          color: errors.length ? (t.red || "#ED7969") : t.textMute,
          cursor: "pointer", fontFamily: "inherit",
        }}
      >{open ? "▾" : "▸"} 🧭 Context{summary ? ` · ${summary}` : ""}</button>

      {open && (
        <div style={{
          marginTop: 8, padding: "10px 12px", background: t.surface,
          border: `1px solid ${t.border}`, borderRadius: 6,
          fontSize: 11, color: t.textMute, lineHeight: 1.7, ...mono,
        }}>
          {ctx.url && <div>url: {ctx.url}</div>}
          {ctx.academy && <div>academy: {ctx.academy}</div>}
          {ctx.viewport && <div>viewport: {ctx.viewport.w}×{ctx.viewport.h}{ctx.native_app ? " (native app)" : ""}</div>}
          {typeof ctx.seconds_on_page === "number" && <div>time on page: {Math.round(ctx.seconds_on_page / 60)}m {ctx.seconds_on_page % 60}s</div>}
          {views.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 700, color: t.text }}>View trail</div>
              {views.map((v, i) => <div key={i}>+{v.t}s → {v.view}</div>)}
            </div>
          )}
          {clicks.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 700, color: t.text }}>Click path (last {clicks.length})</div>
              {clicks.map((c, i) => <div key={i}>+{c.t}s [{c.view || "?"}] {c.el}</div>)}
            </div>
          )}
          {errors.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 700, color: t.red || "#ED7969" }}>JS errors</div>
              {errors.map((e, i) => <div key={i} style={{ color: t.red || "#ED7969" }}>+{e.t}s {e.msg}</div>)}
            </div>
          )}
          {ctx.ua && <div style={{ marginTop: 6, opacity: 0.7 }}>{ctx.ua}</div>}
        </div>
      )}
    </div>
  );
}

function FeedbackRow({ f, staff, tokens, onToggleResolved, onSpec }) {
  const t = tokens;
  const resolved = !!f.resolved_at;
  const [specBusy, setSpecBusy] = useState(false);
  const portalColor = f.portal === "client" ? t.amber
    : f.portal === "signup" ? "#6EB4FF"
    : f.portal === "spec" ? "#E8C547"
    : t.green;
  const portalLabel = f.portal === "client" ? "Client portal"
    : f.portal === "signup" ? "Signup page"
    : f.portal === "spec" ? "Offer spec"
    : "Staff portal";
  const kindColor = f.kind === "feature" ? "#C787FF" : (t.red || "#ED7969");
  const kindLabel = f.kind === "feature" ? "✨ Feature" : "🐛 Bug";
  const author = staff?.name || f.submitter_email || "Anonymous";
  const when = f.created_at ? new Date(f.created_at).toLocaleString() : "";
  const isImage = f.file_url && /\.(png|jpe?g|gif|webp|svg)$/i.test(f.file_url);

  return (
    <div style={{
      background: t.surfaceEl, border: `1px solid ${t.border}`,
      borderRadius: 8, padding: "14px 18px 16px",
      borderLeft: `3px solid ${resolved ? t.green : kindColor}`,
      opacity: resolved ? 0.55 : 1,
      transition: "opacity 0.25s ease",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        {/* Resolve checkbox */}
        <label style={{
          flexShrink: 0, marginTop: 2,
          width: 22, height: 22, borderRadius: 6,
          border: `2px solid ${resolved ? (t.green || "#7ED996") : t.border}`,
          background: resolved ? (t.green || "#7ED996") : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", transition: "all 0.18s ease",
        }} title={resolved ? "Mark as open" : "Mark as resolved"}>
          <input
            type="checkbox"
            checked={resolved}
            onChange={onToggleResolved}
            style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
          />
          {resolved && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </label>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase", padding: "3px 8px", borderRadius: 999,
              background: `${kindColor}22`, color: kindColor,
            }}>{kindLabel}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase", padding: "3px 8px", borderRadius: 999,
              background: `${portalColor}1A`, color: portalColor,
            }}>{portalLabel}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: t.text, textDecoration: resolved ? "line-through" : "none" }}>{author}</span>
            {f.submitter_email && f.submitter_email !== author && (
              <span style={{ fontSize: 12, color: t.textMute }}>{f.submitter_email}</span>
            )}
            {f.client_name && (
              <span style={{ fontSize: 11, fontWeight: 700, color: t.accent || t.text, border: `1px solid ${t.border}`, borderRadius: 999, padding: "2px 8px" }}>🏠 {f.client_name}</span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 12, color: t.textMute, fontFamily: "JetBrains Mono, monospace" }}>{when}</span>
          </div>

          <div style={{
            fontSize: 14, color: t.text, lineHeight: 1.6, whiteSpace: "pre-wrap",
            textDecoration: resolved ? "line-through" : "none",
            marginBottom: f.file_url || f.page ? 10 : 0,
          }}>
            {f.body}
          </div>

          {f.file_url && (
            <div style={{ marginTop: 10 }}>
              {isImage ? (
                <a href={f.file_url} target="_blank" rel="noreferrer" style={{ display: "inline-block" }}>
                  <img
                    src={f.file_url}
                    alt={f.file_name || "attachment"}
                    style={{
                      maxWidth: 360, maxHeight: 240, borderRadius: 6,
                      border: `1px solid ${t.border}`, display: "block",
                    }}
                  />
                </a>
              ) : (
                <a href={f.file_url} target="_blank" rel="noreferrer" style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "8px 12px", background: t.surface,
                  border: `1px solid ${t.border}`, borderRadius: 6,
                  color: t.text, textDecoration: "none", fontSize: 13,
                }}>📎 {f.file_name || "Attachment"} ↗</a>
              )}
            </div>
          )}

          {f.page && (
            <div style={{ marginTop: 10, fontSize: 11, color: t.textMute, fontFamily: "JetBrains Mono, monospace" }}>
              Page: {f.page}
            </div>
          )}

          {f.context && typeof f.context === "object" && <ContextPanel ctx={f.context} t={t} />}

          {/* Build spec → GitHub issue (Phase 2 of feedback → action) */}
          <div style={{ marginTop: 12 }}>
            {f.github_issue_url ? (
              <a href={f.github_issue_url} target="_blank" rel="noreferrer" style={{
                display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600,
                color: t.accent || "#E8C547", textDecoration: "none",
              }}>📋 View build spec ↗</a>
            ) : !resolved ? (
              <button
                onClick={async () => { setSpecBusy(true); try { await onSpec(); } finally { setSpecBusy(false); } }}
                disabled={specBusy}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6,
                  border: `1px solid ${t.border}`, background: t.surface, color: t.text,
                  cursor: specBusy ? "default" : "pointer", fontFamily: "inherit",
                }}
              >{specBusy ? "Building spec…" : "✨ Build spec"}</button>
            ) : null}
          </div>

          {resolved && f.resolved_at && (
            <div style={{ marginTop: 8, fontSize: 11, color: t.green || "#7ED996", fontWeight: 600 }}>
              ✓ Resolved {new Date(f.resolved_at).toLocaleString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Portal-native Ship Queue — approve auto-built changes here; never touch GitHub.
function ShipQueuePanel({ tokens, session }) {
  const t = tokens;
  const [prs, setPrs] = useState(null);          // null = loading
  const [reason, setReason] = useState(null);
  const [busyPr, setBusyPr] = useState(null);
  const [shippedCount, setShippedCount] = useState(0);

  const load = async () => {
    try {
      const tok = session?.access_token;
      const res = await fetch("/api/clients?action=ship-queue", { headers: { Authorization: `Bearer ${tok}` } });
      const j = await res.json().catch(() => ({}));
      if (j.reason === "github_not_configured") setReason("github_not_configured");
      setPrs(Array.isArray(j.prs) ? j.prs : []);
    } catch { setPrs([]); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ship = async (pr) => {
    if (!window.confirm(`Ship "${pr.title}"?\n\nThis merges it and deploys to production.`)) return;
    setBusyPr(pr.number);
    try {
      const tok = session?.access_token;
      const res = await fetch(`/api/clients?action=ship-merge&pr=${pr.number}`, { method: "POST", headers: { Authorization: `Bearer ${tok}` } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { alert("Couldn't ship: " + (j.error || res.statusText)); return; }
      setPrs(prev => (prev || []).filter(p => p.number !== pr.number));
      setShippedCount(n => n + 1);
    } catch (e) { alert("Ship failed: " + (e?.message || e)); }
    finally { setBusyPr(null); }
  };

  const checkBadge = (state) => {
    const map = {
      success: { c: t.green, label: "✓ checks passed" },
      pending: { c: t.amber, label: "… checks running" },
      failure: { c: t.red || "#ED7969", label: "✕ checks failing" },
      unknown: { c: t.textMute, label: "checks: n/a" },
    };
    const m = map[state] || map.unknown;
    return <span style={{ fontSize: 11, fontWeight: 700, color: m.c }}>{m.label}</span>;
  };

  if (prs === null) return <div style={{ color: t.textMute, padding: 24 }}>Loading…</div>;

  if (reason === "github_not_configured") {
    return (
      <div style={{ color: t.textMute, padding: 24, lineHeight: 1.6 }}>
        Auto-build isn't connected yet. Once the Claude GitHub App + <code>ANTHROPIC_API_KEY</code> are set up,
        built changes show up here to approve in one tap.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: t.text, fontWeight: 600 }}>Ready to ship</div>
        <div style={{ fontSize: 12, color: t.textMute }}>{prs.length} waiting{shippedCount ? ` · ${shippedCount} shipped` : ""}</div>
        <button onClick={load} style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6, border: `1px solid ${t.border}`, background: t.surface, color: t.text, cursor: "pointer" }}>Refresh</button>
      </div>

      {prs.length === 0 ? (
        <div style={{ color: t.textMute, padding: 24, fontStyle: "italic" }}>Nothing waiting to ship. Built changes from feedback land here.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {prs.map(pr => (
            <div key={pr.number} style={{ background: t.surfaceEl, border: `1px solid ${t.border}`, borderRadius: 8, padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{pr.title}</span>
                {checkBadge(pr.checks)}
                <a href={pr.url} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", fontSize: 11, color: t.textMute, textDecoration: "none" }}>view diff ↗</a>
              </div>
              {pr.summary && (
                <div style={{ fontSize: 13, color: t.textSub || t.textMute, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 12, maxHeight: 160, overflow: "auto" }}>{pr.summary}</div>
              )}
              <button
                onClick={() => ship(pr)}
                disabled={busyPr === pr.number}
                style={{
                  fontSize: 13, fontWeight: 700, padding: "8px 16px", borderRadius: 6, border: "none",
                  background: t.accent, color: "#000", cursor: busyPr === pr.number ? "default" : "pointer",
                }}
              >{busyPr === pr.number ? "Shipping…" : "🚀 Approve & ship"}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tokens, accent }) {
  return (
    <div>
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", color: accent || tokens.text }}>{value}</div>
      <div style={{ fontSize: 11, color: tokens.textMute, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4 }}>{label}</div>
    </div>
  );
}
