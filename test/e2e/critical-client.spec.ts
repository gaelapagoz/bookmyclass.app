import { expect, test } from "@playwright/test";
import { openBookingFormFromFirstAvailableSlot, submitBookingWithPaymentOption } from "./support/booking";
import { signInClient, signUpPublicUser } from "./support/auth";
import { completeStripeCheckoutForTest, verifyTestEmail } from "./support/e2e-api";
import {
  E2E_PASSWORD,
  SEEDED_CLIENT_WITH_CREDITS,
  SEEDED_SERVICE_SLUG,
} from "./support/constants";

test.describe("critical client flows", () => {
  test.describe.configure({ mode: "serial" });

  const signupEmail = `e2e.signup.${Date.now()}@example.test`;

  test("sign up + verify email + first login", async ({ page }) => {
    await signUpPublicUser(page, {
      firstName: "E2E",
      lastName: "Signup",
      email: signupEmail,
      password: E2E_PASSWORD,
    });

    await verifyTestEmail(page, signupEmail);
    await signInClient(page, { email: signupEmail, password: E2E_PASSWORD });
    await expect(page.getByRole("heading", { name: "Client Dashboard" })).toBeVisible();
  });

  test("buy subscription via Stripe checkout", async ({ page }) => {
    await signInClient(page, { email: signupEmail, password: E2E_PASSWORD });

    await page.goto("/subscription");
    const monthlyCard = page.locator("article").filter({ hasText: "E2E Monthly Unlimited" }).first();
    await expect(monthlyCard).toBeVisible();

    await monthlyCard.getByRole("button", { name: "Continue to checkout" }).click();
    await expect(page).toHaveURL(/\/subscription\/success\?session_id=/);

    const checkoutSessionId = new URL(page.url()).searchParams.get("session_id");
    expect(checkoutSessionId).toBeTruthy();

    await completeStripeCheckoutForTest(page.request, checkoutSessionId as string);
    await page.goto(`/subscription/success?session_id=${encodeURIComponent(checkoutSessionId as string)}`);

    await expect(page.getByRole("heading", { name: "Payment Confirmed" })).toBeVisible();
  });

  test("book class with entitlement", async ({ page }) => {
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);

    await openBookingFormFromFirstAvailableSlot(page, SEEDED_SERVICE_SLUG);
    await submitBookingWithPaymentOption(page, /Use Existing Plan/i);

    await expect(page).toHaveURL(new RegExp(`/book-a-class/${SEEDED_SERVICE_SLUG}/confirmed\\?bookingId=`));
    await expect(page.getByRole("heading", { name: "Booking Confirmed" })).toBeVisible();
  });

  test("book class via Stripe checkout", async ({ page }) => {
    await signInClient(page, { email: signupEmail, password: E2E_PASSWORD });

    await openBookingFormFromFirstAvailableSlot(page, SEEDED_SERVICE_SLUG);
    await submitBookingWithPaymentOption(page, /Single Session/i);

    await expect(page).toHaveURL(new RegExp(`/book-a-class/${SEEDED_SERVICE_SLUG}/payment/success\\?bookingId=.*&session_id=`));

    const successUrl = new URL(page.url());
    const bookingId = successUrl.searchParams.get("bookingId");
    const checkoutSessionId = successUrl.searchParams.get("session_id");
    expect(bookingId).toBeTruthy();
    expect(checkoutSessionId).toBeTruthy();

    await completeStripeCheckoutForTest(page.request, checkoutSessionId as string);
    await page.goto(
      `/book-a-class/${SEEDED_SERVICE_SLUG}/payment/success?bookingId=${encodeURIComponent(bookingId as string)}&session_id=${encodeURIComponent(checkoutSessionId as string)}`,
    );

    await expect(page.getByRole("heading", { name: "Payment Confirmed" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Booking Summary" })).toBeVisible();
  });

  test("dashboard shows booking and subscription state", async ({ page }) => {
    await signInClient(page, { email: signupEmail, password: E2E_PASSWORD });
    await page.goto("/dashboard/membership");
    await expect(page.getByRole("heading", { name: "Membership & Credits" })).toBeVisible();
    await expect(page.getByText("E2E Monthly Unlimited").first()).toBeVisible();

    await page.context().clearCookies();
    await signInClient(page, { email: signupEmail, password: E2E_PASSWORD });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Client Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent Bookings" })).toBeVisible();
  });

  test("cancel booking if allowed", async ({ page }) => {
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);

    await openBookingFormFromFirstAvailableSlot(page, SEEDED_SERVICE_SLUG);
    await submitBookingWithPaymentOption(page, /Use Existing Plan/i);

    await page.goto("/dashboard/bookings");
    await page.getByRole("button", { name: "Cancel booking" }).first().click();
    await expect(page.getByText("Booking cancelled.")).toBeVisible();
  });
});

