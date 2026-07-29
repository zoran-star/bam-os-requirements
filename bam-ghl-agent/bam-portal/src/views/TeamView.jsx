import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { NewStaffModal, EditStaffModal, getRoleLabel } from "../components/StaffModals";
import { showToast, ToastHost, ConfirmHost } from "../components/dialogs.jsx";

// One-line "what can this role see" hints under each group header, mirroring
// api/_roles.js + the canSee* flags in App.jsx. Keep in sync when roles change.
const ROLE_HINTS = {
  admin:              "Full access: every client, financials, commissions, team",
  scaling_manager:    "Their assigned clients, systems, marketing, commissions for their book",
  systems_manager:    "All systems tickets + delegation",
  systems_executor:   "Systems tickets assigned to them",
  marketing_manager:  "Marketing + content across all clients, content routing",
  marketing_executor: "Marketing + content execution",
  content_executor:   "Content tickets assigned to them only",
};

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
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [resendingId, setResendingId] = useState(null);
  const [search, setSearch] = useState("");
  // staff.id -> number of non-archived academies they're the Scaling Manager for
  const [clientCounts, setClientCounts] = useState({});

  const isAdmin = me?.role === "admin";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError("");
    (async () => {
      const { data, error } = await supabase
        .from("staff")
        .select("id,name,email,role,booking_url,avatar_url")
        .order("name");
      if (cancelled) return;
      if (error) {
        setFetchError(error.message);
      } else {
        setStaff(data || []);
      }
      setLoading(false);

      // Per-SM academy load ("manages N academies" on the cards).
      try {
        const { data: crows } = await supabase
          .from("clients").select("scaling_manager_id").is("archived_at", null);
        if (!cancelled && Array.isArray(crows)) {
          const counts = {};
          crows.forEach(r => { if (r.scaling_manager_id) counts[r.scaling_manager_id] = (counts[r.scaling_manager_id] || 0) + 1; });
          setClientCounts(counts);
        }
      } catch { /* count line just won't show */ }

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

  const showBanner = (text) => showToast(text, "success");

  const onCreated = (member) => {
    showBanner(`Invited ${member.name}.`);
    refresh();
  };

  const onSaved = (member) => {
    showBanner(`Updated ${member.name}.`);
    refresh();
  };

  const q = search.trim().toLowerCase();
  const searched = q
    ? staff.filter(s =>
        (s.name || "").toLowerCase().includes(q) ||
        (s.email || "").toLowerCase().includes(q) ||
        getRoleLabel(s.role).toLowerCase().includes(q))
    : staff;
  const grouped = STAFF_ROLE_ORDER.map(role => ({
    role,
    members: searched.filter(s => s.role === role),
  })).filter(g => g.members.length > 0);

  const rolePillColor = (role) => {
    const tone = ROLE_TONE[role];
    if (!tone) return { bg: tk.surface, border: tk.border, color: tk.textMute };
    const colorMap = { accent: tk.accent, blueish: "#6EB4FF", purpleish: "#C787FF", greenish: tk.green || "#7ED996" };
    return { bg: tone.bg, border: tone.border, color: colorMap[tone.text] || tk.text };
  };

  return (
    <div style={{ padding: "24px 28px", color: tk.text }}>
      {/* Slim header: count + admin-only Add button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: tk.textSub }}>
          {loading
            ? "Loading…"
            : `${staff.length} member${staff.length === 1 ? "" : "s"}${isAdmin ? " · click any card to edit or send a password reset" : ""}`
          }
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email, or role…"
          style={{
            flex: "0 1 260px", minWidth: 180, padding: "9px 13px", fontSize: 13,
            background: tk.surface, color: tk.text, border: `1px solid ${tk.border}`,
            borderRadius: 8, outline: "none", fontFamily: "inherit",
          }}
        />
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
          Could not load staff: {fetchError}
        </div>
      )}

      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ background: tk.surface, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 18, display: "flex", alignItems: "center", gap: 14 }}>
              <div className="bp-skel" style={{ width: 44, height: 44, borderRadius: 12, background: tk.border }} />
              <div style={{ flex: 1 }}>
                <div className="bp-skel" style={{ height: 12, width: "60%", borderRadius: 999, background: tk.border, marginBottom: 8 }} />
                <div className="bp-skel" style={{ height: 10, width: "80%", borderRadius: 999, background: tk.border }} />
              </div>
            </div>
          ))}
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
          {ROLE_HINTS[group.role] && (
            <div style={{ fontSize: 11.5, color: tk.textMute, margin: "-6px 0 12px", lineHeight: 1.4 }}>{ROLE_HINTS[group.role]}</div>
          )}

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
                  {member.avatar_url ? (
                    <img src={member.avatar_url} alt="" style={{
                      width: 44, height: 44, borderRadius: 12, objectFit: "cover",
                      border: `1px solid ${pill.border}`, flexShrink: 0, background: pill.bg,
                    }} onError={e => { e.currentTarget.style.display = "none"; e.currentTarget.nextSibling.style.display = "flex"; }} />
                  ) : null}
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: pill.bg, border: `1px solid ${pill.border}`,
                    color: pill.color, fontSize: 14, fontWeight: 700,
                    display: member.avatar_url ? "none" : "flex", alignItems: "center", justifyContent: "center",
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
                      {member.role === "scaling_manager" && (
                        <span style={{
                          color: tk.textSub, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
                          textTransform: "uppercase", padding: "3px 9px", borderRadius: 999,
                          background: tk.surfaceEl || tk.bg, border: `1px solid ${tk.border}`,
                        }}>{clientCounts[member.id] || 0} academies</span>
                      )}
                      {["scaling_manager", "marketing_manager", "marketing_executor"].includes(member.role) && !member.booking_url && (
                        <span title="Client checklist booking buttons fall back to Slack until a booking link is set - edit this member to add one" style={{
                          color: tk.amber || "#E8A547", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                          textTransform: "uppercase", padding: "3px 9px", borderRadius: 999,
                          background: `${tk.amber || "#E8A547"}1A`, border: `1px solid ${tk.amber || "#E8A547"}66`,
                        }}>No booking link</span>
                      )}
                      {pending && (
                        <span style={{
                          color: tk.amber || "#E8A547", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
                          textTransform: "uppercase", padding: "3px 9px", borderRadius: 999,
                          background: `${tk.amber || "#E8A547"}1A`, border: `1px solid ${tk.amber || "#E8A547"}66`,
                        }}>Pending invite</span>
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

      <ToastHost tokens={tk} />
      <ConfirmHost tokens={tk} />
    </div>
  );
}
