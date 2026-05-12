import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { E2E_TEST_SECRET } from "./constants";

function testHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-e2e-test-secret": E2E_TEST_SECRET,
  };
}

async function assertOk(response: APIResponse, endpoint: string): Promise<void> {
  if (!response.ok()) {
    let body = "(no body)";
    try {
      body = await response.text();
    } catch {
      // ignore
    }
    throw new Error(
      `E2E helper route failed:\n  endpoint: ${endpoint}\n  status: ${response.status()}\n  body: ${body}`,
    );
  }
}

export async function verifyTestEmail(page: Page, email: string) {
  const response = await page.request.post("/api/test/e2e/verify-email", {
    headers: testHeaders(),
    data: { email },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { verified?: boolean };
  expect(payload.verified).toBe(true);
}

export async function completeStripeCheckoutForTest(request: APIRequestContext, checkoutSessionId: string) {
  const response = await request.post("/api/test/e2e/stripe/complete", {
    headers: testHeaders(),
    data: { checkoutSessionId },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { completed?: boolean };
  expect(payload.completed).toBe(true);
}

export async function failStripeCheckoutForTest(
  request: APIRequestContext,
  input: { checkoutSessionId: string; mode?: "async_failed" | "expired" },
) {
  const response = await request.post("/api/test/e2e/stripe/fail", {
    headers: testHeaders(),
    data: input,
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { failed?: boolean };
  expect(payload.failed).toBe(true);
}

export async function cleanSeededClientBookingsForTest(request: APIRequestContext, clientEmail: string) {
  const response = await request.post("/api/test/e2e/clean-seeded-client-bookings", {
    headers: testHeaders(),
    data: { clientEmail },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { success?: boolean };
  expect(payload.success).toBe(true);
}

export async function createUnassignedTeacherSessionForTest(request: APIRequestContext): Promise<string> {
  const response = await request.post("/api/test/e2e/teacher/unassigned-session", {
    headers: testHeaders(),
    data: {},
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { sessionId?: string };
  expect(payload.sessionId).toBeTruthy();
  return payload.sessionId as string;
}

export async function clearCapturedPasswordResetOutboxForTest(request: APIRequestContext, email: string) {
  const response = await request.post("/api/test/e2e/password-reset-token", {
    headers: testHeaders(),
    data: { email, clearOutbox: true },
  });
  expect(response.ok()).toBeTruthy();
}

export async function getPasswordResetTokenForTest(
  request: APIRequestContext,
  email: string,
  options?: { requestReset?: boolean },
): Promise<string> {
  const response = await request.post("/api/test/e2e/password-reset-token", {
    headers: testHeaders(),
    data: { email, requestReset: options?.requestReset ?? false },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { token?: string };
  expect(payload.token).toBeTruthy();
  return payload.token as string;
}

export async function prepareCancellationWindowBookingForTest(
  request: APIRequestContext,
  input: { clientEmail: string; mode: "late" | "early" },
): Promise<{ bookingId: string }> {
  const response = await request.post("/api/test/e2e/bookings/prepare-cancellation-window", {
    headers: testHeaders(),
    data: input,
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { bookingId?: string };
  expect(payload.bookingId).toBeTruthy();
  return { bookingId: payload.bookingId as string };
}

export async function prepareCheckInWindowBookingForTest(
  request: APIRequestContext,
  input: {
    clientEmail: string;
    mode?: "in_window" | "before_window" | "after_window";
    classMode?: "collective" | "private";
  },
): Promise<{ bookingId: string; sessionId: string; sessionTitle: string }> {
  const endpoint = "/api/test/e2e/bookings/prepare-checkin-window";
  const response = await request.post(endpoint, {
    headers: testHeaders(),
    data: input,
  });
  await assertOk(response, endpoint);
  const payload = (await response.json()) as {
    bookingId?: string;
    sessionId?: string;
    sessionTitle?: string;
  };
  expect(payload.bookingId).toBeTruthy();
  expect(payload.sessionId).toBeTruthy();
  expect(payload.sessionTitle).toBeTruthy();
  return {
    bookingId: payload.bookingId as string,
    sessionId: payload.sessionId as string,
    sessionTitle: payload.sessionTitle as string,
  };
}

export async function prepareWaitlistSessionForTest(
  request: APIRequestContext,
  input: { clientEmail: string; createWaitlistEntry?: boolean; serviceSlug: string },
): Promise<{ dateKey: string; endTime: string; serviceSlug: string; sessionId: string; startTime: string }> {
  const endpoint = "/api/test/e2e/bookings/prepare-waitlist-session";
  const response = await request.post(endpoint, {
    headers: testHeaders(),
    data: input,
  });
  await assertOk(response, endpoint);
  const payload = (await response.json()) as {
    sessionId?: string;
    serviceSlug?: string;
    dateKey?: string;
    startTime?: string;
    endTime?: string;
  };
  expect(payload.sessionId).toBeTruthy();
  expect(payload.serviceSlug).toBeTruthy();
  expect(payload.dateKey).toBeTruthy();
  expect(payload.startTime).toBeTruthy();
  expect(payload.endTime).toBeTruthy();

  return {
    sessionId: payload.sessionId as string,
    serviceSlug: payload.serviceSlug as string,
    dateKey: payload.dateKey as string,
    startTime: payload.startTime as string,
    endTime: payload.endTime as string,
  };
}

export async function createVerifiedClientForTest(
  request: APIRequestContext,
  input: { email: string; password: string },
): Promise<void> {
  const response = await request.post("/api/test/e2e/users/create-verified-client", {
    headers: testHeaders(),
    data: input,
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { created?: boolean };
  expect(payload.created).toBe(true);
}

export async function deactivateUserForTest(request: APIRequestContext, email: string) {
  const response = await request.post("/api/test/e2e/users/deactivate", {
    headers: testHeaders(),
    data: { email },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { deactivated?: boolean };
  expect(payload.deactivated).toBe(true);
}

export async function reactivateUserForTest(request: APIRequestContext, email: string) {
  const response = await request.post("/api/test/e2e/users/reactivate", {
    headers: testHeaders(),
    data: { email },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { reactivated?: boolean };
  expect(payload.reactivated).toBe(true);
}

type CapturedEmail = {
  to: string[];
  subject: string;
  html: string;
  from: string;
  replyTo: string | null;
  context: string;
  createdAt: string;
};

export async function getCapturedEmailsForTest(request: APIRequestContext): Promise<CapturedEmail[]> {
  const response = await request.get("/api/test/e2e/outbox", {
    headers: testHeaders(),
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { emails?: CapturedEmail[] };
  return payload.emails ?? [];
}

export async function clearCapturedEmailsForTest(request: APIRequestContext): Promise<void> {
  const response = await request.delete("/api/test/e2e/outbox", {
    headers: testHeaders(),
  });
  expect(response.ok()).toBeTruthy();
}
