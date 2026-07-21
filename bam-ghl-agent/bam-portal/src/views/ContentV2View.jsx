import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import V2Page, { V2EmptyState } from "../components/v2rail/V2Page";
import QueueRow from "../components/v2rail/QueueRow";
import ContentTicketDrawer from "./contentv2/ContentTicketDrawer";
import { ageShort, modeLabel } from "./contentv2/utils";
import "./contentv2/contentv2.css";

// Staff queue for V2 content asks: the new / edit / replace creative tickets
// from the V2 rail (v2_tickets, assignee_role = content). Reads run through
// supabase-js (staff RLS = all) with a realtime subscription; every mutation
// goes through /api/v2-tickets (see ContentTicketDrawer).

const CONTENT_ROLE = "content";
const TABS = [
  { id: "new", label: "New", statuses: ["new"] },
  { id: "in_progress", label: "In progress", statuses: ["in_progress"] },
  { id: "waiting_client", label: "Needs client", statuses: ["waiting_client"] },
  { id: "done", label: "Done", statuses: ["resolved", "closed"] },
];
const OPEN_STATUSES = ["new", "in_progress", "waiting_client"];

// Build the queue-row sub-line from the intake (mode + angle, best effort).
function subLine(t) {
  const intake = t.intake || {};
  const parts = [];
  const ml = modeLabel(intake.mode || (intake.replacing ? "edit" : ""));
  if (ml) parts.push(ml);
  if (intake.angle) parts.push(String(intake.angle));
  else if (intake.offer ?? intake.offer_id) parts.push(String(intake.offer ?? intake.offer_id));
  return parts.join(" · ") || null;
}

export default function ContentV2View({ tokens, dark, me, session }) {
  const [tickets, setTickets] = useState([]);
  const [clientsMap, setClientsMap] = useState({});
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("new");
  const [openId, setOpenId] = useState(null);
  const didInit = useRef(false);

  const staffMap = useMemo(() => {
    const m = {};
    for (const s of staffList) m[s.id] = s.name;
    return m;
  }, [staffList]);

  // ── Reads (supabase-js) ──
  async function loadQueue() {
    const { data, error: err } = await supabase
      .from("v2_tickets")
      .select("*")
      .eq("assignee_role", CONTENT_ROLE)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (err) { setError(err.message); setLoading(false); return; }
    setError("");
    setTickets(data || []);
    setLoading(false);
  }

  // Lookup maps (academy names + staff owners) - loaded once, cheap.
  async function loadMaps() {
    const [{ data: clients }, { data: staff }] = await Promise.all([
      supabase.from("clients").select("id,business_name").order("business_name"),
      supabase.from("staff").select("id,name,role").order("name"),
    ]);
    const cm = {};
    for (const c of clients || []) cm[c.id] = c.business_name;
    setClientsMap(cm);
    setStaffList(staff || []);
  }

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    loadMaps();
    loadQueue();
    // Realtime: any ticket change refreshes the queue; message inserts touch
    // updated_at so ordering + counts stay live too.
    const ch = supabase
      .channel("contentv2-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "v2_tickets" }, () => loadQueue())
      .on("postgres_changes", { event: "*", schema: "public", table: "v2_ticket_messages" }, () => loadQueue())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Close the drawer if the open ticket left the content lane (e.g. reassigned).
  useEffect(() => {
    if (openId && !loading && !tickets.some((t) => t.id === openId)) setOpenId(null);
  }, [tickets, openId, loading]);

  const counts = useMemo(() => {
    const c = {};
    for (const tab of TABS) c[tab.id] = 0;
    for (const t of tickets) {
      for (const tab of TABS) if (tab.statuses.includes(t.status)) c[tab.id]++;
    }
    return c;
  }, [tickets]);

  const openCount = useMemo(
    () => tickets.filter((t) => OPEN_STATUSES.includes(t.status)).length,
    [tickets],
  );

  const activeStatuses = TABS.find((t) => t.id === activeTab)?.statuses || [];
  const visible = tickets.filter((t) => activeStatuses.includes(t.status));
  const openTicket = tickets.find((t) => t.id === openId) || null;

  return (
    <V2Page
      dark={dark}
      title="Content V2"
      sub="Creative asks from V2 academies. New, edit and replace, all ads."
    >
      <section className="v2r-queue-card">
        <div className="v2r-queue-head">
          <div className="c2-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`c2-tab${activeTab === tab.id ? " is-active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                {counts[tab.id] > 0 && <span className="c2-tab-count">{counts[tab.id]}</span>}
              </button>
            ))}
          </div>
          <span className="v2r-queue-count">{openCount} open</span>
        </div>

        {loading ? (
          <div className="c2-loading">Loading content asks...</div>
        ) : error ? (
          <div className="c2-error">
            Could not load the queue. {error}
            <div><button type="button" className="c2-retry" onClick={() => { setLoading(true); loadQueue(); }}>Retry</button></div>
          </div>
        ) : visible.length === 0 ? (
          <V2EmptyState message={
            activeTab === "new"
              ? "No new content asks. Requests from the V2 rail land here."
              : `Nothing in ${TABS.find((t) => t.id === activeTab)?.label.toLowerCase()}.`
          } />
        ) : (
          visible.map((t) => (
            <QueueRow
              key={t.id}
              dark={dark}
              academy={clientsMap[t.client_id] || "Academy"}
              title={t.title || "Content ask"}
              sub={subLine(t)}
              status={t.status}
              owner={t.assigned_to ? (staffMap[t.assigned_to] || "Assigned") : null}
              age={ageShort(t.updated_at || t.created_at)}
              onClick={() => setOpenId(t.id)}
            />
          ))
        )}
      </section>

      <ContentTicketDrawer
        open={!!openTicket}
        ticket={openTicket}
        dark={dark}
        session={session}
        staffList={staffList}
        academyName={openTicket ? (clientsMap[openTicket.client_id] || "Academy") : ""}
        onClose={() => setOpenId(null)}
        onMutated={loadQueue}
      />
    </V2Page>
  );
}
