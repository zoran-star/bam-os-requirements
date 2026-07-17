import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_notifications.js", () => ({
  checkParentPushReceipts: vi.fn().mockResolvedValue({
    checked: 0,
    delivered: 0,
    failed: 0,
    retried: 0,
  }),
  dispatchParentPushDeliveries: vi.fn().mockResolvedValue({
    claimed: 0,
    failed: 0,
    retried: 0,
    sent: 0,
  }),
}));

import handler from "./notifications-worker.js";
import type { ParentApiRequest, ParentApiResponse } from "./_types.js";

describe("api/parent/notifications-worker", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
    vi.clearAllMocks();
  });

  it("runs for the configured cron bearer", async () => {
    const res = await invoke({ authorization: "Bearer cron-secret" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("does not trust a spoofable cron marker when CRON_SECRET is configured", async () => {
    const res = await invoke({ "x-vercel-cron": "1" });
    expect(res.statusCode).toBe(401);
  });

  it("fails closed when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;
    const res = await invoke({ "x-vercel-cron": "1" });
    expect(res.statusCode).toBe(500);
  });
});

async function invoke(headers: Record<string, string>): Promise<MockResponse> {
  const res = mockResponse();
  await handler(
    {
      headers,
      method: "GET",
      query: {},
    } satisfies ParentApiRequest,
    res,
  );
  return res;
}

type MockResponse = ParentApiResponse & { body: unknown; statusCode: number };

function mockResponse(): MockResponse {
  const res = {
    body: undefined as unknown,
    statusCode: 200,
    json(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader() {
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
  };
  return res;
}
