/* global process */
import { withSentryApiRoute } from "./_sentry.js";
import { ADMIN_ROLES, hasRole } from "./_roles.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const DEFAULT_SENTRY_BASE_URL = "https://us.sentry.io";
const DEFAULT_SENTRY_ORG = "full-control";
const DEFAULT_PROJECT_IDS = "4511527624638464,4511527636828160";
const VALID_WINDOWS = new Set(["24h", "7d"]);

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function requireAdmin(req, res) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "auth required" });
    return null;
  }

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) {
    res.status(401).json({ error: "invalid token" });
    return null;
  }

  const user = await userRes.json();
  if (!user?.email) {
    res.status(401).json({ error: "invalid token" });
    return null;
  }

  const rows = await sb(
    `staff?email=eq.${encodeURIComponent(user.email)}&select=id,name,email,role`
  );
  const staff = rows?.[0] || null;
  if (!hasRole(staff?.role, ADMIN_ROLES)) {
    res.status(403).json({ error: "admin only" });
    return null;
  }

  return staff;
}

function sentryConfig() {
  const authToken = process.env.SENTRY_ISSUES_AUTH_TOKEN || process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG || DEFAULT_SENTRY_ORG;
  const baseUrl = (process.env.SENTRY_BASE_URL || DEFAULT_SENTRY_BASE_URL).replace(/\/+$/, "");
  const projectIds = (process.env.SENTRY_ISSUES_PROJECT_IDS || DEFAULT_PROJECT_IDS)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const environment = process.env.SENTRY_ENVIRONMENT || "production";
  return { authToken, org, baseUrl, projectIds, environment };
}

function sumStats(stats) {
  if (!stats) return null;
  const series = Array.isArray(stats)
    ? stats
    : Object.values(stats).flatMap((value) => (Array.isArray(value) ? value : []));

  if (!series.length) return null;
  return series.reduce((total, point) => {
    if (Array.isArray(point)) return total + (Number(point[1]) || 0);
    if (point && typeof point === "object") return total + (Number(point.count) || 0);
    return total;
  }, 0);
}

function numericCount(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value.replace(/,/g, "")) || 0;
  return 0;
}

function issuePeriodCount(issue) {
  const statsCount = sumStats(issue.stats);
  return statsCount === null ? numericCount(issue.count) : statsCount;
}

function tagValue(tags, key) {
  if (!tags) return null;
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (Array.isArray(tag) && tag[0] === key) return tag[1] || null;
      if (tag?.key === key) return tag.value || tag.name || null;
    }
    return null;
  }
  return tags[key] || null;
}

function defaultSurface(projectSlug) {
  if (projectSlug === "bam-portal-api") return "vercel-api";
  if (projectSlug === "bam-portal-web") return "web";
  return "unknown";
}

async function sentryFetch(url, authToken) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const isAuth = res.status === 401 || res.status === 403;
    throw new Error(isAuth ? "Sentry auth failed" : `Sentry API ${res.status}`);
  }

  return res.json();
}

function issuePermalink(issue, { baseUrl, org }) {
  return issue.permalink || `${baseUrl.replace("/api/0", "")}/organizations/${org}/issues/${issue.id}/`;
}

function shapeIssue(issue, config) {
  const projectSlug = issue.project?.slug || issue.project?.name || "unknown";
  const surface =
    tagValue(issue.latestEvent?.tags, "surface") ||
    tagValue(issue.tags, "surface") ||
    defaultSurface(projectSlug);

  return {
    id: String(issue.id),
    shortId: issue.shortId || issue.short_id || issue.id,
    title: issue.title || issue.metadata?.title || "Untitled issue",
    culprit: issue.culprit || "",
    projectSlug,
    surface,
    count: issuePeriodCount(issue),
    userCount: numericCount(issue.userCount || issue.users),
    firstSeen: issue.firstSeen || issue.first_seen || null,
    lastSeen: issue.lastSeen || issue.last_seen || null,
    status: issue.status || "",
    level: issue.level || "",
    permalink: issuePermalink(issue, config),
  };
}

async function hydrateSurface(issue, config, statsPeriod) {
  if (issue.surface !== "web" && issue.surface !== "unknown") return issue;

  const url = new URL(`${config.baseUrl}/api/0/organizations/${config.org}/issues/${issue.id}/events/`);
  url.searchParams.set("environment", config.environment);
  url.searchParams.set("statsPeriod", statsPeriod);
  url.searchParams.set("limit", "1");

  try {
    const events = await sentryFetch(url, config.authToken);
    const event = Array.isArray(events) ? events[0] : null;
    const surface = tagValue(event?.tags, "surface");
    return surface ? { ...issue, surface } : issue;
  } catch {
    return issue;
  }
}

async function listSentryIssues(req, res) {
  const staff = await requireAdmin(req, res);
  if (!staff) return;

  const statsPeriod = VALID_WINDOWS.has(req.query?.window) ? req.query.window : "24h";
  const config = sentryConfig();
  if (!config.authToken) {
    return res.status(500).json({ error: "Sentry issue token is not configured" });
  }
  if (!config.projectIds.length) {
    return res.status(500).json({ error: "Sentry project IDs are not configured" });
  }

  const url = new URL(`${config.baseUrl}/api/0/organizations/${config.org}/issues/`);
  url.searchParams.set("query", "is:unresolved");
  url.searchParams.set("sort", "freq");
  url.searchParams.set("statsPeriod", statsPeriod);
  url.searchParams.set("limit", "25");
  url.searchParams.append("environment", config.environment);
  for (const projectId of config.projectIds) url.searchParams.append("project", projectId);

  const raw = await sentryFetch(url, config.authToken);
  const issues = (Array.isArray(raw) ? raw : [])
    .map((issue) => shapeIssue(issue, config))
    .filter((issue) => issue.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0);
    })
    .slice(0, 5);

  const hydrated = await Promise.all(
    issues.map((issue) => hydrateSurface(issue, config, statsPeriod))
  );

  return res.status(200).json({
    data: hydrated,
    window: statsPeriod,
    generated_at: new Date().toISOString(),
  });
}

async function handler(req, res) {
  const action = req.query?.action;

  if (action === "sentry-issues") {
    if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
    return listSentryIssues(req, res);
  }

  if (action === "test-api-error") {
    if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
    const staff = await requireAdmin(req, res);
    if (!staff) return;
    throw new Error(`[Sentry test] BAM Portal API error (${new Date().toISOString()})`);
  }

  return res.status(400).json({ error: "unknown action" });
}

export default withSentryApiRoute(handler);
