import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";

// ─── Feedback tab ────────────────────────────────────────────────────────────
// ZORAN-ONLY view that lists all submissions from portal_feedback.
// Sources of submissions: universal floating Bug/Feature widget on
//   - client portal (client-portal.html)
//   - signup page  (onboarding.html)
//   - staff portal (UniversalFeedbackWidget mounted in App.jsx)
// Each row shows kind (Bug/Feature), body, file, who/where/when, and a
// checkbox to mark it resolved (or un-resolve). Items not yet resolved
// float to the top; resolved items sink to the bottom and dim out.
// ────────────────────────────────────────────────────────────────────────────

export default function FeedbackView({ tokens, dark, me, session }) {
  const t = tokens;
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
        const res = await fetch(`/api/clients?action=list-feedback&limit=300${portalQs}${kindQs}`, {
          headers: { Authorization: `Bearer ${tok}` },
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

  return (
    <div>
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
            <FeedbackRow key={f.id} f={f} staff={staffMap[f.author_id]} tokens={t} onToggleResolved={() => toggleResolved(f)} />
          ))}
        </div>
      )}
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

function FeedbackRow({ f, staff, tokens, onToggleResolved }) {
  const t = tokens;
  const resolved = !!f.resolved_at;
  const portalColor = f.portal === "client" ? t.amber
    : f.portal === "signup" ? "#6EB4FF"
    : t.green;
  const portalLabel = f.portal === "client" ? "Client portal"
    : f.portal === "signup" ? "Signup page"
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

function Stat({ label, value, tokens, accent }) {
  return (
    <div>
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", color: accent || tokens.text }}>{value}</div>
      <div style={{ fontSize: 11, color: tokens.textMute, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4 }}>{label}</div>
    </div>
  );
}
