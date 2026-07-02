// DORMANT until Phase 6 cutover. Production wiring will resolve real invoices
// from Stripe instead of trusting a payload.

import { withSentryApiRoute } from "../../_sentry.js";
import {
  applyInvoiceCreditGrants,
  sweepLapsedCreditEntitlements,
  type InvoiceGrantInput,
} from "../../_runtime/credit-engine.js";
import { createRuntimeSupabaseClient } from "../../_runtime/supabase.js";
import { HttpError, sendError } from "../_errors.js";
import { getStaffContext } from "../_staff-context.js";
import type { HeaderValue, RuntimeApiRequest, RuntimeApiResponse } from "../_types.js";

type InvoiceLinePayload = {
  lineId: string;
  stripePriceId: string;
  periodStart: string;
  periodEnd: string;
};

async function handler(req: RuntimeApiRequest, res: RuntimeApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    await authorize(req);

    const body = readJsonObject(req.body);
    const supabase = createRuntimeSupabaseClient();
    if (body.sweep === true) {
      const tenantId = stringValue(body.client_id) || stringValue(body.tenantId);
      if (!tenantId) throw new HttpError(400, "client_id required");
      return res.status(200).json(await sweepLapsedCreditEntitlements(supabase, tenantId));
    }

    const invoice = readInvoiceGrantInput(body);
    return res.status(200).json(await applyInvoiceCreditGrants(supabase, invoice));
  } catch (error) {
    return sendError(res, error);
  }
}

async function authorize(req: RuntimeApiRequest): Promise<void> {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  const provided = providedCronSecret(req);
  if (cronSecret && provided === cronSecret) return;

  await getStaffContext(req);
}

function providedCronSecret(req: RuntimeApiRequest): string {
  const secret = queryValue(req.query?.secret).trim();
  if (secret) return secret;
  return bearerToken(header(req.headers, "authorization"));
}

function readInvoiceGrantInput(body: Record<string, unknown>): InvoiceGrantInput {
  const tenantId = stringValue(body.client_id) || stringValue(body.tenantId);
  const subscriptionId = stringValue(body.subscriptionId) || stringValue(body.subscription_id);
  const invoiceId = stringValue(body.invoiceId) || stringValue(body.invoice_id);
  const lines = readInvoiceLines(body.lines);

  if (!tenantId) throw new HttpError(400, "client_id required");
  if (!subscriptionId) throw new HttpError(400, "subscriptionId required");
  if (!invoiceId) throw new HttpError(400, "invoiceId required");
  if (lines.length === 0) throw new HttpError(400, "lines required");

  return { tenantId, subscriptionId, invoiceId, lines };
}

function readInvoiceLines(value: unknown): InvoiceGrantInput["lines"] {
  if (!Array.isArray(value)) throw new HttpError(400, "lines required");

  return value.map((line, index) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw new HttpError(400, `lines[${index}] must be an object`);
    }
    const row = line as Record<string, unknown>;
    const payload: InvoiceLinePayload = {
      lineId: stringValue(row.lineId) || stringValue(row.line_id),
      stripePriceId: stringValue(row.stripePriceId) || stringValue(row.stripe_price_id),
      periodStart: stringValue(row.periodStart) || stringValue(row.period_start),
      periodEnd: stringValue(row.periodEnd) || stringValue(row.period_end),
    };

    if (!payload.lineId) throw new HttpError(400, `lines[${index}].lineId required`);
    if (!payload.stripePriceId) throw new HttpError(400, `lines[${index}].stripePriceId required`);
    if (!payload.periodStart) throw new HttpError(400, `lines[${index}].periodStart required`);
    if (!payload.periodEnd) throw new HttpError(400, `lines[${index}].periodEnd required`);

    return payload;
  });
}

function readJsonObject(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new HttpError(400, "Invalid JSON body.");
    }
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }

  throw new HttpError(400, "Expected JSON body.");
}

function queryValue(value: HeaderValue): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function header(headers: Record<string, HeaderValue>, name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return queryValue(value);
}

function bearerToken(auth: string): string {
  return auth.replace(/^Bearer\s+/i, "").trim();
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export default withSentryApiRoute(handler);
