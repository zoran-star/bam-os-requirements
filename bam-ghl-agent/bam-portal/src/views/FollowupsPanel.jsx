import { useState, useEffect } from "react";
import { authFetch } from "../lib/authFetch";

// Scheduled follow-ups timeline — approve / edit / skip / snooze the agent's
// next nudges before they auto-send. (Approve-each: nothing sends unapproved.)
async function api(action, payload = {}) {
  const res = await authFetch("/api/agent-followups", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `${action} failed`);
  return d;
}

function when(ts) {
  if (!ts) return "—";
  const ms = new Date(ts).getTime() - Date.now();
  const past = ms < 0; const a = Math.abs(ms);
  const h = a / 3600000, d = a / 86400000;
  const s = d >= 1 ? `${Math.round(d)}d` : h >= 1 ? `${Math.round(h)}h` : `${Math.max(1, Math.round(a / 60000))}m`;
  return past ? `${s} overdue` : `in ${s}`;
}

export default function FollowupsPanel({ tokens }) {
  const c = tokens || {};
  const text = c.text || "#EDEDEC", sub = c.textSub || "#8E8E93", mute = c.textMute || "#5A5A60";
  const surface = c.surface || "#0F0F12", border = c.border || "rgba(255,255,255,.08)";
  const accent = c.accent || "#E8C547", red = c.red || "#FB7185", green = "#5BBF7B";
  const F = "Inter, sans-serif";

  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState("");

  useEffect(() => { load(); }, []);
  async function load() { try { const d = await api("list"); setRows(d.followups || []); } catch (e) { setErr(e.message); } }
  async function act(fn, id) { setBusy(id); try { await fn(); await load(); } catch (e) { alert(e.message); } finally { setBusy(null); } }
  async function detect() {
    setBusy("detect"); setNote("Scanning for quiet leads…");
    try { const d = await api("detect-now"); const tot = (d.academies || []).reduce((s, a) => s + (a.drafted || 0), 0); setNote(`Done — ${tot} new follow-up${tot === 1 ? "" : "s"} drafted.`); await load(); }
    catch (e) { setNote("⚠ " + e.message); } finally { setBusy(null); }
  }

  const btn = (color, bord) => ({ background: "transparent", border: `1px solid ${bord}`, color, borderRadius: 7, padding: "5px 11px", fontSize: 12, cursor: "pointer", fontFamily: F });

  if (err) return <div style={{ padding: 24, color: red, fontFamily: F }}>⚠ {err}</div>;
  if (!rows) return <div style={{ padding: 24, color: sub, fontFamily: F }}>Loading follow-ups…</div>;

  const upcoming = rows.filter(r => r.status === "pending" || r.status === "approved");
  const recent = rows.filter(r => !["pending", "approved"].includes(r.status));
  const badge = (r) => {
    if (r.status === "pending")  return { t: "needs approval", c: accent };
    if (r.status === "approved") return { t: "✓ approved · will send " + when(r.scheduled_at), c: green };
    if (r.status === "sent")     return { t: "sent", c: sub };
    if (r.status === "canceled") return { t: "canceled (lead replied)", c: mute };
    if (r.status === "skipped")  return { t: "skipped", c: mute };
    if (r.status === "failed")   return { t: "failed: " + (r.send_error || ""), c: red };
    return { t: r.status, c: mute };
  };

  const Card = (r) => {
    const bd = badge(r);
    const live = r.status === "pending" || r.status === "approved";
    return (
      <div key={r.id} style={{ background: surface, border: `1px solid ${r.status === "pending" ? accent + "66" : border}`, borderRadius: 11, padding: "12px 14px", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 13.5 }}>{r.contact_name || "Lead"}</span>
          {r.business_name && <span style={{ fontSize: 11, color: mute }}>· {r.business_name}</span>}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: live ? accent : mute }}>⏰ {when(r.scheduled_at)}</span>
        </div>
        {r.goal && <div style={{ fontSize: 11.5, color: sub, marginBottom: 6 }}>🎯 {r.goal}</div>}
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: text, background: "rgba(255,255,255,.03)", borderRadius: 8, padding: "8px 10px" }}>{r.draft_message}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, fontFamily: "JetBrains Mono, monospace", color: bd.c }}>{bd.t}</span>
          <div style={{ flex: 1 }} />
          {live && <>
            {r.status === "pending" && <button disabled={busy === r.id} onClick={() => act(() => api("approve", { id: r.id }), r.id)} style={btn(green, green)}>✓ approve</button>}
            <button disabled={busy === r.id} onClick={() => { const t = prompt("Edit the follow-up message:", r.draft_message); if (t && t.trim() && t.trim() !== r.draft_message) act(() => api("edit", { id: r.id, message: t.trim() }), r.id); }} style={btn(sub, border)}>✎ edit</button>
            <button disabled={busy === r.id} onClick={() => act(() => api("snooze", { id: r.id, hours: 24 }), r.id)} style={btn(sub, border)}>+1d</button>
            <button disabled={busy === r.id} onClick={() => act(() => api("send-now", { id: r.id }), r.id)} style={btn(accent, accent)}>send now</button>
            <button disabled={busy === r.id} onClick={() => { if (confirm("Skip this follow-up?")) act(() => api("skip", { id: r.id }), r.id); }} style={btn(red, border)}>✕ skip</button>
          </>}
        </div>
      </div>
    );
  };

  return (
    <div style={{ fontFamily: F, color: text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: sub, lineHeight: 1.5, flex: 1, minWidth: 240 }}>
          The agent's next nudges for leads who went quiet. Approve, edit, or skip each one before it auto-sends. Nothing sends until you approve it — and anything cancels the moment the lead replies.
        </div>
        <button disabled={busy === "detect"} onClick={detect} style={btn(accent, accent)}>{busy === "detect" ? "scanning…" : "↻ check for new"}</button>
      </div>
      {note && <div style={{ fontSize: 12, color: sub, marginBottom: 10 }}>{note}</div>}

      <div style={{ fontSize: 14, fontWeight: 700, margin: "10px 0 8px" }}>Upcoming {upcoming.length ? `· ${upcoming.length}` : ""}</div>
      {!upcoming.length && <div style={{ color: mute, fontSize: 13, padding: "8px 0 16px" }}>No scheduled follow-ups right now. Hit “check for new” to scan quiet leads.</div>}
      {upcoming.map(Card)}

      {recent.length > 0 && <>
        <div style={{ fontSize: 14, fontWeight: 700, margin: "20px 0 8px", color: sub }}>Recent</div>
        {recent.map(Card)}
      </>}
    </div>
  );
}
