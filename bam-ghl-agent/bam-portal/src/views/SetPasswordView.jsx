import { useState } from "react";

export default function SetPasswordView({ supabase, onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters");
    if (password !== confirm) return setError("Passwords don't match");
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) return setError(updateError.message);
    onDone();
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#000000",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
    }}>
      <div style={{ width: 420, maxWidth: "90vw" }}>
        <div style={{ textAlign: "center", marginBottom: 44 }}>
          <img src="/bam-logo.png" alt="BAM" style={{ width: 160, margin: "0 auto 24px", display: "block" }} />
          <div style={{ fontSize: 24, fontWeight: 700, color: "#E8E8F0" }}>Set Your Password</div>
          <div style={{ fontSize: 14, color: "#6B6B80", marginTop: 8 }}>
            Create a password to finish signing in
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 20, padding: "36px 32px",
        }}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#8B8BA0", marginBottom: 8, letterSpacing: "0.04em" }}>NEW PASSWORD</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters" required autoFocus
              style={{ width: "100%", padding: "14px 16px", borderRadius: 12,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                color: "#E8E8F0", fontSize: 15, fontFamily: "inherit", outline: "none" }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#8B8BA0", marginBottom: 8, letterSpacing: "0.04em" }}>CONFIRM PASSWORD</label>
            <input
              type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Re-enter password" required
              style={{ width: "100%", padding: "14px 16px", borderRadius: 12,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                color: "#E8E8F0", fontSize: 15, fontFamily: "inherit", outline: "none" }}
            />
          </div>

          {error && (
            <div style={{ padding: "12px 16px", borderRadius: 10, marginBottom: 20,
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
              color: "#F87171", fontSize: 13 }}>{error}</div>
          )}

          <button type="submit" disabled={loading} style={{
            width: "100%", padding: "14px 0", borderRadius: 12,
            background: loading ? "#7A6A3A" : "linear-gradient(135deg, #C8A84E 0%, #A0822A 100%)",
            border: "none", color: "#1A1A1A", fontSize: 15, fontWeight: 700,
            cursor: loading ? "wait" : "pointer", fontFamily: "inherit",
          }}>
            {loading ? "Saving..." : "Save Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
