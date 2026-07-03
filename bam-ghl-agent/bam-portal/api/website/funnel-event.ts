// Public beacon - website funnel analytics (free trial / enroll pages).
//
//   POST /api/website/funnel-event
//   body { client_id, funnel, step, session_id?, url?, referrer?, utm?, meta? }
//
// Fire-and-forget from the funnel pages via navigator.sendBeacon. CORS-gated
// by clients.allowed_domains like the other api/website/* endpoints. The
// offer is resolved server-side from the funnel's entry point, so events are
// per-offer automatically. Rows land in funnel_events (staff-read RLS).

import { withSentryApiRoute } from "../_sentry.js";
import { createRuntimeSupabaseClient } from "../_runtime/supabase.js";
import type { RuntimeApiRequest, RuntimeApiResponse } from "../runtime/_types.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);
let originsCache: { set: Set<string> | null; at: number } = { set: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

const STEPS = new Set([
  "page_view", "form_started", "form_completed",
  "calendar_viewed", "slot_picked", "confirmed",
  "plan_viewed", "plan_picked", "payment_started", "paid",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cache the funnel-key -> offer lookup briefly; every page view hits this.
let offerCache: Map<string, string | null> = new Map();
let offerCacheAt = 0;
const OFFER_TTL_MS = 5 * 60_000;

async function sbReq<T = unknown>(path: string): Promise<T> {
  const response = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function getAllowedOrigins(): Promise<Set<string>> {
  if (originsCache.set && Date.now() - originsCache.at < ORIGINS_TTL_MS) return originsCache.set;
  const set = new Set(DEV_ORIGINS);
  const rows = await sbReq<Array<{ allowed_domains: string[] | null }>>(
    "clients?select=allowed_domains&allowed_domains=not.is.null",
  );
  for (const row of rows || []) {
    for (const domain of row.allowed_domains || []) {
      set.add(`https://${domain}`);
      set.add(`https://www.${domain}`);
    }
  }
  originsCache = { set, at: Date.now() };
  return set;
}

async function offerForFunnel(clientId: string, funnel: string): Promise<string | null> {
  if (Date.now() - offerCacheAt > OFFER_TTL_MS) { offerCache = new Map(); offerCacheAt = Date.now(); }
  const cacheKey = `${clientId}:${funnel}`;
  if (offerCache.has(cacheKey)) return offerCache.get(cacheKey) ?? null;
  let offerId: string | null = null;
  try {
    const rows = await sbReq<Array<{ offer_id: string | null }>>(
      `entry_points?client_id=eq.${encodeURIComponent(clientId)}&key=eq.${encodeURIComponent(funnel)}&select=offer_id&limit=1`,
    );
    offerId = rows?.[0]?.offer_id ?? null;
  } catch { /* lineage is best-effort */ }
  offerCache.set(cacheKey, offerId);
  return offerId;
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().slice(0, max);
  return s || null;
}

function cleanObject(value: unknown, maxJson: number): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const json = JSON.stringify(value);
  if (json.length > maxJson) return null;
  return value as Record<string, unknown>;
}

async function handler(req: RuntimeApiRequest, res: RuntimeApiResponse) {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  let allowed = false;
  try { allowed = (await getAllowedOrigins()).has(origin); } catch { /* 403 below */ }
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  try {
    // sendBeacon posts text/plain, so the body may arrive as an unparsed string.
    const raw = req.body;
    const body = (typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {}) as Record<string, unknown>;

    const clientId = cleanString(body.client_id, 40);
    const funnel = cleanString(body.funnel, 60);
    const step = cleanString(body.step, 30);
    if (!clientId || !UUID_RE.test(clientId)) return res.status(400).json({ error: "client_id required" });
    if (!funnel) return res.status(400).json({ error: "funnel required" });
    if (!step || !STEPS.has(step)) return res.status(400).json({ error: "unknown step" });

    const supabase = createRuntimeSupabaseClient();
    const { error } = await supabase.from("funnel_events").insert({
      client_id: clientId,
      offer_id: await offerForFunnel(clientId, funnel),
      funnel,
      step,
      session_id: cleanString(body.session_id, 64),
      url: cleanString(body.url, 300),
      referrer: cleanString(body.referrer, 300),
      utm: cleanObject(body.utm, 2000),
      meta: cleanObject(body.meta, 2000),
    });
    if (error) throw new Error(error.message);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[funnel-event]", e instanceof Error ? e.message : e);
    return res.status(200).json({ ok: false }); // beacons never retry; stay quiet
  }
}

export default withSentryApiRoute(handler);
