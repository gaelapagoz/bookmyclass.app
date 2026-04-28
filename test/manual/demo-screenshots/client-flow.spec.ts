import { test } from "@playwright/test";
import { capture, demoServiceSlug, signInAsClient } from "./helpers";

test.describe("client flow screenshots", () => {
  test.describe.configure({ mode: "serial" });

  test("01 public home page", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await capture(page, "client-01-public-home.png");
  });

  test("02 book a class discovery", async ({ page }) => {
    await page.goto("/book-a-class");
    await page.waitForLoadState("networkidle");
    await capture(page, "client-02-book-a-class.png");
  });

  test("03 class detail and slot selection", async ({ page }) => {
    await page.goto(`/book-a-class/${demoServiceSlug}`);
    await page.waitForLoadState("networkidle");
    await capture(page, "client-03-class-detail-or-slot-selection.png");
  });

  test("04 client sign-in page", async ({ page }) => {
    await page.goto("/sign-in");
    await page.waitForLoadState("networkidle");
    await capture(page, "client-04-client-sign-in.png");
  });

  // Captures the booking form (05) then proceeds to checkout handoff (06).
  // For Stripe-paid flows the script clicks the CTA and screenshots wherever
  // the browser lands — Stripe checkout or an in-app confirmation — without
  // completing the payment.
  test("05-06 payment options and checkout handoff", async ({ page }) => {
    await signInAsClient(page);

    await page.goto(`/book-a-class/${demoServiceSlug}`);
    await page.waitForLoadState("networkidle");

    const bookSlotLinks = page.getByRole("link", { name: /Book slot/i });
    if ((await bookSlotLinks.count()) > 0) {
      await bookSlotLinks.first().click();
      await page.waitForLoadState("networkidle");
    }

    await capture(page, "client-05-payment-options.png");

    // Fill required booking form fields before proceeding to checkout.
    const phoneInput = page.getByLabel("Phone");
    if (await phoneInput.isVisible()) {
      await phoneInput.fill("+32000012345");
    }

    const paymentSelect = page.getByLabel("Select how you want to continue");
    if (await paymentSelect.isVisible()) {
      // Select the first real option (index 1 skips any placeholder at index 0).
      await paymentSelect.selectOption({ index: 1 }).catch(() => {});
    }

    const checkboxes = page.getByRole("checkbox");
    for (let i = 0, n = await checkboxes.count(); i < n; i++) {
      await checkboxes.nth(i).check().catch(() => {});
    }

    const cta = page.getByRole("button", { name: /Continue To Secure Checkout|Confirm Using Plan/i });
    if ((await cta.count()) > 0 && (await cta.isEnabled())) {
      await cta.click();
      // Wait for whatever page loads (our app or Stripe hosted checkout).
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }

    await capture(page, "client-06-checkout-handoff-or-confirmation.png");
  });

  test("07 client dashboard bookings", async ({ page }) => {
    await signInAsClient(page);
    await page.goto("/dashboard/bookings");
    await page.waitForLoadState("networkidle");
    await capture(page, "client-07-client-dashboard-bookings.png");
  });
});
