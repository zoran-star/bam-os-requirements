import { useState, useEffect } from "react";
const TICKET_STATUSES = ["New", "In Progress", "Awaiting Client", "Complete"];

const TICKET_PATHS = {
  "Bug/Change": { color: "red", fields: ["Describe Item", "Bug or Change", "Description", "Timeline", "Drive Link"] },
  "Systems Menu": { color: "accent", fields: ["Selected System", "Uploaded .docx", "Drive Link", "Additional Context"] },
  "Custom Build": { color: "blue", fields: ["Category", "Problem", "Who It's For", "Current Process", "Success Outcome"] },
};
import Avatar from '../components/primitives/Avatar';

function TicketModal({ ticket, tokens, dark, onClose, onStatusChange }) {
  const [tab, setTab] = useState("overview");
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 10); return () => clearTimeout(t); }, []);

  const pathInfo = TICKET_PATHS[ticket.path];
  const pathColor = pathInfo.color === "red" ? tokens.red : pathInfo.color === "accent" ? tokens.accent : tokens.blue;
  const tabs = ["overview", "build plan", "messages", "delivery"];

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: dark ? "rgba(0,0,0,0.80)" : "rgba(0,0,0,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, backdropFilter: "blur(12px)",
      opacity: ready ? 1 : 0, transition: "opacity 0.2s",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 880, maxHeight: "88vh",
        background: tokens.surface, borderRadius: 20,
        border: `1px solid ${tokens.borderMed}`,
        boxShadow: `0 40px 100px rgba(0,0,0,${dark ? 0.7 : 0.2})`,
        display: "flex", flexDirection: "column", overflow: "hidden",
        transform: ready ? "translateY(0) scale(1)" : "translateY(16px) scale(0.975)",
        transition: "transform 0.22s cubic-bezier(0.34,1.3,0.64,1)",
      }}>
        {/* Header */}
        <div style={{ padding: "28px 32px 24px", borderBottom: `1px solid ${tokens.border}`, display: "flex", alignItems: "flex-start", gap: 18, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: tokens.textMute, fontFamily: "monospace" }}>{ticket.id}</span>
              {ticket.redAlert && <span style={{ fontSize: 12, fontWeight: 600, color: tokens.red }}>{"\ud83d\udd34"} Red Alert</span>}
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: tokens.text, margin: 0, letterSpacing: "-0.03em", lineHeight: 1.3 }}>{ticket.description}</h2>
            <div style={{ display: "flex", gap: 16, fontSize: 14, color: tokens.textMute, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontWeight: 500, color: tokens.textSub }}>{ticket.clientName}</span>
              <span style={{ color: pathColor, fontWeight: 600 }}>{ticket.path}</span>
              <span>Submitted {ticket.submitted}</span>
              <span style={{ fontWeight: 500, color: ticket.priority === "High" ? tokens.red : ticket.priority === "Medium" ? tokens.amber : tokens.textMute }}>{ticket.priority} priority</span>
            </div>
          </div>
          <div onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: tokens.textMute, fontSize: 18, transition: "color 0.12s",
          }}
            onMouseEnter={e => e.currentTarget.style.color = tokens.text}
            onMouseLeave={e => e.currentTarget.style.color = tokens.textMute}
          >{"\u00d7"}</div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", paddingLeft: 32, flexShrink: 0, borderBottom: `1px solid ${tokens.border}`, gap: 8 }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "14px 20px", fontSize: 14, fontWeight: tab === t ? 600 : 400,
              background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
              color: tab === t ? tokens.text : tokens.textMute,
              borderBottom: `2px solid ${tab === t ? tokens.accent : "transparent"}`,
              marginBottom: -1, transition: "all 0.12s", textTransform: "capitalize",
            }}>{t}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 32 }}>
          {tab === "overview" && (
            <div>
              {/* Status control */}
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginBottom: 12, letterSpacing: "0.04em" }}>STATUS</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {TICKET_STATUSES.map(s => (
                    <button key={s} onClick={() => onStatusChange(ticket.id, s)} style={{
                      padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                      background: ticket.status === s ? tokens.accentGhost : "transparent",
                      border: ticket.status === s ? `1px solid ${tokens.accentBorder}` : `1px solid ${tokens.border}`,
                      color: ticket.status === s ? tokens.accent : tokens.textMute,
                      fontFamily: "inherit", fontWeight: ticket.status === s ? 600 : 400,
                      transition: "all 0.12s",
                    }}>{s}</button>
                  ))}
                </div>
              </div>

              {/* Submission details */}
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginBottom: 16, letterSpacing: "0.04em" }}>SUBMISSION DETAILS</div>
                {Object.entries(ticket.fields).map(([key, val]) => (
                  <div key={key} style={{ display: "flex", gap: 16, marginBottom: 14, alignItems: "flex-start" }}>
                    <span style={{ width: 160, flexShrink: 0, fontSize: 13, fontWeight: 500, color: tokens.textSub }}>{key}</span>
                    <span style={{ fontSize: 14, color: tokens.text, lineHeight: 1.6 }}>{val}</span>
                  </div>
                ))}
              </div>

              {/* Manager */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderRadius: 12, background: tokens.surfaceAlt }}>
                <Avatar name={ticket.manager} size={32} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: tokens.text }}>{ticket.manager}</div>
                  <div style={{ fontSize: 12, color: tokens.textMute }}>Assigned</div>
                </div>
              </div>
            </div>
          )}

          {tab !== "overview" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 8 }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text }}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</div>
              <div style={{ fontSize: 14, color: tokens.textMute }}>Connect Supabase to populate this panel.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SystemsView({ tokens, dark }) {
  const [subTab, setSubTab] = useState("tickets");
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [expandedProfile, setExpandedProfile] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [profileSearch, setProfileSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleStatusChange = (ticketId, newStatus) => {
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: newStatus } : t));
    setSelectedTicket(prev => prev ? { ...prev, status: newStatus } : null);
    if (newStatus === "Complete") {
      const ticket = tickets.find(t => t.id === ticketId);
      setToast(`Email sent to ${ticket?.clientName || "client"} \u2014 ticket ${ticketId} marked complete.`);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard?.writeText("portal.byanymeanscoaches.com/support-ticket");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const subTabs = ["tickets", "client profiles", "build templates"];

  const [clientProfiles] = useState([]);
  const [buildTemplates] = useState([]);
  const filteredProfiles = profileSearch
    ? clientProfiles.filter(p => p.businessName.toLowerCase().includes(profileSearch.toLowerCase()) || p.niche.toLowerCase().includes(profileSearch.toLowerCase()))
    : clientProfiles;

  return (
    <div>
      {/* Sub-tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 32 }}>
        {subTabs.map(t => (
          <button key={t} onClick={() => setSubTab(t)} style={{
            padding: "10px 22px", borderRadius: 8, fontSize: 14, cursor: "pointer",
            background: subTab === t ? tokens.accentGhost : "transparent",
            border: "none", color: subTab === t ? tokens.accent : tokens.textMute,
            fontFamily: "inherit", fontWeight: subTab === t ? 600 : 400,
            textTransform: "uppercase", letterSpacing: "0.04em", transition: "all 0.12s",
          }}>{t}</button>
        ))}
      </div>

      {/* TICKETS */}
      {subTab === "tickets" && (
        <div>
          {/* Shareable link bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 14, padding: "14px 20px",
            background: tokens.surfaceEl, borderRadius: 12, marginBottom: 28,
            border: `1px solid ${tokens.border}`,
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", flexShrink: 0 }}>CLIENT INTAKE</span>
            <div style={{ flex: 1, fontSize: 14, color: tokens.accent, fontFamily: "monospace", fontWeight: 500 }}>
              portal.byanymeanscoaches.com/support-ticket
            </div>
            <button onClick={handleCopyLink} style={{
              padding: "6px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer",
              background: copied ? tokens.greenSoft : tokens.accentGhost,
              border: `1px solid ${copied ? tokens.green : tokens.accentBorder}`,
              color: copied ? tokens.green : tokens.accent,
              fontFamily: "inherit", fontWeight: 600, transition: "all 0.15s",
            }}>{copied ? "Copied" : "Copy"}</button>
          </div>

          {tickets.length === 0 && (
            <div style={{ padding: "60px 0", textAlign: "center", opacity: 0.4 }}>
              <div style={{ fontSize: 16, color: tokens.textMute }}>No tickets loaded</div>
            </div>
          )}
          {/* Kanban columns */}
          <div style={{ display: "flex", gap: 14 }}>
            {TICKET_STATUSES.map((status, ci) => {
              const colTickets = tickets.filter(t => t.status === status);
              return (
                <div key={ci} style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "0 4px" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: tokens.textMute }}>{status}</span>
                    <span style={{ fontSize: 12, color: tokens.textMute }}>{colTickets.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 120 }}>
                    {colTickets.map((ticket, ti) => {
                      const pathInfo = TICKET_PATHS[ticket.path];
                      const pathColor = pathInfo.color === "red" ? tokens.red : pathInfo.color === "accent" ? tokens.accent : tokens.blue;
                      return (
                        <div key={ticket.id}
                          onClick={() => setSelectedTicket(ticket)}
                          style={{
                            background: tokens.surfaceEl, borderRadius: 12,
                            padding: "16px 18px", cursor: "pointer",
                            border: `1px solid ${tokens.border}`,
                            borderLeft: ticket.redAlert ? `3px solid ${tokens.red}` : `1px solid ${tokens.border}`,
                            transition: "all 0.15s",
                            opacity: status === "Complete" ? 0.5 : 1,
                            animation: `cardIn 0.3s ease ${ti * 40}ms both`,
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceHov; e.currentTarget.style.borderColor = tokens.borderStr; }}
                          onMouseLeave={e => { e.currentTarget.style.background = tokens.surfaceEl; e.currentTarget.style.borderColor = tokens.border; }}
                        >
                          {/* Header */}
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, fontFamily: "monospace" }}>{ticket.id}</span>
                            {ticket.redAlert && <span style={{ fontSize: 11, fontWeight: 600, color: tokens.red }}>{"\ud83d\udd34"} Red Alert</span>}
                          </div>

                          {/* Client */}
                          <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text, marginBottom: 6, lineHeight: 1.3, letterSpacing: "-0.01em" }}>
                            {ticket.clientName}
                          </div>

                          {/* Description */}
                          <div style={{
                            fontSize: 13, color: tokens.textSub, lineHeight: 1.5, marginBottom: 12,
                            overflow: "hidden", textOverflow: "ellipsis",
                            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                          }}>{ticket.description}</div>

                          {/* Footer */}
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{
                              fontSize: 11, fontWeight: 600, color: pathColor, letterSpacing: "0.02em",
                              padding: "3px 8px", borderRadius: 5,
                              background: pathInfo.color === "red" ? tokens.redSoft : pathInfo.color === "accent" ? tokens.accentGhost : `${tokens.blue}12`,
                            }}>{ticket.path}</span>
                            <span style={{
                              fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
                              color: ticket.priority === "High" ? tokens.red : ticket.priority === "Medium" ? tokens.amber : tokens.textMute,
                            }}>{ticket.priority}</span>
                            <div style={{ flex: 1 }} />
                            <span style={{ fontSize: 11, color: tokens.textMute }}>{ticket.submitted}</span>
                          </div>
                          {/* Copy client link */}
                          {ticket.publicToken && (
                            <div style={{ marginTop: 10 }}>
                              <span
                                onClick={e => {
                                  e.stopPropagation();
                                  navigator.clipboard?.writeText(`${window.location.origin}/ticket/${ticket.publicToken}`);
                                  e.currentTarget.textContent = "Copied!";
                                  setTimeout(() => { if (e.currentTarget) e.currentTarget.textContent = "Copy client link"; }, 1500);
                                }}
                                style={{
                                  fontSize: 11, color: tokens.textMute, cursor: "pointer",
                                  transition: "color 0.12s",
                                }}
                                onMouseEnter={e => e.currentTarget.style.color = tokens.accent}
                                onMouseLeave={e => e.currentTarget.style.color = tokens.textMute}
                              >Copy client link</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CLIENT PROFILES */}
      {subTab === "client profiles" && (
        <div>
          {/* Search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 12, padding: "12px 20px",
            background: tokens.surfaceEl, borderRadius: 12, marginBottom: 24,
            border: `1px solid ${tokens.border}`,
          }}>
            <span style={{ fontSize: 14, color: tokens.textMute }}>{"\u2315"}</span>
            <input
              value={profileSearch} onChange={e => setProfileSearch(e.target.value)}
              placeholder="Search clients..."
              style={{
                flex: 1, background: "none", border: "none", outline: "none",
                fontSize: 14, color: tokens.text, fontFamily: "inherit",
              }}
            />
          </div>

          {/* Profile rows */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {filteredProfiles.map((profile, pi) => {
              const expanded = expandedProfile === profile.id;
              return (
                <div key={profile.id} style={{ animation: `cardIn 0.3s ease ${pi * 40}ms both` }}>
                  <div
                    onClick={() => setExpandedProfile(expanded ? null : profile.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 20,
                      padding: "18px 24px", cursor: "pointer",
                      background: expanded ? tokens.surfaceAlt : "transparent",
                      borderRadius: expanded ? "14px 14px 0 0" : 14,
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = tokens.surfaceEl; }}
                    onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ width: 200, minWidth: 200, flexShrink: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text, letterSpacing: "-0.01em" }}>{profile.businessName}</div>
                      <div style={{ fontSize: 13, color: tokens.textMute, marginTop: 3 }}>{profile.niche}</div>
                    </div>
                    <div style={{ width: 140, minWidth: 140, flexShrink: 0, fontSize: 13, color: tokens.textSub }}>{profile.location}</div>
                    <div style={{ width: 140, minWidth: 140, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, color: tokens.textMute, fontFamily: "monospace" }}>{profile.ghlSubAccount}</span>
                    </div>
                    <div style={{ flex: 1 }}>
                      {profile.activeBuilds > 0 ? (
                        <span style={{ fontSize: 14, fontWeight: 600, color: tokens.accent }}>{profile.activeBuilds} active build{profile.activeBuilds > 1 ? "s" : ""}</span>
                      ) : (
                        <span style={{ fontSize: 13, color: tokens.textMute }}>No active builds</span>
                      )}
                    </div>
                    <div style={{ fontSize: 14, color: expanded ? tokens.accent : tokens.textMute, transition: "color 0.12s", transform: expanded ? "rotate(90deg)" : "rotate(0)", flexShrink: 0 }}>{"\u2192"}</div>
                  </div>

                  {/* Expanded detail */}
                  {expanded && (
                    <div style={{
                      background: tokens.surfaceEl, borderRadius: "0 0 14px 14px",
                      padding: "24px 28px", animation: "cardIn 0.2s ease both",
                    }}>
                      {/* Overview */}
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginBottom: 10, letterSpacing: "0.04em" }}>OVERVIEW</div>
                        <div style={{ fontSize: 14, color: tokens.textSub, lineHeight: 1.7 }}>{profile.overview}</div>
                      </div>

                      {/* Branding */}
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginBottom: 10, letterSpacing: "0.04em" }}>BRANDING</div>
                        <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            {profile.branding.colors.map((c, i) => (
                              <div key={i} style={{ width: 28, height: 28, borderRadius: 6, background: c, border: `1px solid ${tokens.borderStr}` }} title={c} />
                            ))}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, color: tokens.textSub }}><span style={{ color: tokens.textMute }}>Fonts:</span> {profile.branding.fonts}</div>
                            <div style={{ fontSize: 13, color: tokens.textSub, marginTop: 4 }}><span style={{ color: tokens.textMute }}>Tone:</span> {profile.branding.tone}</div>
                          </div>
                        </div>
                      </div>

                      {/* GHL */}
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginBottom: 10, letterSpacing: "0.04em" }}>GHL SETUP</div>
                        <div style={{ fontSize: 14, color: tokens.textSub, lineHeight: 1.7 }}>{profile.ghlSetup}</div>
                      </div>

                      {/* Builds */}
                      <div style={{ display: "flex", gap: 40 }}>
                        {profile.builds.length > 0 && (
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginBottom: 10, letterSpacing: "0.04em" }}>ACTIVE BUILDS</div>
                            {profile.builds.map((b, i) => (
                              <div key={i} style={{ fontSize: 14, color: tokens.accent, fontWeight: 500, marginBottom: 6 }}>{b}</div>
                            ))}
                          </div>
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginBottom: 10, letterSpacing: "0.04em" }}>BUILD HISTORY</div>
                          {profile.history.map((h, i) => (
                            <div key={i} style={{ fontSize: 13, color: tokens.textSub, marginBottom: 6 }}>{h}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* BUILD TEMPLATES */}
      {subTab === "build templates" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
            {buildTemplates.map((tmpl, ti) => {
              const catColor = tmpl.category === "Funnels" ? tokens.blue : tmpl.category === "Automations" ? tokens.accent : tokens.green;
              return (
                <div key={tmpl.id}
                  onClick={() => setSelectedTemplate(selectedTemplate === tmpl.id ? null : tmpl.id)}
                  style={{
                    background: tokens.surfaceEl, borderRadius: 14, cursor: "pointer",
                    border: `1px solid ${selectedTemplate === tmpl.id ? tokens.borderStr : tokens.border}`,
                    transition: "all 0.15s", overflow: "hidden",
                    animation: `cardIn 0.3s ease ${ti * 50}ms both`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = tokens.borderStr; }}
                  onMouseLeave={e => { if (selectedTemplate !== tmpl.id) e.currentTarget.style.borderColor = tokens.border; }}
                >
                  <div style={{ padding: "22px 24px" }}>
                    {/* Header */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 600, color: tokens.text, letterSpacing: "-0.01em", lineHeight: 1.3 }}>{tmpl.name}</div>
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: 600, color: catColor, letterSpacing: "0.02em",
                        padding: "3px 8px", borderRadius: 5, flexShrink: 0,
                        background: tmpl.category === "Funnels" ? `${tokens.blue}12` : tmpl.category === "Automations" ? tokens.accentGhost : tokens.greenSoft,
                      }}>{tmpl.category}</span>
                    </div>

                    {/* Description */}
                    <div style={{ fontSize: 13, color: tokens.textSub, lineHeight: 1.6, marginBottom: 16 }}>{tmpl.description}</div>

                    {/* Status dots */}
                    <div style={{ display: "flex", gap: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: tmpl.built ? tokens.green : tokens.borderMed }} />
                        <span style={{ fontSize: 12, color: tmpl.built ? tokens.green : tokens.textMute }}>Built</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: tmpl.approved ? tokens.green : tokens.borderMed }} />
                        <span style={{ fontSize: 12, color: tmpl.approved ? tokens.green : tokens.textMute }}>Approved</span>
                      </div>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {selectedTemplate === tmpl.id && (
                    <div style={{ padding: "0 24px 22px", borderTop: `1px solid ${tokens.border}`, paddingTop: 18, animation: "cardIn 0.2s ease both" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: tokens.textMute, marginBottom: 10, letterSpacing: "0.04em" }}>TEMPLATE DETAILS</div>
                      <div style={{ fontSize: 14, color: tokens.textSub, lineHeight: 1.7, marginBottom: 16 }}>
                        {tmpl.description} This template includes all necessary automations, triggers, and content placeholders. Ready for customization per client branding and business rules.
                      </div>
                      <div style={{ display: "flex", gap: 12 }}>
                        <span style={{ fontSize: 13, color: tokens.accent, fontWeight: 500, cursor: "pointer" }}>Use Template</span>
                        <span style={{ fontSize: 13, color: tokens.textMute }}>{"\u00b7"}</span>
                        <span style={{ fontSize: 13, color: tokens.textSub, cursor: "pointer" }}>Duplicate</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ticket Modal */}
      {selectedTicket && (
        <TicketModal
          ticket={selectedTicket}
          tokens={tokens}
          dark={dark}
          onClose={() => setSelectedTicket(null)}
          onStatusChange={handleStatusChange}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
          background: tokens.green, color: "#fff", padding: "14px 28px",
          borderRadius: 12, fontSize: 14, fontWeight: 600, zIndex: 2000,
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          animation: "cardIn 0.3s ease both",
        }}>{toast}</div>
      )}
    </div>
  );
}
