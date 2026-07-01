// KPI event log writer (Track A of KPIs-off-GHL). One row per funnel moment:
//   lead | trial_booked | trial_attended | trial_no_show | joined | cancelled
// Best-effort by design: a KPI-logging hiccup must NEVER break the live flow
// that triggered it (lead capture, a card move, a payment), so this swallows
// its own errors. Idempotent on (client_id, step, ref) - re-fires are ignored.
// The KPI sandbox later imports approved historical rows into the same table
// with source='ghl-import'.

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

export const KPI_STEPS = ["lead", "trial_booked", "trial_attended", "trial_no_show", "joined", "cancelled"];

export async function recordKpiEvent({ clientId, step, offerId, ghlContactId, contactName, occurredAt, ref, meta, source } = {}) {
  try {
    if (!SB_URL || !SB_KEY || !clientId || !KPI_STEPS.includes(step)) return;
    const row = {
      client_id: clientId,
      step,
      ...(offerId ? { offer_id: offerId } : {}),
      ...(ghlContactId ? { ghl_contact_id: String(ghlContactId) } : {}),
      ...(contactName ? { contact_name: String(contactName).slice(0, 200) } : {}),
      ...(occurredAt ? { occurred_at: occurredAt } : {}),
      ...(ref ? { ref: String(ref) } : {}),
      ...(meta && typeof meta === "object" ? { meta } : {}),
      ...(source ? { source } : {}),
    };
    const res = await fetch(`${SB_URL}/rest/v1/kpi_events?on_conflict=client_id,step,ref`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify([row]),
    });
    if (!res.ok) console.error("[recordKpiEvent] non-fatal:", res.status, (await res.text()).slice(0, 200));
  } catch (e) {
    console.error("[recordKpiEvent] non-fatal:", e?.message || e);
  }
}
