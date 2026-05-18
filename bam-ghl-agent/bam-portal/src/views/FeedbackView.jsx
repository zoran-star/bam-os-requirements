import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";

// ─── Feedback tab ────────────────────────────────────────────────────────────
// Admin-only view that lists all submissions from portal_feedback. Sources:
//   - 'client' portal red button (the admin bug-flag widget on client-portal.html)
//   - 'staff'  portal — the existing Settings feedback widget
// Each row shows body text, attached file (if any), where it came from,
// who submitted it, and when.
// ────────────────────────────────────────────────────────────────────────────

export default function FeedbackView({ tokens, dark, me, session }) {
  const t = tokens;
  const [feedback, setFeedback] = useState([]);
  const [staffMap, setStaffMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState("all"); // all | client | staff
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        // Use the admin-gated API endpoint so RLS-free service-key access happens server-side.
        const tok = session?.access_token;
        const portalQs = filter === "all" ? "" : `&portal=${filter}`;
        const res = await fetch(`/api/clients?action=list-feedback&limit=200${portalQs}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setFeedback(json.data || []);

        // Resolve staff IDs → names for display
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
  }, [session, filter, refresh]);

  const counts = useMemo(() => {
    const all = feedback.length;
    const client = feedback.filter(f => f.portal === "client").length;
    const staff = feedback.filter(f => f.portal === "staff").length;
    return { all, client, staff };
  }, [feedback]);

  return (
    <div>
      {/* Header counts */}
      <div style={{ display: "flex", gap: 36, marginBottom: 28, alignItems: "baseline", flexWrap: "wrap" }}>
        <Stat label="Total" value={counts.all} tokens={t} />
        <Stat label="From client portal" value={counts.client} tokens={t} accent={t.amber} />
        <Stat label="From staff portal" value={counts.staff} tokens={t} accent={t.green} />
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 22, alignItems: "center" }}>
        {[
          { value: "all", label: `All ${counts.all}` },
          { value: "client", label: `Client portal ${counts.client}` },
          { value: "staff", label: `Staff portal ${counts.staff}` },
        ].map(o => (
          <button
            key={o.value}
            onClick={() => setFilter(o.value)}
            style={{
              padding: "7px 14px",
              background: filter === o.value ? t.surface : t.surfaceEl,
              color: filter === o.value ? t.text : t.textMute,
              border: `1px solid ${filter === o.value ? t.borderStr || t.border : t.border}`,
              borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >{o.label}</button>
        ))}
        <button
          onClick={() => setRefresh(x => x + 1)}
          style={{
            marginLeft: "auto", padding: "7px 14px", background: "transparent",
            color: t.textSub, border: `1px solid ${t.border}`, borderRadius: 6,
            fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}
        >Refresh</button>
      </div>

      {loading && <div style={{ color: t.textMute, padding: 24 }}>Loading feedback…</div>}
      {err && <div style={{ color: t.red, padding: 24 }}>Error: {err}</div>}
      {!loading && !err && feedback.length === 0 && (
        <div style={{ color: t.textMute, padding: 48, textAlign: "center", fontStyle: "italic" }}>
          No feedback yet. The red button on the client portal will land submissions here.
        </div>
      )}

      {!loading && !err && feedback.length > 0 && (
        <div style={{ display: "grid", gap: 12 }}>
          {feedback.map(f => (
            <FeedbackRow key={f.id} f={f} staff={staffMap[f.author_id]} tokens={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedbackRow({ f, staff, tokens }) {
  const t = tokens;
  const portalColor = f.portal === "client" ? t.amber : t.green;
  const portalLabel = f.portal === "client" ? "Client portal" : "Staff portal";
  const author = staff?.name || f.submitter_email || "Unknown";
  const when = f.created_at ? new Date(f.created_at).toLocaleString() : "";
  const isImage = f.file_url && /\.(png|jpe?g|gif|webp|svg)$/i.test(f.file_url);

  return (
    <div style={{
      background: t.surfaceEl, border: `1px solid ${t.border}`,
      borderRadius: 6, padding: "16px 20px",
      borderLeft: `3px solid ${portalColor}`,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
          textTransform: "uppercase", padding: "2px 8px", borderRadius: 999,
          background: `${portalColor}22`, color: portalColor,
        }}>{portalLabel}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{author}</span>
        {f.submitter_email && f.submitter_email !== author && (
          <span style={{ fontSize: 12, color: t.textMute }}>{f.submitter_email}</span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: t.textMute, fontFamily: "JetBrains Mono, monospace" }}>{when}</span>
      </div>

      <div style={{ fontSize: 14, color: t.text, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: f.file_url ? 14 : 0 }}>
        {f.body}
      </div>

      {f.file_url && (
        <div style={{ marginTop: 12 }}>
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
            <a
              href={f.file_url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "8px 12px", background: t.surface,
                border: `1px solid ${t.border}`, borderRadius: 6,
                color: t.text, textDecoration: "none", fontSize: 13,
              }}
            >
              📎 {f.file_name || "Attachment"} ↗
            </a>
          )}
        </div>
      )}

      {f.page && (
        <div style={{ marginTop: 10, fontSize: 11, color: t.textMute, fontFamily: "JetBrains Mono, monospace" }}>
          Page: {f.page}
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
