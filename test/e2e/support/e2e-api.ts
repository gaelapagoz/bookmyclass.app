import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_TEST_SECRET } from "./constants";

function testHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-e2e-test-secret": E2E_TEST_SECRET,
  };
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

export async function cleanSeededClientBookingsForTest(request: APIRequestContext, clientEmail: string) {
  const response = await request.post("/api/test/e2e/clean-seeded-client-bookings", {
    headers: testHeaders(),
    data: { clientEmail },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { success?: boolean };
  expect(payload.success).toBe(true);
}
