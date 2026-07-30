import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { runTicketSubmit, makeIntakeDb, failureMessage, supportMailto, SUPPORT_EMAIL, HONEYPOT_FIELD } from "./publicTicketSubmit";

// ─── TOKENS (client-facing dark only) ───────────────────────────────────────

const tk = {
  bg: "#08080A",
  surface: "#0F0F12",
  surfaceEl: "#16161A",
  surfaceHov: "#1C1C21",
  border: "rgba(255,255,255,0.05)",
  borderMed: "rgba(255,255,255,0.08)",
  borderStr: "rgba(255,255,255,0.14)",
  text: "#EDEDEC",
  textSub: "#8E8E93",
  textMute: "#48484A",
  gold: "#E2DD9F",
  goldGhost: "rgba(226,221,159,0.06)",
  goldBorder: "rgba(226,221,159,0.15)",
  green: "#34D399",
  greenSoft: "rgba(52,211,153,0.10)",
  red: "#FB7185",
  redSoft: "rgba(251,113,133,0.08)",
  blue: "#60A5FA",
};

// ─── SYSTEMS MENU ITEMS ─────────────────────────────────────────────────────

const SYSTEMS_MENU = [
  { id: "s1", name: "Trial Booking Funnel", desc: "Landing page + GHL pipeline + follow-up" },
  { id: "s2", name: "Lead Nurture Sequence", desc: "5-email + 3-SMS drip for cold leads" },
  { id: "s3", name: "Review Request Automation", desc: "Google review request post-trial" },
  { id: "s4", name: "Camp Registration Flow", desc: "Seasonal camp signup + payment" },
  { id: "s5", name: "Referral Tracking Dashboard", desc: "Track referral sources & attribution" },
  { id: "s6", name: "Monthly KPI Report", desc: "Auto-generated performance report" },
];

const CATEGORIES = ["Funnel", "Automation", "Dashboard", "Integration", "Landing Page", "Other"];
// The public-facing stages now come from the server (PUBLIC_STAGES in
// api/_public-ticket-intake.js) so one list maps every real ticket status.
// The old local ["New", ...] named statuses the database has never had.

// ─── SHARED COMPONENTS ──────────────────────────────────────────────────────

function Shell({ children }) {
  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', -apple-system, system-ui, sans-serif", background: tk.bg, minHeight: "100vh", color: tk.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300..800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
        ::placeholder{color:${tk.textMute}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
      {/* Header */}
      <div style={{ padding: "28px 32px", borderBottom: `1px solid ${tk.border}` }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: tk.gold }}>By Any Means</div>
          <div style={{ fontSize: 12, color: tk.textMute, marginTop: 3 }}>Client Support</div>
        </div>
      </div>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 80px" }}>
        {children}
      </div>
    </div>
  );
}

function StepIndicator({ current, total }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 40 }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 600,
            background: i < current ? tk.gold : i === current ? tk.goldGhost : "transparent",
            color: i < current ? "#08080A" : i === current ? tk.gold : tk.textMute,
            border: `1.5px solid ${i <= current ? tk.gold : tk.borderStr}`,
            transition: "all 0.3s",
          }}>{i + 1}</div>
          {i < total - 1 && (
            <div style={{ width: 32, height: 1, background: i < current ? tk.gold : tk.borderStr, transition: "background 0.3s" }} />
          )}
        </div>
      ))}
      <span style={{ fontSize: 13, color: tk.textMute, marginLeft: 8 }}>Step {current + 1} of {total}</span>
    </div>
  );
}

function BackButton({ onClick }) {
  return (
    <button onClick={onClick} style={{
      background: "none", border: "none", color: tk.textMute, cursor: "pointer",
      fontSize: 14, fontFamily: "inherit", padding: "8px 0", marginBottom: 24,
      display: "flex", alignItems: "center", gap: 6, transition: "color 0.12s",
    }}
      onMouseEnter={e => e.currentTarget.style.color = tk.text}
      onMouseLeave={e => e.currentTarget.style.color = tk.textMute}
    >← Back</button>
  );
}

function FieldLabel({ children }) {
  return <label style={{ display: "block", fontSize: 14, fontWeight: 500, color: tk.text, marginBottom: 8 }}>{children}</label>;
}

function TextInput({ value, onChange, placeholder, type = "text" }) {
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder} style={{
      width: "100%", padding: "14px 18px", borderRadius: 10,
      background: tk.surfaceEl, border: `1px solid ${tk.border}`,
      color: tk.text, fontSize: 15, fontFamily: "inherit",
      outline: "none", transition: "border-color 0.15s",
    }}
      onFocus={e => e.currentTarget.style.borderColor = tk.goldBorder}
      onBlur={e => e.currentTarget.style.borderColor = tk.border}
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 4 }) {
  return (
    <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows} style={{
      width: "100%", padding: "14px 18px", borderRadius: 10, resize: "vertical",
      background: tk.surfaceEl, border: `1px solid ${tk.border}`,
      color: tk.text, fontSize: 15, fontFamily: "inherit", lineHeight: 1.6,
      outline: "none", transition: "border-color 0.15s",
    }}
      onFocus={e => e.currentTarget.style.borderColor = tk.goldBorder}
      onBlur={e => e.currentTarget.style.borderColor = tk.border}
    />
  );
}

function SelectInput({ value, onChange, options, placeholder }) {
  return (
    <select value={value} onChange={onChange} style={{
      width: "100%", padding: "14px 18px", borderRadius: 10, appearance: "none",
      background: `${tk.surfaceEl} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%238E8E93' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E") no-repeat right 16px center`,
      border: `1px solid ${tk.border}`,
      color: value ? tk.text : tk.textMute, fontSize: 15, fontFamily: "inherit",
      outline: "none", cursor: "pointer",
    }}>
      <option value="" style={{ background: tk.surfaceEl, color: tk.textMute }}>{placeholder}</option>
      {options.map(o => <option key={o} value={o} style={{ background: tk.surfaceEl, color: tk.text }}>{o}</option>)}
    </select>
  );
}

function PrimaryButton({ onClick, children, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "16px 40px", borderRadius: 10, fontSize: 15, fontWeight: 600,
      background: disabled ? tk.textMute : tk.gold, color: "#08080A",
      border: "none", cursor: disabled ? "default" : "pointer",
      fontFamily: "inherit", transition: "all 0.15s",
      opacity: disabled ? 0.4 : 1,
    }}>{children}</button>
  );
}

// ─── TICKET INTAKE ──────────────────────────────────────────────────────────

export function TicketIntake() {
  const [step, setStep] = useState(0); // 0=path, 1=form, 2=review, 3=done, 4=not saved
  const [path, setPath] = useState(null);
  const [fields, setFields] = useState({});
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [ticketRef, setTicketRef] = useState("");
  const [publicToken, setPublicToken] = useState("");
  const [failure, setFailure] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // Honeypot. Rendered off-screen and never focusable, so a person cannot fill
  // it by accident or by tabbing. The server refuses any submission that has it.
  const [honeypot, setHoneypot] = useState("");

  const setField = (key, val) => setFields(prev => ({ ...prev, [key]: val }));

  const pathOptions = [
    { key: "Bug/Change", title: "Fix or change something", desc: "Something isn't working right, or you need a modification to an existing system.", icon: "⚙" },
    { key: "Systems Menu", title: "Add something from our systems menu", desc: "Choose from our pre-built systems and automations to add to your account.", icon: null },
    { key: "Custom Build", title: "Request a custom build", desc: "Need something unique? Describe what you need and we'll scope it out.", icon: null },
  ];

  // DIAGNOSTIC ONLY. Neither of these is ever shown to anyone as a real
  // reference or a real tracking link: the server mints both off the saved row
  // and runTicketSubmit refuses to report success without them. They exist so
  // the failure screen's mailto can quote an attempted id.
  //
  // Which is just as well - `TKT-100..999` is 900 values for a table that
  // already holds 213 tickets, so as a real reference it would have collided
  // constantly, and a token from Math.random is not a secret.
  const generateTicketId = () => {
    const num = Math.floor(Math.random() * 900) + 100;
    return `TKT-${num}`;
  };

  const generateToken = () => {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  };

  // The reference and the tracking link come off the row the SERVER saved, and
  // from nothing else. See src/publicTicketSubmit.js for why: this used to show
  // the success screen unconditionally, so a rejected insert still told the
  // person their request was received.
  //
  // The write goes to /api/public-ticket, not to PostgREST. It cannot go to
  // PostgREST: RLS on `tickets` has exactly one insert policy and it is for
  // role `authenticated`, so a logged-out visitor is refused whatever the
  // payload says. The route holds the service key and is the only door.
  //
  // There is no sendConfirmation. The old code invoked a Supabase edge function
  // called `send-ticket-confirmation`; no such function is deployed in this
  // project (checked 2026-07-30), so it never sent anything. A call that cannot
  // work is not a feature, it is a comment that costs a round trip.
  const handleSubmit = async () => {
    setSubmitting(true);
    setFailure(null);

    const db = makeIntakeDb({
      fetchImpl: typeof fetch === "function" ? (...args) => fetch(...args) : undefined,
    });

    const outcome = await runTicketSubmit({
      db,
      form: { clientName, clientEmail, path, fields, honeypot },
      makeRef: generateTicketId,
      makeToken: generateToken,
    });

    setSubmitting(false);

    if (!outcome.ok) {
      console.error("Ticket insert failed:", outcome.reason, outcome.detail);
      setTicketRef("");
      setPublicToken("");
      setFailure(outcome);
      setStep(4);
      return;
    }

    setTicketRef(outcome.ticketRef);
    setPublicToken(outcome.publicToken);
    setStep(3);
  };

  const isFormValid = () => {
    if (!clientName || !clientEmail) return false;
    if (path === "Bug/Change") return fields["Describe the item"] && fields["Bug or Change"] && fields["Description"];
    if (path === "Systems Menu") return fields["Selected System"];
    if (path === "Custom Build") return fields["Category"] && fields["Problem"] && fields["Who it's for"];
    return false;
  };

  const statusUrl = publicToken ? `${window.location.origin}/ticket/${publicToken}` : "";

  return (
    <Shell>
      {/* ─ SCREEN 0: PATH SELECTOR ─ */}
      {step === 0 && (
        <div style={{ animation: "fadeUp 0.35s ease both" }}>
          <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 8 }}>What do you need help with?</h1>
          <p style={{ fontSize: 15, color: tk.textSub, marginBottom: 40 }}>Select the option that best describes your request.</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pathOptions.map(opt => (
              <div key={opt.key}
                onClick={() => { setPath(opt.key); setFields({}); setStep(1); }}
                style={{
                  padding: "28px 28px", borderRadius: 14, cursor: "pointer",
                  background: tk.surfaceEl, border: `1px solid ${tk.border}`,
                  transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = tk.goldBorder; e.currentTarget.style.background = tk.surfaceHov; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = tk.border; e.currentTarget.style.background = tk.surfaceEl; }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
                  {opt.icon && <span style={{ fontSize: 24, lineHeight: 1 }}>{opt.icon}</span>}
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 600, color: tk.text, marginBottom: 6, letterSpacing: "-0.01em" }}>{opt.title}</div>
                    <div style={{ fontSize: 14, color: tk.textSub, lineHeight: 1.5 }}>{opt.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─ SCREEN 1: FORM ─ */}
      {step === 1 && (
        <div style={{ animation: "fadeUp 0.35s ease both" }}>
          <BackButton onClick={() => setStep(0)} />
          <StepIndicator current={0} total={3} />

          <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 32 }}>
            {path === "Bug/Change" ? "Describe the issue or change" : path === "Systems Menu" ? "Choose a system" : "Describe your custom build"}
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Client info — always shown */}
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <FieldLabel>Your name / business name</FieldLabel>
                <TextInput value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. BAM San Jose" />
              </div>
              <div style={{ flex: 1 }}>
                <FieldLabel>Email</FieldLabel>
                <TextInput value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="you@business.com" type="email" />
              </div>
            </div>

            <div style={{ height: 1, background: tk.border }} />

            {/* PATH 1: Bug/Change */}
            {path === "Bug/Change" && (
              <>
                <div>
                  <FieldLabel>Describe the item</FieldLabel>
                  <TextInput value={fields["Describe the item"] || ""} onChange={e => setField("Describe the item", e.target.value)} placeholder="e.g. Booking calendar, landing page header…" />
                </div>
                <div>
                  <FieldLabel>Is this a bug or a change?</FieldLabel>
                  <SelectInput value={fields["Bug or Change"] || ""} onChange={e => setField("Bug or Change", e.target.value)} options={["Bug", "Change"]} placeholder="Select…" />
                </div>
                <div>
                  <FieldLabel>Description</FieldLabel>
                  <TextArea value={fields["Description"] || ""} onChange={e => setField("Description", e.target.value)} placeholder="Describe what's happening and what you expected…" rows={5} />
                </div>
                <div>
                  <FieldLabel>Timeline</FieldLabel>
                  <TextInput value={fields["Timeline"] || ""} onChange={e => setField("Timeline", e.target.value)} placeholder="e.g. ASAP, end of week, no rush…" />
                </div>
                <div>
                  <FieldLabel>Google Drive link (optional)</FieldLabel>
                  <TextInput value={fields["Drive Link"] || ""} onChange={e => setField("Drive Link", e.target.value)} placeholder="Paste a Drive link to screenshots or files…" />
                </div>
              </>
            )}

            {/* PATH 2: Systems Menu */}
            {path === "Systems Menu" && (
              <>
                <div>
                  <FieldLabel>Select a system</FieldLabel>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginTop: 4 }}>
                    {SYSTEMS_MENU.map(sys => {
                      const selected = fields["Selected System"] === sys.name;
                      return (
                        <div key={sys.id}
                          onClick={() => setField("Selected System", sys.name)}
                          style={{
                            padding: "18px 20px", borderRadius: 10, cursor: "pointer",
                            background: selected ? tk.goldGhost : tk.surfaceEl,
                            border: `1.5px solid ${selected ? tk.gold : tk.border}`,
                            transition: "all 0.15s",
                          }}
                          onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = tk.borderStr; }}
                          onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = tk.border; }}
                        >
                          <div style={{ fontSize: 14, fontWeight: 600, color: selected ? tk.gold : tk.text, marginBottom: 4 }}>{sys.name}</div>
                          <div style={{ fontSize: 12, color: tk.textMute, lineHeight: 1.4 }}>{sys.desc}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {fields["Selected System"] && (
                  <div style={{
                    padding: "16px 20px", borderRadius: 10,
                    background: tk.goldGhost, border: `1px solid ${tk.goldBorder}`,
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}>
                    <div>
                      <div style={{ fontSize: 13, color: tk.textMute, marginBottom: 4 }}>Selected system brief</div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: tk.gold }}>{fields["Selected System"]}.docx</div>
                    </div>
                    <button style={{
                      padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                      background: tk.gold, color: "#08080A", border: "none", cursor: "pointer",
                      fontFamily: "inherit",
                    }}>Download .docx</button>
                  </div>
                )}

                <div>
                  <FieldLabel>Upload completed .docx</FieldLabel>
                  <div style={{
                    padding: "32px 20px", borderRadius: 10, textAlign: "center",
                    background: tk.surfaceEl, border: `1.5px dashed ${tk.borderStr}`,
                    cursor: "pointer", transition: "border-color 0.15s",
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = tk.goldBorder}
                    onMouseLeave={e => e.currentTarget.style.borderColor = tk.borderStr}
                  >
                    <div style={{ fontSize: 14, color: tk.textSub }}>Drop file here or click to upload</div>
                    <div style={{ fontSize: 12, color: tk.textMute, marginTop: 4 }}>.docx files only</div>
                    <input type="file" accept=".docx" style={{ display: "none" }}
                      onChange={e => setField("Uploaded .docx", e.target.files?.[0]?.name || "")}
                    />
                  </div>
                  {fields["Uploaded .docx"] && (
                    <div style={{ fontSize: 13, color: tk.green, marginTop: 8 }}>Uploaded: {fields["Uploaded .docx"]}</div>
                  )}
                </div>

                <div>
                  <FieldLabel>Google Drive link (optional)</FieldLabel>
                  <TextInput value={fields["Drive Link"] || ""} onChange={e => setField("Drive Link", e.target.value)} placeholder="Paste a Drive link…" />
                </div>
                <div>
                  <FieldLabel>Additional context (optional)</FieldLabel>
                  <TextArea value={fields["Additional Context"] || ""} onChange={e => setField("Additional Context", e.target.value)} placeholder="Anything else we should know…" rows={3} />
                </div>
              </>
            )}

            {/* PATH 3: Custom Build */}
            {path === "Custom Build" && (
              <>
                <div>
                  <FieldLabel>Category</FieldLabel>
                  <SelectInput value={fields["Category"] || ""} onChange={e => setField("Category", e.target.value)} options={CATEGORIES} placeholder="Select a category…" />
                </div>
                <div>
                  <FieldLabel>What problem are you trying to solve?</FieldLabel>
                  <TextArea value={fields["Problem"] || ""} onChange={e => setField("Problem", e.target.value)} placeholder="Describe the problem in your own words…" rows={4} />
                </div>
                <div>
                  <FieldLabel>Who is this for?</FieldLabel>
                  <TextInput value={fields["Who it's for"] || ""} onChange={e => setField("Who it's for", e.target.value)} placeholder="e.g. my coaching staff, my clients, front desk…" />
                </div>
                <div>
                  <FieldLabel>What's your current process?</FieldLabel>
                  <TextArea value={fields["Current Process"] || ""} onChange={e => setField("Current Process", e.target.value)} placeholder="How do you handle this today?" rows={3} />
                </div>
                <div>
                  <FieldLabel>What does success look like?</FieldLabel>
                  <TextArea value={fields["Success Outcome"] || ""} onChange={e => setField("Success Outcome", e.target.value)} placeholder="Describe the ideal outcome…" rows={3} />
                </div>
              </>
            )}
          </div>

          <div style={{ marginTop: 40, display: "flex", gap: 12 }}>
            <PrimaryButton onClick={() => setStep(2)} disabled={!isFormValid()}>Review & Submit</PrimaryButton>
          </div>
        </div>
      )}

      {/* ─ SCREEN 2: REVIEW ─ */}
      {step === 2 && (
        <div style={{ animation: "fadeUp 0.35s ease both" }}>
          <BackButton onClick={() => setStep(1)} />
          <StepIndicator current={1} total={3} />

          <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 8 }}>Review your submission</h2>
          <p style={{ fontSize: 14, color: tk.textSub, marginBottom: 32 }}>Please confirm everything looks correct before submitting.</p>

          <div style={{ background: tk.surfaceEl, borderRadius: 14, border: `1px solid ${tk.border}`, overflow: "hidden" }}>
            {/* Path */}
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${tk.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: tk.textMute, letterSpacing: "0.04em", marginBottom: 6 }}>REQUEST TYPE</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: tk.gold }}>{path}</div>
            </div>

            {/* Client info */}
            <div style={{ padding: "16px 24px", borderBottom: `1px solid ${tk.border}`, display: "flex", gap: 32 }}>
              <div>
                <div style={{ fontSize: 12, color: tk.textMute, marginBottom: 4 }}>Name</div>
                <div style={{ fontSize: 14, color: tk.text, fontWeight: 500 }}>{clientName}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: tk.textMute, marginBottom: 4 }}>Email</div>
                <div style={{ fontSize: 14, color: tk.text }}>{clientEmail}</div>
              </div>
            </div>

            {/* Fields */}
            {Object.entries(fields).filter(([, v]) => v).map(([key, val]) => (
              <div key={key} style={{ padding: "14px 24px", borderBottom: `1px solid ${tk.border}` }}>
                <div style={{ fontSize: 12, color: tk.textMute, marginBottom: 4 }}>{key}</div>
                <div style={{ fontSize: 14, color: tk.text, lineHeight: 1.6 }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Honeypot. Off-screen, not focusable, not announced to screen
              readers, and autofill is turned off so a password manager has no
              reason to touch it. A person cannot reach this field; a bot fills
              every input it finds, and the server refuses anything that has it. */}
          <input
            type="text"
            name={HONEYPOT_FIELD}
            value={honeypot}
            onChange={e => setHoneypot(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: "absolute", left: -9999, top: -9999, width: 1, height: 1, opacity: 0 }}
          />

          <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
            <PrimaryButton onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Submitting…" : "Confirm & Submit"}
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* ─ SCREEN 3: CONFIRMATION ─ */}
      {step === 3 && (
        <div style={{ animation: "fadeUp 0.35s ease both", textAlign: "center", paddingTop: 40 }}>
          <StepIndicator current={2} total={3} />

          <div style={{ fontSize: 48, marginBottom: 20 }}>✓</div>
          <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 10 }}>Your ticket has been submitted</h2>
          <p style={{ fontSize: 16, color: tk.textSub, marginBottom: 40 }}>We'll be in touch within 24 hours.</p>

          <div style={{
            background: tk.surfaceEl, borderRadius: 14, border: `1px solid ${tk.border}`,
            padding: "28px 32px", display: "inline-block", textAlign: "left",
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: tk.textMute, letterSpacing: "0.04em", marginBottom: 8 }}>TICKET REFERENCE</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: tk.gold, fontFamily: "monospace", marginBottom: 20 }}>{ticketRef}</div>

            <div style={{ fontSize: 12, fontWeight: 600, color: tk.textMute, letterSpacing: "0.04em", marginBottom: 8 }}>TRACK YOUR TICKET</div>
            <div style={{
              display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
              background: tk.bg, borderRadius: 8, border: `1px solid ${tk.border}`,
            }}>
              <span style={{ fontSize: 13, color: tk.gold, fontFamily: "monospace", flex: 1, wordBreak: "break-all" }}>{statusUrl}</span>
              <button onClick={() => navigator.clipboard?.writeText(statusUrl)} style={{
                padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: tk.goldGhost, border: `1px solid ${tk.goldBorder}`,
                color: tk.gold, cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
              }}>Copy</button>
            </div>
            <div style={{ fontSize: 12, color: tk.textMute, marginTop: 10 }}>Bookmark this link to check your ticket status anytime.</div>
          </div>
        </div>
      )}

      {/* ─ SCREEN 4: NOT SAVED ─
          Deliberately offers no reference and no tracking link. There is no
          ticket to reference. What it does offer is a route to a human that
          does not need the database, carrying everything they already typed. */}
      {step === 4 && (
        <div style={{ animation: "fadeUp 0.35s ease both", textAlign: "center", paddingTop: 40 }}>
          <div style={{ fontSize: 44, marginBottom: 20, color: tk.red }}>!</div>
          <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 10 }}>Your request was not submitted</h2>
          <p style={{ fontSize: 16, color: tk.textSub, marginBottom: 8, maxWidth: 520, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
            {/* On a rate limit the server explains WHICH limit in plain
                English, and that is more use than our generic line. Everything
                else keeps the generic copy, because a database error message is
                not something to put in front of a person. */}
            {failure?.reason === "throttled" && failure?.detail
              ? failure.detail
              : failureMessage(failure?.reason)} Nobody on our team has seen it, so please use one of the options below.
          </p>
          <p style={{ fontSize: 14, color: tk.textMute, marginBottom: 32 }}>Your answers are still filled in, so nothing you typed is lost.</p>

          <div style={{
            background: tk.surfaceEl, borderRadius: 14, border: `1px solid ${tk.red}25`,
            padding: "28px 32px", display: "inline-block", textAlign: "left", maxWidth: 520,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: tk.text, marginBottom: 6 }}>Email it to us instead</div>
            <div style={{ fontSize: 14, color: tk.textSub, lineHeight: 1.6, marginBottom: 16 }}>
              This opens an email to {SUPPORT_EMAIL} with everything you just filled in, ready to send.
            </div>
            <a
              href={supportMailto({
                ref: failure?.row?.ticket_id, clientName, clientEmail, path, fields, reason: failure?.reason,
              })}
              style={{
                display: "inline-block", padding: "14px 28px", borderRadius: 10, fontSize: 15, fontWeight: 600,
                background: tk.gold, color: "#08080A", textDecoration: "none", fontFamily: "inherit",
              }}
            >Email support</a>

            <div style={{ height: 1, background: tk.border, margin: "24px 0" }} />

            <div style={{ fontSize: 14, fontWeight: 600, color: tk.text, marginBottom: 6 }}>Or try sending it again</div>
            <div style={{ fontSize: 14, color: tk.textSub, lineHeight: 1.6, marginBottom: 16 }}>
              {/* Do not promise a retry will work when we already know it will
                  not: a rate limit refuses the next attempt too. */}
              {failure?.reason === "throttled"
                ? "This one will be refused again until the limit resets, so email is the faster route right now."
                : "If this was a temporary connection problem, a second attempt may go through."}
            </div>
            <button
              onClick={() => { setFailure(null); setStep(2); }}
              style={{
                padding: "13px 26px", borderRadius: 10, fontSize: 14, fontWeight: 600,
                background: "transparent", border: `1px solid ${tk.borderStr}`,
                color: tk.text, cursor: "pointer", fontFamily: "inherit",
              }}
            >Back to review and try again</button>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ─── TICKET STATUS PAGE ─────────────────────────────────────────────────────

// ─── CONTENT PORTAL ─────────────────────────────────────────────────────────

const ONBOARDING_RESOURCES = [
  {
    section: "How to Submit Your Ads",
    icon: null,
    items: [
      { title: "Ad Submission Guide", desc: "Step-by-step walkthrough for submitting ad content to your BAM team.", type: "guide" },
      { title: "What We Need From You", desc: "Checklist of assets, access, and approvals required before we can run your ads.", type: "checklist" },
      { title: "Creative Best Practices", desc: "What makes a great ad — format specs, dos and don'ts, examples.", type: "guide" },
    ],
  },
  {
    section: "Ad Requests & Guides",
    icon: null,
    items: [
      { title: "Request New Ad Creative", desc: "Submit a request for new video or static ad creative from the production team.", type: "action" },
      { title: "Ad Copy Templates", desc: "Proven ad copy templates for trial offers, seasonal promos, and testimonials.", type: "template" },
      { title: "Campaign Types Explained", desc: "Lead gen, retargeting, brand awareness — when to use each and what to expect.", type: "guide" },
      { title: "Performance Benchmarks", desc: "What good looks like — CPL, CTR, and conversion rate targets by campaign type.", type: "guide" },
    ],
  },
  {
    section: "Resources",
    icon: null,
    items: [
      { title: "The Perfect Testimonial", desc: "How to capture a great client testimonial in under 5 minutes. Script and setup included.", type: "guide" },
      { title: "How to Film on iPhone", desc: "Lighting, framing, audio — everything you need to shoot pro-quality content on your phone.", type: "guide" },
      { title: "Brand Asset Guide", desc: "Your colors, fonts, tone of voice, and logo usage guidelines.", type: "resource" },
      { title: "Content Calendar Template", desc: "Plan your social content 30 days out with this plug-and-play template.", type: "template" },
      { title: "Facility Photo Checklist", desc: "The 10 shots every gym needs for ads, social, and website.", type: "checklist" },
    ],
  },
];

// Demo ad content status for client view
const CLIENT_AD_STATUS = [
  { id: "ca1", title: "Trial Booking Testimonial x3", status: "Ready for Review", statusColor: "blue", message: "Your 3 testimonial ads are ready! Please review and approve so we can launch.", action: "Review & Approve", date: "Mar 12" },
  { id: "ca2", title: "Spring Camp Promo", status: "In Production", statusColor: "gold", message: "Our team is editing your camp promo video. Expected delivery: Mar 22.", action: null, date: "Mar 10" },
  { id: "ca3", title: "Parent Testimonials x2", status: "Waiting on You", statusColor: "red", message: "We need your filmed testimonial footage to proceed. See the filming guide above for tips.", action: "Upload Footage", date: "Mar 8" },
];

export function ContentPortal() {
  const [onboarded, setOnboarded] = useState(() => {
    try { return localStorage.getItem("bam_content_onboarded") === "true"; } catch { return false; }
  });
  const [showOnboarding, setShowOnboarding] = useState(!onboarded);
  const [expandedSection, setExpandedSection] = useState(null);

  const handleCompleteOnboarding = () => {
    setShowOnboarding(false);
    setOnboarded(true);
    try { localStorage.setItem("bam_content_onboarded", "true"); } catch {}
  };

  const handleReviewOnboarding = () => {
    setShowOnboarding(true);
  };

  return (
    <Shell>
      {/* ─ ONBOARDING / WHAT YOU SHOULD KNOW ─ */}
      {showOnboarding && (
        <div style={{ animation: "fadeUp 0.35s ease both" }}>
          <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 8 }}>What You Should Know</h1>
          <p style={{ fontSize: 15, color: tk.textSub, marginBottom: 8 }}>
            Everything you need to work with your BAM team on ads and content.
          </p>
          <p style={{ fontSize: 13, color: tk.textMute, marginBottom: 40 }}>
            Review these resources to get started. You can always revisit them later.
          </p>

          {ONBOARDING_RESOURCES.map((section, si) => (
            <div key={si} style={{ marginBottom: 32 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                {section.icon && <span style={{ fontSize: 20 }}>{section.icon}</span>}
                <span style={{ fontSize: 18, fontWeight: 600, color: tk.text, letterSpacing: "-0.01em" }}>{section.section}</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {section.items.map((item, ii) => {
                  const typeColor = item.type === "action" ? tk.gold : item.type === "template" ? tk.blue : item.type === "checklist" ? tk.green : tk.textSub;
                  return (
                    <div key={ii} style={{
                      padding: "20px 24px", borderRadius: 12,
                      background: tk.surfaceEl, border: `1px solid ${tk.border}`,
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = tk.goldBorder; e.currentTarget.style.background = tk.surfaceHov; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = tk.border; e.currentTarget.style.background = tk.surfaceEl; }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, color: tk.text, marginBottom: 4 }}>{item.title}</div>
                          <div style={{ fontSize: 13, color: tk.textSub, lineHeight: 1.5 }}>{item.desc}</div>
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: typeColor, letterSpacing: "0.04em",
                          textTransform: "uppercase", padding: "3px 8px", borderRadius: 4,
                          background: item.type === "action" ? tk.goldGhost : `${typeColor}12`,
                          flexShrink: 0, marginTop: 2,
                        }}>{item.type}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 16 }}>
            <button onClick={handleCompleteOnboarding} style={{
              padding: "16px 40px", borderRadius: 10, fontSize: 15, fontWeight: 600,
              background: tk.gold, color: "#08080A", border: "none", cursor: "pointer",
              fontFamily: "inherit",
            }}>Got it — show me my content</button>
          </div>
        </div>
      )}

      {/* ─ CONTENT STATUS DASHBOARD ─ */}
      {!showOnboarding && (
        <div style={{ animation: "fadeUp 0.35s ease both" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 4 }}>Your Content</h1>
              <p style={{ fontSize: 14, color: tk.textMute }}>Track your ad content and see what's needed from you.</p>
            </div>
            <button onClick={handleReviewOnboarding} style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 13,
              background: "transparent", border: `1px solid ${tk.border}`,
              color: tk.textMute, cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.12s",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = tk.goldBorder; e.currentTarget.style.color = tk.gold; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = tk.border; e.currentTarget.style.color = tk.textMute; }}
            >View guides & resources</button>
          </div>

          {/* Action required callout */}
          {(() => {
            const needsAction = CLIENT_AD_STATUS.filter(a => a.statusColor === "red");
            if (needsAction.length === 0) return null;
            return (
              <div style={{
                padding: "20px 24px", borderRadius: 14, marginBottom: 24,
                background: tk.redSoft, border: `1px solid ${tk.red}15`,
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: tk.red, marginBottom: 6 }}>Action needed from you</div>
                {needsAction.map(a => (
                  <div key={a.id} style={{ fontSize: 14, color: tk.text, lineHeight: 1.6 }}>
                    <strong>{a.title}</strong> — {a.message}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Ad content cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {CLIENT_AD_STATUS.map((ad, i) => {
              const sc = ad.statusColor === "red" ? tk.red : ad.statusColor === "blue" ? tk.blue : tk.gold;
              const scBg = ad.statusColor === "red" ? tk.redSoft : ad.statusColor === "blue" ? `${tk.blue}12` : tk.goldGhost;
              return (
                <div key={ad.id} style={{
                  padding: "24px 28px", borderRadius: 14,
                  background: tk.surfaceEl, border: `1px solid ${tk.border}`,
                  borderLeft: `3px solid ${sc}`,
                  animation: `fadeUp 0.35s ease ${i * 60}ms both`,
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 16, fontWeight: 600, color: tk.text }}>{ad.title}</span>
                        <span style={{
                          fontSize: 11, fontWeight: 600, color: sc, padding: "3px 10px",
                          borderRadius: 5, background: scBg,
                        }}>{ad.status}</span>
                      </div>
                      <div style={{ fontSize: 14, color: tk.textSub, lineHeight: 1.6, marginBottom: ad.action ? 14 : 0 }}>{ad.message}</div>
                      {ad.action && (
                        <button style={{
                          padding: "10px 24px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                          background: sc === tk.red ? tk.red : tk.gold, color: "#08080A",
                          border: "none", cursor: "pointer", fontFamily: "inherit",
                        }}>{ad.action}</button>
                      )}
                    </div>
                    <span style={{ fontSize: 12, color: tk.textMute, flexShrink: 0 }}>{ad.date}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Timeline / what's next */}
          <div style={{ marginTop: 36 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: tk.text, marginBottom: 16 }}>What's Next</div>
            <div style={{
              padding: "20px 24px", borderRadius: 14,
              background: tk.surfaceEl, border: `1px solid ${tk.border}`,
            }}>
              {[
                { label: "Review & approve testimonial ads", done: false, due: "Mar 14" },
                { label: "Upload parent testimonial footage", done: false, due: "Mar 16" },
                { label: "Camp promo delivery", done: false, due: "Mar 22" },
                { label: "Monthly ad performance review", done: false, due: "Mar 28" },
              ].map((item, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "12px 0",
                  borderBottom: i < 3 ? `1px solid ${tk.border}` : "none",
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                    border: `1.5px solid ${item.done ? tk.green : tk.borderStr}`,
                    background: item.done ? tk.green : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {item.done && <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 14, color: tk.text, flex: 1 }}>{item.label}</span>
                  <span style={{ fontSize: 12, color: tk.textMute }}>{item.due}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ─── TICKET STATUS PAGE ─────────────────────────────────────────────────────
//
// /ticket/<token>, the link the confirmation screen hands out.
//
// WHAT THIS USED TO DO. It queried a `public_token` column and a
// `ticket_messages` table. Neither existed: the column is added by
// supabase/migrations/20260730T120000_public_ticket_intake.sql, and
// `ticket_messages` has NEVER existed in this project
// (to_regclass('public.ticket_messages') is null, checked 2026-07-30). So every
// visit either 404'd into "Ticket not found" or, worse, when Supabase was
// unconfigured, rendered a hardcoded demo ticket for "Demo Client" with three
// invented messages - at a real URL, to a real person, about their real
// request. That demo block is gone. A page that invents a status is the same
// lie as a form that invents a success.
//
// WHAT IT DOES NOW. Reads /api/public-ticket?token=..., which returns an
// allow-listed view of the row (api/_public-ticket-intake.js publicTicketView):
// stage, subject, dates and the client-facing messages, and nothing else. The
// thread comes from `tickets.messages`, the jsonb column api/tickets.js and the
// client portal already use - no second message store.
//
// WHY THERE IS NO REPLY BOX. There used to be one, and it wrote to the table
// that does not exist, so every message a person typed here was silently
// discarded. Rather than build an unauthenticated write endpoint keyed on a
// token that can be forwarded, pasted into a chat or sit in a browser history,
// replies go by email, which reaches the same people and is already how support
// answers. Read-only is the honest version of a page that was never writable.

export function TicketStatus() {
  const { token } = useParams();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/public-ticket?token=${encodeURIComponent(token || "")}`);
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        // Anything other than a ticket the server handed back is "not found".
        // There is no fallback that invents one.
        if (!res.ok || !json || !json.data) setError("not_found");
        else setTicket(json.data);
      } catch {
        if (!cancelled) setError("unreachable");
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <Shell>
        <div style={{ textAlign: "center", padding: "80px 0", color: tk.textMute, fontSize: 15 }}>Loading ticket…</div>
      </Shell>
    );
  }

  if (error || !ticket) {
    return (
      <Shell>
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: tk.text, marginBottom: 8 }}>
            {error === "unreachable" ? "We could not load this ticket" : "Ticket not found"}
          </div>
          <div style={{ fontSize: 14, color: tk.textMute, marginBottom: 24, lineHeight: 1.6 }}>
            {error === "unreachable"
              ? "Something went wrong on our side. Please try again in a moment."
              : "This link may be wrong or expired. Nothing is lost: email us and we will find your request."}
          </div>
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ fontSize: 14, color: tk.gold, textDecoration: "none" }}>
            {SUPPORT_EMAIL}
          </a>
        </div>
      </Shell>
    );
  }

  const stages = ticket.stages || [];
  const statusIndex = ticket.stageIndex;
  const submittedDate = ticket.submittedAt
    ? new Date(ticket.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "-";
  const replySubject = `Re: support request ${ticket.reference}`;
  const replyLink = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(replySubject)}`;

  return (
    <Shell>
      <div style={{ animation: "fadeUp 0.35s ease both" }}>
        {/* Ticket header */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: tk.textMute, fontFamily: "monospace" }}>{ticket.reference}</span>
            <span style={{ fontSize: 13, color: tk.textMute }}>Submitted {submittedDate}</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 8 }}>{ticket.subject}</h1>
          {ticket.path && <div style={{ fontSize: 14, color: tk.textSub }}>{ticket.path} request</div>}
        </div>

        {/* Cancelled tickets get a plain statement, not a progress bar that
            would imply the work is still moving. */}
        {ticket.cancelled ? (
          <div style={{
            background: tk.surfaceEl, borderRadius: 14, border: `1px solid ${tk.border}`,
            padding: "24px 28px", marginBottom: 32,
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: tk.text, marginBottom: 6 }}>This request was closed</div>
            <div style={{ fontSize: 14, color: tk.textSub, lineHeight: 1.6 }}>
              It is no longer being worked on. If that is not what you expected, reply by email and we will pick it back up.
            </div>
          </div>
        ) : (
          <div style={{
            background: tk.surfaceEl, borderRadius: 14, border: `1px solid ${tk.border}`,
            padding: "28px 28px", marginBottom: 32, overflowX: "auto",
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: tk.textMute, letterSpacing: "0.04em", marginBottom: 20 }}>STATUS</div>
            <div style={{ display: "flex", alignItems: "center", gap: 0, minWidth: 320 }}>
              {stages.map((s, i) => {
                const isActive = i === statusIndex;
                const isPast = i < statusIndex;
                return (
                  <div key={s} style={{ display: "flex", alignItems: "center", flex: 1 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 600,
                        background: isPast ? tk.green : isActive ? tk.gold : "transparent",
                        color: isPast ? "#08080A" : isActive ? "#08080A" : tk.textMute,
                        border: `2px solid ${isPast ? tk.green : isActive ? tk.gold : tk.borderStr}`,
                        transition: "all 0.3s",
                      }}>
                        {isPast ? "✓" : i + 1}
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: isActive ? 600 : 400,
                        color: isActive ? tk.gold : isPast ? tk.green : tk.textMute,
                        marginTop: 8, textAlign: "center", whiteSpace: "nowrap",
                      }}>{s}</span>
                    </div>
                    {i < stages.length - 1 && (
                      <div style={{ flex: 1, height: 2, background: isPast ? tk.green : tk.borderStr, margin: "0 8px", marginBottom: 24, transition: "background 0.3s" }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Complete state */}
        {ticket.complete && (
          <div style={{
            background: tk.greenSoft, borderRadius: 14, border: `1px solid ${tk.green}20`,
            padding: "24px 28px", marginBottom: 32, textAlign: "center",
          }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: tk.green, marginBottom: 6 }}>Ticket complete</div>
            <div style={{ fontSize: 14, color: tk.textSub }}>This request has been completed. Check the messages below for any notes from the BAM Business Team.</div>
          </div>
        )}

        {/* Messages thread, read only */}
        <div style={{
          background: tk.surfaceEl, borderRadius: 14, border: `1px solid ${tk.border}`,
          overflow: "hidden",
        }}>
          <div style={{ padding: "18px 24px", borderBottom: `1px solid ${tk.border}` }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: tk.text }}>Messages</span>
          </div>

          <div style={{ maxHeight: 400, overflowY: "auto", padding: "16px 24px" }}>
            {ticket.messages.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 0", color: tk.textMute, fontSize: 14 }}>No messages yet. The BAM Business Team will post updates here.</div>
            )}
            {ticket.messages.map((msg, i) => {
              const isTeam = msg.from === "BAM";
              const time = msg.at
                ? new Date(msg.at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                : "";
              return (
                <div key={i} style={{
                  display: "flex", flexDirection: "column",
                  alignItems: isTeam ? "flex-start" : "flex-end",
                  marginBottom: 16,
                }}>
                  <div style={{
                    maxWidth: "80%", padding: "14px 18px", borderRadius: 12,
                    background: isTeam ? tk.bg : tk.goldGhost,
                    border: `1px solid ${isTeam ? tk.border : tk.goldBorder}`,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: isTeam ? tk.gold : tk.textSub, marginBottom: 6 }}>
                      {isTeam ? "BAM Business Team" : "You"}
                    </div>
                    <div style={{ fontSize: 14, color: tk.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{msg.body}</div>
                  </div>
                  {time && <span style={{ fontSize: 11, color: tk.textMute, marginTop: 4, padding: "0 4px" }}>{time}</span>}
                </div>
              );
            })}
          </div>

          {/* Reply by email. Not a box that pretends to send. */}
          <div style={{ padding: "16px 24px", borderTop: `1px solid ${tk.border}` }}>
            <div style={{ fontSize: 13, color: tk.textSub, lineHeight: 1.6 }}>
              Need to add something? Reply by email and quote <b style={{ color: tk.text, fontFamily: "monospace" }}>{ticket.reference}</b>.
            </div>
            <a href={replyLink} style={{
              display: "inline-block", marginTop: 12, padding: "11px 22px", borderRadius: 8,
              fontSize: 13, fontWeight: 600, background: tk.goldGhost,
              border: `1px solid ${tk.goldBorder}`, color: tk.gold, textDecoration: "none",
            }}>Email us about this ticket</a>
          </div>
        </div>
      </div>
    </Shell>
  );
}
