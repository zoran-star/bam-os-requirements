import { useState } from "react";

export default function LoginView({ onLogin, supabase }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }
      if (data?.session) onLogin(data.session);
    } catch (err) {
      setError(err.message || "Login failed");
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError("Enter your email first");
      return;
    }
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
    } else {
      setForgotSent(true);
      setError(null);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#000000",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300..800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
      `}</style>

      <div style={{
        width: 420, maxWidth: "90vw", animation: "fadeIn 0.5s ease both",
      }}>
        {/* Logo / Brand */}
        <div style={{ textAlign: "center", marginBottom: 44 }}>
          <img
            src="/bam-logo.png"
            alt="By Any Means Business"
            style={{
              width: 160, height: "auto", margin: "0 auto 24px", display: "block",
              filter: "drop-shadow(0 4px 24px rgba(200,168,78,0.2))",
              animation: "fadeIn 0.6s ease both",
            }}
          />
          <div style={{
            fontSize: 24, fontWeight: 700, color: "#E8E8F0",
            letterSpacing: "-0.03em", lineHeight: 1.2,
          }}>
            HQ
          </div>
          <div style={{ fontSize: 14, color: "#6B6B80", marginTop: 8 }}>
            Sign in to continue
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 20,
          padding: "36px 32px",
          backdropFilter: "blur(20px)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}>
          {!showForgot ? (
            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: 20 }}>
                <label style={{
                  display: "block", fontSize: 12, fontWeight: 600, color: "#8B8BA0",
                  marginBottom: 8, letterSpacing: "0.04em",
                }}>EMAIL</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@byanymeansbball.com"
                  required
                  autoFocus
                  style={{
                    width: "100%", padding: "14px 16px", borderRadius: 12,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#E8E8F0", fontSize: 15, fontFamily: "inherit",
                    outline: "none", transition: "border-color 0.15s, background 0.15s",
                  }}
                  onFocus={e => { e.target.style.borderColor = "#C8A84E40"; e.target.style.background = "rgba(200,168,78,0.04)"; e.target.style.boxShadow = "0 0 0 3px rgba(200,168,78,0.08), 0 0 20px rgba(200,168,78,0.06)"; }}
                  onBlur={e => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; e.target.style.background = "rgba(255,255,255,0.04)"; e.target.style.boxShadow = "none"; }}
                />
              </div>

              <div style={{ marginBottom: 8 }}>
                <label style={{
                  display: "block", fontSize: 12, fontWeight: 600, color: "#8B8BA0",
                  marginBottom: 8, letterSpacing: "0.04em",
                }}>PASSWORD</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  style={{
                    width: "100%", padding: "14px 16px", borderRadius: 12,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#E8E8F0", fontSize: 15, fontFamily: "inherit",
                    outline: "none", transition: "border-color 0.15s, background 0.15s",
                  }}
                  onFocus={e => { e.target.style.borderColor = "#C8A84E40"; e.target.style.background = "rgba(200,168,78,0.04)"; e.target.style.boxShadow = "0 0 0 3px rgba(200,168,78,0.08), 0 0 20px rgba(200,168,78,0.06)"; }}
                  onBlur={e => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; e.target.style.background = "rgba(255,255,255,0.04)"; e.target.style.boxShadow = "none"; }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
                <button
                  type="button"
                  onClick={() => setShowForgot(true)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "#C8A84E", fontSize: 13, fontFamily: "inherit", fontWeight: 500,
                    padding: "4px 0",
                  }}
                >
                  Forgot password?
                </button>
              </div>

              {error && (
                <div style={{
                  padding: "12px 16px", borderRadius: 10, marginBottom: 20,
                  background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
                  color: "#F87171", fontSize: 13, fontWeight: 500,
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%", padding: "14px 0", borderRadius: 12,
                  background: loading ? "#7A6A3A" : "linear-gradient(135deg, #C8A84E 0%, #A0822A 100%)",
                  border: "none", color: "#1A1A1A", fontSize: 15, fontWeight: 700,
                  cursor: loading ? "wait" : "pointer", fontFamily: "inherit",
                  transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)", letterSpacing: "-0.01em",
                  boxShadow: loading ? "none" : "0 4px 16px rgba(200,168,78,0.3)",
                }}
                onMouseEnter={e => { if (!loading) { e.currentTarget.style.filter = "brightness(1.1)"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 32px rgba(200,168,78,0.4), 0 0 40px rgba(200,168,78,0.15)"; } }}
                onMouseLeave={e => { e.currentTarget.style.filter = "none"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = loading ? "none" : "0 4px 16px rgba(200,168,78,0.3)"; }}
              >
                {loading ? "Signing in..." : "Sign In"}
              </button>
            </form>
          ) : (
            <div>
              {forgotSent ? (
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <div style={{ fontSize: 40, marginBottom: 16 }}>✉️</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "#E8E8F0", marginBottom: 8 }}>Check your email</div>
                  <div style={{ fontSize: 14, color: "#6B6B80", lineHeight: 1.6 }}>
                    We sent a password reset link to <span style={{ color: "#E8E8F0", fontWeight: 500 }}>{email}</span>
                  </div>
                  <button
                    onClick={() => { setShowForgot(false); setForgotSent(false); }}
                    style={{
                      marginTop: 24, padding: "10px 24px", borderRadius: 10,
                      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
                      color: "#E8E8F0", fontSize: 14, fontFamily: "inherit", cursor: "pointer",
                    }}
                  >
                    Back to sign in
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "#E8E8F0", marginBottom: 8 }}>Reset Password</div>
                  <div style={{ fontSize: 14, color: "#6B6B80", marginBottom: 24 }}>Enter your email and we'll send you a reset link.</div>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@byanymeansbball.com"
                    autoFocus
                    style={{
                      width: "100%", padding: "14px 16px", borderRadius: 12,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "#E8E8F0", fontSize: 15, fontFamily: "inherit",
                      outline: "none", marginBottom: 16,
                    }}
                  />
                  {error && (
                    <div style={{
                      padding: "12px 16px", borderRadius: 10, marginBottom: 16,
                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
                      color: "#F87171", fontSize: 13,
                    }}>{error}</div>
                  )}
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => { setShowForgot(false); setError(null); }}
                      style={{
                        flex: 1, padding: "12px 0", borderRadius: 10,
                        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                        color: "#8B8BA0", fontSize: 14, fontFamily: "inherit", cursor: "pointer",
                      }}
                    >Cancel</button>
                    <button
                      onClick={handleForgotPassword}
                      disabled={loading}
                      style={{
                        flex: 1, padding: "12px 0", borderRadius: 10,
                        background: "linear-gradient(135deg, #C8A84E, #A0822A)", border: "none",
                        color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                      }}
                    >Send Reset Link</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: 32 }}>
          <div style={{ fontSize: 12, color: "#3A3A50" }}>
            Powered by FullControl
          </div>
        </div>
      </div>
    </div>
  );
}
