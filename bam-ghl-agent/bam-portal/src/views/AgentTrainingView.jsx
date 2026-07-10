import { useState, useEffect, Suspense, lazy } from "react";
import { authFetch } from "../lib/authFetch";
const SandboxApp = lazy(() => import("../sandbox/SandboxApp"));
const FollowupsPanel = lazy(() => import("./FollowupsPanel"));
const AgentModePanel = lazy(() => import("./AgentModePanel"));

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
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null);
  const [mode, setMode] = useState("manage");   // 'manage' | 'sandbox'

  const tabBtn = (on) => ({ background: on ? accent : "transparent", color: on ? "#0B0B0D" : sub, border: `1px solid ${on ? accent : border}`, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F });
  const Tabs = () => (
    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      <button style={tabBtn(mode === "mode")} onClick={() => setMode("mode")}>🎚 Autonomy</button>
      <button style={tabBtn(mode === "manage")} onClick={() => setMode("manage")}>🤖 Learnings & approvals</button>
      <button style={tabBtn(mode === "followups")} onClick={() => setMode("followups")}>⏰ Follow-ups</button>
      <button style={tabBtn(mode === "sandbox")} onClick={() => setMode("sandbox")}>🎮 Sandbox</button>
    </div>
  );

  useEffect(() => { load(); }, []);
  async function load() {
    try {
      // Classification/promotion is handled by the /consolidate-lessons skill now;
      // this view just lists, edits, and archives individual lessons.
      const d = await api("list");
      setLessons(d.lessons || []);
    } catch (e) { setErr(e.message); }
  }
  async function act(fn, id) { setBusy(id); try { await fn(); await load(); } catch (e) { alert(e.message); } finally { setBusy(null); } }

  const btn = (color, bord) => ({ background: "transparent", border: `1px solid ${bord}`, color, borderRadius: 7, padding: "5px 11px", fontSize: 12, cursor: "pointer", fontFamily: F });

  if (mode === "sandbox") return (
    <div style={{ padding: "8px 4px", fontFamily: F, color: text }}>
      <Tabs />
      <Suspense fallback={<div style={{ color: sub, padding: 24 }}>Loading sandbox…</div>}>
        <SandboxApp embedded />
      </Suspense>
    </div>
  );

  if (mode === "mode") return (
    <div style={{ padding: "8px 4px", fontFamily: F, color: text }}>
      <Tabs />
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>🎚 Agent autonomy</div>
      <Suspense fallback={<div style={{ color: sub, padding: 24 }}>Loading…</div>}>
        <AgentModePanel tokens={c} />
      </Suspense>
    </div>
  );

  if (mode === "followups") return (
    <div style={{ padding: "8px 4px", fontFamily: F, color: text }}>
      <Tabs />
      <Suspense fallback={<div style={{ color: sub, padding: 24 }}>Loading follow-ups…</div>}>
        <FollowupsPanel tokens={c} />
      </Suspense>
    </div>
  );

  if (err) return <div style={{ padding: 24, color: red, fontFamily: F }}><Tabs />⚠ {err}</div>;
  if (!lessons) return <div style={{ padding: 24, color: sub, fontFamily: F }}><Tabs />Loading…</div>;

  const active = lessons.filter(l => l.active !== false);
  const byAcademy = {};
  for (const l of active) { const k = l.business_name || "(unknown academy)"; (byAcademy[k] = byAcademy[k] || []).push(l); }

  return (
    <div style={{ padding: "8px 4px", fontFamily: F, color: text }}>
      <Tabs />
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>🤖 Agent training</div>
      <div style={{ fontSize: 13, color: sub, marginBottom: 12, lineHeight: 1.6, maxWidth: 660 }}>
        Lessons the agents have learned, per academy. <b style={{ color: text }}>Academy</b> lessons stay local (their offer, pricing, local facts); <b style={{ color: accent }}>general</b> lessons are shared sales-craft loaded by every academy. Classification + dedup is done in one pass by the <b style={{ color: text }}>/consolidate-lessons</b> skill (run it when the pile grows). Here you can read, edit, or archive individual lessons.
      </div>
      {!active.length && <div style={{ color: mute, fontSize: 14, padding: "20px 0" }}>No learnings yet across any academy.</div>}
      {Object.keys(byAcademy).sort().map(ac => (
        <div key={ac} style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 14, fontWeight: 700, margin: "14px 0 8px" }}>{ac} <span style={{ color: mute, fontWeight: 400 }}>· {byAcademy[ac].length}</span></div>
          {byAcademy[ac].map(l => (
            <div key={l.id} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{l.lesson}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10.5, fontFamily: "JetBrains Mono, monospace", padding: "2px 8px", borderRadius: 99, border: `1px solid ${l.scope === "general" ? accent : border}`, color: l.scope === "general" ? accent : mute }}>{l.scope === "general" ? "general · shared brain" : "academy"}</span>
                <div style={{ flex: 1 }} />
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
