import { useEffect, useMemo, useState } from "react";

const WINDOWS = [
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7d" },
];

const SENTRY_PURPLE = "#A78BFA";
const CLAUDE_ORANGE = "#D97757";

export default function AppErrorsPanel({ tokens, session }) {
  const t = tokens;
  const [timeWindow, setTimeWindow] = useState("24h");
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);

    (async () => {
      try {
        const res = await fetch(`/api/app-errors?action=sentry-issues&window=${encodeURIComponent(timeWindow)}`, {
          headers: { Authorization: `Bearer ${session?.access_token || ""}` },
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setIssues(Array.isArray(json.data) ? json.data : []);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setErr(e.message);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [session?.access_token, timeWindow, refresh]);

  const totals = useMemo(() => {
    const count = issues.reduce((sum, issue) => sum + (Number(issue.count) || 0), 0);
    const users = issues.reduce((sum, issue) => sum + (Number(issue.userCount) || 0), 0);
    return { count, users };
  }, [issues]);

  return (
    <div>
      <div style={{ display: "flex", gap: 32, marginBottom: 24, alignItems: "baseline", flexWrap: "wrap" }}>
        <Stat label="Issues" value={issues.length} tokens={t} accent={issues.length ? t.amber : t.text} />
        <Stat label="Events" value={totals.count} tokens={t} />
        <Stat label="Users" value={totals.users} tokens={t} />
      </div>

      <div style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        flexWrap: "wrap",
        marginBottom: 18,
      }}>
        {WINDOWS.map((option) => {
          const active = timeWindow === option.value;
          return (
            <button
              key={option.value}
              onClick={() => setTimeWindow(option.value)}
              style={pillButton(t, active)}
            >
              {option.label}
            </button>
          );
        })}
        <button onClick={() => setRefresh((x) => x + 1)} style={outlineButton(t)}>
          Refresh
        </button>
      </div>

      {loading && <div style={{ color: t.textMute, padding: 24 }}>Loading app errors...</div>}
      {err && <div style={{ color: t.red, padding: 24 }}>Error: {err}</div>}
      {!loading && !err && issues.length === 0 && (
        <div style={{ color: t.textMute, padding: 48, textAlign: "center", fontStyle: "italic" }}>
          No production errors in this window.
        </div>
      )}
      {!loading && !err && issues.length > 0 && (
        <div style={{ display: "grid", gap: 12 }}>
          {issues.map((issue) => (
            <IssueRow key={`${issue.projectSlug}:${issue.id}`} issue={issue} tokens={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function IssueRow({ issue, tokens }) {
  const t = tokens;
  const borderColor = surfaceColor(issue.surface, t);
  const secondaryText = t.textSub || t.text;
  return (
    <div style={{
      background: t.surfaceEl,
      border: `1px solid ${t.borderStr || t.border}`,
      borderRadius: 8,
      padding: "14px 18px 16px",
    }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            {issue.shortId && (
              <span style={{
                color: t.text,
                fontSize: 12,
                fontWeight: 800,
                fontFamily: "JetBrains Mono, monospace",
                letterSpacing: "0.02em",
              }}>
                {issue.shortId}
              </span>
            )}
            <Chip label={issue.projectSlug} color={issue.projectSlug === "bam-portal-api" ? "#6EB4FF" : t.amber} />
            <Chip label={surfaceLabel(issue.surface)} color={borderColor} />
          </div>
          <div style={{ color: t.text, fontSize: 15, fontWeight: 700, lineHeight: 1.4, marginBottom: 6 }}>
            {issue.title}
          </div>
          {issue.culprit && (
            <div style={{ color: secondaryText, fontSize: 12, fontFamily: "JetBrains Mono, monospace", marginBottom: 10, overflowWrap: "anywhere" }}>
              {issue.culprit}
            </div>
          )}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", color: secondaryText, fontSize: 12 }}>
            <span><strong style={{ color: t.text }}>{formatNumber(issue.count)}</strong> events</span>
            <span><strong style={{ color: t.text }}>{formatNumber(issue.userCount)}</strong> users</span>
            <span>First {formatDate(issue.firstSeen)}</span>
            <span>Last {formatDate(issue.lastSeen)}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <a href={issue.permalink} target="_blank" rel="noreferrer" style={actionButton(t, SENTRY_PURPLE)}>
            View in Sentry
            <IconArrowUpRight />
          </a>
          <button onClick={() => copyClaudePrompt(issue)} style={actionButton(t, CLAUDE_ORANGE)}>
            <IconClipboard />
            Copy Claude Prompt
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, color }) {
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      padding: "3px 8px",
      borderRadius: 999,
      background: `${color}22`,
      color,
    }}>
      {label}
    </span>
  );
}

function Stat({ label, value, tokens, accent }) {
  return (
    <div>
      <div style={{ fontSize: 30, fontWeight: 700, color: accent || tokens.text }}>{formatNumber(value)}</div>
      <div style={{ fontSize: 11, color: tokens.textMute, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function pillButton(t, active) {
  return {
    padding: "7px 14px",
    background: active ? t.surface : t.surfaceEl,
    color: active ? t.text : t.textMute,
    border: `1px solid ${active ? (t.borderStr || t.border) : t.border}`,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

function outlineButton(t) {
  return {
    padding: "7px 12px",
    background: "transparent",
    color: t.textSub || t.textMute,
    border: `1px solid ${t.border}`,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    textDecoration: "none",
  };
}

function actionButton(t, color) {
  return {
    ...outlineButton(t),
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    color: t.text || "#FFFFFF",
    border: `1px solid ${color}`,
    whiteSpace: "nowrap",
  };
}

function surfaceLabel(surface) {
  if (surface === "staff-web" || surface === "public-web") return "Staff app";
  if (surface === "client-web") return "Client web";
  if (surface === "client-mobile-webview") return "Mobile webview";
  if (surface === "vercel-api") return "API";
  if (surface === "vercel-cron") return "Cron";
  return surface || "Unknown";
}

function surfaceColor(surface, t) {
  if (surface === "vercel-api" || surface === "vercel-cron") return "#6EB4FF";
  if (surface === "client-mobile-webview") return "#C787FF";
  if (surface === "client-web") return t.green || "#7ED996";
  if (surface === "staff-web" || surface === "public-web") return t.red || "#FB7185";
  return t.textMute || "#9A978F";
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

async function copyClaudePrompt(issue) {
  const prompt = [
    `Investigate Sentry issue ${issue.shortId || issue.id} using Sentry MCP and diagnose it.`,
    `Project: ${issue.projectSlug}.`,
    `Surface: ${issue.surface || "unknown"}.`,
    `Title: ${issue.title}.`,
    `URL: ${issue.permalink}.`,
    "If it requires fixing, propose a fix.",
  ].join("\n");
  await navigator.clipboard.writeText(prompt);
}

function IconArrowUpRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

function IconClipboard() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="4" width="8" height="4" rx="1" />
      <path d="M16 6h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
    </svg>
  );
}
