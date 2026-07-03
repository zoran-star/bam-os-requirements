import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import clientMessagesHandler from "../client/parent-message-threads.js";
import parentMessagesHandler from "../parent/messages.js";
import type { ParentApiRequest, ParentApiResponse } from "../parent/_types.js";

const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
const runtimeTestSupabaseUrl = process.env.RUNTIME_TEST_SUPABASE_URL ?? LOCAL_SUPABASE_URL;
const runtimeTestServiceRoleKey = process.env.RUNTIME_TEST_SUPABASE_SERVICE_ROLE_KEY;
const runtimeTestAnonKey = process.env.RUNTIME_TEST_SUPABASE_ANON_KEY;

if (!runtimeTestServiceRoleKey) {
  throw new Error("RUNTIME_TEST_SUPABASE_SERVICE_ROLE_KEY is required. Run npm run test:runtime.");
}
if (!runtimeTestAnonKey) {
  throw new Error("RUNTIME_TEST_SUPABASE_ANON_KEY is required. Run npm run test:runtime.");
}

const TENANT_ID = "39875f07-0a4b-4429-a201-2249bc1f24df";
const ALEX_PROFILE_ID = "361f1ae0-901a-45bd-a3fa-3d136fcda7f0";
const PARENT_EMAIL = "parent.alex.rivera@example.test";
const ACADEMY_EMAIL = "academy.owner@example.test";
const LOCAL_PASSWORD = "local-password";

type MockResponse = ParentApiResponse & {
  body: unknown;
  headers: Record<string, string>;
  statusCode: number;
};

type ThreadDto = {
  id: string;
  status: "OPEN" | "CLOSED";
  customer_profile_id: string;
};

type MessageDto = {
  id: string;
  body: string | null;
  client_message_id: string | null;
  author_type: "PARENT" | "STAFF" | "SYSTEM";
};

type ParentMessagesBody = {
  thread: ThreadDto | null;
  messages: MessageDto[];
  unread_count: number;
};

type SendBody = {
  thread: ThreadDto;
  message: MessageDto;
};

type AcademyListBody = {
  threads: Array<ThreadDto & { unread_count: number }>;
};

const serviceSupabase = createClient(runtimeTestSupabaseUrl, runtimeTestServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const anonSupabase = createClient(runtimeTestSupabaseUrl, runtimeTestAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

describe("parent messaging API runtime loop", () => {
  beforeEach(async () => {
    assertLocalSupabase();
    process.env.VITE_SUPABASE_URL = runtimeTestSupabaseUrl;
    process.env.SUPABASE_URL = runtimeTestSupabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = runtimeTestServiceRoleKey;
    process.env.SUPABASE_SERVICE_KEY = runtimeTestServiceRoleKey;
    await cleanupMessagingFixtures();
  });

  afterEach(async () => {
    await cleanupMessagingFixtures();
  });

  it("runs the parent and academy messaging loop through the handlers", async () => {
    const parentToken = await signIn(PARENT_EMAIL);
    const academyToken = await signIn(ACADEMY_EMAIL);

    const initial = await invoke(parentMessagesHandler, {
      method: "GET",
      token: parentToken,
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.body).toMatchObject({
      thread: null,
      messages: [],
      unread_count: 0,
    });

    const firstSend = await invoke(parentMessagesHandler, {
      body: {
        body: "Hello from runtime parent API",
        client_message_id: "runtime-api-parent-1",
      },
      method: "POST",
      token: parentToken,
    });
    expect(firstSend.statusCode).toBe(200);
    const sent = firstSend.body as SendBody;
    expect(sent.thread.customer_profile_id).toBe(ALEX_PROFILE_ID);
    expect(sent.message.author_type).toBe("PARENT");

    const replay = await invoke(parentMessagesHandler, {
      body: {
        body: "Hello from runtime parent API",
        client_message_id: "runtime-api-parent-1",
      },
      method: "POST",
      token: parentToken,
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.body as SendBody).message.id).toBe(sent.message.id);

    const academyList = await invoke(clientMessagesHandler, {
      method: "GET",
      query: { needs_reply: "true" },
      token: academyToken,
    });
    expect(academyList.statusCode).toBe(200);
    expect((academyList.body as AcademyListBody).threads.some((thread) => thread.id === sent.thread.id)).toBe(true);

    const academyUnread = await invoke(clientMessagesHandler, {
      method: "GET",
      query: { action: "unread-count" },
      token: academyToken,
    });
    expect(academyUnread.statusCode).toBe(200);
    expect((academyUnread.body as { unread_count: number }).unread_count).toBeGreaterThan(0);

    const staffReply = await invoke(clientMessagesHandler, {
      body: {
        body: "Reply from the academy",
        client_message_id: "runtime-api-staff-1",
      },
      method: "POST",
      query: { action: "messages", thread_id: sent.thread.id },
      token: academyToken,
    });
    expect(staffReply.statusCode).toBe(200);
    expect((staffReply.body as SendBody).message.author_type).toBe("STAFF");

    const parentAfterReply = await invoke(parentMessagesHandler, {
      method: "GET",
      query: { thread_id: sent.thread.id },
      token: parentToken,
    });
    expect(parentAfterReply.statusCode).toBe(200);
    const parentAfterReplyBody = parentAfterReply.body as ParentMessagesBody;
    expect(parentAfterReplyBody.messages.some((message) => message.body === "Reply from the academy")).toBe(true);
    expect(parentAfterReplyBody.unread_count).toBe(1);

    const parentRead = await invoke(parentMessagesHandler, {
      body: { thread_id: sent.thread.id },
      method: "POST",
      query: { action: "read" },
      token: parentToken,
    });
    expect(parentRead.statusCode).toBe(200);
    expect(parentRead.body).toEqual({ unread_count: 0 });

    const closed = await invoke(clientMessagesHandler, {
      body: { status: "CLOSED" },
      method: "PATCH",
      query: { thread_id: sent.thread.id },
      token: academyToken,
    });
    expect(closed.statusCode).toBe(200);
    expect((closed.body as ThreadDto).status).toBe("CLOSED");

    const reopened = await invoke(parentMessagesHandler, {
      body: {
        body: "Following up after close",
        client_message_id: "runtime-api-parent-reopen",
      },
      method: "POST",
      token: parentToken,
    });
    expect(reopened.statusCode).toBe(200);
    expect((reopened.body as SendBody).thread.status).toBe("OPEN");

    const parentOnAcademyApi = await invoke(clientMessagesHandler, {
      method: "GET",
      token: parentToken,
    });
    expect(parentOnAcademyApi.statusCode).toBe(403);
  });
});

async function signIn(email: string): Promise<string> {
  const { data, error } = await anonSupabase.auth.signInWithPassword({
    email,
    password: LOCAL_PASSWORD,
  });
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error(`No access token for ${email}`);
  return token;
}

async function cleanupMessagingFixtures(): Promise<void> {
  const { data: threads, error: threadError } = await serviceSupabase
    .from("customer_message_threads")
    .select("id")
    .eq("tenant_id", TENANT_ID)
    .eq("customer_profile_id", ALEX_PROFILE_ID);
  if (threadError) throw new Error(threadError.message);

  const threadIds = (threads ?? []).map((thread) => thread.id as string);
  if (threadIds.length === 0) return;

  const { error: readError } = await serviceSupabase
    .from("customer_thread_reads")
    .delete()
    .in("thread_id", threadIds);
  if (readError) throw new Error(readError.message);

  const { error: messageError } = await serviceSupabase
    .from("customer_thread_messages")
    .delete()
    .in("thread_id", threadIds);
  if (messageError) throw new Error(messageError.message);

  const { error: deleteThreadError } = await serviceSupabase
    .from("customer_message_threads")
    .delete()
    .in("id", threadIds);
  if (deleteThreadError) throw new Error(deleteThreadError.message);
}

async function invoke(
  handler: (req: ParentApiRequest, res: ParentApiResponse) => unknown,
  req: {
    body?: unknown;
    method: string;
    query?: Record<string, string>;
    token: string;
  },
): Promise<MockResponse> {
  const res = mockResponse();
  await handler(
    {
      body: req.body,
      headers: { authorization: `Bearer ${req.token}` },
      method: req.method,
      query: req.query ?? {},
    },
    res,
  );
  return res;
}

function mockResponse(): MockResponse {
  const res = {
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    statusCode: 200,
    json(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
  };
  return res;
}

function assertLocalSupabase(): void {
  if (!runtimeTestSupabaseUrl.includes("127.0.0.1") && process.env.ALLOW_REMOTE_RUNTIME_TESTS !== "1") {
    throw new Error("Runtime contract tests only run against local Supabase by default.");
  }
}
