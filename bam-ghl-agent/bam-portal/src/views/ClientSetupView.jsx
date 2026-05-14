import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

// Staff-only bulk setup page. Lists every client and lets an admin:
//   - Set / edit owner_name + email (inline)
//   - Assign a Meta ad_account_id from a dropdown of accessible ad accounts
//     (sourced from /api/meta/adaccounts using the logged-in staff's token)
//   - Send a Supabase invite to clients that don't have an auth user yet
// Auto-suggests a likely ad account by fuzzy name match.

function fuzzyScore(clientName, adName) {
  if (!clientName || !adName) return 0;
  const c = clientName.toLowerCase().trim();
  const a = adName.toLowerCase().trim();
  if (c === a) return 100;
  if (a.includes(c) || c.includes(a)) return 60;
  const cw = c.split(/[\s\-_/.,&]+/).filter(w => w.length > 2);
  const aw = a.split(/[\s\-_/.,&]+/).filter(w => w.length > 2);
  let common = 0;
  for (const w of cw) if (aw.includes(w)) common++;
  return common * 15;
}

function suggestAdAccount(clientName, adAccounts) {
  let best = null;
  let bestScore = 0;
  for (const a of adAccounts) {
    const s = fuzzyScore(clientName, a.name || "");
    if (s > bestScore) { best = a; bestScore = s; }
  }
  return bestScore >= 15 ? best : null;
}

function statusLabel(client) {
  if (client.auth_user_id) return { text: "Active", color: "green" };
  if (client.email) return { text: "Ready to invite", color: "amber" };
  return { text: "Needs email", color: "mute" };
}

export default function ClientSetupView({ tokens, session }) {
  const [clients, setClients] = useState([]);
  const [adAccounts, setAdAccounts] = useState([]);
  const [metaConnected, setMetaConnected] = useState(null); // null = loading
  const [loading, setLoading] = useState(true);
  const [rowState, setRowState] = useState({});

  const tk = tokens;

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    // 1. Clients
    const { data: clientRows } = await supabase
      .from("clients")
      .select("id,name,owner_name,email,auth_user_id,meta_ad_account_id,status,created_at")
      .order("name");
    const cs = clientRows || [];
    setClients(cs);

    // 2. Ad accounts (requires staff Meta connection)
    let adAccts = [];
    let connected = false;
    try {
      const tok = session?.access_token;
      const res = await fetch("/api/meta/adaccounts", { headers: { Authorization: `Bearer ${tok}` } });
      if (res.ok) {
        const json = await res.json();
        adAccts = json.ad_accounts || [];
        connected = true;
      }
    } catch { /* ignore */ }
    setAdAccounts(adAccts);
    setMetaConnected(connected);

    // 3. Init row state with current values + auto-suggestions for empty ones
    const rs = {};
    cs.forEach(c => {
      let suggested = "";
      if (!c.meta_ad_account_id && adAccts.length) {
        const s = suggestAdAccount(c.name, adAccts);
        if (s) suggested = s.id;
      }
      rs[c.id] = {
        owner_name: c.owner_name || "",
        email: c.email || "",
        ad_account_id: c.meta_ad_account_id || suggested || "",
        message: "",
        kind: "",
        saving: false,
      };
    });
    setRowState(rs);
    setLoading(false);
  }

  function update(clientId, patch) {
    setRowState(prev => ({ ...prev, [clientId]: { ...prev[clientId], ...patch } }));
  }

  async function saveRow(client) {
    const state = rowState[client.id];
    update(client.id, { saving: true, message: "Saving…", kind: "info" });
    try {
      const tok = session?.access_token;

      // 1. Update email / owner_name if changed
      const emailChanged = (state.email || "") !== (client.email || "");
      const ownerChanged = (state.owner_name || "") !== (client.owner_name || "");
      if (emailChanged || ownerChanged) {
        const r = await fetch("/api/clients?action=update-fields", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ client_id: client.id, email: state.email, owner_name: state.owner_name }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      }

      // 2. Update meta_ad_account_id if changed
      if ((state.ad_account_id || "") !== (client.meta_ad_account_id || "")) {
        if (state.ad_account_id) {
          const r = await fetch("/api/meta/adaccounts", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
            body: JSON.stringify({ client_id: client.id, ad_account_id: state.ad_account_id }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        } else {
          // Clear it
          const r = await fetch(`/api/meta/adaccounts?client_id=${encodeURIComponent(client.id)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${tok}` },
          });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error || `HTTP ${r.status}`);
          }
        }
      }

      update(client.id, { saving: false, message: "Saved ✓", kind: "success" });
      // Reload after a short delay to refresh status
      setTimeout(load, 500);
    } catch (e) {
      update(client.id, { saving: false, message: e.message, kind: "error" });
    }
  }

  async function sendInvite(client) {
    const state = rowState[client.id];
    if (!state.email) {
      update(client.id, { message: "Need email first", kind: "error" });
      return;
    }
    if (!state.owner_name) {
      update(client.id, { message: "Need owner name", kind: "error" });
      return;
    }
    if (client.auth_user_id) {
      // Already has auth — could re-send, but use reset-password instead
      update(client.id, { message: "Already active — use Reset Password", kind: "info" });
      return;
    }
    update(client.id, { saving: true, message: "Sending invite…", kind: "info" });
    try {
      const tok = session?.access_token;
      const r = await fetch("/api/clients?action=setup-account", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ client_id: client.id, owner_name: state.owner_name, email: state.email }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      update(client.id, { saving: false, message: "Invite sent ✓", kind: "success" });
      setTimeout(load, 500);
    } catch (e) {
      update(client.id, { saving: false, message: e.message, kind: "error" });
    }
  }

  // Styles
  const sectionPad = { padding: "24px 28px" };
  const headerStyle = { fontSize: 20, fontWeight: 700, color: tk.text, marginBottom: 6 };
  const subStyle = { fontSize: 13, color: tk.textMute, marginBottom: 22 };
  const cellStyle = { padding: "10px 12px", borderBottom: `1px solid ${tk.border}`, verticalAlign: "middle", fontSize: 13 };
  const headStyle = { ...cellStyle, fontSize: 10, color: tk.textMute, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: `2px solid ${tk.border}` };
  const inputStyle = { width: "100%", padding: "6px 8px", background: tk.bg, border: `1px solid ${tk.border}`, borderRadius: 6, color: tk.text, fontSize: 12, fontFamily: "inherit" };

  if (loading) {
    return (
      <div style={sectionPad}>
        <div style={headerStyle}>Client Setup</div>
        <div style={subStyle}>Loading clients + ad accounts…</div>
      </div>
    );
  }

  return (
    <div style={sectionPad}>
      <div style={headerStyle}>Client Setup</div>
      <div style={subStyle}>
        Bulk wire-up: assign Meta ad accounts, set owner contact info, and send invite emails.
        {metaConnected === false && (
          <span style={{ color: tk.red, marginLeft: 8, fontWeight: 600 }}>
            ⚠ Meta not connected — go to Settings → Connect Meta to load ad accounts.
          </span>
        )}
        {metaConnected && (
          <span style={{ color: tk.green, marginLeft: 8 }}>
            ✓ Meta connected — {adAccounts.length} ad accounts available
          </span>
        )}
      </div>

      <div style={{ overflowX: "auto", border: `1px solid ${tk.border}`, borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
          <thead>
            <tr>
              <th style={{ ...headStyle, textAlign: "left", width: 180 }}>Client</th>
              <th style={{ ...headStyle, textAlign: "left", width: 160 }}>Owner name</th>
              <th style={{ ...headStyle, textAlign: "left", width: 220 }}>Email</th>
              <th style={{ ...headStyle, textAlign: "left", width: 260 }}>Meta ad account</th>
              <th style={{ ...headStyle, textAlign: "left", width: 100 }}>Status</th>
              <th style={{ ...headStyle, textAlign: "right", width: 200 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(c => {
              const s = rowState[c.id] || {};
              const status = statusLabel(c);
              const statusColor = status.color === "green" ? tk.green : status.color === "amber" ? tk.amber : tk.textMute;
              const msgColor = s.kind === "success" ? tk.green : s.kind === "error" ? tk.red : tk.textMute;
              return (
                <tr key={c.id}>
                  <td style={cellStyle}>
                    <div style={{ fontWeight: 600, color: tk.text }}>{c.name}</div>
                    <div style={{ fontSize: 10, color: tk.textMute, fontFamily: "monospace" }}>{c.id.slice(0, 8)}</div>
                  </td>
                  <td style={cellStyle}>
                    <input
                      style={inputStyle}
                      value={s.owner_name || ""}
                      onChange={e => update(c.id, { owner_name: e.target.value })}
                      placeholder="Owner first + last"
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      style={inputStyle}
                      type="email"
                      value={s.email || ""}
                      onChange={e => update(c.id, { email: e.target.value })}
                      placeholder="owner@academy.com"
                    />
                  </td>
                  <td style={cellStyle}>
                    {metaConnected ? (
                      <select
                        style={inputStyle}
                        value={s.ad_account_id || ""}
                        onChange={e => update(c.id, { ad_account_id: e.target.value })}
                      >
                        <option value="">— select —</option>
                        {adAccounts.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.name || "(unnamed)"} · {a.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ color: tk.textMute, fontSize: 11 }}>connect Meta first</span>
                    )}
                    {s.ad_account_id && s.ad_account_id !== (c.meta_ad_account_id || "") && !c.meta_ad_account_id && (
                      <div style={{ fontSize: 10, color: tk.amber, marginTop: 2 }}>auto-suggested</div>
                    )}
                  </td>
                  <td style={cellStyle}>
                    <span style={{ color: statusColor, fontWeight: 600, fontSize: 11 }}>● {status.text}</span>
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button
                        onClick={() => saveRow(c)}
                        disabled={s.saving}
                        style={{
                          fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 6,
                          border: `1px solid ${tk.border}`, background: tk.surface, color: tk.text,
                          cursor: s.saving ? "wait" : "pointer", opacity: s.saving ? 0.6 : 1,
                        }}>Save</button>
                      {!c.auth_user_id && (
                        <button
                          onClick={() => sendInvite(c)}
                          disabled={s.saving || !s.email || !s.owner_name}
                          style={{
                            fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 6,
                            border: "none", background: tk.accent, color: "#0A0A0B",
                            cursor: s.saving ? "wait" : "pointer",
                            opacity: s.saving || !s.email || !s.owner_name ? 0.5 : 1,
                          }}>Send invite</button>
                      )}
                    </div>
                    {s.message && (
                      <div style={{ fontSize: 10, color: msgColor, marginTop: 4, textAlign: "right" }}>{s.message}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
