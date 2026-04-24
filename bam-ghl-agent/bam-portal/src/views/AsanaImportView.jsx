import { useState, useEffect, useMemo } from "react";
import { fetchAsanaImport, importAsanaTicket, saveAcademyMapping } from "../services/asanaImportService";

// Normalize strings for loose matching (lowercase, strip punctuation/whitespace)
function norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Build the type-specific fields shape
function initialFieldsFor(type, description) {
  if (type === "error") return { what_broke: description || "", steps_tried: "", urgency: "" };
  if (type === "change") return { current_state: "", desired_state: description || "", where: "" };
  if (type === "build")  return { what_to_build: description || "", requirements: "", target_users: "" };
  return {};
}

export default function AsanaImportView({ tokens: t, dark }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tickets, setTickets] = useState([]);        // unimported Asana tickets
  const [mapping, setMapping] = useState({});        // asana_name -> { client_id, skip }
  const [clients, setClients] = useState([]);
  const [staff, setStaff] = useState([]);
  const [stafflookup, setStafflookup] = useState({});// asana assignee name -> staff email
  const [alreadyImported, setAlreadyImported] = useState(0);
  const [totalOpen, setTotalOpen] = useState(0);

  const [idx, setIdx] = useState(0);
  const [skipped, setSkipped] = useState(new Set());
  const [imported, setImported] = useState(new Set());

  // form state (re-keyed when idx changes)
  const [clientId, setClientId] = useState("");
  const [markNotClient, setMarkNotClient] = useState(false);
  const [type, setType] = useState("error");
  const [category, setCategory] = useState("systems");
  const [priority, setPriority] = useState("standard");
  const [assignedTo, setAssignedTo] = useState("");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const [flashMsg, setFlashMsg] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    const res = await fetchAsanaImport();
    if (res.error) { setError(res.error); setLoading(false); return; }
    setTickets(res.data || []);
    setMapping(res.mapping || {});
    setClients(res.clients || []);
    setStaff(res.staff || []);
    setStafflookup(res.stafflookup || {});
    setAlreadyImported(res.extra?.already_imported || 0);
    setTotalOpen(res.extra?.total_open || (res.data || []).length);
    setIdx(0);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const current = tickets[idx] || null;

  // Client auto-match (mapping → normalized client name match)
  const autoClientId = useMemo(() => {
    if (!current) return "";
    const key = current.parsed.academy?.trim();
    if (!key) return "";
    const mapped = mapping[key];
    if (mapped) return mapped.skip ? "__skip__" : (mapped.client_id || "");
    // Normalized name match
    const nk = norm(key);
    const hit = clients.find(c => norm(c.name) === nk);
    return hit ? hit.id : "";
  }, [current, mapping, clients]);

  const autoAssignee = useMemo(() => {
    if (!current) return "";
    const email = stafflookup[current.assignee_name];
    if (!email) return "";
    const hit = staff.find(s => s.email?.toLowerCase() === email.toLowerCase());
    return hit ? hit.id : "";
  }, [current, staff, stafflookup]);

  // Reset form when the current ticket changes
  useEffect(() => {
    if (!current) return;
    setClientId(autoClientId === "__skip__" ? "" : autoClientId);
    setMarkNotClient(autoClientId === "__skip__");
    // Category: from parsed or default systems
    const cat = current.parsed.category && ["systems","website","ads","other"].includes(current.parsed.category)
      ? current.parsed.category : "systems";
    setCategory(cat);
    // Type: simple heuristic on title/description
    const text = `${current.parsed.title} ${current.parsed.description}`.toLowerCase();
    const guessType =
      /\bfix|broken|not working|error|issue|bug\b/.test(text) ? "error"
      : /\bchange|update|adjust|edit|revise\b/.test(text)      ? "change"
      : /\bbuild|create|new|launch|set ?up\b/.test(text)       ? "build"
      : "error";
    setType(guessType);
    setPriority(current.parsed.red_alert ? "red_alert" : "standard");
    setAssignedTo(autoAssignee);
    setTitle(current.parsed.title || current.name || "");
    setFields(initialFieldsFor(guessType, current.parsed.description));
  }, [current, autoClientId, autoAssignee]);

  // When type changes manually, reset type-specific fields using the parsed description
  const onTypeChange = (newType) => {
    setType(newType);
    setFields(initialFieldsFor(newType, current?.parsed?.description || ""));
  };

  const flash = (msg) => { setFlashMsg(msg); setTimeout(() => setFlashMsg(null), 2500); };

  const advance = () => {
    // Move to next unseen ticket
    let next = idx + 1;
    while (next < tickets.length && (imported.has(next) || skipped.has(next))) next++;
    if (next >= tickets.length) next = idx; // stay; list is done
    setIdx(next);
  };

  const onSkip = () => {
    const s = new Set(skipped); s.add(idx); setSkipped(s);
    advance();
  };

  const onImport = async () => {
    if (!current) return;
    if (markNotClient) {
      // Save mapping as "skip" so future imports hide this academy
      const academy = current.parsed.academy?.trim();
      if (academy) {
        await saveAcademyMapping({ asana_name: academy, skip: true });
      }
      onSkip();
      flash("Marked academy as skip");
      return;
    }
    if (!clientId) { alert("Pick a client (or mark 'not a client')"); return; }

    setBusy(true);

    // Save mapping for this academy (exact-match, one-time)
    const academy = current.parsed.academy?.trim();
    if (academy && !mapping[academy]) {
      await saveAcademyMapping({ asana_name: academy, client_id: clientId, skip: false });
      setMapping({ ...mapping, [academy]: { client_id: clientId, skip: false } });
    }

    const { error, data } = await importAsanaTicket({
      asana_gid: current.asana_gid,
      client_id: clientId,
      category,
      type,
      priority,
      title,
      fields,
      assigned_to: assignedTo || null,
      asana_created_at: current.created_at,
      due_date: current.due_on,
    });

    setBusy(false);
    if (error) { alert(`Import failed: ${error}`); return; }

    const s = new Set(imported); s.add(idx); setImported(s);
    setAlreadyImported(alreadyImported + 1);
    flash(`Imported → ${clients.find(c => c.id === clientId)?.name || "client"}`);
    advance();
  };

  if (loading) return <div style={{ color: t.textMute, padding: 24 }}>Loading Asana tickets…</div>;
  if (error)   return <div style={{ color: t.red,     padding: 24 }}>Error: {error}</div>;

  if (!tickets.length) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: t.textMute }}>
        <div style={{ fontSize: 16, color: t.text, marginBottom: 6 }}>Nothing to import.</div>
        <div style={{ fontSize: 13 }}>
          {alreadyImported > 0 && <>Already imported: {alreadyImported}. </>}
          {totalOpen === 0 && <>No open tickets in Tickets - MASTER.</>}
        </div>
        <button onClick={load} style={btnSecondary(t)}>Reload from Asana</button>
      </div>
    );
  }

  const pending = tickets.length - imported.size - skipped.size;
  const done = idx >= tickets.length || pending === 0;

  return (
    <div style={{ padding: "8px 4px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Progress header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: t.textMute }}>
          <b style={{ color: t.text }}>{imported.size}</b> imported ·{" "}
          <b style={{ color: t.text }}>{skipped.size}</b> skipped ·{" "}
          <b style={{ color: t.text }}>{pending}</b> left
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={load} style={btnSecondary(t)}>Reload</button>
      </div>

      {flashMsg && (
        <div style={{ background: t.greenSoft || `${t.green}20`, border: `1px solid ${t.green}55`, color: t.green, padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
          {flashMsg}
        </div>
      )}

      {done ? (
        <div style={{ padding: 40, textAlign: "center", color: t.textMute }}>
          <div style={{ fontSize: 16, color: t.text, marginBottom: 6 }}>All caught up.</div>
          <div style={{ fontSize: 13 }}>Imported: {imported.size} · Skipped: {skipped.size}</div>
        </div>
      ) : (
        <TicketCard
          tokens={t}
          dark={dark}
          ticket={current}
          idx={idx + 1}
          total={tickets.length}
          clients={clients}
          staff={staff}
          clientId={clientId} setClientId={setClientId}
          markNotClient={markNotClient} setMarkNotClient={setMarkNotClient}
          category={category} setCategory={setCategory}
          type={type} onTypeChange={onTypeChange}
          priority={priority} setPriority={setPriority}
          assignedTo={assignedTo} setAssignedTo={setAssignedTo}
          title={title} setTitle={setTitle}
          fields={fields} setFields={setFields}
          onSkip={onSkip}
          onImport={onImport}
          busy={busy}
        />
      )}
    </div>
  );
}

function TicketCard({
  tokens: t, dark, ticket, idx, total, clients, staff,
  clientId, setClientId, markNotClient, setMarkNotClient,
  category, setCategory, type, onTypeChange,
  priority, setPriority, assignedTo, setAssignedTo,
  title, setTitle, fields, setFields,
  onSkip, onImport, busy,
}) {
  return (
    <div style={{
      background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 20, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 24,
    }}>
      {/* LEFT — raw Asana */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: t.textMute, letterSpacing: 0.5, textTransform: "uppercase" }}>
          Ticket {idx} / {total}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: t.text, wordBreak: "break-word" }}>
          {ticket.name}
        </div>

        <Field label="Academy (from Asana)" value={ticket.parsed.academy || "—"} tokens={t} />
        <Field label="Email (from Asana)"   value={ticket.parsed.email   || "—"} tokens={t} />
        <Field label="Asana category"       value={ticket.parsed.category || "—"} tokens={t} />
        <Field label="Assigned (Asana)"     value={ticket.assignee_name || "—"}   tokens={t} />
        <Field label="Created"              value={ticket.created_at?.slice(0,10) || "—"} tokens={t} />
        <Field label="Due"                  value={ticket.due_on || "—"} tokens={t} />
        {ticket.parsed.red_alert && (
          <div style={{ fontSize: 11, color: t.red, fontWeight: 700, letterSpacing: 0.4 }}>🔴 RED ALERT</div>
        )}

        <div>
          <div style={{ fontSize: 11, color: t.textMute, marginBottom: 4, fontWeight: 600 }}>DESCRIPTION</div>
          <div style={{
            background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8,
            padding: 10, fontSize: 12, color: t.textSub, whiteSpace: "pre-wrap",
            maxHeight: 220, overflowY: "auto", lineHeight: 1.5,
          }}>
            {ticket.parsed.description || "(none)"}
          </div>
        </div>

        <a href={ticket.permalink} target="_blank" rel="noreferrer"
           style={{ fontSize: 12, color: t.accent, textDecoration: "none", marginTop: 4 }}>
          Open in Asana ↗
        </a>
      </div>

      {/* RIGHT — cleanup form */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <FormLabel tokens={t}>Map to client</FormLabel>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={markNotClient ? "" : clientId}
                  disabled={markNotClient}
                  onChange={e => setClientId(e.target.value)}
                  style={selectStyle(t)}>
            <option value="">— pick a client —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label style={{ fontSize: 12, color: t.textSub, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={markNotClient} onChange={e => setMarkNotClient(e.target.checked)} />
            Not a real client
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <FormLabel tokens={t}>Category</FormLabel>
            <select value={category} onChange={e => setCategory(e.target.value)} style={selectStyle(t)}>
              <option value="systems">Systems</option>
              <option value="website">Website</option>
              <option value="ads">Ads</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <FormLabel tokens={t}>Priority</FormLabel>
            <select value={priority} onChange={e => setPriority(e.target.value)} style={selectStyle(t)}>
              <option value="standard">Standard</option>
              <option value="red_alert">🔴 Red Alert</option>
            </select>
          </div>
        </div>

        <div>
          <FormLabel tokens={t}>Ticket type</FormLabel>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { v: "error",  l: "Fix (Error)" },
              { v: "change", l: "Change" },
              { v: "build",  l: "Build" },
            ].map(opt => (
              <button key={opt.v} onClick={() => onTypeChange(opt.v)}
                style={{
                  flex: 1, padding: "10px 8px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  borderRadius: 8, fontFamily: "inherit",
                  border: `1px solid ${type === opt.v ? t.accent : t.border}`,
                  background: type === opt.v ? `${t.accent}22` : t.bg,
                  color: type === opt.v ? t.text : t.textSub,
                }}>{opt.l}</button>
            ))}
          </div>
        </div>

        <div>
          <FormLabel tokens={t}>Title</FormLabel>
          <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle(t)} />
        </div>

        {/* Type-specific fields */}
        {type === "error" && (
          <TypeFields tokens={t} fields={fields} setFields={setFields}
            schema={[
              { k: "what_broke",  l: "What broke?",      big: true },
              { k: "steps_tried", l: "Steps already tried" },
              { k: "urgency",     l: "Urgency / impact" },
            ]} />
        )}
        {type === "change" && (
          <TypeFields tokens={t} fields={fields} setFields={setFields}
            schema={[
              { k: "current_state", l: "Current state" },
              { k: "desired_state", l: "Desired state", big: true },
              { k: "where",         l: "Where (page/flow/form)" },
            ]} />
        )}
        {type === "build" && (
          <TypeFields tokens={t} fields={fields} setFields={setFields}
            schema={[
              { k: "what_to_build", l: "What to build", big: true },
              { k: "requirements",  l: "Requirements / specs" },
              { k: "target_users",  l: "Who uses it" },
            ]} />
        )}

        <div>
          <FormLabel tokens={t}>Assign to (optional)</FormLabel>
          <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} style={selectStyle(t)}>
            <option value="">— unassigned —</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name} · {s.role}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button onClick={onSkip} style={btnSecondary(t)} disabled={busy}>Skip</button>
          <button onClick={onImport} style={btnPrimary(t)} disabled={busy}>
            {busy ? "Importing…" : "Import ticket →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TypeFields({ tokens: t, fields, setFields, schema }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {schema.map(({ k, l, big }) => (
        <div key={k}>
          <FormLabel tokens={t}>{l}</FormLabel>
          {big ? (
            <textarea value={fields[k] || ""} onChange={e => setFields({ ...fields, [k]: e.target.value })}
              style={{ ...inputStyle(t), minHeight: 80, resize: "vertical" }} />
          ) : (
            <input value={fields[k] || ""} onChange={e => setFields({ ...fields, [k]: e.target.value })}
              style={inputStyle(t)} />
          )}
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, tokens: t }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: t.textMute, marginBottom: 2, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: t.text }}>{value}</div>
    </div>
  );
}

function FormLabel({ tokens: t, children }) {
  return (
    <div style={{ fontSize: 11, color: t.textMute, marginBottom: 4, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

function inputStyle(t) {
  return {
    width: "100%", padding: "9px 12px",
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8,
    color: t.text, fontSize: 13, fontFamily: "inherit",
  };
}
function selectStyle(t) { return { ...inputStyle(t), cursor: "pointer" }; }
function btnPrimary(t) {
  return {
    padding: "10px 16px", background: t.accent, color: "#000", border: "none",
    borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flex: 1,
  };
}
function btnSecondary(t) {
  return {
    padding: "10px 16px", background: "transparent", color: t.text,
    border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  };
}
