import { useState, useRef, useEffect } from "react";
import { submitFeedback, fetchFeedbackItems } from "../services/feedbackService";
import { fetchSlackStatus, disconnectSlack, getSlackOAuthUrl } from "../services/slackService";
import { useIsMobile } from '../hooks/useMediaQuery';
import { useStaffMe } from '../hooks/useStaffMe';
import { supabase } from '../lib/supabase';

const INTEGRATIONS = [
  { key: "ghl", label: "GoHighLevel", desc: "CRM, contacts, pipelines, conversations", endpoint: "/api/ghl?action=locations" },
  { key: "asana", label: "Asana", desc: "Tasks, projects, team assignments", endpoint: "/api/asana/tasks?mode=user&user=mike&limit=1" },
  { key: "stripe", label: "Stripe", desc: "Payments, subscriptions, alerts", endpoint: "/api/stripe/alerts" },
  { key: "gcal", label: "Google Calendar", desc: "Events, meetings, scheduling", endpoint: "/api/calendar/events" },
];

function StatusDot({ status, tokens }) {
  const color = status === "connected" ? tokens.green : status === "checking" ? tokens.amber : tokens.red;
  return (
    <div style={{
      width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0,
      animation: status === "checking" ? "gentlePulse 1s ease-in-out infinite" : "none",
    }} />
  );
}

export default function SettingsView({ tokens, dark, setDark, userName, session }) {
  const isMobile = useIsMobile();
  const me = useStaffMe(session);
  const [showNewClient, setShowNewClient] = useState(false);
  // ─── Integration status ───
  const [integrationStatus, setIntegrationStatus] = useState({});

  useEffect(() => {
    INTEGRATIONS.forEach(({ key, endpoint }) => {
      setIntegrationStatus(prev => ({ ...prev, [key]: "checking" }));
      fetch(endpoint)
        .then(r => {
          setIntegrationStatus(prev => ({ ...prev, [key]: r.ok ? "connected" : "disconnected" }));
        })
        .catch(() => {
          setIntegrationStatus(prev => ({ ...prev, [key]: "disconnected" }));
        });
    });
  }, []);

  // ─── Slack OAuth status ───
  const [slackStatus, setSlackStatus] = useState({ connected: false });
  const [slackLoading, setSlackLoading] = useState(true);

  useEffect(() => {
    fetchSlackStatus().then(status => {
      setSlackStatus(status);
      setSlackLoading(false);
    });
    // Check URL params for OAuth callback result
    const params = new URLSearchParams(window.location.search);
    const slackResult = params.get("slack");
    if (slackResult === "connected") {
      setSlackStatus({ connected: true });
      setSlackLoading(false);
    }
  }, []);

  const handleConnectSlack = async () => {
    const url = await getSlackOAuthUrl();
    if (url) window.location.href = url;
  };

  const handleDisconnectSlack = async () => {
    await disconnectSlack();
    setSlackStatus({ connected: false });
  };

  // ─── Feedback ───
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackHistory, setFeedbackHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    fetchFeedbackItems().then(({ data }) => setFeedbackHistory(data));
  }, []);

  const handleSubmitFeedback = async (source = "text", body = "") => {
    const content = body || feedbackText.trim();
    if (!content) return;
    setFeedbackSending(true);
    const { data } = await submitFeedback({ body: content, source, page: "settings", author: userName || "Mike" });
    setFeedbackSending(false);
    setFeedbackSent(true);
    setFeedbackText("");
    if (data) setFeedbackHistory(prev => [data, ...prev]);
    setTimeout(() => setFeedbackSent(false), 3000);
  };

  const toggleVoice = () => {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition not supported."); return; }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map(r => r[0].transcript).join(" ");
      handleSubmitFeedback("voice", transcript);
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  // ─── Styles ───
  const sectionStyle = {
    background: tokens.surfaceEl, borderRadius: 16, border: `1px solid ${tokens.border}`,
    padding: isMobile ? "16px 14px" : "24px 28px", marginBottom: 20, animation: "cardIn 0.3s ease both",
  };
  const sectionTitle = { fontSize: 15, fontWeight: 700, color: tokens.text, marginBottom: 4, letterSpacing: "-0.01em" };
  const sectionDesc = { fontSize: 13, color: tokens.textMute, marginBottom: 20 };

  const statusLabel = (s) => s === "connected" ? "Connected" : s === "checking" ? "Checking..." : "Disconnected";
  const statusColor = (s) => s === "connected" ? tokens.green : s === "checking" ? tokens.amber : tokens.red;

  return (
    <div>

      {/* ═══ Profile ═══ */}
      <div style={{ ...sectionStyle, animationDelay: "0ms" }}>
        <div style={sectionTitle}>Profile</div>
        <div style={sectionDesc}>Your account details</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, background: tokens.accentGhost,
            color: tokens.accent, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, fontWeight: 700,
          }}>
            {(userName || "M")[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: tokens.text }}>{userName || "User"}</div>
            <div style={{ fontSize: 13, color: tokens.textMute }}>{session?.user?.email || "—"}</div>
          </div>
        </div>
      </div>

      {/* ═══ Appearance ═══ */}
      <div style={{ ...sectionStyle, animationDelay: "40ms" }}>
        <div style={sectionTitle}>Appearance</div>
        <div style={sectionDesc}>Customize your portal experience</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: tokens.text }}>Dark Mode</div>
            <div style={{ fontSize: 12, color: tokens.textMute }}>Switch between light and dark themes</div>
          </div>
          <div onClick={() => setDark(d => !d)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            <div style={{
              width: 44, height: 24, borderRadius: 12, position: "relative",
              background: dark ? tokens.accent : tokens.borderStr,
              transition: "background 0.2s ease",
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: "50%",
                background: dark ? tokens.surface : "#fff",
                position: "absolute", top: 3,
                left: dark ? 22 : 3,
                transition: "left 0.2s ease",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }} />
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </div>
        </div>
      </div>

      {/* ═══ Clients (admin only) ═══ */}
      {me?.role === "admin" && (
        <div style={{ ...sectionStyle, animationDelay: "60ms" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div>
              <div style={sectionTitle}>Clients</div>
              <div style={{ fontSize: 13, color: tokens.textMute }}>Create and manage client portal logins</div>
            </div>
            <button
              onClick={() => setShowNewClient(true)}
              style={{ padding: "8px 14px", background: tokens.accent, color: "#0A0A0B", border: 0, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >+ New client</button>
          </div>
        </div>
      )}

      {/* ═══ Integrations ═══ */}
      <div style={{ ...sectionStyle, animationDelay: "80ms" }}>
        <div style={sectionTitle}>Integrations</div>
        <div style={sectionDesc}>Connected services and their status</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {INTEGRATIONS.map(({ key, label, desc }) => {
            const s = integrationStatus[key] || "checking";
            return (
              <div key={key} style={{
                display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
                borderRadius: 10, background: tokens.surface, border: `1px solid ${tokens.border}`,
              }}>
                <StatusDot status={s} tokens={tokens} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: tokens.text }}>{label}</div>
                  <div style={{ fontSize: 12, color: tokens.textMute }}>{desc}</div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: statusColor(s),
                  padding: "3px 10px", borderRadius: 8,
                  background: `${statusColor(s)}12`,
                }}>{statusLabel(s)}</span>
              </div>
            );
          })}

          {/* Slack — special row with connect/disconnect */}
          <div style={{
            display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
            borderRadius: 10, background: tokens.surface, border: `1px solid ${tokens.border}`,
          }}>
            <StatusDot status={slackLoading ? "checking" : slackStatus.connected ? "connected" : "disconnected"} tokens={tokens} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: tokens.text }}>Slack</div>
              <div style={{ fontSize: 12, color: tokens.textMute }}>
                {slackStatus.connected
                  ? `Connected${slackStatus.slackTeamName ? ` to ${slackStatus.slackTeamName}` : ""} — channels, DMs, messages`
                  : "Connect your Slack account for personal DMs & messaging"}
              </div>
            </div>
            {slackLoading ? (
              <span style={{ fontSize: 11, fontWeight: 600, color: tokens.amber, padding: "3px 10px", borderRadius: 8, background: `${tokens.amber}12` }}>Checking...</span>
            ) : slackStatus.connected ? (
              <button onClick={handleDisconnectSlack} style={{
                fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 8,
                border: `1px solid ${tokens.border}`, background: tokens.surface,
                color: tokens.red, cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.15s ease",
              }}>Disconnect</button>
            ) : (
              <button onClick={handleConnectSlack} style={{
                fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 8,
                border: "none", background: tokens.accent, color: "#fff",
                cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.15s ease",
              }}>Connect Slack</button>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Feedback ═══ */}
      <div style={{ ...sectionStyle, animationDelay: "120ms" }}>
        <div style={sectionTitle}>Feedback</div>
        <div style={sectionDesc}>Submit requests, bugs, or ideas. Coleman gets notified on Slack and can approve for build.</div>

        {feedbackSent ? (
          <div style={{
            padding: "20px 0", textAlign: "center",
            animation: "cardIn 0.3s ease both",
          }}>
            <div style={{ fontSize: 20, marginBottom: 6, color: tokens.green }}>&#10003;</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: tokens.green }}>Sent to Coleman</div>
            <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 2 }}>He'll review it on Slack</div>
          </div>
        ) : (
          <>
            <textarea
              ref={inputRef}
              value={feedbackText}
              onChange={e => setFeedbackText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmitFeedback(); } }}
              placeholder="What should we build, fix, or change?"
              rows={3}
              style={{
                width: "100%", fontSize: 14, padding: "12px 16px", borderRadius: 10,
                border: `1px solid ${tokens.border}`, background: tokens.surface,
                color: tokens.text, fontFamily: "inherit", outline: "none",
                resize: "vertical", lineHeight: 1.5,
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: isMobile ? "wrap" : "nowrap" }}>
              <button onClick={toggleVoice} style={{
                width: 40, height: 40, borderRadius: 10,
                border: `1px solid ${listening ? tokens.red : tokens.border}`,
                background: listening ? tokens.redSoft : tokens.surface,
                color: listening ? tokens.red : tokens.textMute,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s ease",
                animation: listening ? "gentlePulse 1s ease-in-out infinite" : "none",
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </button>
              {!isMobile && <div style={{ flex: 1 }} />}
              <button onClick={() => handleSubmitFeedback()} disabled={!feedbackText.trim() || feedbackSending} style={{
                fontSize: 13, fontWeight: 600, padding: "10px 20px", borderRadius: 10,
                ...(isMobile ? { flex: 1, justifyContent: "center" } : {}),
                border: "none", background: tokens.accent, color: "#fff",
                cursor: !feedbackText.trim() || feedbackSending ? "default" : "pointer",
                fontFamily: "inherit", opacity: !feedbackText.trim() || feedbackSending ? 0.4 : 1,
                display: "flex", alignItems: "center", gap: 6,
                transition: "all 0.2s ease",
              }}>
                {feedbackSending ? "Sending..." : "Send"}
                {!feedbackSending && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                )}
              </button>
            </div>
          </>
        )}

        {/* Feedback history */}
        {feedbackHistory.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div onClick={() => setShowHistory(p => !p)} style={{
              fontSize: 12, fontWeight: 600, color: tokens.accent, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
            }}>
              {showHistory ? "Hide" : "Show"} history ({feedbackHistory.length})
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: showHistory ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
            {showHistory && (
              <div style={{ marginTop: 10, borderRadius: 10, border: `1px solid ${tokens.border}`, overflow: "hidden" }}>
                {feedbackHistory.slice(0, 20).map((fb, i) => {
                  const statusColor = fb.status === "approved" ? tokens.green
                    : fb.status === "done" ? tokens.blue
                    : fb.status === "rejected" ? tokens.red
                    : tokens.textMute;
                  return (
                    <div key={fb.id || i} style={{
                      padding: "10px 14px",
                      borderBottom: i < feedbackHistory.length - 1 ? `1px solid ${tokens.border}` : "none",
                      fontSize: 13, color: tokens.text,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 6,
                          color: statusColor, background: `${statusColor}12`,
                          textTransform: "capitalize",
                        }}>{fb.status}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 6,
                          color: fb.source === "voice" ? tokens.blue : tokens.textMute,
                          background: fb.source === "voice" ? `${tokens.blue}12` : tokens.surfaceHov,
                        }}>{fb.source === "voice" ? "Voice" : "Text"}</span>
                        <span style={{ fontSize: 11, color: tokens.textMute }}>
                          {new Date(fb.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </span>
                      </div>
                      <div style={{ lineHeight: 1.4 }}>{fb.body}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {showNewClient && (
        <NewClientModal
          tokens={tokens}
          session={session}
          onClose={() => setShowNewClient(false)}
        />
      )}
    </div>
  );
}

// ─── New client modal ───────────────────────────────────────────────
function NewClientModal({ tokens, session, onClose }) {
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("onboarding");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null); // { name, email, password } once successful
  const [copied, setCopied] = useState(false);

  const generatePassword = () => {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!#$%&";
    let p = "";
    const rnd = (window.crypto?.getRandomValues?.bind(window.crypto)) || null;
    if (rnd) {
      const bytes = new Uint32Array(14);
      rnd(bytes);
      for (let i = 0; i < 14; i++) p += chars[bytes[i] % chars.length];
    } else {
      for (let i = 0; i < 14; i++) p += chars[Math.floor(Math.random() * chars.length)];
    }
    setPassword(p);
  };

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const token = session?.access_token;
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, owner_name: ownerName, email, password, status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      setCreated({ name, email, password });
      setBusy(false);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const copyCreds = async () => {
    const text = `BAM Business portal\nURL: https://bam-portal-zoran-stars-projects.vercel.app/client-portal.html\nEmail: ${created.email}\nPassword: ${created.password}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const labelStyle = { fontSize: 11, fontWeight: 700, color: tokens.textMute, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "block" };
  const inputStyle = { width: "100%", padding: "10px 12px", marginBottom: 14, background: tokens.bg, border: `1px solid ${tokens.border}`, borderRadius: 8, color: tokens.text, fontSize: 14, fontFamily: "inherit" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(8px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 12, padding: 28 }}>
        {!created ? (
          <>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>New client</div>
            <div style={{ fontSize: 13, color: tokens.textMute, marginBottom: 20 }}>Creates a portal login linked to a new client row</div>

            <label style={labelStyle}>Academy name</label>
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Elite Hoops Academy" />

            <label style={labelStyle}>Owner name</label>
            <input style={inputStyle} value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Jordan Cole" />

            <label style={labelStyle}>Owner email</label>
            <input style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} placeholder="owner@academy.com" type="email" />

            <label style={labelStyle}>Password</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <input style={{ ...inputStyle, marginBottom: 0, flex: 1 }} value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 characters" type="text" />
              <button onClick={generatePassword} style={{ padding: "0 14px", background: "transparent", border: `1px solid ${tokens.border}`, borderRadius: 8, color: tokens.text, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>Generate</button>
            </div>

            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="onboarding">Onboarding</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="churned">Churned</option>
            </select>

            {error && <div style={{ color: tokens.red || "#ED7969", fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={onClose} style={{ padding: "10px 16px", background: "transparent", border: `1px solid ${tokens.border}`, borderRadius: 8, color: tokens.text, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={submit} disabled={busy} style={{ padding: "10px 18px", background: tokens.accent, color: "#0A0A0B", border: 0, borderRadius: 8, fontWeight: 600, cursor: busy ? "wait" : "pointer", fontSize: 13, opacity: busy ? 0.6 : 1 }}>
                {busy ? "Creating…" : "Create client"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginBottom: 4 }}>✓ Client created</div>
            <div style={{ fontSize: 13, color: tokens.textMute, marginBottom: 20 }}>Copy these credentials now — the password will not be shown again</div>

            <div style={{ background: tokens.bg, border: `1px solid ${tokens.border}`, borderRadius: 8, padding: 16, fontFamily: "monospace", fontSize: 13, color: tokens.text, marginBottom: 16 }}>
              <div style={{ marginBottom: 6 }}><span style={{ color: tokens.textMute }}>Academy:</span> {created.name}</div>
              <div style={{ marginBottom: 6 }}><span style={{ color: tokens.textMute }}>Email:</span> {created.email}</div>
              <div><span style={{ color: tokens.textMute }}>Password:</span> {created.password}</div>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={copyCreds} style={{ padding: "10px 16px", background: "transparent", border: `1px solid ${tokens.border}`, borderRadius: 8, color: tokens.text, cursor: "pointer", fontSize: 13 }}>{copied ? "✓ Copied" : "Copy credentials"}</button>
              <button onClick={onClose} style={{ padding: "10px 18px", background: tokens.accent, color: "#0A0A0B", border: 0, borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
