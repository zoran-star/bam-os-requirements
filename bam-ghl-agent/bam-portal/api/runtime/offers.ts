import { withSentryApiRoute } from "../_sentry.js";
import { createRuntimeSupabaseClient } from "../_runtime/supabase.js";
import { HttpError, sendError } from "./_errors.js";
import { getStaffContext } from "./_staff-context.js";
import type { HeaderValue, RuntimeApiRequest, RuntimeApiResponse } from "./_types.js";

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

let originsCache: { set: Set<string> | null; at: number } = { set: null, at: 0 };
const ORIGINS_TTL_MS = 60_000;

type JsonRecord = Record<string, unknown>;

type OfferRow = {
  id: string;
  client_id: string;
  title: string | null;
  type: string | null;
  status: string | null;
  data: JsonRecord | null;
};

type OfferOptionRow = {
  id: string;
  title: string;
  status: string;
  sort_order: number;
};

type OfferPriceRow = {
  id: string;
  offer_option_id: string;
  title: string;
  amount_cents: number;
  currency: string;
  billing_interval: string | null;
  source_offer_price_key: string | null;
  source_pricing_catalog_id: string | null;
  is_active: boolean;
  is_routable: boolean;
  sort_order: number;
};

type EntitlementTemplateRow = {
  offer_price_id: string;
  entitlement_kind: string;
  credits_per_period: number | null;
  credit_period: string | null;
  is_unlimited: boolean;
};

type PricingCatalogRow = {
  id: string;
  stripe_price_id: string | null;
  tier: string | null;
};

type IntakeField = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
};

async function sbReq<T = unknown>(path: string): Promise<T> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  const txt = await r.text();
  return (txt ? JSON.parse(txt) : null) as T;
}

async function getAllowedOrigins(): Promise<Set<string>> {
  if (originsCache.set && Date.now() - originsCache.at < ORIGINS_TTL_MS) return originsCache.set;
  const set = new Set(DEV_ORIGINS);
  const rows = await sbReq<Array<{ allowed_domains: string[] | null }>>(
    "clients?select=allowed_domains&allowed_domains=not.is.null",
  );
  for (const row of rows || []) {
    for (const d of row.allowed_domains || []) { set.add(`https://${d}`); set.add(`https://www.${d}`); }
  }
  originsCache = { set, at: Date.now() };
  return set;
}

const TRAINING_INTAKE_DEFAULTS = [
  "Parent name", "Phone", "Email", "Emergency contact name", "Emergency contact phone",
];

function fieldKey(label: string): string {
  return String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function inferField(label: string): IntakeField {
  const l = String(label).toLowerCase();
  const base = { key: fieldKey(label), label: String(label), type: "text", required: false };
  if (/\bemail\b/.test(l)) return { ...base, type: "email", placeholder: "you@email.com" };
  if (/phone|mobile|cell/.test(l)) return { ...base, type: "tel", placeholder: "(289) 000-0000" };
  if (/\b(dob|date of birth|birthday|birthdate)\b/.test(l)) return { ...base, type: "date" };
  if (/gender/.test(l)) return { ...base, type: "select", options: ["Boy", "Girl"] };
  if (/t-?shirt|jersey|shirt size/.test(l)) return { ...base, type: "select", options: ["YS", "YM", "YL", "AS", "AM", "AL", "AXL"] };
  if (/skill level|experience/.test(l)) return { ...base, type: "select", options: ["Beginner", "Intermediate", "Advanced"] };
  if (/relationship/.test(l)) return { ...base, type: "select", options: ["Parent", "Guardian", "Other"] };
  if (/grade/.test(l)) return { ...base, type: "text", placeholder: "e.g. Grade 7" };
  if (/medical|allergies|allergy|conditions|goals|notes|why|anything else/.test(l)) return { ...base, type: "textarea" };
  if (/address/.test(l)) return { ...base, type: "textarea", placeholder: "Street, city, postal code" };
  return base;
}

function buildIntakeFields(offer: OfferRow): IntakeField[] {
  const data = asRecord(offer.data);
  const onb = asRecord(data.onboarding);
  const selected = Array.isArray(onb.intake_form_fields) ? onb.intake_form_fields : [];
  const custom = Array.isArray(onb.intake_form_fields_custom) ? onb.intake_form_fields_custom : [];

  const labels: string[] = [];
  const seen = new Set<string>();
  const push = (label: unknown) => {
    const s = typeof label === "string" ? label.trim() : "";
    if (!s || /^add (custom|another)/i.test(s)) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    labels.push(s);
  };

  TRAINING_INTAKE_DEFAULTS.forEach(push);
  selected.forEach(push);
  custom.forEach((field) => {
    if (typeof field === "string") {
      push(field);
      return;
    }
    push(asRecord(field).name);
  });

  return labels.map((label, index) => {
    const field = inferField(label);
    if (/^(parent name|email|phone)$/i.test(label)) field.required = true;
    return { ...field, key: `${field.key}__${index}` };
  });
}

async function fileUrl(offerId: string, sections: string[]): Promise<string | null> {
  const list = sections.map((section) => `"${section}"`).join(",");
  const files = await sbReq<Array<{ storage_path: string | null }>>(
    `offer_files?offer_id=eq.${offerId}&section=in.(${list})&select=storage_path&order=created_at.desc&limit=1`,
  );
  const first = Array.isArray(files) ? files[0] : undefined;
  const path = first?.storage_path;
  return path ? `${SB_URL}/storage/v1/object/public/offers/${path}` : null;
}

async function handler(req: RuntimeApiRequest, res: RuntimeApiResponse) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "Supabase not configured" });
  const origin = stringHeader(req.headers.origin);
  let allowed = false;
  try { allowed = (await getAllowedOrigins()).has(origin); } catch { /* 403 below */ }
  if (allowed) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  if (!allowed) return res.status(403).json({ error: "Forbidden" });

  try {
    const offerId = queryValue(req.query?.offer_id);
    if (!offerId) throw new HttpError(400, "offer_id required");

    const includeArchived = queryValue(req.query?.include_archived) === "1";
    if (includeArchived) {
      await requireStaffForArchivedRead(req);
    }

    const response = await getRuntimeOffer(offerId, includeArchived);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(response);
  } catch (error) {
    return sendError(res, error);
  }
}

async function requireStaffForArchivedRead(req: RuntimeApiRequest): Promise<void> {
  try {
    await getStaffContext(req);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      throw new HttpError(403, "staff only", error.detail ?? error.message);
    }
    throw error;
  }
}

async function getRuntimeOffer(offerId: string, includeArchived: boolean) {
  const supabase = createRuntimeSupabaseClient();
  const { data: offerData, error: offerError } = await supabase
    .from("offers")
    .select("id,client_id,title,type,status,data")
    .eq("id", offerId)
    .limit(1)
    .maybeSingle();

  if (offerError) throw supabaseHttpError("offers", offerError.message);
  const offer = offerData ? (offerData as OfferRow) : null;
  if (!offer) throw new HttpError(404, "offer not found");

  const options = await getOfferOptions(offer, includeArchived);
  const prices = await getOfferPrices(offer.client_id, options.map((option) => option.id), includeArchived);
  const templates = await getActiveTemplates(offer.client_id, prices.map((price) => price.id));
  const catalog = await getCatalogRows(offer.client_id, prices.map((price) => price.source_pricing_catalog_id));
  const [agreementUrl, welcomeVideo] = await Promise.all([
    fileUrl(offer.id, ["onboarding:agreement", "agreement"]),
    fileUrl(offer.id, ["sales:welcome_video", "onboarding:welcome_video", "welcome_video"]),
  ]);

  return {
    offer: {
      id: offer.id,
      client_id: offer.client_id,
      title: offer.title || "Training",
      copy: buildOfferCopy(offer, { agreementUrl, welcomeVideo }),
    },
    options: buildOptions(options, prices, templates, catalog),
  };
}

async function getOfferOptions(offer: OfferRow, includeArchived: boolean): Promise<OfferOptionRow[]> {
  const supabase = createRuntimeSupabaseClient();
  let query = supabase
    .from("offer_options")
    .select("id,title,status,sort_order")
    .eq("tenant_id", offer.client_id)
    .eq("source_offer_id", offer.id)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (!includeArchived) query = query.eq("status", "ACTIVE");

  const { data, error } = await query;
  if (error) throw supabaseHttpError("offer_options", error.message);
  return rows<OfferOptionRow>(data);
}

async function getOfferPrices(
  clientId: string,
  optionIds: string[],
  includeArchived: boolean,
): Promise<OfferPriceRow[]> {
  if (optionIds.length === 0) return [];

  const supabase = createRuntimeSupabaseClient();
  let query = supabase
    .from("offer_prices")
    .select([
      "id",
      "offer_option_id",
      "title",
      "amount_cents",
      "currency",
      "billing_interval",
      "source_offer_price_key",
      "source_pricing_catalog_id",
      "is_active",
      "is_routable",
      "sort_order",
    ].join(","))
    .eq("tenant_id", clientId)
    .in("offer_option_id", optionIds)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (!includeArchived) {
    query = query.eq("is_active", true).eq("is_routable", true);
  }

  const { data, error } = await query;
  if (error) throw supabaseHttpError("offer_prices", error.message);
  return rows<OfferPriceRow>(data);
}

async function getActiveTemplates(clientId: string, priceIds: string[]): Promise<Map<string, EntitlementTemplateRow>> {
  if (priceIds.length === 0) return new Map();

  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("entitlement_templates")
    .select("offer_price_id,entitlement_kind,credits_per_period,credit_period,is_unlimited")
    .eq("tenant_id", clientId)
    .eq("status", "ACTIVE")
    .in("offer_price_id", priceIds);

  if (error) throw supabaseHttpError("entitlement_templates", error.message);

  const byPrice = new Map<string, EntitlementTemplateRow>();
  for (const row of rows<EntitlementTemplateRow>(data)) {
    if (!byPrice.has(row.offer_price_id)) byPrice.set(row.offer_price_id, row);
  }
  return byPrice;
}

async function getCatalogRows(clientId: string, rawCatalogIds: Array<string | null>): Promise<Map<string, PricingCatalogRow>> {
  const catalogIds = [...new Set(rawCatalogIds.filter((id): id is string => Boolean(id)))];
  if (catalogIds.length === 0) return new Map();

  const supabase = createRuntimeSupabaseClient();
  const { data, error } = await supabase
    .from("pricing_catalog")
    .select("id,stripe_price_id,tier")
    .eq("client_id", clientId)
    .in("id", catalogIds);

  if (error) throw supabaseHttpError("pricing_catalog", error.message);

  const byId = new Map<string, PricingCatalogRow>();
  for (const row of rows<PricingCatalogRow>(data)) {
    byId.set(row.id, row);
  }
  return byId;
}

function buildOptions(
  options: OfferOptionRow[],
  prices: OfferPriceRow[],
  templates: Map<string, EntitlementTemplateRow>,
  catalogRows: Map<string, PricingCatalogRow>,
) {
  const pricesByOption = new Map<string, ReturnType<typeof priceResponse>[]>();
  for (const option of options) {
    pricesByOption.set(option.id, []);
  }

  for (const price of prices) {
    const group = pricesByOption.get(price.offer_option_id);
    if (!group) continue;
    group.push(priceResponse(price, templates.get(price.id), price.source_pricing_catalog_id
      ? catalogRows.get(price.source_pricing_catalog_id)
      : undefined));
  }

  return options.map((option) => ({
    id: option.id,
    title: option.title,
    status: option.status,
    prices: pricesByOption.get(option.id) ?? [],
  }));
}

function priceResponse(
  price: OfferPriceRow,
  template: EntitlementTemplateRow | undefined,
  catalog: PricingCatalogRow | undefined,
) {
  return {
    id: price.id,
    title: price.title,
    amount_cents: price.amount_cents,
    currency: price.currency,
    billing_interval: price.billing_interval,
    is_active: price.is_active,
    is_routable: price.is_routable,
    source_offer_price_key: price.source_offer_price_key,
    entitlement: {
      kind: template?.entitlement_kind ?? null,
      credits_per_period: template?.credits_per_period ?? null,
      credit_period: template?.credit_period ?? null,
      is_unlimited: template?.is_unlimited ?? false,
    },
    catalog: {
      stripe_price_id: catalog?.stripe_price_id ?? null,
      tier: catalog?.tier ?? null,
    },
  };
}

function buildOfferCopy(
  offer: OfferRow,
  media: { agreementUrl: string | null; welcomeVideo: string | null },
): JsonRecord {
  const data = asRecord(offer.data);
  const generalInfo = asRecord(data.general_info);
  const sales = asRecord(data.sales);
  const value = asRecord(data.value);

  return compactRecord({
    title: offer.title || "Training",
    type: offer.type,
    description: displayValue(generalInfo.description),
    sales_path: displayValue(sales.sales_path),
    trial_duration_price: displayValue(sales.trial_duration_price),
    gender: displayArray(generalInfo.gender),
    skill_level: displayValue(generalInfo.skill_level),
    location: displayValue(generalInfo.location),
    program_structure: displayValue(value.program_structure),
    what_makes_different: displayValue(value.what_makes_different),
    intake_fields: buildIntakeFields(offer),
    media: compactRecord({
      agreement_url: media.agreementUrl,
      welcome_video: media.welcomeVideo,
    }),
  });
}

function compactRecord(record: JsonRecord): JsonRecord {
  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isPlainRecord(value) && Object.keys(value).length === 0) continue;
    out[key] = value;
  }
  return out;
}

function asRecord(value: unknown): JsonRecord {
  return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function displayValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function displayArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length > 0 ? strings : null;
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function supabaseHttpError(table: string, message: string): HttpError {
  return new HttpError(502, "Supabase request failed", { table, message });
}

function queryValue(value: HeaderValue): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function stringHeader(value: HeaderValue): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default withSentryApiRoute(handler);
