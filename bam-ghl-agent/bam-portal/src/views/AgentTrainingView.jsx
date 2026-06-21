import { useState, useEffect } from "react";
import { authFetch } from "../lib/authFetch";

// Staff view: manage the sales agent's learnings across academies.
// 'academy' lessons stay local; 'general' flags a sales-craft lesson as
// promotable to the shared brain. (One source of truth: agent_lessons.)
async function api(action, payload = {}) {
  const res = await authFetch("/api/agent-learnings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `${action} failed`);
  return d;
}

export default function AgentTrainingView({ tokens }) {
  const c = tokens || {};
  const text = c.text || "#EDEDEC", sub = c.textSub || "#8E8E93", mute = c.textMute || "#5A5A60";
  const surface = c.surface || "#0F0F12", border = c.border || "rgba(255,255,255,.08)";
  const accent = c.accent || "#E8C547", red = c.red || "#FB7185";
  const F = "Inter, sans-serif";

  const [lessons, setLessons] = useState(null);
  const [pending, setPending] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null);

  useEffect(() => { load(); }, []);
  async function load() {
    try {
      const [d, p] = await Promise.all([api("list"), api("list-promotions").catch(() => ({ pending: [] }))]);
      setLessons(d.lessons || []);
      setPending(p.pending || []);
    } catch (e) { setErr(e.message); }
  }
  async function act(fn, id) { setBusy(id); try { await fn(); await load(); } catch (e) { alert(e.message); } finally { setBusy(null); } }

  const btn = (color, bord) => ({ background: "transparent", border: `1px solid ${bord}`, color, borderRadius: 7, padding: "5px 11px", fontSize: 12, cursor: "pointer", fontFamily: F });

  if (err) return <div style={{ padding: 24, color: red, fontFamily: F }}>⚠ {err}</div>;
  if (!lessons) return <div style={{ padding: 24, color: sub, fontFamily: F }}>Loading…</div>;

  const active = lessons.filter(l => l.active !== false);
  const byAcademy = {};
  for (const l of active) { const k = l.business_name || "(unknown academy)"; (byAcademy[k] = byAcademy[k] || []).push(l); }

  return (
    <div style={{ padding: "8px 4px", fontFamily: F, color: text }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>🤖 Agent training</div>
      <div style={{ fontSize: 13, color: sub, marginBottom: 12, lineHeight: 1.6, maxWidth: 660 }}>
        Lessons the booking agent has learned, per academy. <b style={{ color: text }}>Academy</b> lessons stay local (their offer, pricing, local facts). Mark a general sales-craft lesson <b style={{ color: accent }}>general</b> to flag it for the shared brain. Archive ones that no longer apply.
      </div>
      {pending.length > 0 && (
        <div style={{ border: `1px solid ${accent}`, borderRadius: 12, padding: "14px 16px", marginBottom: 22, background: "rgba(232,197,71,.05)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: accent, marginBottom: 4 }}>🌐 Pending global approvals · {pending.length}</div>
          <div style={{ fontSize: 12.5, color: sub, marginBottom: 12, lineHeight: 1.5 }}>
            A client trainer taught these, and the AI judged them general sales-craft. Approve to promote to the shared brain (all academies). Reject to keep it local to their academy.
          </div>
          {pending.map(l => (
            <div key={l.id} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{l.lesson}</div>
              {l.reason && <div style={{ fontSize: 11.5, color: mute, marginTop: 6, fontStyle: "italic" }}>AI: {l.reason}</div>}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10.5, fontFamily: "JetBrains Mono, monospace", color: mute }}>{l.business_name || "(academy)"} · {l.created_by || ""}</span>
                <div style={{ flex: 1 }} />
                <button disabled={busy === l.id} onClick={() => act(() => api("approve-promotion", { id: l.id }), l.id)} style={btn(accent, accent)}>✓ approve → global</button>
                <button disabled={busy === l.id} onClick={() => act(() => api("reject-promotion", { id: l.id }), l.id)} style={btn(sub, border)}>✕ keep local</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {!active.length && <div style={{ color: mute, fontSize: 14, padding: "20px 0" }}>No learnings yet across any academy.</div>}
      {Object.keys(byAcademy).sort().map(ac => (
        <div key={ac} style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 14, fontWeight: 700, margin: "14px 0 8px" }}>{ac} <span style={{ color: mute, fontWeight: 400 }}>· {byAcademy[ac].length}</span></div>
          {byAcademy[ac].map(l => (
            <div key={l.id} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{l.lesson}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10.5, fontFamily: "JetBrains Mono, monospace", padding: "2px 8px", borderRadius: 99, border: `1px solid ${l.scope === "general" ? accent : border}`, color: l.scope === "general" ? accent : mute }}>{l.scope === "general" ? "general · promotable" : "academy"}</span>
                <div style={{ flex: 1 }} />
                {l.scope === "general"
                  ? <button disabled={busy === l.id} onClick={() => act(() => api("set-scope", { id: l.id, scope: "academy" }), l.id)} style={btn(sub, border)}>↩ make academy</button>
                  : <button disabled={busy === l.id} onClick={() => act(() => api("set-scope", { id: l.id, scope: "general" }), l.id)} style={btn(accent, accent)}>⭐ mark general</button>}
                <button disabled={busy === l.id} onClick={() => { const t = prompt("Edit lesson:", l.lesson); if (t && t.trim()) act(() => api("edit", { id: l.id, lesson: t.trim() }), l.id); }} style={btn(sub, border)}>✎ edit</button>
                <button disabled={busy === l.id} onClick={() => { if (confirm("Archive this learning?")) act(() => api("archive", { id: l.id, active: false }), l.id); }} style={btn(red, border)}>archive</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
