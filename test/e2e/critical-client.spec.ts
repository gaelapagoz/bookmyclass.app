import { expect, test } from "@playwright/test";
import { openBookingFormFromFirstAvailableSlot, submitBookingWithPaymentOption } from "./support/booking";
import { signInClient, signUpPublicUser } from "./support/auth";
import {
  cleanSeededClientBookingsForTest,
  clearCapturedPasswordResetOutboxForTest,
  completeStripeCheckoutForTest,
  failStripeCheckoutForTest,
  getPasswordResetTokenForTest,
  prepareCheckInWindowBookingForTest,
  prepareCancellationWindowBookingForTest,
  verifyTestEmail,
} from "./support/e2e-api";
import {
  E2E_PASSWORD,
  SEEDED_CLIENT_WITH_CREDITS,
  SEEDED_CLIENT_NO_CREDITS,
  SEEDED_SERVICE_SLUG,
} from "./support/constants";

test.describe("critical client flows", () => {
  test.describe.configure({ mode: "serial" });

  const signupEmail = `e2e.signup.${Date.now()}@example.test`;

  // @covers customer-sign-up
  // @covers customer-verify-email
  // @covers customer-sign-in
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

  // @covers customer-subscription-catalogue-loads
  // @covers customer-subscription-checkout-starts
  // @covers customer-subscription-success-return-flow
  // @covers cross-stripe-reconciliation-works
  // @covers cross-webhook-final-state-visible
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

  // @covers customer-booking-draft-creation
  // @covers customer-payment-options-shown
  // @covers customer-booking-checkout-starts
  // @covers customer-booking-success-return-flow
  // @covers-partial customer-browse-class-catalogue
  // @covers-partial customer-service-detail-loads
  // @covers-partial customer-availability-browsing
  // @covers cross-stripe-reconciliation-works
  // @covers cross-webhook-final-state-visible
  test("book class with entitlement", async ({ page }) => {
    await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_WITH_CREDITS.email);
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);

    await openBookingFormFromFirstAvailableSlot(page, SEEDED_SERVICE_SLUG, 0);
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
  });

  // @covers customer-booking-draft-creation
  // @covers customer-payment-options-shown
  // @covers customer-booking-checkout-starts
  // @covers customer-booking-success-return-flow
  // @covers customer-booking-confirmed-screen
  // @covers-partial customer-browse-class-catalogue
  // @covers-partial customer-service-detail-loads
  // @covers-partial customer-availability-browsing
  test("book class via Stripe checkout", async ({ page }) => {
    await signInClient(page, { email: signupEmail, password: E2E_PASSWORD });

    await openBookingFormFromFirstAvailableSlot(page, SEEDED_SERVICE_SLUG, 0);
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

  // @covers customer-cancel-booking-before-cutoff
  // @covers cross-cancellation-policy-enforced
  test("cancel booking if allowed", async ({ page }) => {
    await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_WITH_CREDITS.email);
    const prepared = await prepareCancellationWindowBookingForTest(page.request, {
      clientEmail: SEEDED_CLIENT_WITH_CREDITS.email,
      mode: "early",
    });
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);

    await page.goto("/dashboard/bookings");
    const bookingCard = page.getByTestId(`dashboard-booking-${prepared.bookingId}`);
    const cancelButton = page.getByTestId(`dashboard-cancel-${prepared.bookingId}`);
    await expect(cancelButton).toBeEnabled();
    await cancelButton.click();
    await expect(page.getByText("Booking cancelled.")).toBeVisible();
  });

  // @covers customer-cancel-booking-after-cutoff
  // @covers cross-cancellation-policy-enforced
  test("cancel booking is blocked after cutoff", async ({ page }) => {
    await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_WITH_CREDITS.email);
    const prepared = await prepareCancellationWindowBookingForTest(page.request, {
      clientEmail: SEEDED_CLIENT_WITH_CREDITS.email,
      mode: "late",
    });
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);

    await page.goto("/dashboard/bookings");
    const bookingCard = page.getByTestId(`dashboard-booking-${prepared.bookingId}`);
    const cancelButton = page.getByTestId(`dashboard-cancel-${prepared.bookingId}`);
    await expect(cancelButton).toBeVisible();
    await expect(cancelButton).toBeDisabled();
    const reasonId = await cancelButton.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    const reasonText = page.locator(`#${reasonId}`);
    await expect(reasonText).toBeVisible();
    await expect(reasonText).toContainText(/less than 24 hour/i);
  });

  test("dashboard self check-in succeeds within window", async ({ page }) => {
    await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_WITH_CREDITS.email);
    const prepared = await prepareCheckInWindowBookingForTest(page.request, {
      clientEmail: SEEDED_CLIENT_WITH_CREDITS.email,
    });
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);

    await page.goto("/dashboard/bookings");
    const bookingCard = page.getByTestId(`dashboard-booking-${prepared.bookingId}`);
    await expect(bookingCard).toBeVisible();
    await page.getByTestId(`dashboard-check-in-${prepared.bookingId}`).click();

    await expect(page.getByText("Successfully checked in!")).toBeVisible();
    await expect(page.getByTestId(`dashboard-checked-in-${prepared.bookingId}`)).toBeVisible();
  });

  // @covers customer-kiosk-blocked
  test("client is blocked from kiosk routes", async ({ page }) => {
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);
    await page.goto("/kiosk");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  // @covers customer-dashboard-profile-page
  test("dashboard profile page loads expected state", async ({ page }) => {
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);
    await page.goto("/dashboard/profile");
    await expect(page.getByRole("heading", { name: "My Profile" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Profile" })).toBeVisible();
  });

  // @covers-partial customer-billing-portal-access
  test("membership page exposes billing portal initiation", async ({ page }) => {
    await signInClient(page, { email: signupEmail, password: E2E_PASSWORD });
    await page.goto("/dashboard/membership");
    await page.getByRole("button", { name: "Manage billing" }).click();
    await expect(page.getByText("Opening billing...")).toBeVisible();
  });

  // @covers customer-forgot-password
  test("forgot password flow can be initiated", async ({ page }) => {
    const resetEmail = signupEmail;
    await clearCapturedPasswordResetOutboxForTest(page.request, resetEmail);
    await page.context().clearCookies();
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(resetEmail);
    await page.getByRole("button", { name: "Send Reset Link" }).click();
    await expect(page).toHaveURL(/\/forgot-password\?sent=1$/);
  });

  // @covers cross-duplicate-booking-blocked
  test("duplicate booking draft resolves to same pending booking", async ({ page }) => {
    await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_WITH_CREDITS.email);
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);

    await openBookingFormFromFirstAvailableSlot(page, SEEDED_SERVICE_SLUG, 0);
    await submitBookingWithPaymentOption(page, /Single Session/i);
    await expect(page).toHaveURL(new RegExp(`/book-a-class/${SEEDED_SERVICE_SLUG}/payment/success\\?bookingId=.*&session_id=`));
    const firstBookingId = new URL(page.url()).searchParams.get("bookingId");
    expect(firstBookingId).toBeTruthy();

    await openBookingFormFromFirstAvailableSlot(page, SEEDED_SERVICE_SLUG, 0);
    await submitBookingWithPaymentOption(page, /Single Session/i);
    await expect(page).toHaveURL(new RegExp(`/book-a-class/${SEEDED_SERVICE_SLUG}/payment/success\\?bookingId=.*&session_id=`));
    const secondBookingId = new URL(page.url()).searchParams.get("bookingId");
    expect(secondBookingId).toBe(firstBookingId);
  });

  // @covers cross-ineligible-booking-blocked
  test("apply-plan rejects ineligible entitlement", async ({ page }) => {
    await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_NO_CREDITS.email);
    await signInClient(page, SEEDED_CLIENT_NO_CREDITS);

    await openBookingFormFromFirstAvailableSlot(page, SEEDED_SERVICE_SLUG, 0);
    await page.getByLabel("Phone").fill("+32000012345");
    await page.getByRole("checkbox").nth(0).check();
    await page.getByRole("checkbox").nth(1).check();
    await page.getByRole("button", { name: /Continue To Secure Checkout|Confirm Using Plan/i }).click();

    await expect(page).toHaveURL(
      new RegExp(`/book-a-class/${SEEDED_SERVICE_SLUG}/payment(?:/success)?\\?bookingId=`),
    );
    const bookingId = new URL(page.url()).searchParams.get("bookingId");
    expect(bookingId).toBeTruthy();

    const response = await page.request.post(`/api/bookings/${encodeURIComponent(bookingId as string)}/apply-plan`, {
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3000",
        referer: "http://127.0.0.1:3000/test",
        "x-forwarded-host": "127.0.0.1:3000",
        "x-forwarded-proto": "http",
      },
      data: {
        mode: "EXISTING_PLAN",
        entitlementId: "entitlement_missing_1234",
      },
    });

    expect(response.status()).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "PLAN_NOT_FOUND" });
  });

  // @covers cross-payment-failure-handled
  test("failed checkout shows safe payment failure outcome", async ({ page }) => {
    await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_WITH_CREDITS.email);
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);

    await openBookingFormFromFirstAvailableSlot(page, SEEDED_SERVICE_SLUG, 0);
    await submitBookingWithPaymentOption(page, /Single Session/i);
    await expect(page).toHaveURL(new RegExp(`/book-a-class/${SEEDED_SERVICE_SLUG}/payment/success\\?bookingId=.*&session_id=`));

    const successUrl = new URL(page.url());
    const bookingId = successUrl.searchParams.get("bookingId");
    const checkoutSessionId = successUrl.searchParams.get("session_id");
    expect(bookingId).toBeTruthy();
    expect(checkoutSessionId).toBeTruthy();

    await failStripeCheckoutForTest(page.request, {
      checkoutSessionId: checkoutSessionId as string,
      mode: "async_failed",
    });

    await page.goto(
      `/book-a-class/${SEEDED_SERVICE_SLUG}/payment/success?bookingId=${encodeURIComponent(bookingId as string)}&session_id=${encodeURIComponent(checkoutSessionId as string)}`,
    );

    await expect(page.getByRole("heading", { name: "Payment Failed" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Retry payment" })).toBeVisible();
  });

  // @covers cross-session-expiry-stale-booking
  test("expired checkout session results in stale booking safe outcome", async ({ page }) => {
    await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_WITH_CREDITS.email);
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);

    await openBookingFormFromFirstAvailableSlot(page, SEEDED_SERVICE_SLUG, 0);
    await submitBookingWithPaymentOption(page, /Single Session/i);
    await expect(page).toHaveURL(new RegExp(`/book-a-class/${SEEDED_SERVICE_SLUG}/payment/success\\?bookingId=.*&session_id=`));

    const successUrl = new URL(page.url());
    const bookingId = successUrl.searchParams.get("bookingId");
    const checkoutSessionId = successUrl.searchParams.get("session_id");
    expect(bookingId).toBeTruthy();
    expect(checkoutSessionId).toBeTruthy();

    await failStripeCheckoutForTest(page.request, {
      checkoutSessionId: checkoutSessionId as string,
      mode: "expired",
    });

    await page.goto(
      `/book-a-class/${SEEDED_SERVICE_SLUG}/payment/success?bookingId=${encodeURIComponent(bookingId as string)}&session_id=${encodeURIComponent(checkoutSessionId as string)}`,
    );

    await expect(page.getByRole("heading", { name: "Payment Failed" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Retry payment" })).toBeVisible();
  });

  // @covers cross-password-reset-security-flow
  // @covers customer-reset-password
  test("password reset completes and token is single-use", async ({ page }) => {
    const resetEmail = SEEDED_CLIENT_NO_CREDITS.email;
    await clearCapturedPasswordResetOutboxForTest(page.request, resetEmail);

    const resetToken = await getPasswordResetTokenForTest(page.request, resetEmail, {
      requestReset: true,
    });
    const newPassword = "E2ENewerPass123!";

    await page.goto(`/reset-password?token=${encodeURIComponent(resetToken)}`);
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Save New Password" }).click();
    await expect(page).toHaveURL(/\/sign-in\?password_reset=1$/);
    await signInClient(page, { email: resetEmail, password: newPassword });
    await expect(page.getByRole("heading", { name: "Client Dashboard" })).toBeVisible();
    await page.context().clearCookies();

    await page.goto(`/reset-password?token=${encodeURIComponent(resetToken)}`);
    await page.getByLabel("New password", { exact: true }).fill("AnotherPass123!");
    await page.getByLabel("Confirm new password").fill("AnotherPass123!");
    await page.getByRole("button", { name: "Save New Password" }).click();
    await expect(page).toHaveURL(/\/reset-password\?error=invalid_token/);
    await expect(page.getByText("Reset link is invalid or expired.")).toBeVisible();
  });
});
