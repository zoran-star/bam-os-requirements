import { withSentryApiRoute } from "../_sentry.js";
import { HttpError, sendError } from "./_errors.js";
import { getParentReadContext, type ParentReadContext } from "./_parent-context.js";
import { eq, rpc, sb } from "./_supabase.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

const THREAD_SELECT =
  "id,tenant_id,customer_profile_id,kind,status,subject_student_id,last_message_at,last_message_preview,last_message_author_type,created_at,updated_at";
const MESSAGE_SELECT =
  "id,thread_id,tenant_id,author_type,author_customer_profile_id,author_auth_user_id,author_display_name,message_type,body,client_message_id,edited_at,deleted_at,created_at,updated_at";
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const MAX_BODY_LENGTH = 4_000;
const THROTTLE_LIMIT = 15;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ThreadKind = "GENERAL";
type ThreadStatus = "OPEN" | "CLOSED";
type AuthorType = "PARENT" | "STAFF" | "SYSTEM";
type MessageType = "TEXT" | "ANNOUNCEMENT" | "SYSTEM";

type CustomerMessageThreadRow = {
  id: string;
  tenant_id: string;
  customer_profile_id: string;
  kind: ThreadKind;
  status: ThreadStatus;
  subject_student_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_author_type: AuthorType | null;
  created_at: string;
  updated_at: string;
};

type CustomerThreadMessageRow = {
  id: string;
  thread_id: string;
  tenant_id: string;
  author_type: AuthorType;
  author_customer_profile_id: string | null;
  author_auth_user_id: string | null;
  author_display_name: string | null;
  message_type: MessageType;
  body: string | null;
  client_message_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type CustomerThreadReadRow = {
  thread_id: string;
  last_read_at: string;
};

type ParentMessageThreadDto = {
  id: string;
  tenant_id: string;
  customer_profile_id: string;
  kind: ThreadKind;
  status: ThreadStatus;
  subject_student_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_author_type: AuthorType | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
};

type ParentMessageDto = {
  id: string;
  thread_id: string;
  author_type: AuthorType;
  author_display_name: string | null;
  message_type: MessageType;
  body: string | null;
  client_message_id: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

type SendRpcResult = {
  message: CustomerThreadMessageRow;
  thread: CustomerMessageThreadRow;
};

type MessagePage = {
  messages: CustomerThreadMessageRow[];
  next_before: string | null;
};

class TenantRequiredError extends Error {
  constructor() {
    super("Multiple academies on this account. Pass tenant_id.");
    this.name = "TenantRequiredError";
  }
}

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  try {
    const action = queryValue(req.query?.action);

    if (action === "read") {
      if (req.method !== "POST") return methodNotAllowed(res, "POST");
      return await markRead(req, res);
    }

    if (action === "unread-count") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return await getUnreadCount(req, res);
    }

    if (action) {
      throw new HttpError(404, "Not found.");
    }

    if (req.method === "GET") return await getMessages(req, res);
    if (req.method === "POST") return await sendMessage(req, res);
    return methodNotAllowed(res, "GET, POST");
  } catch (error) {
    if (error instanceof TenantRequiredError) {
      return res.status(422).json({
        error: error.message,
        code: "TENANT_REQUIRED",
      });
    }
    return sendError(res, error);
  }
}

async function getMessages(req: ParentApiRequest, res: ParentApiResponse) {
  const context = await getParentReadContext(req);
  const tenantId = resolveTenantId(context, queryValue(req.query?.tenant_id));
  const threadId = optionalUuidQuery(queryValue(req.query?.thread_id), "thread_id");
  const limit = readLimit(queryValue(req.query?.limit), DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT);
  const before = queryValue(req.query?.before);
  const thread = threadId
    ? await getParentThreadById(tenantId, context.profile.id, threadId)
    : await getDefaultParentThread(tenantId, context.profile.id);

  if (!thread) {
    return res.status(200).json({
      thread: null,
      messages: [],
      page: { next_before: null },
      unread_count: 0,
    });
  }

  const [page, unreadCount] = await Promise.all([
    readMessagePage(thread.id, limit, before),
    getParentUnreadCount(thread.id, context.user.id),
  ]);

  return res.status(200).json({
    thread: mapParentThread(thread, unreadCount),
    messages: page.messages.map(mapParentMessage),
    page: { next_before: page.next_before },
    unread_count: unreadCount,
  });
}

async function sendMessage(req: ParentApiRequest, res: ParentApiResponse) {
  const context = await getParentReadContext(req);
  const body = readJsonObject(req.body);
  const tenantId = resolveTenantId(context, optionalString(body.tenant_id));
  const request = readSendRequest(body);

  if (request.thread_id) {
    await requireParentThread(tenantId, context.profile.id, request.thread_id);
  }

  await enforceSendThrottle(context.profile.id);

  const result = await sendThreadMessage({
    p_tenant_id: tenantId,
    p_customer_profile_id: context.profile.id,
    p_thread_id: request.thread_id,
    p_author_type: "PARENT",
    p_author_auth_user_id: context.user.id,
    p_author_display_name: `${context.profile.first_name} ${context.profile.last_name}`.trim(),
    p_body: request.body,
    p_client_message_id: request.client_message_id,
    p_message_type: "TEXT",
  });

  return res.status(200).json({
    thread: mapParentThread(result.thread, 0),
    message: mapParentMessage(result.message),
  });
}

async function markRead(req: ParentApiRequest, res: ParentApiResponse) {
  const context = await getParentReadContext(req);
  const body = readJsonObject(req.body);
  const tenantId = resolveTenantId(context, optionalString(body.tenant_id));
  const threadId = requiredUuidString(body.thread_id, "thread_id");
  const thread = await requireParentThread(tenantId, context.profile.id, threadId);
  const lastReadAt = thread.last_message_at ?? new Date().toISOString();

  await sb(
    "customer_thread_reads?on_conflict=thread_id,auth_user_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        thread_id: thread.id,
        tenant_id: tenantId,
        reader_type: "PARENT",
        customer_profile_id: context.profile.id,
        auth_user_id: context.user.id,
        last_read_at: lastReadAt,
        updated_at: new Date().toISOString(),
      }),
    },
  );

  return res.status(200).json({
    unread_count: await getParentUnreadCount(thread.id, context.user.id),
  });
}

async function getUnreadCount(req: ParentApiRequest, res: ParentApiResponse) {
  const context = await getParentReadContext(req);
  const tenantId = resolveTenantId(context, queryValue(req.query?.tenant_id));
  const thread = await getDefaultParentThread(tenantId, context.profile.id);

  return res.status(200).json({
    unread_count: thread ? await getParentUnreadCount(thread.id, context.user.id) : 0,
  });
}

function resolveTenantId(context: ParentReadContext, providedTenantId: string | null): string {
  if (context.academyIds.length === 0) {
    throw new HttpError(403, "No academy membership found.");
  }

  if (providedTenantId) {
    if (!context.academyIds.includes(providedTenantId)) {
      throw new HttpError(403, "Academy not found for this account.");
    }
    return providedTenantId;
  }

  if (context.academyIds.length === 1) {
    return context.academyIds[0]!;
  }

  throw new TenantRequiredError();
}

async function getDefaultParentThread(
  tenantId: string,
  profileId: string,
): Promise<CustomerMessageThreadRow | null> {
  const rows = await sb<CustomerMessageThreadRow[]>(
    "customer_message_threads" +
      `?tenant_id=eq.${eq(tenantId)}` +
      `&customer_profile_id=eq.${eq(profileId)}` +
      "&kind=eq.GENERAL" +
      `&select=${THREAD_SELECT}` +
      "&limit=1",
  );
  return firstRow(rows);
}

async function getParentThreadById(
  tenantId: string,
  profileId: string,
  threadId: string,
): Promise<CustomerMessageThreadRow | null> {
  const rows = await sb<CustomerMessageThreadRow[]>(
    "customer_message_threads" +
      `?id=eq.${eq(threadId)}` +
      `&tenant_id=eq.${eq(tenantId)}` +
      `&customer_profile_id=eq.${eq(profileId)}` +
      `&select=${THREAD_SELECT}` +
      "&limit=1",
  );
  return firstRow(rows);
}

async function requireParentThread(
  tenantId: string,
  profileId: string,
  threadId: string,
): Promise<CustomerMessageThreadRow> {
  const thread = await getParentThreadById(tenantId, profileId, threadId);
  if (!thread) throw new HttpError(404, "Thread not found.");
  return thread;
}

async function readMessagePage(
  threadId: string,
  limit: number,
  before: string | null,
): Promise<MessagePage> {
  const filters = [
    `thread_id=eq.${eq(threadId)}`,
    `select=${MESSAGE_SELECT}`,
    "order=created_at.desc,id.desc",
    `limit=${limit}`,
  ];

  if (before) {
    filters.push(keysetBeforeFilter(before));
  }

  const rows = await sb<CustomerThreadMessageRow[]>(
    `customer_thread_messages?${filters.join("&")}`,
  );
  const pageRows = Array.isArray(rows) ? rows : [];
  const oldestRow = pageRows.at(-1) ?? null;

  return {
    messages: [...pageRows].reverse(),
    next_before: pageRows.length === limit && oldestRow ? encodeCursor(oldestRow.created_at, oldestRow.id) : null,
  };
}

async function getParentUnreadCount(threadId: string, authUserId: string): Promise<number> {
  const reads = await sb<CustomerThreadReadRow[]>(
    "customer_thread_reads" +
      `?thread_id=eq.${eq(threadId)}` +
      `&auth_user_id=eq.${eq(authUserId)}` +
      "&select=thread_id,last_read_at" +
      "&limit=1",
  );
  const read = firstRow(reads);
  const filters = [
    `thread_id=eq.${eq(threadId)}`,
    "author_type=in.(STAFF,SYSTEM)",
    "deleted_at=is.null",
    "select=id",
    "limit=1000",
  ];

  if (read) {
    filters.push(`created_at=gt.${eq(read.last_read_at)}`);
  }

  const rows = await sb<Array<{ id: string }>>(`customer_thread_messages?${filters.join("&")}`);
  return Array.isArray(rows) ? rows.length : 0;
}

async function enforceSendThrottle(profileId: string): Promise<void> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const rows = await sb<Array<{ id: string }>>(
    "customer_thread_messages" +
      `?author_customer_profile_id=eq.${eq(profileId)}` +
      `&created_at=gt.${eq(since)}` +
      "&select=id" +
      `&limit=${THROTTLE_LIMIT}`,
  );

  if (Array.isArray(rows) && rows.length >= THROTTLE_LIMIT) {
    throw new HttpError(429, "You are sending messages too quickly. Please wait a moment.");
  }
}

async function sendThreadMessage(args: Record<string, unknown>): Promise<SendRpcResult> {
  const rows = await rpc<SendRpcResult[]>("customer_send_thread_message", args);
  const result = firstRow(rows);
  if (!result?.thread || !result.message) {
    throw new HttpError(502, "Message send failed.");
  }
  return result;
}

function readSendRequest(body: Record<string, unknown>): {
  thread_id: string | null;
  client_message_id: string;
  body: string;
} {
  return {
    thread_id: optionalUuidString(body.thread_id, "thread_id"),
    client_message_id: requiredTrimmedString(body.client_message_id, "client_message_id"),
    body: requiredMessageBody(body.body),
  };
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

function requiredTrimmedString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(422, `${fieldName} is required.`);
  }
  return value.trim();
}

function requiredMessageBody(value: unknown): string {
  const body = requiredTrimmedString(value, "Message body");
  if (body.length > MAX_BODY_LENGTH) {
    throw new HttpError(422, "Message body must be 4000 characters or fewer.");
  }
  return body;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function optionalUuidQuery(value: string | null, fieldName: string): string | null {
  if (!value) return null;
  if (!UUID_PATTERN.test(value)) throw new HttpError(400, `Invalid ${fieldName}.`);
  return value;
}

function optionalUuidString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(422, `Invalid ${fieldName}.`);
  const trimmed = value.trim();
  if (!UUID_PATTERN.test(trimmed)) throw new HttpError(422, `Invalid ${fieldName}.`);
  return trimmed;
}

function requiredUuidString(value: unknown, fieldName: string): string {
  const uuid = optionalUuidString(value, fieldName);
  if (!uuid) throw new HttpError(422, `${fieldName} is required.`);
  return uuid;
}

function readLimit(value: string | null, defaultLimit: number, maxLimit: number): number {
  if (!value) return defaultLimit;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new HttpError(400, "Invalid limit.");
  }
  return Math.min(limit, maxLimit);
}

function keysetBeforeFilter(cursor: string): string {
  const decoded = decodeCursor(cursor);
  return `or=(created_at.lt.${eq(decoded.created_at)},and(created_at.eq.${eq(decoded.created_at)},id.lt.${eq(decoded.id)}))`;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64");
}

function decodeCursor(cursor: string): { created_at: string; id: string } {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const separator = decoded.indexOf("|");
    const createdAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (separator <= 0 || Number.isNaN(Date.parse(createdAt)) || !UUID_PATTERN.test(id)) {
      throw new Error("invalid cursor");
    }
    return { created_at: createdAt, id };
  } catch {
    throw new HttpError(400, "Invalid before cursor.");
  }
}

function mapParentThread(
  row: CustomerMessageThreadRow,
  unreadCount: number,
): ParentMessageThreadDto {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    customer_profile_id: row.customer_profile_id,
    kind: row.kind,
    status: row.status,
    subject_student_id: row.subject_student_id,
    last_message_at: row.last_message_at,
    last_message_preview: row.last_message_preview,
    last_message_author_type: row.last_message_author_type,
    unread_count: unreadCount,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapParentMessage(row: CustomerThreadMessageRow): ParentMessageDto {
  return {
    id: row.id,
    thread_id: row.thread_id,
    author_type: row.author_type,
    author_display_name: row.author_display_name,
    message_type: row.message_type,
    body: row.body,
    client_message_id: row.client_message_id,
    created_at: row.created_at,
    edited_at: row.edited_at,
    deleted_at: row.deleted_at,
  };
}

function firstRow<T>(rows: T[] | null | undefined): T | null {
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

function queryValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function methodNotAllowed(res: ParentApiResponse, allow: string) {
  res.setHeader("Allow", allow);
  return res.status(405).json({ error: "method not allowed" });
}

export default withSentryApiRoute(handler);
