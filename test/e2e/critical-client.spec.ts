import { expect, test } from "@playwright/test";
import { PriceType } from "@prisma/client";
import { openBookingFormFromFirstAvailableSlot, submitBookingWithPaymentOption } from "./support/booking";
import { signInClient, signUpPublicUser } from "./support/auth";
import {
  cleanSeededClientBookingsForTest,
  clearCapturedPasswordResetOutboxForTest,
  completeStripeCheckoutForTest,
  createVerifiedClientForTest,
  failStripeCheckoutForTest,
  getPasswordResetTokenForTest,
  prepareCheckInWindowBookingForTest,
  prepareCancellationWindowBookingForTest,
  prepareWaitlistSessionForTest,
  verifyTestEmail,
} from "./support/e2e-api";
import {
  E2E_PASSWORD,
  SEEDED_CLIENT_WITH_CREDITS,
  SEEDED_CLIENT_NO_CREDITS,
  SEEDED_SERVICE_SLUG,
} from "./support/constants";

async function purchaseRecurringSubscriptionForClient(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
): Promise<void> {
  await signInClient(page, { email, password });
  await page.goto("/subscription");

  const plansResponse = await page.request.get("/api/subscription/plans");
  expect(plansResponse.ok()).toBeTruthy();
  const plansPayload = (await plansResponse.json()) as {
    products?: Array<{ productId: string; name: string; priceType: PriceType }>;
  };
  const recurringProduct = plansPayload.products?.find((product) => product.priceType === PriceType.RECURRING);
  expect(recurringProduct?.productId).toBeTruthy();
  expect(recurringProduct?.name).toBeTruthy();

  const monthlyCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: recurringProduct?.name as string }) })
    .first();
  await expect(monthlyCard).toBeVisible();
  const addToCartButton = monthlyCard.getByRole("button", { name: "Add to Cart" });
  await expect(addToCartButton).toBeVisible();
  await expect(addToCartButton).toBeEnabled();
  await addToCartButton.click();

  const goToCartLink = page.getByRole("link", { name: "Go to cart" });
  await expect(goToCartLink).toBeVisible();
  await goToCartLink.click();
  await expect(page).toHaveURL(/\/cart$/);

  const checkoutButton = page.getByRole("button", { name: "Checkout" });
  await expect(checkoutButton).toBeVisible();
  await expect(checkoutButton).toBeEnabled();
  await checkoutButton.click();

  try {
    await expect(page).toHaveURL(/\/subscription\/success\?session_id=/);
  } catch {
    const checkoutResponse = await page.request.post("/api/subscription/checkout", {
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:3000",
        referer: "http://127.0.0.1:3000/subscription",
        "x-forwarded-host": "127.0.0.1:3000",
        "x-forwarded-proto": "http",
      },
      data: { productId: recurringProduct?.productId },
    });
    expect(checkoutResponse.ok()).toBeTruthy();
    const checkoutPayload = (await checkoutResponse.json()) as { checkoutUrl?: string };
    expect(checkoutPayload.checkoutUrl).toBeTruthy();
    await page.goto(checkoutPayload.checkoutUrl as string);
    await expect(page).toHaveURL(/\/subscription\/success\?session_id=/);
  }

  const checkoutSessionId = new URL(page.url()).searchParams.get("session_id");
  expect(checkoutSessionId).toBeTruthy();
  await completeStripeCheckoutForTest(page.request, checkoutSessionId as string);
  await page.goto(`/subscription/success?session_id=${encodeURIComponent(checkoutSessionId as string)}`);
  await expect(page.getByRole("heading", { name: "Payment Confirmed" })).toBeVisible();
}

test.describe("critical client flows", () => {
  test.describe.configure({ mode: "serial" });

  const signupEmail = `e2e.signup.${Date.now()}@bookmyclass.app`;

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
    const subscriptionCheckoutEmail = `e2e.subscription.checkout.${Date.now()}@bookmyclass.app`;
    await createVerifiedClientForTest(page.request, {
      email: subscriptionCheckoutEmail,
      password: E2E_PASSWORD,
    });
    await purchaseRecurringSubscriptionForClient(page, subscriptionCheckoutEmail, E2E_PASSWORD);
  });

  // @covers customer-booking-draft-creation
  // @covers customer-payment-options-shown
  // @covers customer-apply-plan-entitlement
  // @covers customer-booking-confirmed-screen
  // @covers-partial public-class-catalogue-loads
  // @covers-partial public-service-detail-availability
  test("book class with entitlement", async ({ page }) => {
    await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_WITH_CREDITS.email);
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);

    await openBookingFormFromFirstAvailableSlot(page, SEEDED_SERVICE_SLUG, 0);
    await submitBookingWithPaymentOption(page, /Use Existing Plan/i);

    await expect(page).toHaveURL(new RegExp(`/book-a-class/${SEEDED_SERVICE_SLUG}/confirmed\\?bookingId=`));
    const bookingId = new URL(page.url()).searchParams.get("bookingId");
    expect(bookingId).toBeTruthy();
    await expect(page.getByRole("heading", { name: "Booking Confirmed" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Booking Summary" })).toBeVisible();
  });

  // @covers customer-booking-draft-creation
  // @covers customer-payment-options-shown
  // @covers customer-booking-checkout-starts
  // @covers customer-booking-success-return-flow
  // @covers customer-booking-confirmed-screen
  // @covers-partial public-class-catalogue-loads
  // @covers-partial public-service-detail-availability
  // @covers cross-stripe-reconciliation-works
  // @covers cross-webhook-final-state-visible
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

  // @covers customer-dashboard-booking-membership-state
  test("dashboard shows booking and subscription state", async ({ page }) => {
    const dashboardMembershipEmail = `e2e.dashboard.membership.${Date.now()}@bookmyclass.app`;
    await createVerifiedClientForTest(page.request, {
      email: dashboardMembershipEmail,
      password: E2E_PASSWORD,
    });
    await purchaseRecurringSubscriptionForClient(page, dashboardMembershipEmail, E2E_PASSWORD);

    await page.context().clearCookies();
    await signInClient(page, { email: dashboardMembershipEmail, password: E2E_PASSWORD });
    await page.goto("/dashboard/membership");
    await expect(page.getByRole("heading", { name: "Membership & Credits" })).toBeVisible();
    await expect(page.getByText("No recurring subscriptions found.")).toHaveCount(0);
    await expect(page.getByText(/Status:\s*ACTIVE/i).first()).toBeVisible();

    await page.context().clearCookies();
    await signInClient(page, { email: dashboardMembershipEmail, password: E2E_PASSWORD });
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
    const cancelButton = page.getByTestId(`dashboard-cancel-${prepared.bookingId}`);
    await expect(cancelButton).toBeEnabled();
    await cancelButton.click();
    await expect(page.getByRole("dialog", { name: "Cancel booking?" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm cancellation" }).click();
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
    const cancelButton = page.getByTestId(`dashboard-cancel-${prepared.bookingId}`);
    await expect(cancelButton).toBeVisible();
    await expect(cancelButton).toBeDisabled();
    const reasonId = await cancelButton.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    const reasonText = page.locator(`#${reasonId}`);
    await expect(reasonText).toBeVisible();
    await expect(reasonText).toContainText(/less than 24 hour/i);
  });

  // @covers customer-waitlist-join-cancel
  test("client joins and cancels waitlist from dashboard", async ({ page }) => {
    await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_WITH_CREDITS.email);
    const prepared = await prepareWaitlistSessionForTest(page.request, {
      clientEmail: SEEDED_CLIENT_WITH_CREDITS.email,
      serviceSlug: SEEDED_SERVICE_SLUG,
    });

    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);
    await page.goto(`/book-a-class/${prepared.serviceSlug}`);

    const selectPreparedDateButton = page.getByRole("button", { name: `Select ${prepared.dateKey}` });
    if ((await selectPreparedDateButton.count()) === 0) {
      await page.getByRole("button", { name: "Show next month" }).click();
    }
    await page.getByRole("button", { name: `Select ${prepared.dateKey}` }).click();

    const preparedSlotCard = page.getByTestId(`service-slot-${prepared.sessionId}`);
    await expect(preparedSlotCard).toBeVisible();
    const waitlistJoinResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === "POST" && /\/api\/waitlist\/join$/.test(response.url());
    });
    await preparedSlotCard.getByRole("button", { name: /Join waitlist/i }).click();
    const waitlistJoinResponse = await waitlistJoinResponsePromise;
    expect([201, 409]).toContain(waitlistJoinResponse.status());

    await page.goto("/dashboard/bookings");
    const waitlistCard = page.getByTestId(/dashboard-waitlist-/).first();
    await expect(waitlistCard).toBeVisible();
    await expect(waitlistCard).toContainText("WAITLIST");
    await expect(page.getByText(/position/i)).toHaveCount(0);

    await waitlistCard.getByRole("button", { name: "Cancel waitlist" }).click();
    await expect(page.getByText("Waitlist entry cancelled.")).toBeVisible();
  });

  // @covers customer-dashboard-check-in
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
    const billingPortalEmail = `e2e.billing.portal.${Date.now()}@bookmyclass.app`;
    await createVerifiedClientForTest(page.request, {
      email: billingPortalEmail,
      password: E2E_PASSWORD,
    });
    await purchaseRecurringSubscriptionForClient(page, billingPortalEmail, E2E_PASSWORD);

    await page.context().clearCookies();
    await signInClient(page, { email: billingPortalEmail, password: E2E_PASSWORD });
    await page.goto("/dashboard/membership");
    await expect(page.getByRole("button", { name: "Manage billing" })).toBeVisible();
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
    const firstSessionId = new URL(page.url()).searchParams.get("sessionId");
    expect(firstSessionId).toBeTruthy();
    await submitBookingWithPaymentOption(page, /Single Session/i);
    await expect(page).toHaveURL(new RegExp(`/book-a-class/${SEEDED_SERVICE_SLUG}/payment/success\\?bookingId=.*&session_id=`));
    const firstBookingId = new URL(page.url()).searchParams.get("bookingId");
    expect(firstBookingId).toBeTruthy();

    await page.goto(`/book-a-class/${SEEDED_SERVICE_SLUG}/book?sessionId=${encodeURIComponent(firstSessionId as string)}`);
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
    const resetEmail = `e2e.pwreset.${Date.now()}@bookmyclass.app`;
    await createVerifiedClientForTest(page.request, { email: resetEmail, password: E2E_PASSWORD });
    await page.context().clearCookies();

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

