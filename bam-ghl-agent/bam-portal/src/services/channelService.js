// Channel Service — reads bam_channel_snapshots + bam_channel_settings from Supabase
// All reads are RLS-gated by email allowlist (see bam_channel_schema.sql)
// Ingest action posts to /api/stripe/overview?section=channel-ingest

import { supabase } from "../lib/supabase";

const ALLOWLIST = [
  "zoran@byanymeansbball.com",
  "mike@byanymeansbball.com",
  "coleman@byanymeansbball.com",
];

export function isChannelViewer(session) {
  const email = (session?.user?.email || "").toLowerCase();
  return ALLOWLIST.includes(email);
}

export async function fetchChannelSettings() {
  const { data, error } = await supabase
    .from("bam_channel_settings")
    .select("*")
    .eq("id", 1)
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function fetchLatestSnapshot() {
  const { data, error } = await supabase
    .from("bam_channel_snapshots")
    .select("*")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function fetchSnapshotHistory(days = 60) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("bam_channel_snapshots")
    .select("snapshot_date, daily_ratio, new_mrr_60d, ad_spend_60d, total_business_mrr")
    .gte("snapshot_date", since)
    .order("snapshot_date", { ascending: true });
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null };
}

// Hand-entered fields (funnel numbers, ad spend) — admin form
export async function upsertSnapshotFields(date, fields) {
  const { data: existing } = await supabase
    .from("bam_channel_snapshots")
    .select("id")
    .eq("snapshot_date", date)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("bam_channel_snapshots")
      .update(fields)
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("bam_channel_snapshots")
      .insert([{ snapshot_date: date, ingested_by: "manual", ...fields }]);
    if (error) return { error: error.message };
  }
  return { error: null };
}

export async function triggerStripeIngest(session) {
  const token = session?.access_token;
  if (!token) return { error: "no auth session" };
  try {
    const res = await fetch("/api/stripe/overview?section=channel-ingest", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error || `HTTP ${res.status}` };
    return { data: json.data, error: null };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Derived metric helpers ─────────────────────────────────────────────────

export function computeDayCounter(campaignStartDate, windowDays = 42) {
  if (!campaignStartDate) return { dayN: 0, total: windowDays, daysRemaining: windowDays };
  const start = new Date(campaignStartDate);
  const now = new Date();
  const dayN = Math.max(1, Math.min(windowDays, Math.floor((now - start) / 86400000) + 1));
  return { dayN, total: windowDays, daysRemaining: Math.max(0, windowDays - dayN) };
}

export function ratioStatus(ratio, settings) {
  const target = settings?.target_mrr_per_ad_dollar ?? 3.0;
  const acceptable = settings?.acceptable_mrr_per_ad_dollar ?? 1.5;
  if (ratio >= target) return "good";
  if (ratio >= acceptable) return "warn";
  return "bad";
}

// Returns { stage, status, counterfactual } — identifies worst funnel stage
export function diagnoseFunnel(snapshot, settings) {
  if (!snapshot) return null;
  const ad = +snapshot.ad_spend_60d || 0;
  const leads = +snapshot.leads_60d || 0;
  const booked = +snapshot.booked_calls_60d || 0;
  const showed = +snapshot.showed_up_60d || 0;
  const closed = +snapshot.closed_60d || 0;

  const cpl = leads > 0 ? ad / leads : 0;
  const leadToBook = leads > 0 ? booked / leads : 0;
  const showRate = booked > 0 ? showed / booked : 0;
  const closeRate = showed > 0 ? closed / showed : 0;

  const stages = [
    { key: "CPL", actual: cpl, target: settings?.target_cpl ?? 15, lowerIsBetter: true },
    { key: "LEAD→BOOK", actual: leadToBook, target: settings?.target_lead_to_book ?? 0.40, lowerIsBetter: false },
    { key: "SHOW-UP", actual: showRate, target: settings?.target_show_rate ?? 0.65, lowerIsBetter: false },
    { key: "CLOSE", actual: closeRate, target: settings?.target_close_rate ?? 0.60, lowerIsBetter: false },
  ];

  // Gap = how far below target (or above for lowerIsBetter)
  const withGaps = stages.map(s => {
    const gap = s.lowerIsBetter ? (s.actual - s.target) / s.target : (s.target - s.actual) / s.target;
    return { ...s, gap };
  });
  withGaps.sort((a, b) => b.gap - a.gap);
  const worst = withGaps[0];
  if (worst.gap <= 0) return null; // everything's at or above target

  // Counterfactual: if worst stage hit target, what would close + MRR be?
  let projClosed = closed;
  if (worst.key === "SHOW-UP") {
    const projShowed = Math.round(booked * worst.target);
    projClosed = Math.round(projShowed * (closeRate || 0));
  } else if (worst.key === "CLOSE") {
    projClosed = Math.round(showed * worst.target);
  } else if (worst.key === "LEAD→BOOK") {
    const projBooked = Math.round(leads * worst.target);
    projClosed = Math.round(projBooked * (showRate || 0) * (closeRate || 0));
  }
  const avgMrrPerClose = closed > 0 ? (+snapshot.new_mrr_60d || 0) / closed : 0;
  const projMrr = Math.round(projClosed * avgMrrPerClose);
  const projRatio = ad > 0 ? projMrr / ad : 0;

  return {
    stage: worst.key,
    actualPct: worst.lowerIsBetter ? `$${worst.actual.toFixed(2)}` : `${Math.round(worst.actual * 100)}%`,
    targetPct: worst.lowerIsBetter ? `$${worst.target.toFixed(2)}` : `${Math.round(worst.target * 100)}%`,
    counterfactual: projClosed > closed
      ? `If ${worst.key.toLowerCase()} hit target, closes would be ${projClosed}, MRR would be ~$${projMrr.toLocaleString()}, $/MRR ratio would be $${projRatio.toFixed(2)}.`
      : null,
  };
}

export function computeKillProgress(snapshot, settings) {
  if (!snapshot || !settings) return [];
  const rows = [
    {
      label: "Full/Partner clients",
      actual: +snapshot.active_full_partner || 0,
      target: settings.kill_full_partner_clients,
      unit: "count",
    },
    {
      label: "Core clients",
      actual: +snapshot.active_core || 0,
      target: settings.kill_core_clients,
      unit: "count",
    },
    {
      label: "Total BAM Business MRR",
      actual: +snapshot.total_business_mrr || 0,
      target: settings.kill_total_mrr,
      unit: "money",
    },
    {
      label: "Full/Partner MRR (of above)",
      actual: +snapshot.full_partner_mrr || 0,
      target: settings.kill_full_partner_mrr,
      unit: "money",
    },
    {
      label: `Channel proven @ $${(settings.kill_ad_spend_threshold / 1000).toFixed(0)}K+/mo`,
      actual: +snapshot.ad_spend_60d / 2 || 0, // 60d / 2 = monthly approximation
      target: settings.kill_ad_spend_threshold,
      unit: "money",
      sustainDays: +snapshot.consecutive_days_above_spend_threshold || 0,
      sustainTarget: 60,
    },
    {
      label: `Sustained $3:1 (${settings.kill_sustained_days}d)`,
      actual: +snapshot.consecutive_days_above_3to1 || 0,
      target: settings.kill_sustained_days,
      unit: "days",
      detail: (+snapshot.daily_ratio || 0) < (settings.target_mrr_per_ad_dollar || 3)
        ? `Currently $${(+snapshot.daily_ratio || 0).toFixed(2)}:1 — below threshold`
        : `Currently $${(+snapshot.daily_ratio || 0).toFixed(2)}:1`,
    },
  ];
  return rows.map(r => ({
    ...r,
    pct: Math.min(100, Math.round((r.actual / r.target) * 100)),
    remaining: Math.max(0, r.target - r.actual),
  }));
}

export function compositeKillProgress(rows) {
  if (!rows.length) return 0;
  const avg = rows.reduce((sum, r) => sum + Math.min(100, r.pct), 0) / rows.length;
  return Math.round(avg);
}

// ── Trajectory projection (client-side, pure function) ─────────────────────
// Returns 13-month MRR array starting at month 0 (today) through month 12.
export function projectTrajectory(scenarioKey, settings, snapshot) {
  const sc = settings?.scenarios?.[scenarioKey];
  if (!sc) return [];
  const startingMrr = +snapshot?.total_business_mrr || settings?.existing_book_mrr || 28000;
  const monthlyAdSpend = +sc.monthly_ad_spend || 2000;
  const ratio = +sc.ratio || 1.5;
  // New MRR added per month from channel
  const channelMrrPerMonth = monthlyAdSpend * ratio;
  // Partner growth-share ramp (linear interpolation between 0 → m6 → m12)
  const gs6 = settings?.partner_growth_share_month_6 || 0;
  const gs12 = settings?.partner_growth_share_month_12 || 0;

  const out = [];
  let mrr = startingMrr;
  for (let m = 0; m <= 12; m++) {
    let growthShare = 0;
    if (m <= 6) growthShare = (gs6 / 6) * m;
    else growthShare = gs6 + ((gs12 - gs6) / 6) * (m - 6);
    if (m > 0) mrr += channelMrrPerMonth + growthShare;
    out.push(Math.round(mrr));
  }
  return out;
}

export function estimateKillDate(scenarioKey, settings, snapshot) {
  const traj = projectTrajectory(scenarioKey, settings, snapshot);
  const killMrr = settings?.kill_total_mrr || 45000;
  const hitMonth = traj.findIndex(v => v >= killMrr);
  if (hitMonth < 0) return "Q4 2027+";
  const d = new Date();
  d.setMonth(d.getMonth() + hitMonth);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
