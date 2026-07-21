import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import V2Page, { V2EmptyState } from "../components/v2rail/V2Page";
import QueueRow from "../components/v2rail/QueueRow";
import MarketingDrawer from "./marketingv2/MarketingDrawer";
import {
  MODES, resolveMode, campaignLabel, shortAge, isOpen, MARKETING_OWNER_ROLES,
} from "./marketingv2/intake";
import "./marketingv2/marketingv2.css";

// Staff queue for V2 marketing asks: the post / budget / remove / new-campaign
// tickets from the V2 rail (v2_tickets, assignee_role = marketing). Every one is
// a single row of type marketing_ask; the sub-kind lives in intake.mode, which
// the queue lets staff filter on. Reads run through supabase-js (staff RLS = all)
// with a realtime subscription; every mutation goes through /api/v2-tickets (see
// MarketingDrawer + marketingv2/api.js).

const MARKETING_ROLE = "marketing";

// Status segment: the open work vs everything already handled.
const SEGMENTS = [
  { id: "open", label: "Open", statuses: ["new", "in_progress", "waiting_client"] },
  { id: "done", label: "Done", statuses: ["resolved", "closed"] },
];

// Mode filter pills. "all" first, then the four handled sub-kinds. "generic"
// tickets fold under "all" only (no pill of their own - rare fallback).
const MODE_PILLS = [
  { id: "all", label: "All" },
  { id: "post", label: "Post" },
  { id: "budget", label: "Budget" },
  { id: "remove", label: "Remove" },
  { id: "campaign", label: "New campaign" },
];

// Queue-row sub-line: mode label + campaign name (best effort).
function subLine(t) {
  const mode = resolveMode(t);
  const label = MODES[mode]?.label || "";
  const campaign = campaignLabel(t);
  return [label, campaign].filter(Boolean).join(" · ") || null;
}

export default function MarketingV2View({ tokens, dark, me, session }) {
  const [tickets, setTickets] = useState([]);
  const [clientsMap, setClientsMap] = useState({});
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [segment, setSegment] = useState("open");
  const [modeFilter, setModeFilter] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [msgBump, setMsgBump] = useState(0);
  const didInit = useRef(false);

  const staffMap = useMemo(() => {
    const m = {};
    for (const s of staffList) m[s.id] = s.name;
    return m;
  }, [staffList]);

  // Reassign target pool: staff whose role can own a marketing ticket.
  const owners = useMemo(
    () => staffList.filter((s) => MARKETING_OWNER_ROLES.includes(s.role)),
    [staffList],
  );

  // ── Reads (supabase-js) ──
  async function loadQueue() {
    const { data, error: err } = await supabase
      .from("v2_tickets")
      .select("*")
      .eq("assignee_role", MARKETING_ROLE)
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
    // Realtime: any ticket change refreshes the queue; a message insert both
    // refreshes the queue (updated_at moved) and bumps the open drawer's thread.
    const ch = supabase
      .channel("marketingv2-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "v2_tickets" }, () => loadQueue())
      .on("postgres_changes", { event: "*", schema: "public", table: "v2_ticket_messages" }, () => {
        loadQueue();
        setMsgBump((b) => b + 1);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Close the drawer if the open ticket left the marketing lane (e.g. reassigned).
  useEffect(() => {
    if (openId && !loading && !tickets.some((t) => t.id === openId)) setOpenId(null);
  }, [tickets, openId, loading]);

  const openCount = useMemo(() => tickets.filter(isOpen).length, [tickets]);

  // Segment first (open/done), then the mode pills count within that subset.
  const segStatuses = SEGMENTS.find((s) => s.id === segment)?.statuses || [];
  const bySegment = useMemo(
    () => tickets.filter((t) => segStatuses.includes(t.status)),
    [tickets, segment],
  );

  const modeCounts = useMemo(() => {
    const c = { all: bySegment.length };
    for (const t of bySegment) {
      const m = resolveMode(t);
      c[m] = (c[m] || 0) + 1;
    }
    return c;
  }, [bySegment]);

  const visible = useMemo(
    () => (modeFilter === "all" ? bySegment : bySegment.filter((t) => resolveMode(t) === modeFilter)),
    [bySegment, modeFilter],
  );

  const openTicket = tickets.find((t) => t.id === openId) || null;

  return (
    <V2Page
      dark={dark}
      title="Marketing V2"
      sub="Campaign asks from V2 academies. Post, budget, remove and new campaign."
    >
      <section className="v2r-queue-card">
        <div className="v2r-queue-head">
          <span className="v2r-microlabel">Queue</span>
          <span className="v2r-queue-count">{openCount} open</span>
        </div>

        <div className="v2r-mkt-toolbar">
          <div className="v2r-mkt-seg" role="tablist" aria-label="Status">
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={segment === s.id}
                className={`v2r-mkt-seg-btn${segment === s.id ? " is-on" : ""}`}
                onClick={() => setSegment(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="v2r-mkt-modes">
            {MODE_PILLS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`v2r-mkt-mode${modeFilter === p.id ? " is-on" : ""}`}
                onClick={() => setModeFilter(p.id)}
              >
                {p.label}
                {modeCounts[p.id] > 0 && <span className="v2r-mkt-mode-count">{modeCounts[p.id]}</span>}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="v2r-mkt-state">
            <div className="v2r-mkt-spin" aria-hidden="true" />
            Loading marketing asks...
          </div>
        ) : error ? (
          <div className="v2r-mkt-state is-error">
            Could not load the queue. {error}
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="v2r-btn v2r-btn-secondary"
                onClick={() => { setLoading(true); loadQueue(); }}
              >
                Retry
              </button>
            </div>
          </div>
        ) : visible.length === 0 ? (
          <V2EmptyState message={
            segment === "open" && modeFilter === "all"
              ? "No marketing asks yet. Send to marketing and campaign requests land here."
              : `Nothing in ${modeFilter === "all" ? SEGMENTS.find((s) => s.id === segment)?.label.toLowerCase() : MODE_PILLS.find((p) => p.id === modeFilter)?.label.toLowerCase()}.`
          } />
        ) : (
          visible.map((t) => (
            <QueueRow
              key={t.id}
              dark={dark}
              academy={clientsMap[t.client_id] || "Academy"}
              title={t.title || MODES[resolveMode(t)]?.title || "Marketing ask"}
              sub={subLine(t)}
              status={t.status}
              owner={t.assigned_to ? (staffMap[t.assigned_to] || "Assigned") : null}
              age={shortAge(t.updated_at || t.created_at)}
              onClick={() => setOpenId(t.id)}
            />
          ))
        )}
      </section>

      <MarketingDrawer
        ticket={openTicket}
        dark={dark}
        clientName={openTicket ? (clientsMap[openTicket.client_id] || "Academy") : ""}
        ownerName={openTicket && openTicket.assigned_to ? (staffMap[openTicket.assigned_to] || "") : ""}
        owners={owners}
        msgBump={msgBump}
        onClose={() => setOpenId(null)}
        onMutated={loadQueue}
      />
    </V2Page>
  );
}
