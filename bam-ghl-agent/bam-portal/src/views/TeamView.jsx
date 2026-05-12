import { useState } from "react";
import { NewStaffModal, EditStaffModal, getRoleLabel } from "../components/StaffModals";

// Sample staff — replace with Supabase fetch later
const SAMPLE_STAFF = [
  { id: "55e35cac-4472-4788-ab2a-4f30c7183904", name: "Zoran Savic",   email: "zoran@byanymeansbball.com",   role: "admin" },
  { id: "dev-mike",                              name: "Mike Eluki",    email: "mike@byanymeansbball.com",    role: "admin" },
  { id: "4fe042f4-d890-45c3-a55f-8d18423373dd", name: "Rosano Arandila", email: "rarandila@gmail.com",         role: "systems_manager" },
  { id: "6e876f7f-6e17-443d-a032-5f28fa0c908b", name: "Chris Delos",   email: "mcdelostrinos@gmail.com",     role: "systems_executor" },
  { id: "98694d3f-ad3c-4607-85a3-f3900789970a", name: "Jenny Babeco",  email: "jennybabeco@gmail.com",       role: "systems_executor" },
  { id: "dev-mkt-1",                             name: "Coleman Smith", email: "coleman@byanymeansbball.com", role: "marketing_executor" },
];

const ROLE_TONE = {
  admin:              { bg: "rgba(232,197,71,0.10)",  border: "rgba(232,197,71,0.45)",  text: "accent" },
  systems_manager:    { bg: "rgba(110,180,255,0.10)", border: "rgba(110,180,255,0.40)", text: "blueish" },
  systems_executor:   { bg: "rgba(110,180,255,0.06)", border: "rgba(110,180,255,0.30)", text: "blueish" },
  marketing_manager:  { bg: "rgba(199,135,255,0.10)", border: "rgba(199,135,255,0.40)", text: "purpleish" },
  marketing_executor: { bg: "rgba(199,135,255,0.06)", border: "rgba(199,135,255,0.30)", text: "purpleish" },
  scaling_manager:    { bg: "rgba(126,217,150,0.10)", border: "rgba(126,217,150,0.40)", text: "greenish" },
};

export default function TeamView({ tokens: tk, dark, session, me }) {
  const [staff, setStaff] = useState(SAMPLE_STAFF);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [banner, setBanner] = useState(null);

  const editing = editingId ? staff.find(s => s.id === editingId) : null;

  const showBanner = (text) => {
    setBanner(text);
    setTimeout(() => setBanner(null), 3500);
  };

  const onCreated = (member) => {
    setStaff(prev => [...prev, member]);
  };

  const onSaved = (member) => {
    setStaff(prev => prev.map(s => s.id === member.id ? member : s));
    showBanner(`Updated ${member.name}.`);
  };

  // Group by role for cleaner display
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

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 11, color: tk.textMute, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>§ Team</div>
          <div style={{ fontSize: 28, fontWeight: 500, color: tk.text, letterSpacing: "-0.01em" }}>Staff Members</div>
          <div style={{ fontSize: 13, color: tk.textSub, marginTop: 6 }}>
            {staff.length} member{staff.length === 1 ? "" : "s"}. Click any card to edit details or send a password reset.
          </div>
        </div>
        <button
          onClick={() => setShowNew(true)}
          style={{
            padding: "10px 18px", background: tk.accent, color: "#0A0A0B",
            border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >+ Add staff member</button>
      </div>

      {/* Grouped staff cards */}
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
              return (
                <div
                  key={member.id}
                  onClick={() => setEditingId(member.id)}
                  style={{
                    background: tk.surface,
                    border: `1px solid ${tk.border}`,
                    borderRadius: 12,
                    padding: 18,
                    cursor: "pointer",
                    transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                    display: "flex", alignItems: "center", gap: 14,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = tk.accent;
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = `0 8px 20px rgba(0,0,0,0.15)`;
                  }}
                  onMouseLeave={e => {
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
                      {member.email}
                    </div>
                    <div style={{
                      display: "inline-block",
                      marginTop: 8,
                      color: pill.color, fontSize: 10, fontWeight: 600, letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      padding: "3px 9px", borderRadius: 999,
                      background: pill.bg, border: `1px solid ${pill.border}`,
                    }}>{getRoleLabel(member.role)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {staff.length === 0 && (
        <div style={{ padding: 48, textAlign: "center", color: tk.textSub, fontSize: 14 }}>
          No staff members yet. Click "+ Add staff member" to get started.
        </div>
      )}

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

const STAFF_ROLE_ORDER = [
  "admin",
  "scaling_manager",
  "systems_manager",
  "systems_executor",
  "marketing_manager",
  "marketing_executor",
];
