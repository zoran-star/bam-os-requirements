// Daily credit-expiry sweeper (offer tie-in step D). For every academy with
// the credit engine enabled, expire lapsed weekly-credit entitlement balances
// (credit_rollover EXPIRE policy) via sweepLapsedCreditEntitlements.
// Invoked by the Vercel cron (GET, CRON_SECRET) - see vercel.json.

import { withSentryApiRoute } from "../../_sentry.js";
import { sweepLapsedCreditEntitlements } from "../../_runtime/credit-engine.js";
import { createRuntimeSupabaseClient } from "../../_runtime/supabase.js";
import { assertRows } from "../../_runtime/supabase.js";
import { HttpError, sendError } from "../_errors.js";
import { getStaffContext } from "../_staff-context.js";
import type { HeaderValue, RuntimeApiRequest, RuntimeApiResponse } from "../_types.js";

async function handler(req: RuntimeApiRequest, res: RuntimeApiResponse) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      throw new HttpError(405, "method not allowed");
    }
    await authorize(req);

    const supabase = createRuntimeSupabaseClient();
    const { data, error } = await supabase
      .from("clients")
      .select("id, business_name")
      .eq("credit_engine_enabled", true);
    const clients = assertRows<{ id: string; business_name: string | null }>(data, error);

    const results = [];
    for (const client of clients) {
      const swept = await sweepLapsedCreditEntitlements(supabase, client.id);
      results.push({ client_id: client.id, business_name: client.business_name, swept });
    }
    return res.status(200).json({ ok: true, academies: results.length, results });
  } catch (error) {
    return sendError(res, error);
  }
}

async function authorize(req: RuntimeApiRequest): Promise<void> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (cronSecret && providedCronSecret(req) === cronSecret) return;
  await getStaffContext(req);
}

function providedCronSecret(req: RuntimeApiRequest): string {
  const raw = req.query?.secret;
  const fromQuery = ((Array.isArray(raw) ? raw[0] : raw) || "").trim();
  if (fromQuery) return fromQuery;
  return bearerToken(req.headers?.authorization as HeaderValue);
}

function bearerToken(value: HeaderValue): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1]?.trim() ?? "";
}

export default withSentryApiRoute(handler);
