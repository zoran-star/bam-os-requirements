import { useState } from "react";
const AD_PRODUCTION_STAGES = ["Filmed", "Sent", "Produced", "Reviewed", "Approved"];
import ProgressBar from '../components/primitives/ProgressBar';
import Avatar from '../components/primitives/Avatar';

export default function MarketingView({ tokens, dark }) {
  const [mktTab, setMktTab] = useState("performance"); // performance, production
  const [expandedClient, setExpandedClient] = useState(null);
  const [sortBy, setSortBy] = useState("spend"); // spend, cpl, leads, roas, stale

  const [allClientsData] = useState([]);
  const [adProduction] = useState({});
  const allClients = allClientsData;

  const sorted = [...allClients].sort((a, b) => {
    if (sortBy === "spend") return b.mkt.totalSpend - a.mkt.totalSpend;
    if (sortBy === "cpl") return a.mkt.cpl - b.mkt.cpl;
    if (sortBy === "leads") return b.mkt.totalLeads - a.mkt.totalLeads;
    if (sortBy === "roas") return b.mkt.roas - a.mkt.roas;
    if (sortBy === "stale") {
      const staleness = (mkt) => {
        const u = mkt.lastCampaignUpdate;
        if (u === "Today") return 0;
        if (u === "Yesterday") return 1;
        const match = u.match(/(\d+)d/);
        return match ? parseInt(match[1]) : 99;
      };
      return staleness(b.mkt) - staleness(a.mkt);
    }
    return 0;
  });

  // Portfolio totals
  const totalBudget = allClients.reduce((a, c) => a + c.mkt.monthlyBudget, 0);
  const totalSpend = allClients.reduce((a, c) => a + c.mkt.totalSpend, 0);
  const totalLeads = allClients.reduce((a, c) => a + c.mkt.totalLeads, 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const avgRoas = allClients.length > 0 ? (allClients.reduce((a, c) => a + c.mkt.roas, 0) / allClients.length) : 0;
  const totalCampaigns = allClients.reduce((a, c) => a + c.mkt.campaigns.length, 0);
  const pausedCampaigns = allClients.reduce((a, c) => a + c.mkt.campaigns.filter(x => x.status === "Paused").length, 0);
  const staleCampaigns = allClients.reduce((a, c) => a + c.mkt.campaigns.filter(x => {
    const u = x.lastUpdated;
    const match = u.match(/(\d+)d/);
    return match && parseInt(match[1]) >= 4;
  }).length, 0);

  const budgetPct = totalBudget > 0 ? Math.round((totalSpend / totalBudget) * 100) : 0;

  // Ad production aggregates
  const allAds = Object.entries(adProduction).flatMap(([client, ads]) => ads.map(a => ({ ...a, clientName: client })));
  const adsByStage = AD_PRODUCTION_STAGES.map(s => ({ stage: s, ads: allAds.filter(a => a.stage === s) }));

  return (
    <div>
      {/* Empty state placeholder */}
      {allClients.length === 0 && allAds.length === 0 && (
        <div style={{ padding: "60px 0", textAlign: "center", opacity: 0.4 }}>
          <div style={{ fontSize: 16, color: tokens.textMute }}>No marketing data loaded</div>
        </div>
      )}

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 32 }}>
        {[{ key: "performance", label: "Ad Performance" }, { key: "production", label: "Ad Production" }].map(t => (
          <button key={t.key} onClick={() => setMktTab(t.key)} style={{
            padding: "10px 22px", borderRadius: 8, fontSize: 14, cursor: "pointer",
            background: mktTab === t.key ? tokens.accentGhost : "transparent",
            border: "none", color: mktTab === t.key ? tokens.accent : tokens.textMute,
            fontFamily: "inherit", fontWeight: mktTab === t.key ? 600 : 400,
            transition: "all 0.12s",
          }}>{t.label}{t.key === "production" && <span style={{ fontSize: 12, marginLeft: 6, color: tokens.textMute }}>{allAds.length}</span>}</button>
        ))}
      </div>

      {/* AD PRODUCTION TRACKER */}
      {mktTab === "production" && (
        <div>
          {/* Summary stats */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 48, marginBottom: 36 }}>
            {AD_PRODUCTION_STAGES.map(stage => {
              const count = allAds.filter(a => a.stage === stage).length;
              const stageColor = stage === "Approved" ? tokens.green : stage === "Reviewed" ? tokens.blue : stage === "Produced" ? tokens.accent : stage === "Sent" ? tokens.amber : tokens.textSub;
              return (
                <div key={stage}>
                  <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: count > 0 ? stageColor : tokens.textMute }}>{count}</div>
                  <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>{stage.toLowerCase()}</div>
                </div>
              );
            })}
          </div>

          {/* Kanban columns */}
          <div style={{ display: "flex", gap: 14 }}>
            {adsByStage.map(({ stage, ads }, ci) => {
              const stageColor = stage === "Approved" ? tokens.green : stage === "Reviewed" ? tokens.blue : stage === "Produced" ? tokens.accent : stage === "Sent" ? tokens.amber : tokens.textSub;
              return (
                <div key={ci} style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "0 4px" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: stageColor }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: tokens.textMute }}>{stage}</span>
                    <span style={{ fontSize: 12, color: tokens.textMute }}>{ads.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 120 }}>
                    {ads.map((ad, ai) => (
                      <div key={ad.id} style={{
                        background: tokens.surfaceEl, borderRadius: 12,
                        padding: "16px 18px", border: `1px solid ${tokens.border}`,
                        borderLeft: `3px solid ${stageColor}`,
                        animation: `cardIn 0.3s ease ${ai * 40}ms both`,
                        transition: "all 0.15s",
                      }}
                        onMouseEnter={e => { e.currentTarget.style.background = tokens.surfaceHov; e.currentTarget.style.borderColor = tokens.borderStr; }}
                        onMouseLeave={e => { e.currentTarget.style.background = tokens.surfaceEl; e.currentTarget.style.borderColor = tokens.border; }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, marginBottom: 6, lineHeight: 1.3 }}>{ad.title}</div>
                        <div style={{ fontSize: 13, color: tokens.textSub, marginBottom: 10 }}>{ad.clientName}</div>
                        <div style={{ fontSize: 12, color: tokens.textMute, lineHeight: 1.5, marginBottom: 10 }}>{ad.notes}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: tokens.textMute, padding: "2px 6px", borderRadius: 4, background: tokens.surfaceAlt }}>{ad.creativeType}</span>
                          <div style={{ flex: 1 }} />
                          <Avatar name={ad.assignee} size={18} />
                          <span style={{ fontSize: 11, color: tokens.textMute }}>Due {ad.dueDate}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Per-client breakdown */}
          <div style={{ marginTop: 44 }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginBottom: 4, letterSpacing: "-0.02em" }}>
              By Client
              <span style={{ fontSize: 14, fontWeight: 400, color: tokens.textMute, marginLeft: 10 }}>{Object.keys(adProduction).filter(k => adProduction[k].length > 0).length}</span>
            </div>
            <div style={{ height: 1, background: tokens.border, marginBottom: 16 }} />
            {Object.entries(adProduction).filter(([, ads]) => ads.length > 0).map(([clientName, ads], ri) => (
              <div key={clientName} style={{ marginBottom: 12, animation: `cardIn 0.3s ease ${ri * 30}ms both` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 0" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: tokens.text, width: 200, flexShrink: 0 }}>{clientName}</span>
                  <div style={{ flex: 1, display: "flex", gap: 3 }}>
                    {AD_PRODUCTION_STAGES.map(stage => {
                      const count = ads.filter(a => a.stage === stage).length;
                      const sc = stage === "Approved" ? tokens.green : stage === "Reviewed" ? tokens.blue : stage === "Produced" ? tokens.accent : stage === "Sent" ? tokens.amber : tokens.textSub;
                      return (
                        <div key={stage} style={{
                          flex: 1, height: 6, borderRadius: 3,
                          background: count > 0 ? sc : tokens.borderMed,
                          opacity: count > 0 ? 0.8 : 0.3,
                        }} title={`${stage}: ${count}`} />
                      );
                    })}
                  </div>
                  <span style={{ fontSize: 12, color: tokens.textMute, width: 60, textAlign: "right" }}>{ads.length} ad{ads.length > 1 ? "s" : ""}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AD PERFORMANCE (existing) */}
      {mktTab === "performance" && <>
      {/* Portfolio hero stats */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 48, marginBottom: 36 }}>
        <div>
          <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, color: tokens.text }}>${totalSpend.toLocaleString()}</div>
          <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>total ad spend</div>
        </div>
        <div style={{ width: 1, height: 48, background: tokens.border }} />
        <div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: tokens.green }}>{totalLeads.toLocaleString()}</div>
          <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>total leads</div>
        </div>
        <div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: avgCpl <= 20 ? tokens.green : tokens.amber }}>${avgCpl.toFixed(2)}</div>
          <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>avg CPL</div>
        </div>
        <div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: avgRoas >= 5 ? tokens.green : tokens.amber }}>{avgRoas.toFixed(1)}x</div>
          <div style={{ fontSize: 14, color: tokens.textMute, marginTop: 8 }}>avg ROAS</div>
        </div>
      </div>

      {/* Budget bar + campaign summary */}
      <div style={{ display: "flex", gap: 20, marginBottom: 36 }}>
        <div style={{ flex: 2, padding: "20px 24px", borderRadius: 14, background: tokens.surfaceEl, border: `1px solid ${tokens.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: tokens.textSub }}>Portfolio Budget</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>${totalSpend.toLocaleString()} / ${totalBudget.toLocaleString()}</span>
          </div>
          <ProgressBar pct={budgetPct} tokens={tokens} animated={true} delay={200} height={6} />
          <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 8 }}>{budgetPct}% of budget used {"\u00b7"} ${(totalBudget - totalSpend).toLocaleString()} remaining</div>
        </div>
        <div style={{ flex: 1, display: "flex", gap: 12 }}>
          {[
            { label: "Active", val: totalCampaigns - pausedCampaigns, color: tokens.green },
            { label: "Paused", val: pausedCampaigns, color: tokens.amber },
            { label: "Stale", val: staleCampaigns, color: tokens.red },
          ].map((s, i) => (
            <div key={i} style={{ flex: 1, padding: "16px", borderRadius: 14, background: tokens.surfaceEl, border: `1px solid ${tokens.border}`, textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.val > 0 ? s.color : tokens.textMute, letterSpacing: "-0.02em" }}>{s.val}</div>
              <div style={{ fontSize: 12, color: tokens.textMute, marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Sort controls */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
        {[
          { key: "spend", label: "Highest Spend" },
          { key: "leads", label: "Most Leads" },
          { key: "cpl", label: "Best CPL" },
          { key: "roas", label: "Best ROAS" },
          { key: "stale", label: "Most Stale" },
        ].map(s => (
          <button key={s.key} onClick={() => setSortBy(s.key)} style={{
            padding: "8px 18px", borderRadius: 8, fontSize: 13, cursor: "pointer",
            background: sortBy === s.key ? tokens.accentGhost : "transparent",
            border: "none", color: sortBy === s.key ? tokens.accent : tokens.textMute,
            fontFamily: "inherit", fontWeight: sortBy === s.key ? 600 : 400,
            transition: "all 0.12s",
          }}>{s.label}</button>
        ))}
      </div>

      {/* Column headers */}
      <div style={{ display: "flex", alignItems: "center", padding: "0 24px 12px", gap: 16 }}>
        <div style={{ width: 200, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>CLIENT</div>
        <div style={{ width: 100, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>BUDGET</div>
        <div style={{ width: 90, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>SPEND</div>
        <div style={{ width: 70, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>LEADS</div>
        <div style={{ width: 80, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>CPL</div>
        <div style={{ width: 70, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em" }}>ROAS</div>
        <div style={{ flex: 1, fontSize: 11, fontWeight: 600, color: tokens.textMute, letterSpacing: "0.04em", textAlign: "right" }}>LAST UPDATE</div>
      </div>

      {/* Client rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {sorted.map((client, ci) => {
          const mkt = client.mkt;
          const expanded = expandedClient === client.id;
          const budgetUsed = mkt.monthlyBudget > 0 ? Math.round((mkt.totalSpend / mkt.monthlyBudget) * 100) : 0;
          const isStale = (() => {
            const u = mkt.lastCampaignUpdate;
            const match = u.match(/(\d+)d/);
            return match && parseInt(match[1]) >= 4;
          })();
          const hasPaused = mkt.campaigns.some(c => c.status === "Paused");
          const trendIcon = mkt.trend === "up" ? "\u2191" : mkt.trend === "down" ? "\u2193" : "\u2192";
          const trendColor = mkt.trend === "up" ? tokens.green : mkt.trend === "down" ? tokens.red : tokens.textMute;

          return (
            <div key={client.id} style={{ animation: `cardIn 0.3s ease ${ci * 35}ms both` }}>
              {/* Row */}
              <div
                onClick={() => setExpandedClient(expanded ? null : client.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 16,
                  padding: "16px 24px", cursor: "pointer",
                  background: expanded ? tokens.surfaceAlt : "transparent",
                  borderRadius: expanded ? "14px 14px 0 0" : 14,
                  borderLeft: `3px solid ${isStale ? tokens.red : hasPaused ? tokens.amber : trendColor}`,
                  transition: "all 0.15s",
                }}
                onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = tokens.surfaceEl; }}
                onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ width: 200, minWidth: 200, flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{client.name}</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    {mkt.platforms.map(p => (
                      <span key={p} style={{ fontSize: 10, color: tokens.textMute, padding: "1px 5px", borderRadius: 3, background: tokens.surfaceAlt }}>{p}</span>
                    ))}
                  </div>
                </div>
                <div style={{ width: 100, minWidth: 100, flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>${mkt.monthlyBudget.toLocaleString()}</div>
                  <div style={{ width: 60, marginTop: 4 }}><ProgressBar pct={budgetUsed} tokens={tokens} animated={false} height={3} /></div>
                </div>
                <div style={{ width: 90, minWidth: 90, flexShrink: 0, fontSize: 14, fontWeight: 600, color: tokens.text }}>${mkt.totalSpend.toLocaleString()}</div>
                <div style={{ width: 70, minWidth: 70, flexShrink: 0, fontSize: 14, fontWeight: 700, color: tokens.text }}>{mkt.totalLeads}</div>
                <div style={{ width: 80, minWidth: 80, flexShrink: 0, fontSize: 14, fontWeight: 600, color: mkt.cpl <= 18 ? tokens.green : mkt.cpl <= 25 ? tokens.amber : tokens.red }}>${mkt.cpl.toFixed(2)}</div>
                <div style={{ width: 70, minWidth: 70, flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: mkt.roas >= 6 ? tokens.green : tokens.amber }}>{mkt.roas.toFixed(1)}x</span>
                  <span style={{ fontSize: 12, color: trendColor }}>{trendIcon}</span>
                </div>
                <div style={{ flex: 1, textAlign: "right", flexShrink: 0 }}>
                  <span style={{ fontSize: 13, color: isStale ? tokens.red : tokens.textMute, fontWeight: isStale ? 600 : 400 }}>{mkt.lastCampaignUpdate}</span>
                </div>
              </div>

              {/* Expanded — campaign details */}
              {expanded && (
                <div style={{
                  background: tokens.surfaceEl, borderRadius: "0 0 14px 14px",
                  padding: "4px 24px 24px 27px",
                  borderLeft: `3px solid ${isStale ? tokens.red : hasPaused ? tokens.amber : trendColor}`,
                  animation: "cardIn 0.2s ease both",
                }}>
                  {mkt.campaigns.map((camp, cmi) => {
                    const campStale = (() => {
                      const match = camp.lastUpdated.match(/(\d+)d/);
                      return match && parseInt(match[1]) >= 4;
                    })();
                    return (
                      <div key={cmi} style={{
                        padding: "18px 20px", borderRadius: 12, marginBottom: 8, marginTop: cmi === 0 ? 12 : 0,
                        background: tokens.surface, border: `1px solid ${tokens.border}`,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: tokens.text, flex: 1 }}>{camp.name}</span>
                          <span style={{ fontSize: 11, color: tokens.textMute }}>{camp.platform}</span>
                          <span style={{
                            fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 5,
                            color: camp.status === "Active" ? tokens.green : tokens.amber,
                            background: camp.status === "Active" ? tokens.greenSoft : tokens.amberSoft,
                          }}>{camp.status}</span>
                          {campStale && <span style={{ fontSize: 11, fontWeight: 600, color: tokens.red }}>Stale</span>}
                        </div>
                        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                          {[
                            { l: "Spend", v: `$${camp.spend.toLocaleString()}` },
                            { l: "Impressions", v: camp.impressions.toLocaleString() },
                            { l: "Clicks", v: camp.clicks.toLocaleString() },
                            { l: "Leads", v: camp.leads },
                            { l: "CPL", v: `$${camp.cpl.toFixed(2)}` },
                            { l: "CTR", v: camp.ctr },
                            { l: "Conv", v: camp.conv },
                          ].map((m, mi) => (
                            <div key={mi}>
                              <div style={{ fontSize: 11, color: tokens.textMute }}>{m.l}</div>
                              <div style={{ fontSize: 15, fontWeight: 600, color: tokens.text, marginTop: 2 }}>{m.v}</div>
                            </div>
                          ))}
                          <div style={{ flex: 1 }} />
                          <div style={{ alignSelf: "flex-end", fontSize: 11, color: campStale ? tokens.red : tokens.textMute }}>Updated {camp.lastUpdated}</div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Notes + meta */}
                  <div style={{ display: "flex", alignItems: "center", gap: 24, paddingTop: 16, borderTop: `1px solid ${tokens.border}`, marginTop: 8 }}>
                    <span style={{ fontSize: 13, color: tokens.textSub, flex: 1 }}>{mkt.notes}</span>
                    <span style={{ fontSize: 13, color: tokens.textMute }}>{mkt.campaigns.length} campaign{mkt.campaigns.length > 1 ? "s" : ""}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Onboarding clients not running ads */}
      {(() => {
        const notRunning = [];
        if (notRunning.length === 0) return null;
        return (
          <div style={{ marginTop: 44 }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: tokens.text, marginBottom: 4, letterSpacing: "-0.02em" }}>
              Not Running Ads
              <span style={{ fontSize: 14, fontWeight: 400, color: tokens.textMute, marginLeft: 10 }}>{notRunning.length}</span>
            </div>
            <div style={{ height: 1, background: tokens.border, marginBottom: 16 }} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {notRunning.map((c, i) => {
                const m = null;
                return (
                  <div key={i} style={{
                    padding: "12px 18px", borderRadius: 10,
                    background: tokens.surfaceEl, border: `1px solid ${tokens.border}`,
                    fontSize: 13, color: tokens.textSub, display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <span style={{ fontWeight: 500 }}>{c.name}</span>
                    {m && m.monthlyBudget > 0 && (
                      <span style={{ fontSize: 11, color: tokens.textMute }}>${m.monthlyBudget.toLocaleString()} budget</span>
                    )}
                    <span style={{ fontSize: 11, color: tokens.amber }}>{m?.notes || "No data"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      </>}
    </div>
  );
}
