import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import V2Page, { V2EmptyState } from "../components/v2rail/V2Page";
import TicketPicker, { PickerRow } from "./websitev2/TicketPicker";
import WebsiteSandbox from "./websitev2/WebsiteSandbox";
import { ticketAnnotations } from "./websitev2/utils";
import "./websitev2/websitev2.css";

// Staff Website Sandbox (locked mockup 3: search on top, sandbox below).
// Systems-lane website_change tickets from the V2 client annotator render on
// the client's LIVE page; type='fix' rows ride along in the picker (chip only,
// they are worked on the Systems page). Reads run through supabase-js (staff
// RLS = all) with a realtime subscription, mutations go through
// /api/v2-tickets (see websitev2/utils.ticketApi) - same data patterns as
// ContentV2View.

const SYSTEMS_ROLE = "systems";
const QUEUE_TYPES = ["website_change", "fix"];
const OPEN_STATUSES = ["new", "in_progress", "waiting_client"];

// Client-side search: academy name, page url, note text (+ section + title).
function matchesQuery(t, academy, q) {
  if (!q) return true;
  const hay = [
    academy || "",
    t.title || "",
    t.context?.page_url || "",
    ...ticketAnnotations(t).flatMap((a) => [a.note || "", a.section || ""]),
  ].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export default function WebsiteV2View({ tokens, dark, me, session }) {
  const [tickets, setTickets] = useState([]);
  const [clientsMap, setClientsMap] = useState({});
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const didInit = useRef(false);

  // ── Reads (supabase-js) ──
  async function loadQueue() {
    const { data, error: err } = await supabase
      .from("v2_tickets")
      .select("*")
      .eq("assignee_role", SYSTEMS_ROLE)
      .in("type", QUEUE_TYPES)
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
      .channel("websitev2-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "v2_tickets" }, () => loadQueue())
      .on("postgres_changes", { event: "*", schema: "public", table: "v2_ticket_messages" }, () => loadQueue())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const websiteTickets = useMemo(() => tickets.filter((t) => t.type === "website_change"), [tickets]);
  const openCount = useMemo(
    () => websiteTickets.filter((t) => OPEN_STATUSES.includes(t.status)).length,
    [websiteTickets],
  );

  // Auto-select the freshest open website_change so the sandbox is never
  // pointlessly empty; if the active ticket leaves the lane, pick the next.
  useEffect(() => {
    if (loading) return;
    if (activeId && websiteTickets.some((t) => t.id === activeId)) return;
    const next = websiteTickets.find((t) => OPEN_STATUSES.includes(t.status)) || websiteTickets[0] || null;
    setActiveId(next ? next.id : null);
  }, [websiteTickets, activeId, loading]);

  const activeTicket = websiteTickets.find((t) => t.id === activeId) || null;

  // Search results: both types (fix rows show the chip), capped at 8.
  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return tickets.filter((t) => matchesQuery(t, clientsMap[t.client_id], q)).slice(0, 8);
  }, [tickets, clientsMap, query]);

  const selectTicket = (t) => {
    setActiveId(t.id);
    setQuery("");
  };

  return (
    <V2Page
      dark={dark}
      title="Website V2"
      sub="Website change asks from V2 academies, reviewed on the client's live page."
    >
      {loading ? (
        <div className="w2-loading">Loading website tickets...</div>
      ) : error ? (
        <div className="w2-error">
          Could not load the queue. {error}
          <div><button type="button" className="w2-retry" onClick={() => { setLoading(true); loadQueue(); }}>Retry</button></div>
        </div>
      ) : (
        <>
          {/* ── Top bar: search + "N open" pill (opens the picker) ── */}
          <div className="w2-topbar">
            <div className="w2-search">
              <span className="w2-search-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              </span>
              <input
                type="text"
                className="w2-search-input"
                placeholder="Search by academy, page or note..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
              />
              {query && (
                <button type="button" className="w2-search-clear" onClick={() => setQuery("")} aria-label="Clear search">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              )}
              {query.trim() && (
                <>
                  <div className="w2-results-backdrop" onClick={() => setQuery("")} />
                  <div className="w2-results">
                    {results.length === 0 ? (
                      <div className="w2-results-empty">No tickets match "{query.trim()}".</div>
                    ) : (
                      results.map((t) => (
                        <PickerRow
                          key={t.id}
                          ticket={t}
                          academy={clientsMap[t.client_id] || "Academy"}
                          active={t.id === activeId}
                          onSelect={selectTicket}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
            <button type="button" className="w2-openpill" onClick={() => setPickerOpen(true)}>
              <span className="w2-openpill-n">{openCount}</span> open
            </button>
          </div>

          {/* ── The sandbox ── */}
          {activeTicket ? (
            <WebsiteSandbox
              key={activeTicket.id}
              ticket={activeTicket}
              academyName={clientsMap[activeTicket.client_id] || "Academy"}
              staffList={staffList}
              session={session}
              dark={dark}
              onMutated={loadQueue}
            />
          ) : (
            <section className="v2r-queue-card">
              <V2EmptyState message={
                websiteTickets.length === 0
                  ? "No website change asks yet. Notes from the client page annotator land here."
                  : "Pick a ticket to open it in the sandbox."
              } />
            </section>
          )}
        </>
      )}

      {/* ── Ticket picker (the "N open" pill) ── */}
      <TicketPicker
        open={pickerOpen}
        tickets={tickets}
        clientsMap={clientsMap}
        activeId={activeId}
        onSelect={selectTicket}
        onClose={() => setPickerOpen(false)}
      />
    </V2Page>
  );
}
