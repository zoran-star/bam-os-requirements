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

// Per-agent hint copy. Booking works Responded-stage leads; Confirm works leads
// already booked into a trial (Scheduled-Trial stage).
const HINTS = {
  booking: {
    off: "Booking agent is silent - nothing drafts or sends.",
    hawkeye: "Drafts every reply to a Responded-stage lead; you approve each before it sends.",
    self_drive: "Sends confident replies itself. Unsure ones still drop to the inbox.",
  },
  confirm: {
    off: "Confirm agent is silent - booked leads get no confirmation texts.",
    hawkeye: "Drafts every confirm/reminder for booked leads; you approve each before it sends.",
    self_drive: "Sends confident confirmations itself. Handoffs & 'lost' ALWAYS wait for you.",
  },
  closing: {
    off: "Closing agent is silent - good-fit trial attendees get no follow-up.",
    hawkeye: "Drafts every post-trial follow-up for attendees; you approve each before it sends.",
    self_drive: "Sends confident follow-ups itself. Enroll & 'lost' ALWAYS wait for you.",
  },
};

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
  const [selfDriveOn, setSelfDriveOn] = useState(false);   // 🔒 global kill-switch (api self_drive_enabled)

  useEffect(() => { load(); }, []);
  async function load() { try { const d = await api("list"); setRows(d.academies || []); setSelfDriveOn(!!d.self_drive_enabled); } catch (e) { setErr(e.message); } }

  async function setMode(client_id, mode, agent = "booking") {
    setBusy(client_id);
    const action = agent === "confirm" ? "set-confirm-mode" : agent === "closing" ? "set-closing-mode" : "set-mode";
    try { await api(action, { client_id, mode }); await load(); }
    catch (e) { alert(e.message); } finally { setBusy(null); setWarn(null); }
  }
  function pick(row, mode, agent = "booking") {
    const cur = agent === "confirm" ? (row.confirm_mode || "off") : agent === "closing" ? (row.closing_mode || "off") : row.mode;
    if (mode === cur) return;
    if (mode === "self_drive") { setWarn({ ...row, _next: mode, _agent: agent }); return; }
    setMode(row.client_id, mode, agent);
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
      <div style={{ fontSize: 13, color: sub, lineHeight: 1.6, marginBottom: 16, maxWidth: 680 }}>
        Three agents per academy, each with its own switch. <b style={{ color: text }}>Booking</b> works Responded-stage
        leads (get them to book a trial). <b style={{ color: text }}>Confirm</b> works leads already booked (make sure
        they show up, hand off to rebook if they can't). <b style={{ color: text }}>Closing</b> works good-fit trial
        attendees (follow up and get them enrolled). In <b style={{ color: text }}>Hawkeye</b>, every message waits
        for approval in <b style={{ color: text }}>Inbox → 👁 Hawkeye</b>. In <b style={{ color: red }}>Self-drive</b>, the
        agent texts on its own.
      </div>

      {!selfDriveOn && (
        <div style={{ fontSize: 12.5, color: accent, background: "rgba(232,197,71,.08)", border: `1px solid ${accent}55`, borderRadius: 10, padding: "10px 14px", marginBottom: 16, maxWidth: 680, lineHeight: 1.5 }}>
          🔒 <b>Self-drive is disabled right now</b> for all academies - every agent is capped at Off / 👁 Hawkeye, so nothing sends without approval.
        </div>
      )}

      {!rows.length && <div style={{ color: mute, fontSize: 14, padding: "20px 0" }}>No agent-capable academies yet.</div>}

      {rows.map(row => {
        const confirmMode = row.confirm_mode || "off";
        const closingMode = row.closing_mode || "off";
        const anyDrive = row.mode === "self_drive" || confirmMode === "self_drive" || closingMode === "self_drive";
        const AGENT_LABEL = { booking: "Booking agent", confirm: "Confirm agent", closing: "Closing agent" };
        // One agent's labeled segmented control row.
        const control = (agent) => {
          const mode = agent === "confirm" ? confirmMode : agent === "closing" ? closingMode : row.mode;
          const isSub = agent !== "booking";
          return (
            <div style={{ marginTop: isSub ? 12 : 0, paddingTop: isSub ? 12 : 0, borderTop: isSub ? `1px solid ${border}` : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: text }}>{AGENT_LABEL[agent]}</span>
                {mode === "self_drive" && <span style={{ fontSize: 11, fontWeight: 700, color: red }}>🚀</span>}
                {mode === "hawkeye" && <span style={{ fontSize: 11, fontWeight: 700, color: accent }}>👁</span>}
                <div style={{ flex: 1 }} />
                <div style={{ display: "flex", gap: 6 }}>
                  {MODES.filter(m => selfDriveOn || m.key !== "self_drive").map(m => (
                    <button key={m.key} disabled={busy === row.client_id} onClick={() => pick(row, m.key, agent)}
                      style={seg(mode === m.key, m.key === "self_drive")}>{m.label}</button>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 12, color: mode === "self_drive" ? red : sub, marginTop: 6 }}>{HINTS[agent][mode] || ""}</div>
            </div>
          );
        };
        return (
          <div key={row.client_id} style={{ background: surface, border: `1px solid ${anyDrive ? red + "55" : border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 10 }}>{row.business_name}</div>
            {control("booking")}
            {control("confirm")}
            {control("closing")}
            {!row.notify_phone && (row.mode !== "off" || confirmMode !== "off" || closingMode !== "off") && (
              <div style={{ fontSize: 11.5, color: mute, marginTop: 8 }}>⚠ No notify phone set (ghl_kpi_config.agent_notify_phone) - no SMS alerts when chats are waiting.</div>
            )}
          </div>
        );
      })}

      {warn && (
        <div onClick={() => setWarn(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: surface, border: `1px solid ${red}`, borderRadius: 16, width: "100%", maxWidth: 460, padding: 24 }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>⚠️</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: red, marginBottom: 8 }}>Turn on Self-drive for the {warn._agent === "confirm" ? "Confirm" : warn._agent === "closing" ? "Closing" : "Booking"} agent ({warn.business_name})?</div>
            <div style={{ fontSize: 13.5, color: sub, lineHeight: 1.6, marginBottom: 20 }}>
              {warn._agent === "confirm" ? (
                <>It will <b style={{ color: text }}>text booked leads on its own</b> - no approval - to confirm and remind them.
                  Handoffs and "mark lost" <b style={{ color: text }}>always</b> still wait for you. Make sure the brain is trained first.</>
              ) : warn._agent === "closing" ? (
                <>It will <b style={{ color: text }}>text good-fit trial attendees on its own</b> - no approval - to follow up after their trial.
                  Sending the sign-up link (enroll) and "mark lost" <b style={{ color: text }}>always</b> still wait for you. Make sure the brain is trained first.</>
              ) : (
                <>The agent will <b style={{ color: text }}>text real leads on its own</b> - no approval - whenever it's confident.
                  Unsure messages still drop to the inbox, but confident ones <b style={{ color: text }}>send themselves</b>.
                  Make sure the brain is trained and any duplicate GHL workflow texts are turned off first.</>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setWarn(null)} style={{ background: "transparent", border: `1px solid ${border}`, color: sub, borderRadius: 9, padding: "9px 18px", fontSize: 13, cursor: "pointer", fontFamily: F }}>Cancel</button>
              <button onClick={() => setMode(warn.client_id, "self_drive", warn._agent)} style={{ background: red, border: "none", color: "#0B0B0D", borderRadius: 9, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: F }}>Yes, let it drive</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
