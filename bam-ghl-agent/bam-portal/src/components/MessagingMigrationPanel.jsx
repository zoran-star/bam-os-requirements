import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

// Admin tool: run the GHL -> own-store conversation history import for one academy
// (messaging spine increment 2). Runs INSIDE the deployment with the staff session,
// so it uses prod's live creds. Read-only on GHL; idempotent (safe to re-run).
//
// The import is CHUNKED: each request processes a few pages within a wall-clock budget
// and returns a cursor; this panel loops the cursor until done, so a large history can
// never time out the function (which used to return an HTML error -> "not valid JSON").
// Live progress is shown in a status bar that updates after every chunk.
export default function MessagingMigrationPanel({ session, tokens }) {
  const t = tokens || {};
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("39875f07-0a4b-4429-a201-2249bc1f24df"); // BAM GTA
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);     // live running totals while importing
  const [result, setResult] = useState(null); // final summary
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
    const totals = { conversations: 0, messages: 0, skipped: 0, pages: 0, chunks: 0 };
    setProg({ ...totals });
    let cursor = null;
    try {
      for (let i = 0; i < 1000; i++) { // safety cap on chunks
        const r = await fetch("/api/messaging/import-ghl-history", {
          method: "POST",
          headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, ...(cursor || {}) }),
        });
        // Read as text first so a non-JSON error (e.g. a gateway timeout HTML page)
        // surfaces a clear message instead of a raw "Unexpected token" parse error.
        const text = await r.text();
        let j;
        try { j = JSON.parse(text); }
        catch { throw new Error("Server returned a non-JSON response (likely a timeout). Progress was saved - click again to resume."); }
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);

        totals.conversations += j.conversations_scanned || 0;
        totals.messages += j.messages_imported || 0;
        totals.skipped += j.messages_skipped || 0;
        totals.pages += j.pages || 0;
        totals.chunks += 1;
        setProg({ ...totals });

        if (j.done) { setResult({ business_name: j.business_name || (current && current.business_name), ...totals }); break; }
        cursor = j.cursor;
        if (!cursor) { setResult({ business_name: j.business_name || (current && current.business_name), ...totals }); break; }
      }
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
      {/* keyframes for the indeterminate progress stripe */}
      <style>{"@keyframes mmIndeterminate{0%{left:-40%}100%{left:100%}}"}</style>

      <div style={sectionTitle}>Messaging migration (Twilio)</div>
      <div style={{ fontSize: 13, color: t.textMute, marginBottom: 12 }}>
        Save an academy's full GoHighLevel conversation history into the portal's own message store, before it moves to its own Twilio. Read-only on GHL and safe to run again any time.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <select style={sel} value={clientId} onChange={(e) => { setClientId(e.target.value); setResult(null); setError(null); setProg(null); }} disabled={busy}>
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

      {/* LIVE status bar — visible while importing */}
      {busy && prog && (
        <div style={{ marginTop: 12 }}>
          <div style={{ position: "relative", height: 6, borderRadius: 3, overflow: "hidden", background: t.border || "rgba(255,255,255,0.08)" }}>
            <div style={{ position: "absolute", top: 0, bottom: 0, width: "40%", borderRadius: 3, background: t.accent || "#E8C547", animation: "mmIndeterminate 1.1s ease-in-out infinite" }} />
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: t.text, fontVariantNumeric: "tabular-nums" }}>
            Scanned <b>{prog.conversations.toLocaleString()}</b> conversations · imported <b>{prog.messages.toLocaleString()}</b> messages
            {prog.skipped ? <> · <span style={{ color: t.textMute }}>{prog.skipped.toLocaleString()} already saved</span></> : null}
            <span style={{ color: t.textMute }}> · batch {prog.chunks}</span>
          </div>
        </div>
      )}

      {result && !busy && (
        <div style={{ marginTop: 12, fontSize: 13, color: t.text, background: t.surface || "rgba(255,255,255,0.03)", border: `1px solid ${t.border || "#333"}`, borderRadius: 8, padding: "10px 12px" }}>
          ✓ Imported for <b>{result.business_name}</b>: <b>{(result.conversations || 0).toLocaleString()}</b> conversations,
          {" "}<b>{(result.messages || 0).toLocaleString()}</b> messages saved
          {result.skipped ? <> (<b>{result.skipped.toLocaleString()}</b> already saved)</> : null}.
        </div>
      )}
      {error && !busy && (
        <div style={{ marginTop: 12, fontSize: 13, color: t.red || "#e0654f" }}>Couldn't import: {error}</div>
      )}
    </div>
  );
}
