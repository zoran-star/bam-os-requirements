import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import MarketingDrawer from "../src/views/marketingv2/MarketingDrawer";
// MarketingV2View owns these imports in the real app; the mock mounts the
// drawer directly, so it has to pull them in itself.
import "../src/components/v2rail/v2rail.css";
import "../src/views/marketingv2/marketingv2.css";

// Clickable mockup of the Marketing V2 drawer, seeded with the REAL shape of
// BAM GTA ticket bf1bb1fa: mode 'campaign', zero finished creatives, four
// picked library assets. That combination is what produced the dead end where
// Download was disabled and "Launch, mark done" was not.

const TICKET = {
  id: "bf1bb1fa-219f-46c0-9209-eaf3fed5d5d1",
  client_id: "c2",
  type: "marketing_ask",
  status: "new",
  assignee_role: "marketing",
  assigned_to: null,
  title: "New campaign - Testimonial",
  created_at: "2026-07-22T14:00:00Z",
  updated_at: "2026-07-22T14:00:00Z",
  intake: {
    mode: "campaign",
    final_files: [],
    asset_ids: ["a1", "a2", "a3", "a4"],
    offer: "Free trial",
    sales_preset: "Free trial funnel",
    spend: 900,
    landing_page: "https://byanymeanstoronto.ca/free-trial",
    brief: "Testimonial angle, use the parent quotes from the reviews page.",
  },
  context: {},
};

window.fetch = async () => {
  await new Promise((r) => setTimeout(r, 240));
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

function Harness() {
  const [dark, setDark] = useState(true);
  const [open, setOpen] = useState(true);
  return (
    <div style={{ minHeight: "100vh", background: dark ? "#131416" : "#F8F7F5" }}>
      <div style={{ position: "fixed", bottom: 16, left: 16, zIndex: 200, display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => setDark((v) => !v)}
          style={{
            padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12,
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            border: `1px solid ${dark ? "#3A3D42" : "rgba(0,0,0,.14)"}`,
            background: "transparent", color: dark ? "#EDEAE3" : "#1A1815",
          }}
        >
          {dark ? "Light mode" : "Dark mode"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12,
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
            border: `1px solid ${dark ? "#3A3D42" : "rgba(0,0,0,.14)"}`,
            background: "transparent", color: dark ? "#EDEAE3" : "#1A1815",
          }}
        >
          Reopen drawer
        </button>
      </div>
      <MarketingDrawer
        ticket={open ? TICKET : null}
        clientName="BAM GTA"
        ownerName={null}
        owners={[]}
        dark={dark}
        onClose={() => setOpen(false)}
        onMutated={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><Harness /></StrictMode>);
