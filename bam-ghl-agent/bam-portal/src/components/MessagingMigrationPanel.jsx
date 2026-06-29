import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

// Admin tool: run the GHL -> own-store conversation history import for one academy
// (messaging spine increment 2). Runs INSIDE the deployment with the staff session,
// so it uses prod's live creds. Read-only on GHL; idempotent (safe to re-run).
export default function MessagingMigrationPanel({ session, tokens }) {
  const t = tokens || {};
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("39875f07-0a4b-4429-a201-2249bc1f24df"); // BAM GTA
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.from("clients").select("id,business_name,messaging_provider").order("business_name")
      .then(({ data }) => { if (data) setClients(data); })
      .catch(() => {});
  }, []);

  const current = clients.find((c) => c.id === clientId);

  const runImport = async () => {
    if (busy) return;
    setBusy(true); setResult(null); setError(null);
    try {
      const r = await fetch("/api/messaging/import-ghl-history", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setResult(j);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const sectionTitle = { fontSize: 15, fontWeight: 700, color: t.text, marginBottom: 4, letterSpacing: "-0.01em" };
  const sel = { padding: "8px 10px", background: t.surface || "transparent", color: t.text, border: `1px solid ${t.border || "#333"}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", maxWidth: 320 };

  return (
    <div>
      <div style={sectionTitle}>Messaging migration (Twilio)</div>
      <div style={{ fontSize: 13, color: t.textMute, marginBottom: 12 }}>
        Save an academy's full GoHighLevel conversation history into the portal's own message store, before it moves to its own Twilio. Read-only on GHL and safe to run again any time.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <select style={sel} value={clientId} onChange={(e) => { setClientId(e.target.value); setResult(null); setError(null); }} disabled={busy}>
          {clients.length === 0 && <option value={clientId}>BAM GTA</option>}
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.business_name}{c.messaging_provider === "twilio" ? "  (twilio)" : ""}</option>
          ))}
        </select>
        <button
          onClick={runImport}
          disabled={busy}
          style={{ padding: "8px 16px", background: busy ? (t.border || "#444") : (t.accent || "#E8C547"), color: "#0A0A0B", border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }}
        >{busy ? "Importing…" : "Import GHL history"}</button>
        {current && (
          <span style={{ fontSize: 12, color: t.textMute }}>
            now on: <b style={{ color: t.text }}>{current.messaging_provider || "ghl"}</b>
          </span>
        )}
      </div>

      {result && (
        <div style={{ marginTop: 12, fontSize: 13, color: t.text, background: t.surface || "rgba(255,255,255,0.03)", border: `1px solid ${t.border || "#333"}`, borderRadius: 8, padding: "10px 12px" }}>
          ✓ Imported for <b>{result.business_name}</b>: <b>{result.conversations_scanned}</b> conversations,
          {" "}<b>{result.messages_imported}</b> messages saved
          {result.messages_skipped ? <> (<b>{result.messages_skipped}</b> already saved)</> : null}.
        </div>
      )}
      {error && (
        <div style={{ marginTop: 12, fontSize: 13, color: t.red || "#e0654f" }}>Couldn't import: {error}</div>
      )}
    </div>
  );
}
