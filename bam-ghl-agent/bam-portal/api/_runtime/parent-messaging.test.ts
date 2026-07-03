import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

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
const PROFILE_ID = "91000000-0000-4000-8000-000000000001";
const PROFILE_AUTH_USER_ID = "91000000-0000-4000-8000-000000000101";
const PROFILE_EMAIL = "runtime.messaging.parent@example.test";
const RACE_PROFILE_ID = "91000000-0000-4000-8000-000000000002";
const RACE_PROFILE_AUTH_USER_ID = "91000000-0000-4000-8000-000000000102";
const RACE_PROFILE_EMAIL = "runtime.messaging.race@example.test";
const STAFF_AUTH_USER_ID = "91000000-0000-4000-8000-000000000201";
const ALEX_PROFILE_ID = "361f1ae0-901a-45bd-a3fa-3d136fcda7f0";
const ALEX_AUTH_USER_ID = "d353e2fd-23f9-49e3-925d-5cc7cf2b7c11";
const ALEX_EMAIL = "parent.alex.rivera@example.test";
const ALEX_PASSWORD = "local-password";
const CLEANUP_PROFILE_IDS = [PROFILE_ID, RACE_PROFILE_ID, ALEX_PROFILE_ID];
const SYNTHETIC_PROFILE_IDS = [PROFILE_ID, RACE_PROFILE_ID];

type AuthorType = "PARENT" | "STAFF" | "SYSTEM";
type MessageType = "TEXT" | "ANNOUNCEMENT" | "SYSTEM";

type ThreadRow = {
  id: string;
  tenant_id: string;
  customer_profile_id: string;
  kind: string;
  status: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_author_type: AuthorType | null;
  closed_at: string | null;
};

type MessageRow = {
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
  created_at: string;
};

type ReadRow = {
  id: string;
  thread_id: string;
  tenant_id: string;
  reader_type: "PARENT" | "STAFF";
  customer_profile_id: string | null;
  auth_user_id: string;
  last_read_at: string;
};

type SendResult = {
  message: MessageRow;
  thread: ThreadRow;
};

type SendParams = {
  customerProfileId?: string | null;
  threadId?: string | null;
  authorType: AuthorType;
  authorAuthUserId?: string | null;
  authorDisplayName?: string | null;
  body: string;
  clientMessageId?: string | null;
  messageType?: MessageType;
};

const serviceSupabase = createClient(runtimeTestSupabaseUrl, runtimeTestServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

describe("parent messaging runtime contract", () => {
  beforeEach(async () => {
    assertLocalSupabase();
    await cleanupMessagingFixtures();
  });

  it("creates the thread, message, summary, and sender read row on first send", async () => {
    await insertFixtureProfile();

    const result = await sendThreadMessage({
      customerProfileId: PROFILE_ID,
      authorType: "PARENT",
      authorAuthUserId: PROFILE_AUTH_USER_ID,
      authorDisplayName: "Runtime Parent",
      body: "Hello from the parent app",
      clientMessageId: "first-send",
    });

    expect(result.thread.customer_profile_id).toBe(PROFILE_ID);
    expect(result.thread.kind).toBe("GENERAL");
    expect(result.thread.status).toBe("OPEN");
    expect(result.message.thread_id).toBe(result.thread.id);
    expect(result.message.author_customer_profile_id).toBe(PROFILE_ID);
    expect(result.message.author_auth_user_id).toBe(PROFILE_AUTH_USER_ID);

    const thread = await fetchThread(result.thread.id);
    expect(thread.last_message_at).toBe(result.message.created_at);
    expect(thread.last_message_preview).toBe("Hello from the parent app");
    expect(thread.last_message_author_type).toBe("PARENT");

    const read = await fetchRead(result.thread.id, PROFILE_AUTH_USER_ID);
    expect(read.reader_type).toBe("PARENT");
    expect(read.customer_profile_id).toBe(PROFILE_ID);
  });

  it("returns the same message for a replayed client_message_id", async () => {
    await insertFixtureProfile();

    const first = await sendThreadMessage({
      customerProfileId: PROFILE_ID,
      authorType: "PARENT",
      authorAuthUserId: PROFILE_AUTH_USER_ID,
      body: "Send once",
      clientMessageId: "idempotent-send",
    });
    const second = await sendThreadMessage({
      customerProfileId: PROFILE_ID,
      authorType: "PARENT",
      authorAuthUserId: PROFILE_AUTH_USER_ID,
      body: "Send once",
      clientMessageId: "idempotent-send",
    });

    expect(second.message.id).toBe(first.message.id);
    expect(await countMessages(first.thread.id)).toBe(1);
  });

  it("updates the thread summary for the newest message", async () => {
    await insertFixtureProfile();
    const first = await sendThreadMessage({
      customerProfileId: PROFILE_ID,
      authorType: "PARENT",
      authorAuthUserId: PROFILE_AUTH_USER_ID,
      body: "Initial parent message",
      clientMessageId: "summary-parent",
    });
    const staffBody = "Staff response ".repeat(14);

    const second = await sendThreadMessage({
      threadId: first.thread.id,
      customerProfileId: null,
      authorType: "STAFF",
      authorAuthUserId: STAFF_AUTH_USER_ID,
      authorDisplayName: "Runtime Staff",
      body: staffBody,
      clientMessageId: "summary-staff",
    });

    const thread = await fetchThread(first.thread.id);
    expect(thread.last_message_at).toBe(second.message.created_at);
    expect(thread.last_message_preview).toBe(staffBody.slice(0, 140));
    expect(thread.last_message_author_type).toBe("STAFF");
  });

  it("allows a staff send without a parent author and does not reopen a closed thread", async () => {
    await insertFixtureProfile();
    const first = await sendThreadMessage({
      customerProfileId: PROFILE_ID,
      authorType: "PARENT",
      authorAuthUserId: PROFILE_AUTH_USER_ID,
      body: "Parent opens the thread",
      clientMessageId: "staff-base",
    });
    await closeThread(first.thread.id);

    const staff = await sendThreadMessage({
      threadId: first.thread.id,
      customerProfileId: null,
      authorType: "STAFF",
      authorAuthUserId: STAFF_AUTH_USER_ID,
      authorDisplayName: "Runtime Staff",
      body: "Staff reply on closed thread",
      clientMessageId: "staff-closed-send",
    });

    expect(staff.message.author_customer_profile_id).toBeNull();
    expect(staff.message.author_auth_user_id).toBe(STAFF_AUTH_USER_ID);
    expect(staff.thread.status).toBe("CLOSED");
    expect(staff.thread.closed_at).not.toBeNull();
  });

  it("reopens closed threads for parent sends but not system sends", async () => {
    await insertFixtureProfile();
    const first = await sendThreadMessage({
      customerProfileId: PROFILE_ID,
      authorType: "PARENT",
      authorAuthUserId: PROFILE_AUTH_USER_ID,
      body: "Parent starts reopen test",
      clientMessageId: "reopen-base",
    });

    await closeThread(first.thread.id);
    const parentReopen = await sendThreadMessage({
      threadId: first.thread.id,
      customerProfileId: PROFILE_ID,
      authorType: "PARENT",
      authorAuthUserId: PROFILE_AUTH_USER_ID,
      body: "Please reopen this",
      clientMessageId: "reopen-parent",
    });
    expect(parentReopen.thread.status).toBe("OPEN");
    expect(parentReopen.thread.closed_at).toBeNull();

    await closeThread(first.thread.id);
    const systemSend = await sendThreadMessage({
      threadId: first.thread.id,
      customerProfileId: null,
      authorType: "SYSTEM",
      authorAuthUserId: null,
      body: "System note only",
      clientMessageId: "closed-system",
      messageType: "SYSTEM",
    });
    expect(systemSend.thread.status).toBe("CLOSED");
    expect(systemSend.thread.closed_at).not.toBeNull();
  });

  it("keeps parent JWTs denied on tables and the send RPC", async () => {
    const serviceSend = await sendThreadMessage({
      customerProfileId: ALEX_PROFILE_ID,
      authorType: "SYSTEM",
      authorAuthUserId: null,
      body: "Canary service-created message",
      clientMessageId: "alex-canary",
      messageType: "SYSTEM",
    });
    const parentSupabase = createClient(runtimeTestSupabaseUrl, runtimeTestAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: signInData, error: signInError } = await parentSupabase.auth.signInWithPassword({
      email: ALEX_EMAIL,
      password: ALEX_PASSWORD,
    });
    expect(signInError).toBeNull();
    expect(signInData.session?.access_token).toBeTruthy();

    await expectSelectClosed(parentSupabase, "customer_message_threads");
    await expectSelectClosed(parentSupabase, "customer_thread_messages");
    await expectSelectClosed(parentSupabase, "customer_thread_reads");

    const { error: insertError } = await parentSupabase.from("customer_thread_messages").insert({
      thread_id: serviceSend.thread.id,
      tenant_id: TENANT_ID,
      author_type: "PARENT",
      author_customer_profile_id: ALEX_PROFILE_ID,
      author_auth_user_id: ALEX_AUTH_USER_ID,
      body: "Parent JWT direct insert should fail",
      client_message_id: "direct-insert-denied",
    });
    expect(insertError).toBeTruthy();

    const { error: rpcError } = await parentSupabase.rpc("customer_send_thread_message", {
      p_tenant_id: TENANT_ID,
      p_customer_profile_id: ALEX_PROFILE_ID,
      p_thread_id: serviceSend.thread.id,
      p_author_type: "PARENT",
      p_author_auth_user_id: ALEX_AUTH_USER_ID,
      p_author_display_name: "Alex Rivera",
      p_body: "Parent JWT RPC should fail",
      p_client_message_id: "parent-jwt-rpc-denied",
      p_message_type: "TEXT",
    });
    expect(rpcError).toBeTruthy();
    expect(rpcError?.message.toLowerCase()).toContain("permission denied");
  });

  it("converges concurrent first sends to one thread and two messages", async () => {
    await insertFixtureProfile({
      id: RACE_PROFILE_ID,
      supabaseUserId: RACE_PROFILE_AUTH_USER_ID,
      email: RACE_PROFILE_EMAIL,
      lastName: "Race",
    });

    const [first, second] = await Promise.all([
      sendThreadMessage({
        customerProfileId: RACE_PROFILE_ID,
        authorType: "PARENT",
        authorAuthUserId: RACE_PROFILE_AUTH_USER_ID,
        body: "Race send one",
        clientMessageId: "race-one",
      }),
      sendThreadMessage({
        customerProfileId: RACE_PROFILE_ID,
        authorType: "PARENT",
        authorAuthUserId: RACE_PROFILE_AUTH_USER_ID,
        body: "Race send two",
        clientMessageId: "race-two",
      }),
    ]);

    expect(second.thread.id).toBe(first.thread.id);
    expect(await countThreadsForProfile(RACE_PROFILE_ID)).toBe(1);
    expect(await countMessages(first.thread.id)).toBe(2);
  });
});

async function sendThreadMessage(params: SendParams): Promise<SendResult> {
  const { data, error } = await serviceSupabase
    .rpc("customer_send_thread_message", {
      p_tenant_id: TENANT_ID,
      p_customer_profile_id: params.customerProfileId ?? null,
      p_thread_id: params.threadId ?? null,
      p_author_type: params.authorType,
      p_author_auth_user_id: params.authorAuthUserId ?? null,
      p_author_display_name: params.authorDisplayName ?? null,
      p_body: params.body,
      p_client_message_id: params.clientMessageId ?? null,
      p_message_type: params.messageType ?? "TEXT",
    })
    .single();
  if (error) throw new Error(error.message);
  return data as SendResult;
}

async function insertFixtureProfile(overrides: {
  id?: string;
  supabaseUserId?: string;
  email?: string;
  lastName?: string;
} = {}): Promise<void> {
  const { error } = await serviceSupabase.from("customer_profiles").insert({
    id: overrides.id ?? PROFILE_ID,
    supabase_user_id: overrides.supabaseUserId ?? PROFILE_AUTH_USER_ID,
    first_name: "Runtime",
    last_name: overrides.lastName ?? "Messaging",
    email: overrides.email ?? PROFILE_EMAIL,
    phone: null,
    profile_type: "PARENT",
  });
  if (error) throw new Error(error.message);
}

async function cleanupMessagingFixtures(): Promise<void> {
  const { data: threads, error: threadError } = await serviceSupabase
    .from("customer_message_threads")
    .select("id")
    .eq("tenant_id", TENANT_ID)
    .in("customer_profile_id", CLEANUP_PROFILE_IDS);
  if (threadError) throw new Error(threadError.message);

  const threadIds = (threads ?? []).map((thread) => thread.id as string);
  if (threadIds.length > 0) {
    await serviceSupabase.from("customer_thread_reads").delete().in("thread_id", threadIds);
    await serviceSupabase.from("customer_thread_messages").delete().in("thread_id", threadIds);
    await serviceSupabase.from("customer_message_threads").delete().in("id", threadIds);
  }

  const { error: profileError } = await serviceSupabase.from("customer_profiles").delete().in("id", SYNTHETIC_PROFILE_IDS);
  if (profileError) throw new Error(profileError.message);
}

async function fetchThread(threadId: string): Promise<ThreadRow> {
  const { data, error } = await serviceSupabase
    .from("customer_message_threads")
    .select("*")
    .eq("id", threadId)
    .single();
  if (error) throw new Error(error.message);
  return data as ThreadRow;
}

async function fetchRead(threadId: string, authUserId: string): Promise<ReadRow> {
  const { data, error } = await serviceSupabase
    .from("customer_thread_reads")
    .select("*")
    .eq("thread_id", threadId)
    .eq("auth_user_id", authUserId)
    .single();
  if (error) throw new Error(error.message);
  return data as ReadRow;
}

async function closeThread(threadId: string): Promise<void> {
  const { error } = await serviceSupabase
    .from("customer_message_threads")
    .update({ status: "CLOSED", closed_at: new Date().toISOString() })
    .eq("id", threadId);
  if (error) throw new Error(error.message);
}

async function countMessages(threadId: string): Promise<number> {
  const { count, error } = await serviceSupabase
    .from("customer_thread_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countThreadsForProfile(profileId: string): Promise<number> {
  const { count, error } = await serviceSupabase
    .from("customer_message_threads")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TENANT_ID)
    .eq("customer_profile_id", profileId)
    .eq("kind", "GENERAL");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function expectSelectClosed(client: typeof serviceSupabase, table: string): Promise<void> {
  const { data, error } = await client.from(table).select("*");
  if (error) {
    expect(error.message.toLowerCase()).toContain("permission denied");
    return;
  }
  expect(data).toHaveLength(0);
}

function assertLocalSupabase(): void {
  if (!runtimeTestSupabaseUrl.includes("127.0.0.1") && process.env.ALLOW_REMOTE_RUNTIME_TESTS !== "1") {
    throw new Error("Runtime contract tests only run against local Supabase by default.");
  }
}
