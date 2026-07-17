import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkParentPushReceipts, dispatchParentPushDeliveries } from "./_notifications.js";

const deliveryId = "92000000-0000-4000-8000-000000000001";
const eventId = "92000000-0000-4000-8000-000000000002";
const tokenId = "92000000-0000-4000-8000-000000000003";
const userId = "92000000-0000-4000-8000-000000000004";
const threadId = "92000000-0000-4000-8000-000000000005";
const messageId = "92000000-0000-4000-8000-000000000006";

const claimedDelivery = {
  app_environment: "development",
  attempt_count: 1,
  category: "MESSAGES",
  delivery_id: deliveryId,
  device_token_id: tokenId,
  event_class: "CONTEXTUAL",
  event_id: eventId,
  event_type: "STAFF_MESSAGE_RECEIVED",
  expo_push_token: "ExponentPushToken[test-token]",
  occurred_at: "2026-07-14T04:00:00.000Z",
  payload: {
    messageId,
    preview: "Practice is moving indoors.",
    senderName: "Academy Owner",
    threadId,
  },
  recipient_auth_user_id: userId,
};

describe("parent Expo push delivery", () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    delete process.env.EXPO_ACCESS_TOKEN;
    vi.restoreAllMocks();
  });

  it("claims, sends, and records an Expo ticket", async () => {
    const fetchMock = mockFetch([
      { body: [claimedDelivery], match: "/rpc/parent_claim_push_deliveries" },
      { body: { data: [{ id: "expo-ticket-1", status: "ok" }] }, match: "exp.host/--/api/v2/push/send" },
      { body: null, match: `/parent_notification_deliveries?id=eq.${deliveryId}` },
    ]);

    await expect(
      dispatchParentPushDeliveries({ limit: 10, subjectId: messageId }),
    ).resolves.toEqual({ claimed: 1, failed: 0, retried: 0, sent: 1 });

    const claimBody = requestBody(fetchMock, "/rpc/parent_claim_push_deliveries");
    expect(claimBody).toEqual({ p_limit: 10, p_subject_id: messageId });
    const expoBody = requestBody(fetchMock, "exp.host/--/api/v2/push/send") as unknown[];
    expect(expoBody[0]).toMatchObject({
      body: "Practice is moving indoors.",
      channelId: "messages",
      data: {
        eventId,
        eventType: "STAFF_MESSAGE_RECEIVED",
        messageId,
        schemaVersion: 1,
        threadId,
      },
      title: "Academy Owner sent a message",
      to: claimedDelivery.expo_push_token,
    });
    expect(requestBody(fetchMock, `/parent_notification_deliveries?id=eq.${deliveryId}`)).toMatchObject({
      provider_ticket_id: "expo-ticket-1",
      status: "SENT",
    });
  });

  it("fails the delivery and disables DeviceNotRegistered tokens", async () => {
    const fetchMock = mockFetch([
      { body: [claimedDelivery], match: "/rpc/parent_claim_push_deliveries" },
      {
        body: {
          data: [
            {
              details: { error: "DeviceNotRegistered" },
              message: "The device is not registered.",
              status: "error",
            },
          ],
        },
        match: "exp.host/--/api/v2/push/send",
      },
      { body: null, match: `/parent_notification_deliveries?id=eq.${deliveryId}` },
      { body: null, match: `/device_tokens?id=eq.${tokenId}` },
    ]);

    await expect(dispatchParentPushDeliveries()).resolves.toEqual({
      claimed: 1,
      failed: 1,
      retried: 0,
      sent: 0,
    });
    expect(requestBody(fetchMock, `/parent_notification_deliveries?id=eq.${deliveryId}`)).toMatchObject({
      provider_receipt_status: "DeviceNotRegistered",
      status: "FAILED",
    });
    expect(requestBody(fetchMock, `/device_tokens?id=eq.${tokenId}`)).toMatchObject({
      last_error: "The device is not registered.",
    });
  });

  it("marks an accepted ticket delivered after a successful receipt", async () => {
    const fetchMock = mockFetch([
      {
        body: [
          {
            attempt_count: 1,
            device_token_id: tokenId,
            id: deliveryId,
            provider_ticket_id: "expo-ticket-1",
            receipt_attempt_count: 0,
          },
        ],
        match: "/parent_notification_deliveries?channel=eq.PUSH",
      },
      {
        body: { data: { "expo-ticket-1": { status: "ok" } } },
        match: "exp.host/--/api/v2/push/getReceipts",
      },
      { body: null, match: `/parent_notification_deliveries?id=eq.${deliveryId}` },
    ]);

    await expect(checkParentPushReceipts()).resolves.toEqual({
      checked: 1,
      delivered: 1,
      failed: 0,
      retried: 0,
    });
    expect(requestBody(fetchMock, `/parent_notification_deliveries?id=eq.${deliveryId}`)).toMatchObject({
      provider_receipt_status: "ok",
      receipt_attempt_count: 1,
      status: "DELIVERED",
    });
  });
});

function mockFetch(responses: Array<{ body: unknown; match: string; status?: number }>) {
  const queue = [...responses];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected fetch: ${url}`);
    if (!url.includes(next.match)) {
      throw new Error(`Expected fetch URL to include ${next.match}, received ${url}`);
    }
    return new Response(next.body === null ? "" : JSON.stringify(next.body), {
      status: next.status ?? 200,
    });
  });
}

function requestBody(fetchMock: ReturnType<typeof mockFetch>, match: string): unknown {
  const call = fetchMock.mock.calls.find(([input]) => String(input).includes(match));
  const body = call?.[1]?.body;
  return typeof body === "string" ? JSON.parse(body) : null;
}
