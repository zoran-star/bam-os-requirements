import { useState, useEffect, useMemo } from "react";
import { fetchFinancialSummary, fetchCustomers, fetchInvoices, fetchAlerts, fetchMetrics } from "../services/stripeService";
import { useIsMobile } from '../hooks/useMediaQuery';

const SPRING = "cubic-bezier(0.22, 1, 0.36, 1)";

function fmt$(n) {
  if (n == null) return "$0";
  return "$" + Number(n).toLocaleString("en-US");
}

function fmtDate(d) {
  if (!d) return "\u2014";
  const date = typeof d === "number" ? new Date(d * 1000) : new Date(d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateFull(d) {
  if (!d) return "\u2014";
  const date = typeof d === "number" ? new Date(d * 1000) : new Date(d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(d) {
  if (!d) return "";
  const date = new Date(d);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function daysUntil(d) {
  if (!d) return 99;
  const date = typeof d === "number" ? new Date(d * 1000) : new Date(d);
  const now = new Date();
  return Math.ceil((date - now) / (1000 * 60 * 60 * 24));
}

function toClientRow(cust) {
  const sub = cust.subscriptions?.[0];
  return {
    name: cust.name || cust.email || "Unknown",
    tier: sub?.planName || "Foundations",
    monthlyAmount: sub?.amount || 0,
    status: sub?.status || "active",
    lastPaymentDate: "",
  };
}

// ─── Stat Card ───────────────────────────────────────────────────────

function StatCard({ label, value, subValue, color, tokens, delay = 0, trend, trendLabel }) {
  return (
    <div style={{
      background: tokens.surfaceEl, borderRadius: 14,
      border: `1px solid ${tokens.border}`, padding: "22px 24px",
      animation: `slideUp 0.4s ${SPRING} ${delay}ms both`,
      transition: `all 0.3s ${SPRING}`,
      cursor: "default", position: "relative",
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.borderColor = tokens.borderStr; e.currentTarget.style.boxShadow = tokens.cardHover; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 10 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: color || tokens.text, letterSpacing: "-0.03em", lineHeight: 1 }}>{value}</div>
        {trend && (
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              {trend > 0
                ? <path d="M5 1L9 6H1L5 1Z" fill={tokens.green} />
                : <path d="M5 9L1 4H9L5 9Z" fill={tokens.red} />
              }
            </svg>
            <span style={{ fontSize: 12, fontWeight: 600, color: trend > 0 ? tokens.green : tokens.red }}>{trendLabel}</span>
          </div>
        )}
      </div>
      {subValue && <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 8 }}>{subValue}</div>}
    </div>
  );
}

// ─── Alerts Panel ────────────────────────────────────────────────────

function AlertsSection({ tokens, alerts }) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState({});

  const dismiss = (id) => setDismissed(prev => ({ ...prev, [id]: true }));

  const activeFailed = (alerts.failedPayments || []).filter(fp => !dismissed[fp.id]);
  const activePastDue = (alerts.pastDueInvoices || []).filter(inv => !dismissed[inv.id]);
  const totalAlerts = activeFailed.length + activePastDue.length;

  return (
    <div style={{
      background: tokens.surfaceEl, borderRadius: 16,
      border: `1px solid ${totalAlerts > 0 ? tokens.red + "40" : tokens.border}`,
      marginBottom: 28, overflow: "hidden",
      transition: "border-color 0.2s",
      animation: `slideUp 0.4s ${SPRING} both`,
    }}>
      {/* Collapsible header */}
      <div
        onClick={() => setExpanded(p => !p)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px", cursor: "pointer", transition: "background 0.12s",
        }}
        onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={totalAlerts > 0 ? tokens.red : tokens.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: tokens.text, letterSpacing: "-0.01em" }}>Payment Alerts</span>
          {totalAlerts > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, color: "#fff", background: tokens.red,
              padding: "2px 8px", borderRadius: 10, minWidth: 20, textAlign: "center",
            }}>{totalAlerts}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {totalAlerts === 0 && <span style={{ fontSize: 12, color: tokens.green, fontWeight: 600 }}>All clear</span>}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          ><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>

      {/* Collapsible body */}
      {expanded && (
        <div style={{ padding: "0 24px 22px", animation: "cardIn 0.2s ease both" }}>

          {/* Failed Payments */}
          {activeFailed.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: tokens.red, letterSpacing: "0.04em", marginBottom: 10 }}>FAILED PAYMENTS</div>
              {activeFailed.map((fp, i) => (
                <div key={fp.id || i} style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "10px 14px",
                  borderRadius: 10, marginBottom: 4, borderLeft: `3px solid ${tokens.red}`,
                  background: tokens.redSoft, transition: "opacity 0.2s",
                }}>
                  <button onClick={(e) => { e.stopPropagation(); dismiss(fp.id); }} title="Mark as handled" style={{
                    width: 22, height: 22, borderRadius: 6, border: `2px solid ${tokens.red}50`,
                    background: "transparent", cursor: "pointer", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.12s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = tokens.red; e.currentTarget.style.borderColor = tokens.red; e.currentTarget.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = tokens.red + "50"; e.currentTarget.innerHTML = ""; }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>{fp.customerName}</div>
                    <div style={{ fontSize: 11, color: tokens.textMute }}>{fp.failureMessage} · {fmtDate(fp.created)}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: tokens.red }}>{fmt$(fp.amount / 100)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Past Due Invoices */}
          {activePastDue.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: tokens.amber, letterSpacing: "0.04em", marginBottom: 10 }}>PAST DUE</div>
              {activePastDue.map((inv, i) => (
                <div key={inv.id || i} style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "10px 14px",
                  borderRadius: 10, marginBottom: 4, borderLeft: `3px solid ${tokens.amber}`,
                  background: tokens.amberSoft,
                }}>
                  <button onClick={(e) => { e.stopPropagation(); dismiss(inv.id); }} title="Mark as handled" style={{
                    width: 22, height: 22, borderRadius: 6, border: `2px solid ${tokens.amber}50`,
                    background: "transparent", cursor: "pointer", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.12s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = tokens.amber; e.currentTarget.style.borderColor = tokens.amber; e.currentTarget.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = tokens.amber + "50"; e.currentTarget.innerHTML = ""; }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>{inv.customerName}</div>
                    <div style={{ fontSize: 11, color: tokens.textMute }}>Due {fmtDate(inv.dueDate)}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: tokens.amber }}>{fmt$(inv.amount / 100)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Upcoming Renewals */}
          {alerts.upcomingRenewals?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: tokens.blue, letterSpacing: "0.04em", marginBottom: 10 }}>UPCOMING RENEWALS (14 DAYS)</div>
              {alerts.upcomingRenewals.map((r, i) => {
                const days = daysUntil(r.renewalDate);
                return (
                  <div key={r.id || i} style={{
                    display: "flex", alignItems: "center", gap: 14, padding: "10px 14px",
                    borderRadius: 10, marginBottom: 4,
                    background: "transparent", transition: "background 0.12s",
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = tokens.surfaceHov}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                      background: tokens.accentGhost, color: tokens.accent, fontSize: 12, fontWeight: 700, flexShrink: 0,
                    }}>{days}d</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>{r.customerName}</div>
                      <div style={{ fontSize: 11, color: tokens.textMute }}>{r.planName} · renews {fmtDate(r.renewalDate)}</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>{fmt$(r.amount / 100)}</div>
                  </div>
                );
              })}
            </div>
          )}

          {totalAlerts === 0 && (alerts.upcomingRenewals || []).length === 0 && (
            <div style={{ textAlign: "center", padding: "12px 0", fontSize: 13, color: tokens.textMute }}>No payment issues</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Invoice Status Badge ────────────────────────────────────────────

function InvoiceStatusBadge({ status, tokens }) {
  const map = {
    paid: { color: tokens.green, bg: tokens.greenSoft, label: "Paid" },
    open: { color: tokens.blue, bg: tokens.accentGhost, label: "Open" },
    past_due: { color: tokens.amber, bg: tokens.amberSoft, label: "Past Due" },
    void: { color: tokens.textMute, bg: `${tokens.textMute}15`, label: "Void" },
    draft: { color: tokens.textMute, bg: `${tokens.textMute}15`, label: "Draft" },
    uncollectible: { color: tokens.red, bg: tokens.redSoft, label: "Uncollectible" },
  };
  const s = map[status] || map.open;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color: s.color, background: s.bg,
      padding: "4px 10px", borderRadius: 20, letterSpacing: "0.02em",
      display: "inline-block", whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

// ─── Quick Action Button ─────────────────────────────────────────────

function QuickAction({ label, href, icon, tokens, delay = 0 }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "10px 18px", borderRadius: 10,
        background: tokens.accentGhost, color: tokens.accent,
        fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
        border: `1px solid ${tokens.accentBorder}`,
        textDecoration: "none", cursor: "pointer",
        transition: `all 0.25s ${SPRING}`,
        animation: `slideUp 0.35s ${SPRING} ${delay}ms both`,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = tokens.accentGlow || `0 0 20px ${tokens.accent}30`;
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.borderColor = tokens.accent;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.borderColor = tokens.accentBorder;
      }}
    >
      {icon}
      {label}
    </a>
  );
}

// ─── Tab Button ──────────────────────────────────────────────────────

function TabButton({ label, active, onClick, tokens, count }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 20px", borderRadius: 10,
        background: active ? tokens.accentGhost : "transparent",
        color: active ? tokens.accent : tokens.textSub,
        fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
        border: active ? `1px solid ${tokens.accentBorder}` : `1px solid transparent`,
        cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8,
        transition: `all 0.2s ${SPRING}`,
      }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = tokens.surfaceHov; e.currentTarget.style.color = tokens.text; } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = tokens.textSub; } }}
    >
      {label}
      {count != null && (
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 8,
          background: active ? tokens.accent + "20" : tokens.borderMed,
          color: active ? tokens.accent : tokens.textMute,
        }}>{count}</span>
      )}
    </button>
  );
}

// ─── Main View ───────────────────────────────────────────────────────

// Filter out $1 A2P messaging plans
function isRealSub(client) {
  return (client.monthlyAmount || 0) > 1;
}

export default function FinancialsView({ tokens, dark }) {
  const isMobile = useIsMobile();
  const [summary, setSummary] = useState(null);
  const [revenueByMonth, setRevenueByMonth] = useState(null);
  const [clients, setClients] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [alerts, setAlerts] = useState({ failedPayments: [], pastDueInvoices: [], upcomingRenewals: [], expiringCards: [] });
  const [metrics, setMetrics] = useState(null);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [clientSearch, setClientSearch] = useState("");
  const [clientSort, setClientSort] = useState({ key: "monthlyAmount", dir: "desc" });
  const [barsAnimated, setBarsAnimated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [sumRes, custRes, invRes, alertRes, metRes] = await Promise.all([
        fetchFinancialSummary(), fetchCustomers(), fetchInvoices(), fetchAlerts(), fetchMetrics(),
      ]);
      if (cancelled) return;

      if (sumRes.data && sumRes.data.mrr !== undefined) {
        setIsLive(true);
        setSummary({
          mrr: sumRes.data.mrr, totalRevenue: sumRes.data.totalRevenue,
          expenses: 0, net: sumRes.data.totalRevenue,
          availableBalance: sumRes.data.availableBalance,
        });
      } else {
        setSummary({
          mrr: 0, totalRevenue: 0,
          expenses: 0, net: 0,
          availableBalance: null,
        });
      }
      if (custRes.data && custRes.data.length > 0) {
        setClients(custRes.data.map(toClientRow).filter(isRealSub));
      } else {
        setClients([]);
      }
      if (invRes.data && invRes.data.length > 0) {
        setInvoices(invRes.data);
        const byMonth = {};
        invRes.data.filter(inv => inv.status === "paid" && inv.amount > 1).forEach(inv => {
          const d = new Date((inv.paidAt || inv.created) * 1000);
          const key = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
          byMonth[key] = (byMonth[key] || 0) + inv.amount;
        });
        const months = Object.entries(byMonth)
          .map(([month, income]) => ({ month, income, expenses: 0 }))
          .sort((a, b) => new Date("1 " + a.month) - new Date("1 " + b.month))
          .slice(-6);
        if (months.length > 0) setRevenueByMonth(months);
        else setRevenueByMonth([]);
      } else {
        setRevenueByMonth([]);
      }
      if (alertRes.data) setAlerts(alertRes.data);
      if (metRes.data) setMetrics(metRes.data);
      setLastUpdated(new Date());
      setLoading(false);
      // Trigger bar animations after a brief delay
      setTimeout(() => setBarsAnimated(true), 100);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const maxIncome = Math.max(0, ...(revenueByMonth || []).map(m => m.income));
  const m = metrics || {};

  // Parse growth percentage for trend arrows
  const growthStr = m.revenueGrowth || "+0%";
  const growthNum = parseFloat(growthStr.replace(/[^-\d.]/g, ""));

  // Client sorting and filtering
  const filteredClients = useMemo(() => {
    let list = [...(clients || [])].filter(isRealSub);
    if (clientSearch.trim()) {
      const q = clientSearch.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || (c.tier || "").toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      const { key, dir } = clientSort;
      let av = a[key], bv = b[key];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [clients, clientSearch, clientSort]);

  const handleSort = (key) => {
    setClientSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc",
    }));
  };

  const sortArrow = (key) => {
    if (clientSort.key !== key) return null;
    return (
      <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.7 }}>
        {clientSort.dir === "desc" ? "\u25BC" : "\u25B2"}
      </span>
    );
  };

  // Loading — animated chart draw + pulse grid
  if (loading) {
    // Pulse grid layout: 5x3 grid of dots
    const gridDots = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const cx = col * 20 + 10;
        const cy = row * 20 + 10;
        const dist = Math.sqrt(Math.pow(cx - 50, 2) + Math.pow(cy - 30, 2));
        gridDots.push({ cx, cy, delay: dist * 12 });
      }
    }

    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        minHeight: "60vh", animation: "fadeIn 0.5s ease both",
      }}>
        <style>{`
          @keyframes cardIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes finPulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
          @keyframes barGrow { from { width: 0%; } }
          @keyframes dotPulseOut {
            0% { transform: scale(0); opacity: 0; }
            40% { transform: scale(1.4); opacity: 0.8; }
            100% { transform: scale(1); opacity: 0.4; }
          }
          @keyframes dotGlow {
            0%, 100% { opacity: 0.3; }
            50% { opacity: 0.7; }
          }
          @keyframes dotRipple {
            0% { r: 3; opacity: 0.6; }
            100% { r: 8; opacity: 0; }
          }
          @keyframes textFade {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 0.9; }
          }
          @keyframes loaderSlide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(300%); }
          }
        `}</style>

        {/* Pulse grid */}
        <div style={{ width: 100, height: 60, marginBottom: 32 }}>
          <svg viewBox="0 0 100 60" width="100" height="60">
            {gridDots.map((dot, i) => (
              <g key={i}>
                <circle cx={dot.cx} cy={dot.cy} r="2.5"
                  fill={tokens.accent}
                  style={{
                    animation: `dotPulseOut 0.6s ease ${dot.delay}ms both, dotGlow 1.8s ease ${dot.delay + 600}ms infinite`,
                  }} />
                {/* Ripple ring from center outward */}
                {dot.delay < 30 && (
                  <circle cx={dot.cx} cy={dot.cy} fill="none"
                    stroke={tokens.accent} strokeWidth="1" r="2.5"
                    style={{ animation: `dotRipple 2s ease ${dot.delay}ms infinite` }} />
                )}
              </g>
            ))}
          </svg>
        </div>

        {/* Loading text */}
        <div style={{
          fontSize: 14, fontWeight: 500, color: tokens.textMute,
          letterSpacing: "0.06em", textTransform: "uppercase",
          animation: "textFade 2s ease infinite",
          marginBottom: 12,
        }}>
          Syncing with Stripe
        </div>

        {/* Slim progress bar */}
        <div style={{
          width: 200, height: 3, borderRadius: 2,
          background: tokens.borderMed, overflow: "hidden",
        }}>
          <div style={{
            width: "30%", height: "100%", borderRadius: 2,
            background: `linear-gradient(90deg, transparent, ${tokens.accent}, transparent)`,
            animation: "loaderSlide 1.4s ease-in-out infinite",
          }} />
        </div>
      </div>
    );
  }

  // ─── Tab Content Renderers ─────────────────────────────────────────

  const renderOverview = () => (
    <>
      {/* ─── Payment Alerts ─── */}
      <AlertsSection tokens={tokens} alerts={alerts} />

      {!isLive && (
        <div style={{ padding: "16px 0 8px", fontSize: 13, color: tokens.textMute, fontStyle: "italic" }}>No data available</div>
      )}

      {/* ─── Hero Stats Row ─── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 14, marginBottom: 14, ...(!isLive ? { opacity: 0.4 } : {}) }}>
        <StatCard label="MRR" value={fmt$(summary.mrr)} color={tokens.green} tokens={tokens} delay={0}
          trend={growthNum} trendLabel={growthStr.replace(/^[+-]/, (m) => m === "-" ? "-" : "+")}
        />
        <StatCard label="TOTAL REVENUE" value={fmt$(summary.totalRevenue)} color={tokens.text} tokens={tokens} delay={60}
          trend={growthNum} trendLabel={growthStr.replace(/^[+-]/, (m) => m === "-" ? "-" : "+")}
        />
        <StatCard label="EXPENSES" value={fmt$(summary.expenses)} color={tokens.red} tokens={tokens} delay={120} />
        <StatCard label="NET" value={fmt$(summary.net)} color={tokens.accent} tokens={tokens} delay={180} />
      </div>

      {/* ─── Metrics Row ─── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(6, 1fr)", gap: isMobile ? 10 : 14, marginBottom: 20 }}>
        <StatCard label="AVG / CLIENT" value={fmt$(m.avgRevenuePerClient || Math.round(summary.mrr / Math.max(clients.length, 1)))} tokens={tokens} delay={240} />
        <StatCard
          label="REVENUE GROWTH"
          value={m.revenueGrowth || "+0%"}
          color={(m.revenueGrowth || "").startsWith("-") ? tokens.red : tokens.green}
          tokens={tokens} delay={300}
        />
        <StatCard label="COLLECTION RATE" value={m.collectionRate || "\u2014"} color={tokens.green} tokens={tokens} delay={360} />
        <StatCard label="CHURN" value={m.churnCount != null ? `${m.churnCount}` : "0"} subValue={m.churnRate || "0%"} color={m.churnCount > 0 ? tokens.red : tokens.green} tokens={tokens} delay={420} />
        <StatCard label="EST. LTV" value={fmt$(m.ltv || Math.round((summary.mrr / Math.max(clients.length, 1)) * 12))} tokens={tokens} delay={480} />
        <StatCard label="ACTIVE SUBS" value={`${clients.filter(c => c.status === "active").length}`} color={tokens.accent} tokens={tokens} delay={540} />
      </div>

      {/* ─── Cash Flow / Available Balance ─── */}
      {summary.availableBalance != null && (
        <div style={{
          background: tokens.surfaceEl, borderRadius: 14,
          border: `1px solid ${tokens.green}30`, padding: "18px 24px",
          marginBottom: 28, display: "flex", alignItems: "center", justifyContent: "space-between",
          animation: `slideUp 0.4s ${SPRING} 600ms both`,
          boxShadow: `0 0 24px ${tokens.green}08`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
              background: tokens.greenSoft,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={tokens.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>AVAILABLE BALANCE</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 2 }}>Funds available for payout</div>
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: tokens.green, letterSpacing: "-0.03em" }}>
            {fmt$(summary.availableBalance)}
          </div>
        </div>
      )}

      {/* ─── Two-column: Revenue Chart + Tier Breakdown ─── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: 28 }}>

        {/* Revenue by month */}
        <div style={{
          background: tokens.surfaceEl, borderRadius: 16,
          border: `1px solid ${tokens.border}`, padding: "24px 24px 20px",
          animation: `slideUp 0.45s ${SPRING} 200ms both`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 20 }}>REVENUE BY MONTH</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {revenueByMonth.map((mo, i) => {
              const incomePct = (mo.income / maxIncome) * 100;
              const expensePct = (mo.expenses / maxIncome) * 100;
              const net = mo.income - mo.expenses;
              return (
                <div key={mo.month} style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "4px 0",
                  animation: `slideUp 0.4s ${SPRING} ${i * 60 + 300}ms both`,
                  borderRadius: 6, transition: `all 0.2s ${SPRING}`,
                  cursor: "default",
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceHov; e.currentTarget.style.transform = "translateX(2px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "translateX(0)"; }}
                >
                  <span style={{ width: 70, flexShrink: 0, fontSize: 12, fontWeight: 500, color: tokens.textSub }}>{mo.month}</span>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ height: 8, background: tokens.borderMed, borderRadius: 4, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: barsAnimated ? `${incomePct}%` : "0%", borderRadius: 4, background: tokens.green,
                        transition: `width 0.8s cubic-bezier(0.16,1,0.3,1) ${i * 60}ms`,
                      }} />
                    </div>
                    {mo.expenses > 0 && (
                      <div style={{ height: 5, background: tokens.borderMed, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", width: barsAnimated ? `${expensePct}%` : "0%", borderRadius: 3, background: tokens.red, opacity: 0.7,
                          transition: `width 0.8s cubic-bezier(0.16,1,0.3,1) ${i * 60 + 100}ms`,
                        }} />
                      </div>
                    )}
                  </div>
                  <span style={{ width: 80, flexShrink: 0, textAlign: "right", fontSize: 13, fontWeight: 600, color: net >= 0 ? tokens.green : tokens.red }}>
                    {net >= 0 ? "+" : ""}{fmt$(net)}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: tokens.green }} />
              <span style={{ fontSize: 11, color: tokens.textMute }}>Income</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 5, borderRadius: 2, background: tokens.red, opacity: 0.7 }} />
              <span style={{ fontSize: 11, color: tokens.textMute }}>Expenses</span>
            </div>
          </div>
        </div>

        {/* MRR Breakdown (pie-style list) */}
        <div style={{
          background: tokens.surfaceEl, borderRadius: 16,
          border: `1px solid ${tokens.border}`, padding: "24px 24px 20px",
          animation: `slideUp 0.45s ${SPRING} 260ms both`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 20 }}>MRR BREAKDOWN BY TIER</div>
          {(() => {
            const tiers = {};
            clients.forEach(c => {
              const tier = c.tier || "Other";
              if (!tiers[tier]) tiers[tier] = { count: 0, revenue: 0 };
              tiers[tier].count++;
              tiers[tier].revenue += c.monthlyAmount || 0;
            });
            const tierEntries = Object.entries(tiers).sort((a, b) => b[1].revenue - a[1].revenue);
            const totalMRR = tierEntries.reduce((s, [, v]) => s + v.revenue, 0);
            const tierColors = { Accelerator: tokens.accent, Foundations: tokens.blue, Other: tokens.textMute };

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Visual bar */}
                <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: tokens.borderMed }}>
                  {tierEntries.map(([tier, val]) => (
                    <div key={tier} style={{
                      width: barsAnimated ? `${(val.revenue / totalMRR) * 100}%` : "0%",
                      background: tierColors[tier] || tokens.textSub,
                      transition: `width 0.8s cubic-bezier(0.16,1,0.3,1)`,
                    }} />
                  ))}
                </div>
                {tierEntries.map(([tier, val], i) => (
                  <div key={tier} style={{
                    display: "flex", alignItems: "center", gap: 14,
                    animation: `slideUp 0.4s ${SPRING} ${i * 60 + 400}ms both`,
                  }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: tierColors[tier] || tokens.textSub, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>{tier}</div>
                      <div style={{ fontSize: 12, color: tokens.textMute }}>{val.count} clients</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text }}>{fmt$(val.revenue)}</div>
                      <div style={{ fontSize: 11, color: tokens.textMute }}>{totalMRR > 0 ? Math.round((val.revenue / totalMRR) * 100) : 0}%</div>
                    </div>
                  </div>
                ))}
                <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: tokens.textMute }}>Total MRR</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: tokens.green }}>{fmt$(totalMRR)}</span>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </>
  );

  const renderInvoices = () => (
    <div style={{
      background: tokens.surfaceEl, borderRadius: 16,
      border: `1px solid ${tokens.border}`, overflow: "hidden",
      animation: `slideUp 0.4s ${SPRING} both`,
    }}>
      <div style={{ padding: "22px 28px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 18 }}>INVOICE HISTORY</div>
        <div style={{ fontSize: 12, color: tokens.textMute, marginBottom: 18 }}>{invoices.length} invoices</div>
      </div>
      {/* Table header */}
      <div style={{
        display: "flex", alignItems: "center", padding: "12px 28px",
        borderBottom: `1px solid ${tokens.border}`,
      }}>
        <span style={{ flex: 2, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>CUSTOMER</span>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>INVOICE #</span>
        <span style={{ width: 100, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", textAlign: "right" }}>AMOUNT</span>
        <span style={{ width: 100, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", textAlign: "center" }}>STATUS</span>
        <span style={{ width: 120, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", textAlign: "right" }}>DATE</span>
      </div>
      {invoices.length === 0 ? (
        <div style={{ padding: "40px 28px", textAlign: "center", fontSize: 13, color: tokens.textMute }}>No invoices found</div>
      ) : (
        invoices.map((inv, i) => (
          <div key={inv.id || i} style={{
            display: "flex", alignItems: "center", padding: "14px 28px",
            borderBottom: `1px solid ${tokens.border}`,
            transition: `all 0.25s ${SPRING}`, cursor: "default",
            animation: `slideUp 0.35s ${SPRING} ${i * 30}ms both`,
          }}
            onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceHov; e.currentTarget.style.transform = "translateX(4px)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "translateX(0)"; }}
          >
            <span style={{ flex: 2, fontSize: 14, fontWeight: 600, color: tokens.text, letterSpacing: "-0.01em" }}>
              {inv.customerName || inv.customer_name || "Unknown"}
            </span>
            <span style={{ flex: 1, fontSize: 13, color: tokens.textSub, fontFamily: "monospace" }}>
              {inv.number || inv.id || "\u2014"}
            </span>
            <span style={{ width: 100, fontSize: 14, fontWeight: 600, color: tokens.text, textAlign: "right" }}>
              {fmt$(inv.amount > 100 ? inv.amount / 100 : inv.amount)}
            </span>
            <span style={{ width: 100, textAlign: "center" }}>
              <InvoiceStatusBadge status={inv.status} tokens={tokens} />
            </span>
            <span style={{ width: 120, fontSize: 13, color: tokens.textMute, textAlign: "right" }}>
              {fmtDateFull(inv.created)}
            </span>
          </div>
        ))
      )}
    </div>
  );

  const renderClients = () => (
    <div style={{
      background: tokens.surfaceEl, borderRadius: 16,
      border: `1px solid ${tokens.border}`, overflow: "hidden",
      animation: `slideUp 0.4s ${SPRING} both`,
    }}>
      <div style={{ padding: "22px 28px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", marginBottom: 18 }}>CLIENT REVENUE</div>
        {/* Search / filter */}
        <div style={{ position: "relative", marginBottom: 18 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}
          >
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={clientSearch}
            onChange={e => setClientSearch(e.target.value)}
            placeholder="Filter clients..."
            style={{
              padding: "8px 12px 8px 32px", fontSize: 12, borderRadius: 8,
              border: `1px solid ${tokens.border}`, background: tokens.surface,
              color: tokens.text, outline: "none", width: 200,
              transition: `all 0.2s ${SPRING}`,
            }}
            onFocus={e => { e.currentTarget.style.borderColor = tokens.accent; e.currentTarget.style.boxShadow = tokens.inputGlow || `0 0 0 3px ${tokens.accent}20`; }}
            onBlur={e => { e.currentTarget.style.borderColor = tokens.border; e.currentTarget.style.boxShadow = "none"; }}
          />
        </div>
      </div>
      <div style={{
        display: "flex", alignItems: "center", padding: "12px 28px",
        borderBottom: `1px solid ${tokens.border}`,
      }}>
        <span
          onClick={() => handleSort("name")}
          style={{ flex: 2, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", cursor: "pointer", userSelect: "none" }}
        >CLIENT{sortArrow("name")}</span>
        <span
          onClick={() => handleSort("tier")}
          style={{ flex: 1, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", cursor: "pointer", userSelect: "none" }}
        >TIER{sortArrow("tier")}</span>
        <span
          onClick={() => handleSort("monthlyAmount")}
          style={{ width: 100, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", textAlign: "right", cursor: "pointer", userSelect: "none" }}
        >MONTHLY{sortArrow("monthlyAmount")}</span>
        <span
          onClick={() => handleSort("status")}
          style={{ width: 100, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", textAlign: "center", cursor: "pointer", userSelect: "none" }}
        >STATUS{sortArrow("status")}</span>
        <span style={{ width: 120, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", textAlign: "right" }}>LAST PAYMENT</span>
      </div>
      {filteredClients.length === 0 ? (
        <div style={{ padding: "40px 28px", textAlign: "center", fontSize: 13, color: tokens.textMute }}>
          {clientSearch ? "No clients match your search" : "No clients found"}
        </div>
      ) : (
        filteredClients.map((client, i) => {
          const tierColor = client.tier === "Accelerator" ? tokens.accent : tokens.textSub;
          const tierBg = client.tier === "Accelerator" ? tokens.accentGhost : `${tokens.textSub}12`;
          const statusColor = client.status === "active" ? tokens.green : client.status === "past_due" ? tokens.amber : tokens.red;
          const statusBg = client.status === "active" ? tokens.greenSoft : client.status === "past_due" ? tokens.amberSoft : tokens.redSoft;
          const statusLabel = client.status === "past_due" ? "Past Due" : client.status === "canceled" ? "Canceled" : "Active";
          return (
            <div key={client.name + i} style={{
              display: "flex", alignItems: "center", padding: "14px 28px",
              borderBottom: `1px solid ${tokens.border}`,
              transition: `all 0.25s ${SPRING}`, cursor: "default",
              animation: `slideUp 0.35s ${SPRING} ${i * 25}ms both`,
            }}
              onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceHov; e.currentTarget.style.transform = "translateX(4px)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "translateX(0)"; }}
            >
              <span style={{ flex: 2, fontSize: 14, fontWeight: 600, color: tokens.text, letterSpacing: "-0.01em" }}>{client.name}</span>
              <span style={{ flex: 1 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: tierColor, letterSpacing: "0.02em", padding: "3px 8px", borderRadius: 5, background: tierBg }}>{client.tier}</span>
              </span>
              <span style={{ width: 100, fontSize: 14, fontWeight: 600, color: tokens.text, textAlign: "right" }}>{fmt$(client.monthlyAmount)}</span>
              <span style={{ width: 100, textAlign: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: statusColor, letterSpacing: "0.02em", padding: "3px 8px", borderRadius: 5, background: statusBg }}>{statusLabel}</span>
              </span>
              <span style={{ width: 120, fontSize: 13, color: tokens.textMute, textAlign: "right" }}>{client.lastPaymentDate}</span>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div style={{ animation: "cardIn 0.3s ease both" }}>
      <style>{`
        @keyframes cardIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes barGrow { from { width: 0%; } }
      `}</style>

      {/* ─── Header ─── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 24, animation: `fadeIn 0.4s ${SPRING} both`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: tokens.text, letterSpacing: "-0.03em", margin: 0 }}>Financials</h1>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 11, fontWeight: 600, color: tokens.textMute,
            padding: "4px 10px", borderRadius: 6,
            background: tokens.surfaceAlt || tokens.surfaceHov,
            border: `1px solid ${tokens.border}`,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"
                fill={tokens.textMute}
              />
            </svg>
            Powered by Stripe
          </span>
        </div>
        {lastUpdated && (
          <span style={{ fontSize: 12, color: tokens.textMute }}>
            Last updated {fmtTime(lastUpdated)}
          </span>
        )}
      </div>

      {/* ─── Tab Navigation ─── */}
      <div style={{
        display: "flex", gap: 6, marginBottom: 24,
        animation: `fadeIn 0.4s ${SPRING} 50ms both`,
      }}>
        <TabButton label="Overview" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} tokens={tokens} />
        <TabButton label="Invoices" active={activeTab === "invoices"} onClick={() => setActiveTab("invoices")} tokens={tokens} count={invoices.length} />
        <TabButton label="Clients" active={activeTab === "clients"} onClick={() => setActiveTab("clients")} tokens={tokens} count={clients.length} />
      </div>

      {/* ─── Quick Actions ─── */}
      <div style={{
        display: "flex", gap: 10, marginBottom: 28,
        animation: `fadeIn 0.4s ${SPRING} 100ms both`,
      }}>
        <QuickAction
          label="Open Stripe Dashboard"
          href="https://dashboard.stripe.com"
          tokens={tokens}
          delay={100}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>}
        />
        <QuickAction
          label="Create Invoice"
          href="https://dashboard.stripe.com/invoices/create"
          tokens={tokens}
          delay={160}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
        />
        <QuickAction
          label="View Subscriptions"
          href="https://dashboard.stripe.com/subscriptions"
          tokens={tokens}
          delay={220}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
        />
      </div>

      {/* ─── Tab Content ─── */}
      {activeTab === "overview" && renderOverview()}
      {activeTab === "invoices" && renderInvoices()}
      {activeTab === "clients" && renderClients()}
    </div>
  );
}
