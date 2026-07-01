import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

// Custom Fields — staff-side manager for portal-native contact fields per
// academy. Backed by /api/custom-fields (custom_field_defs). Pick an academy,
// then add / edit / delete the fields shown on its contacts. Dormant elsewhere:
// nothing renders these values yet (that lands with the contact-drawer work).

const TYPES = [
  { v: "text", label: "Text" },
  { v: "number", label: "Number" },
  { v: "date", label: "Date" },
  { v: "select", label: "Dropdown (single)" },
  { v: "multiselect", label: "Dropdown (multi)" },
  { v: "boolean", label: "Yes / No" },
  { v: "phone", label: "Phone" },
  { v: "email", label: "Email" },
  { v: "url", label: "URL" },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map(t => [t.v, t.label]));
const hasOptions = (type) => type === "select" || type === "multiselect";

export default function CustomFieldsView({ tokens, session }) {
  const t = tokens;
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null); // field obj, or {} for new, or null
  const [importing, setImporting] = useState(false);

  const authHeaders = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token || ""}`,
  }), [session]);

  // Academies to pick from.
  useEffect(() => {
    supabase.from("clients")
      .select("id,business_name,status")
      .order("business_name")
      .then(({ data }) => setClients((data || []).filter(c => c.status !== "archived")));
  }, []);

  const loadFields = useCallback(async (cid) => {
    if (!cid) { setFields([]); return; }
    setLoading(true); setErr("");
    try {
      const res = await fetch(`/api/custom-fields?client_id=${cid}`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "failed to load");
      setFields(json.fields || []);
    } catch (e) { setErr(e.message); setFields([]); }
    finally { setLoading(false); }
  }, [authHeaders]);

  useEffect(() => { loadFields(clientId); }, [clientId, loadFields]);

  async function saveField(form) {
    setErr("");
    const isNew = !form.id;
    const body = isNew
      ? { client_id: clientId, label: form.label, type: form.type, options: form.options, required: form.required }
      : { id: form.id, label: form.label, type: form.type, options: form.options, required: form.required };
    const res = await fetch("/api/custom-fields", {
      method: isNew ? "POST" : "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) { setErr(json.error || "save failed"); return; }
    setFields(prev => isNew ? [...prev, json.field] : prev.map(f => f.id === json.field.id ? { ...f, ...json.field } : f));
    setEditing(null);
  }

  async function deleteField(id) {
    if (!confirm("Delete this field? Any saved values are removed.")) return;
    const res = await fetch(`/api/custom-fields?id=${id}`, { method: "DELETE", headers: authHeaders() });
    if (res.ok) setFields(prev => prev.filter(f => f.id !== id));
    else { const j = await res.json().catch(() => ({})); setErr(j.error || "delete failed"); }
  }

  // ── styles ────────────────────────────────────────────────────────────────
  const card = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 };
  const input = {
    width: "100%", padding: "10px 12px", background: t.bg, border: `1px solid ${t.border}`,
    borderRadius: 6, color: t.text, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
  };
  const btn = (primary) => ({
    padding: "9px 16px", border: primary ? 0 : `1px solid ${t.borderMed}`,
    background: primary ? t.accent : "transparent", color: primary ? "#0A0A0B" : t.text,
    borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
  });
  const pill = (bg, fg) => ({
    display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11,
    fontWeight: 600, background: bg, color: fg,
  });

  return (
    <div style={{ maxWidth: 780 }}>
      {/* Academy picker + add */}
      <div style={{ ...card, display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: t.textSub, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Academy</div>
          <select value={clientId} onChange={e => setClientId(e.target.value)} style={{ ...input, cursor: "pointer" }}>
            <option value="">- select an academy -</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}
          </select>
        </div>
        <button
          style={{ ...btn(false), alignSelf: "flex-end", opacity: clientId ? 1 : 0.4, pointerEvents: clientId ? "auto" : "none" }}
          onClick={() => setImporting(true)}
        >Import from GHL</button>
        <button
          style={{ ...btn(true), alignSelf: "flex-end", opacity: clientId ? 1 : 0.4, pointerEvents: clientId ? "auto" : "none" }}
          onClick={() => setEditing({ label: "", type: "text", options: [], required: false })}
        >+ Add field</button>
      </div>

      {err && <div style={{ ...card, borderColor: t.red, color: t.red, marginBottom: 16, padding: 12 }}>{err}</div>}

      {/* List */}
      {!clientId ? (
        <div style={{ ...card, textAlign: "center", color: t.textSub }}>Pick an academy to manage its custom fields.</div>
      ) : loading ? (
        <div style={{ ...card, textAlign: "center", color: t.textSub }}>Loading…</div>
      ) : fields.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: t.textSub }}>
          No custom fields yet. Click <b style={{ color: t.text }}>+ Add field</b> to create the first one.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {fields.map(f => (
            <div key={f.id} style={{ ...card, padding: 14, display: "flex", alignItems: "center", gap: 12, opacity: f.archived ? 0.5 : 1 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{f.label}</span>
                  <span style={pill(t.accentGhost, t.accent)}>{TYPE_LABEL[f.type] || f.type}</span>
                  {f.required && <span style={pill(t.amberSoft, t.amber)}>Required</span>}
                  {f.archived && <span style={pill(t.border, t.textSub)}>Archived</span>}
                </div>
                <div style={{ fontSize: 12, color: t.textSub, marginTop: 3, fontFamily: "ui-monospace, monospace" }}>
                  {f.key} · {f.value_count || 0} value{f.value_count === 1 ? "" : "s"}
                  {hasOptions(f.type) && f.options?.length ? ` · ${f.options.length} options` : ""}
                </div>
              </div>
              <button style={btn(false)} onClick={() => setEditing({ ...f, options: f.options || [] })}>Edit</button>
              <button style={{ ...btn(false), borderColor: t.redSoft, color: t.red }} onClick={() => deleteField(f.id)}>Delete</button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <FieldEditor field={editing} tokens={t} onCancel={() => setEditing(null)} onSave={saveField} input={input} btn={btn} card={card} />
      )}

      {importing && (
        <ImportModal
          tokens={t} btn={btn} authHeaders={authHeaders} clientId={clientId}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); loadFields(clientId); }}
        />
      )}
    </div>
  );
}

function ImportModal({ tokens, btn, authHeaders, clientId, onClose, onDone }) {
  const t = tokens;
  const [rows, setRows] = useState(null); // null = loading
  const [sel, setSel] = useState({});     // ghl_field_id -> true
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/custom-fields?action=ghl-fields&client_id=${clientId}`, { headers: authHeaders() });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "failed to load GHL fields");
        setRows(json.fields || []);
      } catch (e) { setErr(e.message); setRows([]); }
    })();
  }, [clientId, authHeaders]);

  const available = (rows || []).filter(r => !r.imported);
  const selectedCount = available.filter(r => sel[r.ghl_field_id]).length;
  const allSelected = available.length > 0 && selectedCount === available.length;

  const doImport = async () => {
    const fields = available.filter(r => sel[r.ghl_field_id]);
    if (!fields.length) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/custom-fields", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ action: "import-ghl", client_id: clientId, fields }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "import failed");
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div onClick={() => !busy && onClose()} style={{
      position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 520, maxHeight: "80vh", display: "flex", flexDirection: "column",
        background: t.surface, border: `1px solid ${t.borderMed}`, borderRadius: 14, padding: 24,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginBottom: 4 }}>Import from GHL</div>
        <div style={{ fontSize: 12, color: t.textSub, marginBottom: 16 }}>Adopt this academy's existing GoHighLevel custom fields.</div>

        {err && <div style={{ color: t.red, fontSize: 13, marginBottom: 12 }}>{err}</div>}

        {rows === null ? (
          <div style={{ color: t.textSub, fontSize: 13 }}>Loading GHL fields…</div>
        ) : rows.length === 0 ? (
          <div style={{ color: t.textSub, fontSize: 13 }}>No custom fields found in GHL for this academy.</div>
        ) : (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: t.textSub, marginBottom: 8, cursor: available.length ? "pointer" : "default" }}>
              <input type="checkbox" disabled={!available.length} checked={allSelected}
                onChange={e => { const v = e.target.checked; const next = {}; if (v) available.forEach(r => { next[r.ghl_field_id] = true; }); setSel(next); }} />
              Select all ({available.length} not yet imported)
            </label>
            <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
              {rows.map(r => (
                <label key={r.ghl_field_id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 6,
                  background: t.bg, opacity: r.imported ? 0.5 : 1, cursor: r.imported ? "default" : "pointer",
                }}>
                  <input type="checkbox" disabled={r.imported} checked={r.imported || !!sel[r.ghl_field_id]}
                    onChange={e => setSel(s => ({ ...s, [r.ghl_field_id]: e.target.checked }))} />
                  <span style={{ flex: 1, fontSize: 13, color: t.text }}>{r.name}</span>
                  <span style={{ fontSize: 11, color: t.textSub }}>{r.type}{r.options?.length ? ` · ${r.options.length} opts` : ""}</span>
                  {r.imported && <span style={{ fontSize: 11, color: t.green }}>imported</span>}
                </label>
              ))}
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={btn(false)} onClick={onClose} disabled={busy}>Cancel</button>
          <button style={{ ...btn(true), opacity: selectedCount && !busy ? 1 : 0.5 }} onClick={doImport} disabled={!selectedCount || busy}>
            {busy ? "Importing…" : `Import ${selectedCount || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldEditor({ field, tokens, onCancel, onSave, input, btn }) {
  const t = tokens;
  const [label, setLabel] = useState(field.label || "");
  const [type, setType] = useState(field.type || "text");
  const [optionsText, setOptionsText] = useState((field.options || []).join("\n"));
  const [required, setRequired] = useState(!!field.required);
  const [busy, setBusy] = useState(false);
  const isNew = !field.id;

  const submit = async () => {
    if (!label.trim()) return;
    setBusy(true);
    await onSave({
      id: field.id,
      label: label.trim(),
      type,
      options: hasOptions(type) ? optionsText.split("\n").map(s => s.trim()).filter(Boolean) : [],
      required,
    });
    setBusy(false);
  };

  return (
    <div onClick={() => !busy && onCancel()} style={{
      position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 440, background: t.surface, border: `1px solid ${t.borderMed}`, borderRadius: 14, padding: 24,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginBottom: 16 }}>{isNew ? "New field" : "Edit field"}</div>

        <label style={{ fontSize: 12, color: t.textSub }}>Label</label>
        <input autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Athlete Grade"
          style={{ ...input, margin: "6px 0 14px" }} />

        <label style={{ fontSize: 12, color: t.textSub }}>Type</label>
        <select value={type} onChange={e => setType(e.target.value)} style={{ ...input, margin: "6px 0 14px", cursor: "pointer" }}>
          {TYPES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>

        {hasOptions(type) && (
          <>
            <label style={{ fontSize: 12, color: t.textSub }}>Options (one per line)</label>
            <textarea value={optionsText} onChange={e => setOptionsText(e.target.value)} rows={4}
              placeholder={"Grade 5\nGrade 6\nGrade 7"} style={{ ...input, margin: "6px 0 14px", resize: "vertical" }} />
          </>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: t.text, marginBottom: 20, cursor: "pointer" }}>
          <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} />
          Required
        </label>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={btn(false)} onClick={onCancel} disabled={busy}>Cancel</button>
          <button style={{ ...btn(true), opacity: label.trim() && !busy ? 1 : 0.5 }} onClick={submit} disabled={!label.trim() || busy}>
            {busy ? "Saving…" : isNew ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
