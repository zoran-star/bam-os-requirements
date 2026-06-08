import * as Sentry from "@sentry/react";

const fallbackDsn = "https://12f4dd6848a4f322f66695c8a789ea5c@o4511491372023808.ingest.us.sentry.io/4511527624638464";
const productionHosts = new Set([
  "staff.byanymeansbusiness.com",
  "portal.byanymeansbusiness.com",
  "fullcontrol.vercel.app",
]);
const isProductionHost = typeof window !== "undefined" && productionHosts.has(window.location.hostname);

const dsn = import.meta.env.VITE_SENTRY_DSN || fallbackDsn;
const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT || (isProductionHost ? "production" : "development");
const release = import.meta.env.VITE_SENTRY_RELEASE;

export const sentryEnabled = Boolean(dsn && import.meta.env.PROD && environment === "production" && isProductionHost);

if (sentryEnabled) {
  Sentry.init({
    dsn,
    environment,
    release: release || undefined,
    initialScope: {
      tags: {
        surface: "staff-web",
        portal: "bam-portal",
      },
    },
  });
}

export function configureStaffSentryContext({ me, session } = {}) {
  if (!sentryEnabled) return;

  if (me?.id || me?.role) {
    Sentry.setTag("surface", "staff-web");
    Sentry.setTag("staff_role", me.role || "unknown");
    if (me.id) Sentry.setTag("staff_id", me.id);
    Sentry.setUser({ id: session?.user?.id || me.id });
    return;
  }

  Sentry.setTag("surface", "staff-web");
  Sentry.setUser(null);
}
