import { withSentryApiRoute } from "../_sentry.js";
import { HttpError, sendError } from "../parent/_errors.js";
import { eq, inList, rpc, sb } from "../parent/_supabase.js";
import type { ParentApiRequest, ParentApiResponse } from "../parent/_types.js";
import { getClientUserContext, type ClientUserContext } from "./_client-context.js";

const THREAD_SELECT =
  "id,tenant_id,customer_profile_id,kind,status,assigned_auth_user_id,subject_student_id,last_message_at,last_message_preview,last_message_author_type,created_at,updated_at,closed_at";
const MESSAGE_SELECT =
  "id,thread_id,tenant_id,author_type,author_customer_profile_id,author_auth_user_id,author_display_name,message_type,body,client_message_id,edited_at,deleted_at,created_at,updated_at";
const PROFILE_SELECT = "id,first_name,last_name,email";
const DEFAULT_THREAD_LIMIT = 30;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_BODY_LENGTH = 4_000;
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
  assigned_auth_user_id: string | null;
  subject_student_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_author_type: AuthorType | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
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

type CustomerProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
};

type CustomerThreadReadRow = {
  thread_id: string;
  last_read_at: string;
};

type ParentMessageDto = {
  id: string;
  thread_id: string;
  author_type: AuthorType;
  author_auth_user_id: string | null;
  author_display_name: string | null;
  message_type: MessageType;
  body: string | null;
  client_message_id: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

type ClientThreadDto = {
  id: string;
  tenant_id: string;
  customer_profile_id: string;
  kind: ThreadKind;
  status: ThreadStatus;
  assigned_auth_user_id: string | null;
  subject_student_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_author_type: AuthorType | null;
  unread_count: number;
  parent: CustomerProfileRow | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

type SendRpcResult = {
  message: CustomerThreadMessageRow;
  thread: CustomerMessageThreadRow;
};

type MessagePage = {
  messages: CustomerThreadMessageRow[];
  next_before: string | null;
};

async function handler(req: ParentApiRequest, res: ParentApiResponse) {
  try {
    const action = queryValue(req.query?.action);
    const threadId = optionalUuidQuery(queryValue(req.query?.thread_id), "thread_id");

    if (!action && !threadId) {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return await listThreads(req, res);
    }

    if (action === "unread-count") {
      if (req.method !== "GET") return methodNotAllowed(res, "GET");
      return await getUnreadCount(req, res);
    }

    if (action === "messages") {
      if (!threadId) throw new HttpError(404, "Thread not found.");
      if (req.method === "GET") return await getMessages(req, res, threadId);
      if (req.method === "POST") return await sendStaffMessage(req, res, threadId);
      return methodNotAllowed(res, "GET, POST");
    }

    if (action === "read") {
      if (!threadId) throw new HttpError(404, "Thread not found.");
      if (req.method !== "POST") return methodNotAllowed(res, "POST");
      return await markStaffRead(req, res, threadId);
    }

    if (!action && threadId) {
      if (req.method !== "PATCH") return methodNotAllowed(res, "PATCH");
      return await patchThread(req, res, threadId);
    }

    throw new HttpError(404, "Not found.");
  } catch (error) {
    return sendError(res, error);
  }
}

async function listThreads(req: ParentApiRequest, res: ParentApiResponse) {
  const context = await getClientUserContext(req);
  const limit = readLimit(queryValue(req.query?.limit), DEFAULT_THREAD_LIMIT, MAX_LIMIT);
  const assigned = queryValue(req.query?.assigned) ?? "all";
  const status = optionalStatus(queryValue(req.query?.status));
  const needsReply = queryValue(req.query?.needs_reply) === "true";
  const q = queryValue(req.query?.q);
  const cursor = queryValue(req.query?.cursor);
  const filters = [
    `tenant_id=eq.${eq(context.tenantId)}`,
    `select=${THREAD_SELECT}`,
    "order=last_message_at.desc.nullslast,id.desc",
    `limit=${limit}`,
  ];

  if (assigned === "me") {
    filters.push(`assigned_auth_user_id=eq.${eq(context.user.id)}`);
  } else if (assigned === "unassigned") {
    filters.push("assigned_auth_user_id=is.null");
  } else if (assigned !== "all") {
    throw new HttpError(422, "Invalid assigned filter.");
  }

  if (status) {
    filters.push(`status=eq.${status}`);
  }

  if (needsReply) {
    filters.push("status=eq.OPEN", "last_message_author_type=eq.PARENT");
  }

  if (q) {
    filters.push(`last_message_preview=ilike.${encodeURIComponent(`*${q}*`)}`);
  }

  if (cursor) {
    filters.push(threadCursorFilter(cursor));
  }

  const rows = await sb<CustomerMessageThreadRow[]>(
    `customer_message_threads?${filters.join("&")}`,
  );
  const threads = Array.isArray(rows) ? rows : [];
  const lastThread = threads.at(-1) ?? null;

  if (threads.length === 0) {
    return res.status(200).json({ threads: [], page: { next_cursor: null } });
  }

  const [parents, unreadCounts] = await Promise.all([
    getParentProfiles(threads.map((thread) => thread.customer_profile_id)),
    getStaffUnreadCounts(threads.map((thread) => thread.id), context.user.id),
  ]);

  return res.status(200).json({
    threads: threads.map((thread) =>
      mapClientThread(thread, parents.get(thread.customer_profile_id) ?? null, unreadCounts.get(thread.id) ?? 0),
    ),
    page: {
      next_cursor:
        threads.length === limit && lastThread?.last_message_at
          ? encodeCursor(lastThread.last_message_at, lastThread.id)
          : null,
    },
  });
}

async function getMessages(
  req: ParentApiRequest,
  res: ParentApiResponse,
  threadId: string,
) {
  const context = await getClientUserContext(req);
  await requireClientThread(context.tenantId, threadId);
  const limit = readLimit(queryValue(req.query?.limit), DEFAULT_MESSAGE_LIMIT, MAX_LIMIT);
  const before = queryValue(req.query?.before);
  const page = await readMessagePage(threadId, limit, before);

  return res.status(200).json({
    messages: page.messages.map(mapClientMessage),
    page: { next_before: page.next_before },
  });
}

async function sendStaffMessage(
  req: ParentApiRequest,
  res: ParentApiResponse,
  threadId: string,
) {
  const context = await getClientUserContext(req);
  await requireClientThread(context.tenantId, threadId);
  const body = readJsonObject(req.body);
  const request = readSendRequest(body);
  const result = await sendThreadMessage({
    p_tenant_id: context.tenantId,
    p_customer_profile_id: null,
    p_thread_id: threadId,
    p_author_type: "STAFF",
    p_author_auth_user_id: context.user.id,
    p_author_display_name: context.clientUser.name,
    p_body: request.body,
    p_client_message_id: request.client_message_id,
    p_message_type: "TEXT",
  });

  return res.status(200).json({
    thread: mapClientThread(result.thread, null, 0),
    message: mapClientMessage(result.message),
  });
}

async function markStaffRead(
  req: ParentApiRequest,
  res: ParentApiResponse,
  threadId: string,
) {
  const context = await getClientUserContext(req);
  const thread = await requireClientThread(context.tenantId, threadId);
  const now = new Date().toISOString();

  await sb(
    "customer_thread_reads?on_conflict=thread_id,auth_user_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        thread_id: thread.id,
        tenant_id: context.tenantId,
        reader_type: "STAFF",
        customer_profile_id: null,
        auth_user_id: context.user.id,
        last_read_at: now,
        updated_at: now,
      }),
    },
  );

  return res.status(200).json({ unread_count: 0 });
}

async function patchThread(
  req: ParentApiRequest,
  res: ParentApiResponse,
  threadId: string,
) {
  const context = await getClientUserContext(req);
  const body = readJsonObject(req.body);
  const patch = readThreadPatch(body);
  const rows = await sb<CustomerMessageThreadRow[]>(
    "customer_message_threads" +
      `?id=eq.${eq(threadId)}` +
      `&tenant_id=eq.${eq(context.tenantId)}` +
      `&select=${THREAD_SELECT}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    },
  );
  const thread = firstRow(rows);
  if (!thread) throw new HttpError(404, "Thread not found.");

  return res.status(200).json(mapClientThread(thread, null, 0));
}

async function getUnreadCount(req: ParentApiRequest, res: ParentApiResponse) {
  const context = await getClientUserContext(req);
  return res.status(200).json({
    unread_count: await getTenantUnreadCount(context),
  });
}

async function requireClientThread(
  tenantId: string,
  threadId: string,
): Promise<CustomerMessageThreadRow> {
  const rows = await sb<CustomerMessageThreadRow[]>(
    "customer_message_threads" +
      `?id=eq.${eq(threadId)}` +
      `&tenant_id=eq.${eq(tenantId)}` +
      `&select=${THREAD_SELECT}` +
      "&limit=1",
  );
  const thread = firstRow(rows);
  if (!thread) throw new HttpError(404, "Thread not found.");
  return thread;
}

async function getParentProfiles(profileIds: string[]): Promise<Map<string, CustomerProfileRow>> {
  const ids = [...new Set(profileIds)];
  if (ids.length === 0) return new Map();

  const rows = await sb<CustomerProfileRow[]>(
    `customer_profiles?id=in.(${inList(ids)})&select=${PROFILE_SELECT}`,
  );
  return new Map((Array.isArray(rows) ? rows : []).map((profile) => [profile.id, profile]));
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
    filters.push(messageCursorFilter(before));
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

async function getStaffUnreadCounts(
  threadIds: string[],
  authUserId: string,
): Promise<Map<string, number>> {
  const counts = new Map(threadIds.map((threadId) => [threadId, 0]));
  if (threadIds.length === 0) return counts;

  const [reads, messages] = await Promise.all([
    sb<CustomerThreadReadRow[]>(
      `customer_thread_reads?thread_id=in.(${inList(threadIds)})` +
        `&auth_user_id=eq.${eq(authUserId)}` +
        "&select=thread_id,last_read_at" +
        "&limit=1000",
    ),
    sb<Array<{ id: string; thread_id: string; created_at: string }>>(
      `customer_thread_messages?thread_id=in.(${inList(threadIds)})` +
        "&author_type=eq.PARENT" +
        "&deleted_at=is.null" +
        "&select=id,thread_id,created_at" +
        "&limit=1000",
    ),
  ]);

  const readByThread = new Map(
    (Array.isArray(reads) ? reads : []).map((read) => [read.thread_id, read.last_read_at]),
  );

  for (const message of Array.isArray(messages) ? messages : []) {
    const lastReadAt = readByThread.get(message.thread_id);
    if (!lastReadAt || message.created_at > lastReadAt) {
      counts.set(message.thread_id, (counts.get(message.thread_id) ?? 0) + 1);
    }
  }

  return counts;
}

async function getTenantUnreadCount(context: ClientUserContext): Promise<number> {
  const [reads, messages] = await Promise.all([
    sb<CustomerThreadReadRow[]>(
      "customer_thread_reads" +
        `?tenant_id=eq.${eq(context.tenantId)}` +
        `&auth_user_id=eq.${eq(context.user.id)}` +
        "&select=thread_id,last_read_at" +
        "&limit=1000",
    ),
    sb<Array<{ id: string; thread_id: string; created_at: string }>>(
      "customer_thread_messages" +
        `?tenant_id=eq.${eq(context.tenantId)}` +
        "&author_type=eq.PARENT" +
        "&deleted_at=is.null" +
        "&select=id,thread_id,created_at" +
        "&limit=1000",
    ),
  ]);
  const readByThread = new Map(
    (Array.isArray(reads) ? reads : []).map((read) => [read.thread_id, read.last_read_at]),
  );

  return (Array.isArray(messages) ? messages : []).filter((message) => {
    const lastReadAt = readByThread.get(message.thread_id);
    return !lastReadAt || message.created_at > lastReadAt;
  }).length;
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
  client_message_id: string;
  body: string;
} {
  return {
    client_message_id: requiredTrimmedString(body.client_message_id, "client_message_id"),
    body: requiredMessageBody(body.body),
  };
}

function readThreadPatch(body: Record<string, unknown>): Record<string, string | null> {
  const patch: Record<string, string | null> = {};

  if (Object.prototype.hasOwnProperty.call(body, "assigned_auth_user_id")) {
    const assignedAuthUserId = body.assigned_auth_user_id;
    if (assignedAuthUserId === null) {
      patch.assigned_auth_user_id = null;
    } else if (typeof assignedAuthUserId === "string" && UUID_PATTERN.test(assignedAuthUserId.trim())) {
      patch.assigned_auth_user_id = assignedAuthUserId.trim();
    } else {
      throw new HttpError(422, "Invalid assigned_auth_user_id.");
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    const status = optionalStatus(typeof body.status === "string" ? body.status : null);
    if (!status) throw new HttpError(422, "Invalid status.");
    patch.status = status;
    patch.closed_at = status === "CLOSED" ? new Date().toISOString() : null;
  }

  if (Object.keys(patch).length === 0) {
    throw new HttpError(422, "No patch fields provided.");
  }

  return patch;
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

function optionalStatus(value: string | null): ThreadStatus | null {
  if (value === "OPEN" || value === "CLOSED") return value;
  if (!value) return null;
  throw new HttpError(422, "Invalid status.");
}

function readLimit(value: string | null, defaultLimit: number, maxLimit: number): number {
  if (!value) return defaultLimit;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new HttpError(400, "Invalid limit.");
  }
  return Math.min(limit, maxLimit);
}

function threadCursorFilter(cursor: string): string {
  const decoded = decodeCursor(cursor, "cursor");
  return `or=(last_message_at.lt.${eq(decoded.created_at)},and(last_message_at.eq.${eq(decoded.created_at)},id.lt.${eq(decoded.id)}))`;
}

function messageCursorFilter(cursor: string): string {
  const decoded = decodeCursor(cursor, "before cursor");
  return `or=(created_at.lt.${eq(decoded.created_at)},and(created_at.eq.${eq(decoded.created_at)},id.lt.${eq(decoded.id)}))`;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64");
}

function decodeCursor(cursor: string, label: string): { created_at: string; id: string } {
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
    throw new HttpError(400, `Invalid ${label}.`);
  }
}

function mapClientThread(
  row: CustomerMessageThreadRow,
  parent: CustomerProfileRow | null,
  unreadCount: number,
): ClientThreadDto {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    customer_profile_id: row.customer_profile_id,
    kind: row.kind,
    status: row.status,
    assigned_auth_user_id: row.assigned_auth_user_id,
    subject_student_id: row.subject_student_id,
    last_message_at: row.last_message_at,
    last_message_preview: row.last_message_preview,
    last_message_author_type: row.last_message_author_type,
    unread_count: unreadCount,
    parent,
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at,
  };
}

function mapClientMessage(row: CustomerThreadMessageRow): ParentMessageDto {
  return {
    id: row.id,
    thread_id: row.thread_id,
    author_type: row.author_type,
    author_auth_user_id: row.author_auth_user_id,
    author_display_name: row.author_display_name,
    message_type: row.message_type,
    body: row.body,
    client_message_id: row.client_message_id,
    created_at: row.created_at,
    edited_at: row.edited_at,
    deleted_at: row.deleted_at,
  };
}

function optionalUuidQuery(value: string | null, fieldName: string): string | null {
  if (!value) return null;
  if (!UUID_PATTERN.test(value)) throw new HttpError(400, `Invalid ${fieldName}.`);
  return value;
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
