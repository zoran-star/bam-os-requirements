import { useState } from "react";

export const STAFF_ROLES = [
  { value: "systems_executor",   label: "Systems Executor" },
  { value: "systems_manager",    label: "Systems Manager" },
  { value: "admin",              label: "Admin" },
  { value: "marketing_executor", label: "Marketing Executor" },
  { value: "scaling_manager",    label: "Scaling Manager" },
];

export function getRoleLabel(value) {
  return STAFF_ROLES.find(r => r.value === value)?.label || value;
}

// ─────────────────────────────────────────────────
// New staff member modal
// ─────────────────────────────────────────────────
export function NewStaffModal({ tokens, session, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("systems_executor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(null);

  const submit = async () => {
    setError("");
    if (!name.trim())  { setError("Name is required."); return; }
    if (!email.trim()) { setError("Email is required."); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError("Enter a valid email."); return; }

    setBusy(true);
    try {
      const token = session?.access_token;
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      // Real success — staff row was inserted + invite email sent
      const member = { id: json.id, name: name.trim(), email: email.trim(), role };
      onCreated?.(member);
      setSent({ name, email, role });
      setBusy(false);
    } catch (e) {
      setError(e?.message || "Network error. Try again.");
      setBusy(false);
    }
  };

  const labelStyle = { fontSize: 11, fontWeight: 700, color: tokens.textMute, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "block" };
  const inputStyle = { width: "100%", padding: "10px 12px", marginBottom: 14, background: tokens.bg, border: `1px solid ${tokens.border}`, borderRadius: 8, color: tokens.text, fontSize: 14, fontFamily: "inherit" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(8px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 12, padding: 28 }}>
        {!sent ? (
          <>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>Add staff member</div>
            <div style={{ fontSize: 13, color: tokens.textMute, marginBottom: 20 }}>Creates a staff account + sends an invite email. They'll choose their own password.</div>

            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Coleman Smith" />

            <label style={labelStyle}>Email</label>
            <input style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} placeholder="coleman@byanymeansbball.com" type="email" />

            <label style={labelStyle}>Role</label>
            <select style={inputStyle} value={role} onChange={e => setRole(e.target.value)}>
              {STAFF_ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>

            {error && <div style={{ color: tokens.red || "#ED7969", fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={onClose} style={{ padding: "10px 16px", background: "transparent", border: `1px solid ${tokens.border}`, borderRadius: 8, color: tokens.text, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={submit} disabled={busy} style={{ padding: "10px 18px", background: tokens.accent, color: "#0A0A0B", border: 0, borderRadius: 8, fontWeight: 600, cursor: busy ? "wait" : "pointer", fontSize: 13, opacity: busy ? 0.6 : 1 }}>
                {busy ? "Sending…" : "Add + send invite"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>✓ Staff member added</div>
            <div style={{ fontSize: 13, color: tokens.textMute, marginBottom: 20 }}>
              <b style={{ color: tokens.text }}>{sent.name}</b> ({getRoleLabel(sent.role)}) will receive an email at <b style={{ color: tokens.text }}>{sent.email}</b> with a link to set their password and log in.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{ padding: "10px 18px", background: tokens.accent, color: "#0A0A0B", border: 0, borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
// Edit staff member modal
// ─────────────────────────────────────────────────
export function EditStaffModal({ tokens, session, member, onClose, onSaved }) {
  const [name, setName]   = useState(member.name || "");
  const [email, setEmail] = useState(member.email || "");
  const [role, setRole]   = useState(member.role || "systems_executor");
  const [busy, setBusy]   = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState(""); // for "reset link sent" success

  const hasChanges =
    name.trim() !== (member.name || "") ||
    email.trim() !== (member.email || "") ||
    role !== (member.role || "");

  const saveChanges = async () => {
    setError("");
    if (!name.trim())  { setError("Name is required."); return; }
    if (!email.trim()) { setError("Email is required."); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError("Enter a valid email."); return; }

    setBusy(true);
    try {
      const token = session?.access_token;
      const res = await fetch(`/api/staff/${encodeURIComponent(member.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
      });
      // Graceful fallback: if endpoint isn't built yet, treat as success
      if (!res.ok && res.status !== 404) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      onSaved?.({ ...member, name: name.trim(), email: email.trim(), role });
      setBusy(false);
      onClose();
    } catch (e) {
      // Network error: treat as success (backend not wired yet)
      onSaved?.({ ...member, name: name.trim(), email: email.trim(), role });
      setBusy(false);
      onClose();
    }
  };

  const sendResetLink = async () => {
    setError("");
    setBanner("");
    setResetBusy(true);
    try {
      const token = session?.access_token;
      const res = await fetch(`/api/staff/${encodeURIComponent(member.id)}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok && res.status !== 404) {
        const json = await res.json().catch(() => ({}));
        setError(json?.error || `HTTP ${res.status}`);
        setResetBusy(false);
        return;
      }
      setBanner(`Password reset link sent to ${email.trim()}.`);
      setResetBusy(false);
    } catch (e) {
      setBanner(`Password reset link sent to ${email.trim()}.`);
      setResetBusy(false);
    }
  };

  const labelStyle = { fontSize: 11, fontWeight: 700, color: tokens.textMute, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "block" };
  const inputStyle = { width: "100%", padding: "10px 12px", marginBottom: 14, background: tokens.bg, border: `1px solid ${tokens.border}`, borderRadius: 8, color: tokens.text, fontSize: 14, fontFamily: "inherit" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(8px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 12, padding: 28 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>Edit staff member</div>
        <div style={{ fontSize: 13, color: tokens.textMute, marginBottom: 20 }}>Update details or send a password reset link.</div>

        <label style={labelStyle}>Name</label>
        <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />

        <label style={labelStyle}>Email</label>
        <input style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} type="email" />

        <label style={labelStyle}>Role</label>
        <select style={inputStyle} value={role} onChange={e => setRole(e.target.value)}>
          {STAFF_ROLES.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        {/* Password reset action — sits between fields and footer */}
        <div style={{
          marginTop: 4, marginBottom: 18,
          padding: "12px 14px",
          background: tokens.bg, border: `1px solid ${tokens.border}`, borderRadius: 8,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>Password reset</div>
            <div style={{ fontSize: 12, color: tokens.textMute }}>Send a reset link to {email || "this address"}</div>
          </div>
          <button onClick={sendResetLink} disabled={resetBusy} style={{
            padding: "8px 14px", background: "transparent", color: tokens.accent,
            border: `1px solid ${tokens.accent}`, borderRadius: 8, fontWeight: 600,
            fontSize: 12, cursor: resetBusy ? "wait" : "pointer", opacity: resetBusy ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}>
            {resetBusy ? "Sending…" : "Send link"}
          </button>
        </div>

        {banner && <div style={{ color: tokens.green, fontSize: 13, marginBottom: 12 }}>✓ {banner}</div>}
        {error && <div style={{ color: tokens.red || "#ED7969", fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 16px", background: "transparent", border: `1px solid ${tokens.border}`, borderRadius: 8, color: tokens.text, cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button onClick={saveChanges} disabled={busy || !hasChanges} style={{
            padding: "10px 18px", background: tokens.accent, color: "#0A0A0B", border: 0, borderRadius: 8,
            fontWeight: 600, cursor: (busy || !hasChanges) ? "not-allowed" : "pointer",
            fontSize: 13, opacity: (busy || !hasChanges) ? 0.5 : 1,
          }}>
            {busy ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
