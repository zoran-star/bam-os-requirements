import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import BacklogV2View from "../src/views/BacklogV2View";
import { store } from "./fake-supabase";

// Local clickable mockup of the staff Backlog page. Mounts the REAL component
// (vite.mock.config.js aliases lib/supabase to the fake one), so the layout,
// CSS and interactions are exactly what ships.

// Stub the mutation endpoint so the action buttons do something visible: a
// triage really removes the row from the lane, a status change really moves it
// between tabs. Nothing leaves the browser.
const realFetch = window.fetch;
window.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.startsWith("/api/v2-tickets")) return realFetch(url, opts);
  const action = new URLSearchParams(u.split("?")[1]).get("action");
  const id = new URLSearchParams(u.split("?")[1]).get("id");
  const body = JSON.parse(opts?.body || "{}");
  const t = store.tickets.find((x) => x.id === id);
  if (t) {
    if (action === "reassign") {
      if (body.assignee_role) t.assignee_role = body.assignee_role;
      if (body.type) t.type = body.type;
      if ("assigned_to" in body) t.assigned_to = body.assigned_to;
    }
    if (action === "status") t.status = body.status;
    t.updated_at = new Date().toISOString();
  }
  await new Promise((r) => setTimeout(r, 240)); // feel the latency
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

function Harness() {
  const [dark, setDark] = useState(true);
  return (
    <div style={{ minHeight: "100vh", background: dark ? "#131416" : "#F8F7F5" }}>
      <div style={{
        // Bottom left, so it cannot sit over the drawer's close button.
        position: "fixed", bottom: 16, left: 16, zIndex: 100, display: "flex", gap: 8,
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 12,
      }}>
        <button
          type="button"
          onClick={() => setDark((v) => !v)}
          style={{
            padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 600,
            border: `1px solid ${dark ? "#3A3D42" : "rgba(0,0,0,.14)"}`,
            background: "transparent", color: dark ? "#EDEAE3" : "#1A1815",
          }}
        >
          {dark ? "Light mode" : "Dark mode"}
        </button>
      </div>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 20px 60px" }}>
        <BacklogV2View dark={dark} session={{ access_token: "mock" }} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><Harness /></StrictMode>);
