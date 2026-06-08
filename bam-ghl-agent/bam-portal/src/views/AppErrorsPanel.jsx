import { useEffect, useMemo, useState } from "react";

const WINDOWS = [
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7d" },
];

const MOBILE_TEST_URL = "https://portal.byanymeansbusiness.com/client-portal.html?sentry_test=client";

export default function AppErrorsPanel({ tokens, session }) {
  const t = tokens;
  const [timeWindow, setTimeWindow] = useState("24h");
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [testStatus, setTestStatus] = useState("");

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

  const triggerStaffError = () => {
    setTestStatus("Staff app test error queued.");
    setTimeout(() => {
      throw new Error(`[Sentry test] BAM Portal staff app error (${new Date().toISOString()})`);
    }, 0);
  };

  const triggerApiError = async () => {
    setTestStatus("Sending API test error...");
    try {
      await fetch("/api/app-errors?action=test-api-error", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      setTestStatus("API test error sent.");
    } catch (e) {
      setTestStatus(`API test request failed: ${e.message}`);
    }
  };

  const openClientPortalError = () => {
    window.open(MOBILE_TEST_URL, "_blank", "noopener,noreferrer");
    setTestStatus("Client portal test opened.");
  };

  const copyMobileLink = async () => {
    try {
      await navigator.clipboard.writeText(MOBILE_TEST_URL);
      setTestStatus("Mobile test link copied.");
    } catch {
      setTestStatus(MOBILE_TEST_URL);
    }
  };

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
        <div style={{ flex: 1 }} />
        <button onClick={triggerStaffError} style={dangerButton(t)}>
          App Error
        </button>
        <button onClick={triggerApiError} style={dangerButton(t)}>
          API Error
        </button>
        <button onClick={openClientPortalError} style={dangerButton(t)}>
          Client Error
        </button>
        <button onClick={copyMobileLink} style={outlineButton(t)}>
          Mobile Link
        </button>
      </div>

      {testStatus && (
        <div style={{
          marginBottom: 18,
          color: t.textMute,
          fontSize: 12,
          fontFamily: "JetBrains Mono, monospace",
        }}>
          {testStatus}
        </div>
      )}

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
  return (
    <div style={{
      background: t.surfaceEl,
      border: `1px solid ${t.border}`,
      borderRadius: 8,
      padding: "14px 18px 16px",
      borderLeft: `3px solid ${surfaceColor(issue.surface, t)}`,
    }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <Chip label={issue.projectSlug} color={issue.projectSlug === "bam-portal-api" ? "#6EB4FF" : t.amber} />
            <Chip label={issue.surface || "unknown"} color={surfaceColor(issue.surface, t)} />
            {issue.shortId && <span style={{ color: t.textMute, fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>{issue.shortId}</span>}
          </div>
          <div style={{ color: t.text, fontSize: 15, fontWeight: 700, lineHeight: 1.4, marginBottom: 6 }}>
            {issue.title}
          </div>
          {issue.culprit && (
            <div style={{ color: t.textMute, fontSize: 12, fontFamily: "JetBrains Mono, monospace", marginBottom: 10, overflowWrap: "anywhere" }}>
              {issue.culprit}
            </div>
          )}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", color: t.textMute, fontSize: 12 }}>
            <span><strong style={{ color: t.text }}>{formatNumber(issue.count)}</strong> events</span>
            <span><strong style={{ color: t.text }}>{formatNumber(issue.userCount)}</strong> users</span>
            <span>First {formatDate(issue.firstSeen)}</span>
            <span>Last {formatDate(issue.lastSeen)}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <a href={issue.permalink} target="_blank" rel="noreferrer" style={linkButton(t)}>
            View in Sentry
          </a>
          <button onClick={() => copyClaudePrompt(issue)} style={outlineButton(t)}>
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

function dangerButton(t) {
  return {
    ...outlineButton(t),
    color: t.red || "#ED7969",
    border: `1px solid ${t.red || "#ED7969"}66`,
  };
}

function linkButton(t) {
  return {
    ...outlineButton(t),
    display: "inline-flex",
    alignItems: "center",
  };
}

function surfaceColor(surface, t) {
  if (surface === "vercel-api" || surface === "vercel-cron") return "#6EB4FF";
  if (surface === "client-mobile-webview") return "#C787FF";
  if (surface === "client-web") return t.green || "#7ED996";
  if (surface === "staff-web") return t.amber || "#E8C547";
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
