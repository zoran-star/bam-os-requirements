/* global process */

import * as Sentry from "@sentry/node";

const fallbackDsn = "https://6f7a59ca46bb683295a81cc97086b160@o4511491372023808.ingest.us.sentry.io/4511527636828160";
const dsn = process.env.SENTRY_DSN || fallbackDsn;
const vercelEnvironment = process.env.VERCEL_ENV;
const environment = process.env.SENTRY_ENVIRONMENT || vercelEnvironment;
const release = process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA;

export const sentryApiEnabled = Boolean(dsn && vercelEnvironment === "production" && environment === "production");

if (sentryApiEnabled) {
  Sentry.init({
    dsn,
    environment,
    release: release || undefined,
    initialScope: {
      tags: {
        portal: "bam-portal",
        surface: "vercel-api",
      },
    },
  });
}

function rawRequestUrl(req) {
  const rawUrl = req.url || req.headers?.["x-vercel-pathname"] || "unknown";
  return String(rawUrl);
}

function routePath(rawUrl) {
  return rawUrl.split("?")[0] || "unknown";
}

function routeSurface(rawUrl) {
  return rawUrl.includes("cron") || rawUrl.includes("/backfill-") ? "vercel-cron" : "vercel-api";
}

function configureScope(scope, req) {
  const rawUrl = rawRequestUrl(req);
  const route = routePath(rawUrl);

  scope.setTag("portal", "bam-portal");
  scope.setTag("surface", routeSurface(rawUrl));
  scope.setTag("api_route", route);
  scope.setTag("http_method", req.method || "unknown");
  scope.setContext("api_request", {
    method: req.method || "unknown",
    route,
  });
}

// Capture a non-exception event (e.g. a watchdog detecting a broken Meta
// token). No-ops outside production so local/dev runs don't emit.
export function captureApiMessage(message, { level = "error", tags = {}, extra = {} } = {}) {
  if (!sentryApiEnabled) return;
  Sentry.captureMessage(message, { level, tags, extra });
}

export function withSentryApiRoute(handler) {
  return async function sentryWrappedApiRoute(req, res) {
    if (!sentryApiEnabled) {
      return handler(req, res);
    }

    return Sentry.withIsolationScope(async (scope) => {
      configureScope(scope, req);

      try {
        return await handler(req, res);
      } catch (error) {
        Sentry.captureException(error);
        await Sentry.flush(2000);
        throw error;
      }
    });
  };
}
