import { expect, type Page } from "@playwright/test";

export async function openBookingFormFromFirstAvailableSlot(page: Page, serviceSlug: string, slotIndex = 0) {
  await page.goto(`/book-a-class/${serviceSlug}`);
  const slotBookButtons = page.getByRole("link", { name: /Book slot/i });
  const nextAvailabilityButton = page.getByRole("button", { name: /Check next available date/i });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.waitForLoadState("networkidle");
    if ((await slotBookButtons.count()) > slotIndex) {
      break;
    }
    if ((await nextAvailabilityButton.count()) === 0) {
      break;
    }
    await nextAvailabilityButton.click();
  }

  await expect(slotBookButtons.nth(slotIndex)).toBeVisible({ timeout: 20_000 });
  await slotBookButtons.nth(slotIndex).click();
  await expect(page).toHaveURL(new RegExp(`/book-a-class/${serviceSlug}/book\\?sessionId=`));
}

export async function submitBookingWithPaymentOption(page: Page, optionLabelContains: RegExp | string) {
  await expect(page).toHaveURL(/\/book-a-class\/[^/]+\/book\?sessionId=/, { timeout: 20_000 });
  await expect(page.getByLabel("Phone")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Phone")).toBeVisible();
  await expect(page.getByLabel("Phone")).toBeEditable();
  await page.getByLabel("Phone").fill("+32000012345");

  const paymentSelect = page.getByLabel("Select how you want to continue");
  await expect(paymentSelect).toBeVisible();
  await expect(page.getByText("Loading payment options...")).toHaveCount(0);

  let selectedValue: string | null = null;
  if (typeof optionLabelContains === "string") {
    const matchingOption = paymentSelect.locator("option", { hasText: optionLabelContains }).first();
    await expect(matchingOption).toHaveCount(1);
    selectedValue = await matchingOption.getAttribute("value");
    expect(selectedValue).toBeTruthy();
    await paymentSelect.selectOption(selectedValue as string);
  } else {
    const matchingOption = paymentSelect.locator("option").filter({ hasText: optionLabelContains }).first();
    await expect(matchingOption).toHaveCount(1);
    selectedValue = await matchingOption.getAttribute("value");
    expect(selectedValue).toBeTruthy();
    await paymentSelect.selectOption(selectedValue as string);
  }

  await expect(paymentSelect).toHaveValue(selectedValue as string);

  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();

  const cta = page.getByRole("button", { name: /Continue To Secure Checkout|Confirm Using Plan/i });
  await expect(cta).toBeEnabled();

  const usesExistingPlan =
    typeof optionLabelContains === "string"
      ? optionLabelContains.toLowerCase().includes("existing plan")
      : /existing plan/i.test(optionLabelContains.source);

  const submitResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    if (request.method() !== "POST") return false;
    const url = response.url();
    if (usesExistingPlan) return /\/api\/bookings\/[^/]+\/apply-plan$/.test(url);
    return /\/api\/checkout\/session$/.test(url);
  });

  const [, submitResponse] = await Promise.all([cta.click(), submitResponsePromise]);
  expect(submitResponse.ok()).toBeTruthy();

  const bookingPathMatch = page.url().match(/(\/book-a-class\/[^/]+)\/book\?/);
  if (bookingPathMatch) {
    if (usesExistingPlan) {
      await expect(page).not.toHaveURL(new RegExp(`${bookingPathMatch[1]}/book\\?sessionId=`), {
        timeout: 20_000,
      });
      return;
    }

    await page.waitForURL(
      (url) =>
        !new RegExp(`${bookingPathMatch[1]}/book\\?sessionId=`).test(url.toString()),
      { timeout: 20_000 },
    );
  }
}
