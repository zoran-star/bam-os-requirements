import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

// Stripe Link-Up - staff-side cleanup that ties every Stripe customer on an
// academy's connected account to a portal contact (the GHL contact import).
// Backed by /api/contacts/stripe-link. Locked decisions (2026-07-08):
// exact-email matches auto-link silently; everything else lands in a review
// queue (Link / Skip per row); customers with no contact get one created
// (source='stripe-import'); duplicate contacts -> the existing merge tool.

export default function StripeContactLinkView({ tokens, session }) {
  const t = tokens;
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState("");
  const [busyRow, setBusyRow] = useState(null);

  const authHeaders = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token || ""}`,
  }), [session]);

  useEffect(() => {
    supabase.from("clients")
      .select("id,business_name,status,stripe_connect_status")
      .order("business_name")
      .then(({ data }) => setClients((data || []).filter(c => c.status !== "archived")));
  }, []);

  const api = useCallback(async (action, payload) => {
    const res = await fetch("/api/contacts/stripe-link", {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ action, client_id: clientId, ...(payload || {}) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }, [authHeaders, clientId]);

  const loadReviews = useCallback(async () => {
    if (!clientId) { setReviews([]); return; }
    setLoading(true); setErr("");
    try {
      const json = await api("list");
      setReviews(json.reviews || []);
    } catch (e) { setErr(e.message); setReviews([]); }
    finally { setLoading(false); }
  }, [clientId, api]);

  useEffect(() => { setSummary(null); loadReviews(); }, [clientId, loadReviews]);

  async function runSweep() {
    setSweeping(true); setErr("");
    const total = { scanned: 0, already_linked: 0, auto_linked: 0, orphans_created: 0, review_added: 0 };
    try {
      let cursor = null;
      // Each call pages 500 customers; loop until Stripe says done.
      for (let i = 0; i < 40; i++) {
        const json = await api("sweep", cursor ? { cursor } : {});
        for (const k of Object.keys(total)) total[k] += json[k] || 0;
        setSummary({ ...total, running: json.has_more });
        if (!json.has_more) break;
        cursor = json.next_cursor;
      }
      setSummary({ ...total, running: false });
      await loadReviews();
    } catch (e) { setErr(e.message); setSummary(s => s ? { ...s, running: false } : null); }
    finally { setSweeping(false); }
  }

  async function decide(review, action, contactKey) {
    setBusyRow(review.id); setErr("");
    try {
      await api(action, { review_id: review.id, contact_key: contactKey });
      setReviews(prev => prev.filter(r => r.id !== review.id));
    } catch (e) { setErr(e.message); }
    finally { setBusyRow(null); }
  }

  // ── styles ──────────────────────────────────────────────
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
  const tile = (label, value, accent) => (
    <div style={{ flex: 1, minWidth: 110, padding: "10px 14px", border: `1px solid ${accent ? t.accent : t.border}`, borderRadius: 10 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent ? t.accent : t.text }}>{value}</div>
      <div style={{ fontSize: 11, color: t.textSub, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
  const who = (r) => [r.name, r.email, r.phone].filter(Boolean).join(" · ") || "-";

  const selected = clients.find(c => c.id === clientId);
  const stripeReady = selected?.stripe_connect_status === "connected";

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ ...card, display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: t.textSub, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Academy</div>
          <select value={clientId} onChange={e => setClientId(e.target.value)} style={{ ...input, cursor: "pointer" }}>
            <option value="">- select an academy -</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.business_name}{c.stripe_connect_status !== "connected" ? " (Stripe not connected)" : ""}</option>)}
          </select>
        </div>
        <button
          style={{ ...btn(true), opacity: clientId && stripeReady && !sweeping ? 1 : 0.4, pointerEvents: clientId && stripeReady && !sweeping ? "auto" : "none" }}
          onClick={runSweep}
        >{sweeping ? "Sweeping…" : "Run sweep"}</button>
      </div>

      {err && <div style={{ ...card, borderColor: t.red, color: t.red, marginBottom: 16, padding: 12 }}>{err}</div>}

      {summary && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          {tile("Scanned", summary.scanned)}
          {tile("Auto-linked", summary.auto_linked, true)}
          {tile("Already linked", summary.already_linked)}
          {tile("Contacts created", summary.orphans_created)}
          {tile("Needs review", summary.review_added, summary.review_added > 0)}
          {summary.running && <div style={{ alignSelf: "center", fontSize: 12, color: t.textSub }}>still sweeping…</div>}
        </div>
      )}

      {!clientId ? (
        <div style={{ ...card, textAlign: "center", color: t.textSub }}>
          Pick an academy, then Run sweep. Exact email matches link silently; anything ambiguous shows below for a Link / Skip call.
        </div>
      ) : loading ? (
        <div style={{ ...card, textAlign: "center", color: t.textSub }}>Loading review queue…</div>
      ) : reviews.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: t.textSub }}>
          Review queue is clear. {summary ? "Nice - everything from the sweep is linked or decided." : "Run a sweep to check for unlinked Stripe customers."}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: t.textSub, margin: "0 0 10px 4px" }}>
            {reviews.length} to review - Link ties the Stripe customer to that contact; Skip leaves them unlinked (won't resurface).
            Same person twice? Merge the contacts from their contact card first, then Link.
          </div>
          {reviews.map(r => (
            <div key={r.id} style={{ ...card, marginBottom: 10, opacity: busyRow === r.id ? 0.5 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, color: t.textSub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Stripe customer</div>
                  <div style={{ fontWeight: 700 }}>{r.customer?.name || r.customer?.email || r.stripe_customer_id}</div>
                  <div style={{ fontSize: 12, color: t.textSub }}>
                    {[r.customer?.email, r.customer?.phone, r.customer?.created_iso ? `since ${r.customer.created_iso}` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <button style={{ ...btn(false), alignSelf: "flex-start" }} onClick={() => decide(r, "skip")}>Skip</button>
              </div>
              <div style={{ marginTop: 12 }}>
                {(r.candidates || []).length === 0 ? (
                  <div style={{ fontSize: 12.5, color: t.textSub }}>No contact match found (and no usable email/phone to create one). Skip, or create the contact by hand first.</div>
                ) : (r.candidates || []).map(cand => (
                  <div key={cand.ghl_contact_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 12px", border: `1px solid ${t.border}`, borderRadius: 8, marginBottom: 6 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who(cand)}</div>
                      <div style={{ fontSize: 11.5, color: t.textSub }}>{cand.athlete_name ? `athlete: ${cand.athlete_name} · ` : ""}{cand.reason}</div>
                    </div>
                    <button style={btn(true)} onClick={() => decide(r, "link", cand.ghl_contact_id)}>Link</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
