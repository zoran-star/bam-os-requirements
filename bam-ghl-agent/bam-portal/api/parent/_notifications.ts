import { eq, rpc, sb } from "./_supabase.js";

const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const MAX_PUSH_BATCH = 100;
const MAX_RECEIPT_BATCH = 300;
const MAX_DELIVERY_ATTEMPTS = 5;
const MAX_RECEIPT_ATTEMPTS = 5;
const EXPO_TOKEN_PATTERN = /^(Expo|Exponent)PushToken\[[^\]]+\]$/;

type NotificationPayload = Record<string, unknown>;

type ClaimedPushDelivery = {
  delivery_id: string;
  event_id: string;
  device_token_id: string;
  expo_push_token: string;
  app_environment: string;
  attempt_count: number;
  event_type: string;
  event_class: string;
  category: string;
  payload: NotificationPayload;
  occurred_at: string;
  recipient_auth_user_id: string;
};

type SentDelivery = {
  id: string;
  device_token_id: string | null;
  provider_ticket_id: string;
  receipt_attempt_count: number;
  attempt_count: number;
};

type ExpoTicket = {
  status?: unknown;
  id?: unknown;
  message?: unknown;
  details?: unknown;
};

type ExpoReceipt = {
  status?: unknown;
  message?: unknown;
  details?: unknown;
};

export type PushDispatchSummary = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
};

export type PushReceiptSummary = {
  checked: number;
  delivered: number;
  retried: number;
  failed: number;
};

export async function dispatchParentPushDeliveries(options: {
  limit?: number;
  subjectId?: string;
  timeoutMs?: number;
} = {}): Promise<PushDispatchSummary> {
  const limit = Math.max(1, Math.min(options.limit ?? MAX_PUSH_BATCH, MAX_PUSH_BATCH));
  const claimed = await rpc<ClaimedPushDelivery[]>("parent_claim_push_deliveries", {
    p_limit: limit,
    p_subject_id: options.subjectId ?? null,
  });
  const deliveries = Array.isArray(claimed) ? claimed : [];
  const summary: PushDispatchSummary = {
    claimed: deliveries.length,
    failed: 0,
    retried: 0,
    sent: 0,
  };

  if (deliveries.length === 0) return summary;

  const valid: ClaimedPushDelivery[] = [];
  for (const delivery of deliveries) {
    if (!EXPO_TOKEN_PATTERN.test(delivery.expo_push_token)) {
      await failDelivery(delivery.delivery_id, "Invalid Expo push token.");
      await disableDeviceToken(delivery.device_token_id, "Invalid Expo push token.");
      summary.failed += 1;
    } else {
      valid.push(delivery);
    }
  }

  if (valid.length === 0) return summary;

  let response: Response;
  try {
    response = await expoFetch(
      EXPO_PUSH_SEND_URL,
      valid.map(buildExpoMessage),
      options.timeoutMs,
    );
  } catch (error) {
    const message = errorMessage(error, "Expo push request failed.");
    for (const delivery of valid) {
      const result = await retryOrFailDelivery(delivery, message);
      summary[result] += 1;
    }
    return summary;
  }

  const responseBody = await safeJson(response);
  if (!response.ok) {
    const message = expoHttpError(response.status, responseBody);
    for (const delivery of valid) {
      const result = isTransientHttpStatus(response.status)
        ? await retryOrFailDelivery(delivery, message)
        : await permanentlyFailDelivery(delivery, message);
      summary[result] += 1;
    }
    return summary;
  }

  const tickets = readTicketArray(responseBody);
  for (const [index, delivery] of valid.entries()) {
    const ticket = tickets[index];
    if (!ticket) {
      const result = await retryOrFailDelivery(delivery, "Expo returned no push ticket.");
      summary[result] += 1;
      continue;
    }

    const result = await applyTicket(delivery, ticket);
    summary[result] += 1;
  }

  return summary;
}

export async function checkParentPushReceipts(): Promise<PushReceiptSummary> {
  const sentBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const checkedBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  const rows = await sb<SentDelivery[]>(
    "parent_notification_deliveries" +
      "?channel=eq.PUSH" +
      "&provider=eq.EXPO" +
      "&status=eq.SENT" +
      "&provider_ticket_id=not.is.null" +
      `&sent_at=lte.${eq(sentBefore)}` +
      `&or=(receipt_checked_at.is.null,receipt_checked_at.lt.${eq(checkedBefore)})` +
      `&receipt_attempt_count=lt.${MAX_RECEIPT_ATTEMPTS}` +
      "&select=id,device_token_id,provider_ticket_id,receipt_attempt_count,attempt_count" +
      "&order=sent_at.asc,id.asc" +
      `&limit=${MAX_RECEIPT_BATCH}`,
  );
  const deliveries = Array.isArray(rows) ? rows : [];
  const summary: PushReceiptSummary = {
    checked: deliveries.length,
    delivered: 0,
    failed: 0,
    retried: 0,
  };

  if (deliveries.length === 0) return summary;

  let response: Response;
  try {
    response = await expoFetch(EXPO_PUSH_RECEIPTS_URL, {
      ids: deliveries.map((delivery) => delivery.provider_ticket_id),
    });
  } catch (error) {
    await recordReceiptCheckFailure(deliveries, errorMessage(error, "Expo receipt request failed."));
    summary.retried = deliveries.length;
    return summary;
  }

  const responseBody = await safeJson(response);
  if (!response.ok) {
    await recordReceiptCheckFailure(deliveries, expoHttpError(response.status, responseBody));
    summary.retried = deliveries.length;
    return summary;
  }

  const receipts = readReceiptMap(responseBody);
  for (const delivery of deliveries) {
    const receipt = receipts[delivery.provider_ticket_id];
    const result = await applyReceipt(delivery, receipt);
    summary[result] += 1;
  }

  return summary;
}

function buildExpoMessage(delivery: ClaimedPushDelivery) {
  const payload = isRecord(delivery.payload) ? delivery.payload : {};
  const senderName = stringValue(payload.senderName);
  const preview = stringValue(payload.preview);
  const threadId = stringValue(payload.threadId);
  const messageId = stringValue(payload.messageId);

  return {
    to: delivery.expo_push_token,
    title: senderName ? `${senderName} sent a message` : "New message",
    body: preview || "You have a new message from your academy.",
    sound: "default",
    priority: "high",
    channelId: "messages",
    ttl: 86_400,
    data: {
      schemaVersion: 1,
      eventId: delivery.event_id,
      eventType: delivery.event_type,
      threadId,
      messageId,
      occurredAt: delivery.occurred_at,
    },
  };
}

async function applyTicket(
  delivery: ClaimedPushDelivery,
  ticket: ExpoTicket,
): Promise<"sent" | "retried" | "failed"> {
  if (ticket.status === "ok" && typeof ticket.id === "string" && ticket.id) {
    await updateDelivery(delivery.delivery_id, {
      last_error: null,
      locked_at: null,
      locked_by: null,
      provider_ticket_id: ticket.id,
      provider_receipt_status: null,
      receipt_attempt_count: 0,
      sent_at: new Date().toISOString(),
      status: "SENT",
    });
    return "sent";
  }

  const providerError = expoProviderError(ticket.details);
  const message = stringValue(ticket.message) || providerError || "Expo rejected the push notification.";
  if (providerError === "DeviceNotRegistered") {
    await failDelivery(delivery.delivery_id, message, providerError);
    await disableDeviceToken(delivery.device_token_id, message);
    return "failed";
  }
  if (providerError === "MessageRateExceeded") {
    return retryOrFailDelivery(delivery, message);
  }

  return permanentlyFailDelivery(delivery, message, providerError);
}

async function applyReceipt(
  delivery: SentDelivery,
  receipt: ExpoReceipt | undefined,
): Promise<"delivered" | "retried" | "failed"> {
  const receiptAttemptCount = delivery.receipt_attempt_count + 1;
  const checkedAt = new Date().toISOString();

  if (!receipt) {
    if (receiptAttemptCount >= MAX_RECEIPT_ATTEMPTS) {
      await failDelivery(delivery.id, "Expo returned no delivery receipt.");
      return "failed";
    }
    await updateDelivery(delivery.id, {
      last_error: "Expo delivery receipt is not available yet.",
      receipt_attempt_count: receiptAttemptCount,
      receipt_checked_at: checkedAt,
    });
    return "retried";
  }

  if (receipt.status === "ok") {
    await updateDelivery(delivery.id, {
      delivered_at: checkedAt,
      last_error: null,
      provider_receipt_status: "ok",
      receipt_attempt_count: receiptAttemptCount,
      receipt_checked_at: checkedAt,
      status: "DELIVERED",
    });
    return "delivered";
  }

  const providerError = expoProviderError(receipt.details);
  const message = stringValue(receipt.message) || providerError || "Expo reported a delivery error.";
  if (providerError === "DeviceNotRegistered") {
    await failDelivery(delivery.id, message, providerError, receiptAttemptCount);
    if (delivery.device_token_id) {
      await disableDeviceToken(delivery.device_token_id, message);
    }
    return "failed";
  }

  if (providerError === "MessageRateExceeded" && delivery.attempt_count < MAX_DELIVERY_ATTEMPTS) {
    await updateDelivery(delivery.id, {
      last_error: message,
      locked_at: null,
      locked_by: null,
      next_attempt_at: nextAttemptAt(delivery.attempt_count),
      provider_receipt_status: providerError,
      receipt_attempt_count: receiptAttemptCount,
      receipt_checked_at: checkedAt,
      status: "RETRY",
    });
    return "retried";
  }

  await failDelivery(delivery.id, message, providerError, receiptAttemptCount);
  return "failed";
}

async function retryOrFailDelivery(
  delivery: ClaimedPushDelivery,
  message: string,
): Promise<"retried" | "failed"> {
  if (delivery.attempt_count >= MAX_DELIVERY_ATTEMPTS) {
    await failDelivery(delivery.delivery_id, message);
    return "failed";
  }

  await updateDelivery(delivery.delivery_id, {
    last_error: message,
    locked_at: null,
    locked_by: null,
    next_attempt_at: nextAttemptAt(delivery.attempt_count),
    status: "RETRY",
  });
  return "retried";
}

async function permanentlyFailDelivery(
  delivery: ClaimedPushDelivery,
  message: string,
  providerError: string | null = null,
): Promise<"failed"> {
  await failDelivery(delivery.delivery_id, message, providerError);
  return "failed";
}

async function failDelivery(
  deliveryId: string,
  message: string,
  providerReceiptStatus: string | null = null,
  receiptAttemptCount?: number,
): Promise<void> {
  await updateDelivery(deliveryId, {
    last_error: message,
    locked_at: null,
    locked_by: null,
    ...(providerReceiptStatus ? { provider_receipt_status: providerReceiptStatus } : {}),
    ...(receiptAttemptCount === undefined ? {} : { receipt_attempt_count: receiptAttemptCount }),
    receipt_checked_at: new Date().toISOString(),
    status: "FAILED",
  });
}

async function disableDeviceToken(deviceTokenId: string, message: string): Promise<void> {
  await sb(`device_tokens?id=eq.${eq(deviceTokenId)}`, {
    body: JSON.stringify({
      disabled_at: new Date().toISOString(),
      last_error: message,
      updated_at: new Date().toISOString(),
    }),
    headers: { Prefer: "return=minimal" },
    method: "PATCH",
  });
}

async function updateDelivery(deliveryId: string, patch: Record<string, unknown>): Promise<void> {
  await sb(`parent_notification_deliveries?id=eq.${eq(deliveryId)}`, {
    body: JSON.stringify(patch),
    headers: { Prefer: "return=minimal" },
    method: "PATCH",
  });
}

async function recordReceiptCheckFailure(deliveries: SentDelivery[], message: string): Promise<void> {
  const checkedAt = new Date().toISOString();
  for (const delivery of deliveries) {
    const nextCount = delivery.receipt_attempt_count + 1;
    if (nextCount >= MAX_RECEIPT_ATTEMPTS) {
      await failDelivery(delivery.id, message, null, nextCount);
    } else {
      await updateDelivery(delivery.id, {
        last_error: message,
        receipt_attempt_count: nextCount,
        receipt_checked_at: checkedAt,
      });
    }
  }
}

async function expoFetch(url: string, body: unknown, timeoutMs = 10_000): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  return fetch(url, {
    body: JSON.stringify(body),
    headers,
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function readTicketArray(body: unknown): ExpoTicket[] {
  if (!isRecord(body)) return [];
  const data = body.data;
  if (Array.isArray(data)) return data.filter(isRecord);
  return isRecord(data) ? [data] : [];
}

function readReceiptMap(body: unknown): Record<string, ExpoReceipt> {
  if (!isRecord(body) || !isRecord(body.data)) return {};
  return Object.fromEntries(
    Object.entries(body.data).filter((entry): entry is [string, ExpoReceipt] => isRecord(entry[1])),
  );
}

function expoProviderError(details: unknown): string | null {
  if (!isRecord(details)) return null;
  return stringValue(details.error);
}

function expoHttpError(status: number, body: unknown): string {
  if (isRecord(body)) {
    const direct = stringValue(body.message) || stringValue(body.error);
    if (direct) return `Expo push service returned ${status}: ${direct}`;
    if (Array.isArray(body.errors)) {
      const first = body.errors.find(isRecord);
      const message = first ? stringValue(first.message) : null;
      if (message) return `Expo push service returned ${status}: ${message}`;
    }
  }
  return `Expo push service returned HTTP ${status}.`;
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function nextAttemptAt(attemptCount: number): string {
  const delays = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
  const delay = delays[Math.min(Math.max(attemptCount - 1, 0), delays.length - 1)] ?? 60_000;
  return new Date(Date.now() + delay).toISOString();
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
