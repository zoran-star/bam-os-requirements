import { useState, useEffect } from "react";
import { authFetch } from "../lib/authFetch";

// BAM-staff control: per-academy agent autonomy mode. One switch governs BOTH
// the Responded reply bot and the follow-up nudge engine.
//   off → silent · hawkeye → approve each · self_drive → auto-send (unsure → inbox)
async function api(action, payload = {}) {
  const res = await authFetch("/api/agent-config", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `${action} failed`);
  return d;
}

const MODES = [
  { key: "off",        label: "Off",        hint: "Agent is silent - nothing drafts or sends." },
  { key: "hawkeye",    label: "👁 Hawkeye", hint: "Agent drafts every message; you approve each one before it sends." },
  { key: "self_drive", label: "🚀 Self-drive", hint: "Agent sends high-confidence messages itself. Anything it's unsure about still drops to the inbox." },
];

export default function AgentModePanel({ tokens }) {
  const c = tokens || {};
  const text = c.text || "#EDEDEC", sub = c.textSub || "#8E8E93", mute = c.textMute || "#5A5A60";
  const surface = c.surface || "#0F0F12", border = c.border || "rgba(255,255,255,.08)";
  const accent = c.accent || "#E8C547", red = c.red || "#FB7185";
  const F = "Inter, sans-serif";

  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null);
  const [warn, setWarn] = useState(null);   // { client_id, business_name } pending self-drive confirm

  useEffect(() => { load(); }, []);
  async function load() { try { const d = await api("list"); setRows(d.academies || []); } catch (e) { setErr(e.message); } }

  async function setMode(client_id, mode) {
    setBusy(client_id);
    try { await api("set-mode", { client_id, mode }); await load(); }
    catch (e) { alert(e.message); } finally { setBusy(null); setWarn(null); }
  }
  function pick(row, mode) {
    if (mode === row.mode) return;
    if (mode === "self_drive") { setWarn({ ...row, _next: mode }); return; }
    setMode(row.client_id, mode);
  }

  if (err) return <div style={{ padding: 24, color: red, fontFamily: F }}>⚠ {err}</div>;
  if (!rows) return <div style={{ padding: 24, color: sub, fontFamily: F }}>Loading…</div>;

  const seg = (on, danger) => ({
    background: on ? (danger ? red : accent) : "transparent",
    color: on ? "#0B0B0D" : sub,
    border: `1px solid ${on ? (danger ? red : accent) : border}`,
    borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: F,
  });

  return (
    <div style={{ fontFamily: F, color: text }}>
      <div style={{ fontSize: 13, color: sub, lineHeight: 1.6, marginBottom: 16, maxWidth: 660 }}>
        One switch per academy. It controls <b style={{ color: text }}>both</b> the Responded-stage reply bot and the
        follow-up nudge engine. In <b style={{ color: text }}>Hawkeye</b>, every message waits for approval in that
        academy's <b style={{ color: text }}>Inbox → 👁 Hawkeye</b>. In <b style={{ color: red }}>Self-drive</b>, the agent
        texts leads on its own.
      </div>

      {!rows.length && <div style={{ color: mute, fontSize: 14, padding: "20px 0" }}>No agent-capable academies yet.</div>}

      {rows.map(row => {
        const cur = MODES.find(m => m.key === row.mode) || MODES[0];
        return (
          <div key={row.client_id} style={{ background: surface, border: `1px solid ${row.mode === "self_drive" ? red + "55" : border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14.5 }}>{row.business_name}</span>
              {row.mode === "self_drive" && <span style={{ fontSize: 11, fontWeight: 700, color: red }}>🚀 autonomous</span>}
              {row.mode === "hawkeye" && <span style={{ fontSize: 11, fontWeight: 700, color: accent }}>👁 approving</span>}
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", gap: 6 }}>
                {MODES.map(m => (
                  <button key={m.key} disabled={busy === row.client_id} onClick={() => pick(row, m.key)}
                    style={seg(row.mode === m.key, m.key === "self_drive")}>{m.label}</button>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 12, color: row.mode === "self_drive" ? red : sub }}>{cur.hint}</div>
            {!row.notify_phone && row.mode !== "off" && (
              <div style={{ fontSize: 11.5, color: mute, marginTop: 6 }}>⚠ No notify phone set (ghl_kpi_config.agent_notify_phone) - no SMS alerts when chats are waiting.</div>
            )}
          </div>
        );
      })}

      {warn && (
        <div onClick={() => setWarn(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: surface, border: `1px solid ${red}`, borderRadius: 16, width: "100%", maxWidth: 460, padding: 24 }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>⚠️</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: red, marginBottom: 8 }}>Turn on Self-drive for {warn.business_name}?</div>
            <div style={{ fontSize: 13.5, color: sub, lineHeight: 1.6, marginBottom: 20 }}>
              The agent will <b style={{ color: text }}>text real leads on its own</b> - no approval - whenever it's confident.
              Unsure messages still drop to the inbox, but confident ones <b style={{ color: text }}>send themselves</b>.
              Make sure the brain is trained and any duplicate GHL workflow texts are turned off first.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setWarn(null)} style={{ background: "transparent", border: `1px solid ${border}`, color: sub, borderRadius: 9, padding: "9px 18px", fontSize: 13, cursor: "pointer", fontFamily: F }}>Cancel</button>
              <button onClick={() => setMode(warn.client_id, "self_drive")} style={{ background: red, border: "none", color: "#0B0B0D", borderRadius: 9, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: F }}>Yes, let it drive</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
