import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { NewStaffModal, EditStaffModal, getRoleLabel } from "../components/StaffModals";

const ROLE_TONE = {
  admin:              { bg: "rgba(232,197,71,0.10)",  border: "rgba(232,197,71,0.45)",  text: "accent" },
  systems_manager:    { bg: "rgba(110,180,255,0.10)", border: "rgba(110,180,255,0.40)", text: "blueish" },
  systems_executor:   { bg: "rgba(110,180,255,0.06)", border: "rgba(110,180,255,0.30)", text: "blueish" },
  marketing_manager:  { bg: "rgba(199,135,255,0.10)", border: "rgba(199,135,255,0.40)", text: "purpleish" },
  marketing_executor: { bg: "rgba(199,135,255,0.06)", border: "rgba(199,135,255,0.30)", text: "purpleish" },
  scaling_manager:    { bg: "rgba(126,217,150,0.10)", border: "rgba(126,217,150,0.40)", text: "greenish" },
};

const STAFF_ROLE_ORDER = [
  "admin",
  "scaling_manager",
  "systems_manager",
  "systems_executor",
  "marketing_manager",
  "marketing_executor",
];

export default function TeamView({ tokens: tk, dark, session, me }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [banner, setBanner] = useState(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [resendingId, setResendingId] = useState(null);

  const isAdmin = me?.role === "admin";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError("");
    (async () => {
      const { data, error } = await supabase
        .from("staff")
        .select("id,name,email,role")
        .order("name");
      if (cancelled) return;
      if (error) {
        setFetchError(error.message);
      } else {
        setStaff(data || []);
      }
      setLoading(false);

      // Which invites are still outstanding (never accepted)? Admin-only —
      // needs the service key to read auth state. Non-fatal if it fails.
      if (isAdmin) {
        try {
          const res = await fetch("/api/clients?action=staff-pending", {
            method: "POST",
            headers: { Authorization: `Bearer ${session?.access_token}` },
          });
          const json = await res.json().catch(() => ({}));
          if (!cancelled && res.ok && Array.isArray(json.pending)) {
            setPendingIds(new Set(json.pending));
          }
        } catch { /* badge just won't show — not worth surfacing */ }
      }
    })();
    return () => { cancelled = true; };
  }, [refreshCounter, isAdmin, session]);

  // Re-send a still-outstanding invite. The backend auto-picks an invite link
  // (never-accepted) vs a recovery link (active), so this is safe to call.
  const resendInvite = async (member) => {
    if (resendingId) return;
    setResendingId(member.id);
    try {
      const res = await fetch("/api/clients?action=reset-staff-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ email: member.email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { showBanner(`Could not resend: ${json?.error || res.status}`); return; }
      showBanner(`Invite re-sent to ${member.email}.`);
    } catch (e) {
      showBanner(`Could not resend: ${e?.message || "network error"}`);
    } finally {
      setResendingId(null);
    }
  };

  const refresh = () => setRefreshCounter(x => x + 1);
  const editing = editingId ? staff.find(s => s.id === editingId) : null;

  const showBanner = (text) => {
    setBanner(text);
    setTimeout(() => setBanner(null), 3500);
  };

  const onCreated = (member) => {
    showBanner(`Invited ${member.name}.`);
    refresh();
  };

  const onSaved = (member) => {
    showBanner(`Updated ${member.name}.`);
    refresh();
  };

  const grouped = STAFF_ROLE_ORDER.map(role => ({
    role,
    members: staff.filter(s => s.role === role),
  })).filter(g => g.members.length > 0);

  const rolePillColor = (role) => {
    const tone = ROLE_TONE[role];
    if (!tone) return { bg: tk.surface, border: tk.border, color: tk.textMute };
    const colorMap = { accent: tk.accent, blueish: "#6EB4FF", purpleish: "#C787FF", greenish: tk.green || "#7ED996" };
    return { bg: tone.bg, border: tone.border, color: colorMap[tone.text] || tk.text };
  };

  return (
    <div style={{ padding: "24px 28px", color: tk.text }}>
      {banner && (
        <div style={{
          position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
          background: tk.green, color: "#fff", padding: "12px 22px", borderRadius: 999,
          fontSize: 13, fontWeight: 600, zIndex: 9999,
          boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        }}>{banner}</div>
      )}

      {/* Slim header: count + admin-only Add button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: tk.textSub }}>
          {loading
            ? "Loading…"
            : `${staff.length} member${staff.length === 1 ? "" : "s"}${isAdmin ? " · click any card to edit or send a password reset" : ""}`
          }
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowNew(true)}
            style={{
              padding: "10px 18px", background: tk.accent, color: "#0A0A0B",
              border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >+ Add staff member</button>
        )}
      </div>

      {fetchError && (
        <div style={{ color: tk.red || "#ED7969", fontSize: 13, marginBottom: 16, padding: "10px 14px", border: `1px solid ${tk.red || "#ED7969"}55`, borderRadius: 8, background: `${tk.red || "#ED7969"}10` }}>
          ⚠ Could not load staff: {fetchError}
        </div>
      )}

      {!loading && !fetchError && staff.length === 0 && (
        <div style={{ padding: 48, textAlign: "center", color: tk.textSub, fontSize: 14 }}>
          No staff members yet.{isAdmin ? " Click \"+ Add staff member\" to get started." : ""}
        </div>
      )}

      {grouped.map(group => (
        <div key={group.role} style={{ marginBottom: 26 }}>
          <div style={{
            fontSize: 10, color: tk.textMute, letterSpacing: "0.22em",
            textTransform: "uppercase", marginBottom: 12,
          }}>{getRoleLabel(group.role)} · {group.members.length}</div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}>
            {group.members.map(member => {
              const pill = rolePillColor(member.role);
              const initials = (member.name || "?")
                .split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
              const pending = pendingIds.has(member.id);
              return (
                <div
                  key={member.id}
                  onClick={() => isAdmin && setEditingId(member.id)}
                  style={{
                    background: tk.surface,
                    border: `1px solid ${tk.border}`,
                    borderRadius: 12,
                    padding: 18,
                    cursor: isAdmin ? "pointer" : "default",
                    transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                    display: "flex", alignItems: "center", gap: 14,
                  }}
                  onMouseEnter={e => {
                    if (!isAdmin) return;
                    e.currentTarget.style.borderColor = tk.accent;
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = `0 8px 20px rgba(0,0,0,0.15)`;
                  }}
                  onMouseLeave={e => {
                    if (!isAdmin) return;
                    e.currentTarget.style.borderColor = tk.border;
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: pill.bg, border: `1px solid ${pill.border}`,
                    color: pill.color, fontSize: 14, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>{initials}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: tk.text, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {member.name}
                    </div>
                    <div style={{ fontSize: 12, color: tk.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {member.email || <span style={{ color: tk.textMute, fontStyle: "italic" }}>no email</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      <span style={{
                        display: "inline-block",
                        color: pill.color, fontSize: 10, fontWeight: 600, letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        padding: "3px 9px", borderRadius: 999,
                        background: pill.bg, border: `1px solid ${pill.border}`,
                      }}>{getRoleLabel(member.role)}</span>
                      {pending && (
                        <span style={{
                          color: tk.amber || "#E8A547", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
                          textTransform: "uppercase", padding: "3px 9px", borderRadius: 999,
                          background: `${tk.amber || "#E8A547"}1A`, border: `1px solid ${tk.amber || "#E8A547"}66`,
                        }}>⏳ Pending invite</span>
                      )}
                    </div>
                  </div>
                  {isAdmin && pending && member.email && (
                    <button
                      onClick={(e) => { e.stopPropagation(); resendInvite(member); }}
                      disabled={resendingId === member.id}
                      style={{
                        flexShrink: 0, alignSelf: "center",
                        padding: "7px 12px", fontSize: 12, fontWeight: 700,
                        borderRadius: 8, cursor: resendingId === member.id ? "default" : "pointer",
                        fontFamily: "inherit", whiteSpace: "nowrap",
                        background: "transparent", color: tk.amber || "#E8A547",
                        border: `1px solid ${tk.amber || "#E8A547"}66`,
                        opacity: resendingId === member.id ? 0.6 : 1,
                      }}
                    >{resendingId === member.id ? "Sending…" : "Resend invite"}</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {showNew && (
        <NewStaffModal
          tokens={tk}
          session={session}
          onClose={() => setShowNew(false)}
          onCreated={onCreated}
        />
      )}

      {editing && (
        <EditStaffModal
          tokens={tk}
          session={session}
          member={editing}
          onClose={() => setEditingId(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
