// Agent Sessions Panel — shown inside the Feedback tab for admins.
// Lists Claude Code sessions captured via /showtime → /byebye skills, grouped
// by user. Click a row to see the side-by-side technical + visual summary.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

const fmt = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const timeAgo = (iso) => {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
};

async function authedFetch(path) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("not authenticated");
  const r = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}

export default function AgentSessionsPanel({ tokens: t, dark }) {
  const [users, setUsers] = useState([]);
  const [activeUser, setActiveUser] = useState("all"); // 'all' or email
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);

  const loadUsers = useCallback(async () => {
    try {
      const u = await authedFetch("/api/agent-sessions?users=true");
      setUsers(u || []);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = activeUser === "all" ? "" : `?user_email=${encodeURIComponent(activeUser)}`;
      const rows = await authedFetch(`/api/agent-sessions${q}`);
      setSessions(rows || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeUser]);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    setSelectedDetail({ loading: true });
    authedFetch(`/api/agent-sessions?id=${selectedId}`)
      .then((d) => { if (!cancelled) setSelectedDetail(d); })
      .catch((e) => { if (!cancelled) setSelectedDetail({ error: e.message }); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const userTabs = [
    { email: "all", display: "All" },
    ...users.map((u) => ({ email: u.email, display: u.display })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: t.text, marginBottom: 4 }}>
          Agent Sessions
        </div>
        <div style={{ fontSize: 13, color: t.textMute }}>
          Claude Code session transcripts captured by /showtime → /byebye. Click any row to review.
        </div>
      </div>

      {/* User tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderBottom: `1px solid ${t.border}`, paddingBottom: 12 }}>
        {userTabs.map((u) => {
          const active = activeUser === u.email;
          return (
            <button
              key={u.email}
              onClick={() => setActiveUser(u.email)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: `1px solid ${active ? t.accent : t.border}`,
                background: active ? t.accent : "transparent",
                color: active ? "#000" : t.textMute,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {u.display}
            </button>
          );
        })}
      </div>

      {/* List */}
      {error && (
        <div style={{ padding: 12, background: "#3a1212", border: "1px solid #5a1d1d", borderRadius: 6, color: "#f8b4b4" }}>
          {error}
        </div>
      )}
      {loading && (
        <div style={{ color: t.textMute, padding: 16 }}>Loading…</div>
      )}
      {!loading && sessions.length === 0 && !error && (
        <div style={{ padding: 32, textAlign: "center", color: t.textMute, fontSize: 14, border: `1px dashed ${t.border}`, borderRadius: 8 }}>
          No sessions yet. Tell someone to run <code style={{ background: t.borderMed, padding: "2px 6px", borderRadius: 4 }}>/showtime</code> in Claude Code, then <code style={{ background: t.borderMed, padding: "2px 6px", borderRadius: 4 }}>/byebye</code> when they finish.
        </div>
      )}
      {!loading && sessions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              style={{
                padding: "14px 16px",
                border: `1px solid ${t.border}`,
                borderRadius: 8,
                cursor: "pointer",
                background: t.surface,
                transition: "border 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.border; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
                    {s.user_display_name || s.user_email}
                  </span>
                  <span style={{ fontSize: 12, color: t.textMute }}>
                    {timeAgo(s.started_at)}
                  </span>
                  <span style={{ fontSize: 11, color: t.textMute, fontFamily: "ui-monospace, monospace" }}>
                    · {s.message_count} msgs
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: s.status === "completed" ? "#1d4d2b" : "#5a4a1d",
                    color: s.status === "completed" ? "#a8e6b8" : "#f0d68a",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {s.status}
                </span>
              </div>
              <div style={{ fontSize: 12, color: t.textMute, marginBottom: 8, fontFamily: "ui-monospace, monospace" }}>
                {s.project_path || "—"}
              </div>
              <div style={{ fontSize: 13, color: t.textSub, lineHeight: 1.5 }}>
                {s.technical_summary
                  ? s.technical_summary.split("\n")[0].slice(0, 180) + (s.technical_summary.length > 180 ? "…" : "")
                  : <em style={{ color: t.textMute }}>(no summary yet)</em>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selectedId && (
        <div
          onClick={() => setSelectedId(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 1400,
              maxHeight: "90vh",
              background: t.surface,
              border: `1px solid ${t.border}`,
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
                  {selectedDetail?.user_display_name || selectedDetail?.user_email || "Session"}
                </div>
                <div style={{ fontSize: 12, color: t.textMute, marginTop: 2 }}>
                  {selectedDetail?.started_at ? `${fmt(selectedDetail.started_at)} → ${fmt(selectedDetail.ended_at)}` : ""}
                  {selectedDetail?.project_path && <> · <span style={{ fontFamily: "ui-monospace, monospace" }}>{selectedDetail.project_path}</span></>}
                </div>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                style={{ background: "transparent", border: `1px solid ${t.border}`, color: t.text, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
              >
                Close
              </button>
            </div>

            {/* Body — split panels */}
            <div style={{ flex: 1, overflow: "auto", padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {selectedDetail?.loading && <div style={{ gridColumn: "1 / -1", color: t.textMute }}>Loading…</div>}
              {selectedDetail?.error && <div style={{ gridColumn: "1 / -1", color: "#f8b4b4" }}>{selectedDetail.error}</div>}
              {selectedDetail && !selectedDetail.loading && !selectedDetail.error && (
                <>
                  {/* Technical (left) */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: t.textMute }}>
                      🛠 Technical Summary
                    </div>
                    <div style={{
                      padding: 16, background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8,
                      fontSize: 13, lineHeight: 1.6, color: t.text, whiteSpace: "pre-wrap",
                      fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
                    }}>
                      {selectedDetail.technical_summary || "(no summary)"}
                    </div>
                  </div>

                  {/* Visual (right) */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: t.accent }}>
                      ✨ The Plain-English Version
                    </div>
                    <div style={{
                      padding: 16, background: t.bg, border: `1px solid ${t.accent}`, borderRadius: 8,
                      fontSize: 14, lineHeight: 1.7, color: t.text, whiteSpace: "pre-wrap",
                    }}>
                      {selectedDetail.visual_summary || "(no summary)"}
                    </div>
                  </div>

                  {/* Full transcript (full-width below) */}
                  <details style={{ gridColumn: "1 / -1", marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", color: t.textMute, fontSize: 12, fontWeight: 600, padding: "8px 0" }}>
                      📜 Full raw transcript ({selectedDetail.message_count || 0} messages)
                    </summary>
                    <pre style={{
                      marginTop: 8, padding: 16, background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8,
                      fontSize: 11, lineHeight: 1.5, color: t.textSub,
                      maxHeight: 400, overflow: "auto",
                      fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
                    }}>
                      {JSON.stringify(selectedDetail.transcript, null, 2)}
                    </pre>
                  </details>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
