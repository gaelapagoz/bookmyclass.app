import { expect, type Page } from "@playwright/test";

export async function openBookingFormFromFirstAvailableSlot(page: Page, serviceSlug: string) {
  await page.goto(`/book-a-class/${serviceSlug}`);
  const slotBookButton = page.getByRole("link", { name: /Book slot/i }).first();
  await expect(slotBookButton).toBeVisible();
  await slotBookButton.click();
  await expect(page).toHaveURL(new RegExp(`/book-a-class/${serviceSlug}/book\\?sessionId=`));
}

export async function submitBookingWithPaymentOption(page: Page, optionLabelContains: RegExp | string) {
  await page.getByLabel("Phone").fill("+32000012345");

  const paymentSelect = page.getByLabel("Select how you want to continue");
  if (typeof optionLabelContains === "string") {
    await paymentSelect.selectOption({ label: optionLabelContains });
  } else {
    const matchingOption = paymentSelect.locator("option").filter({ hasText: optionLabelContains }).first();
    await expect(matchingOption).toHaveCount(1);
    const optionValue = await matchingOption.getAttribute("value");
    expect(optionValue).toBeTruthy();
    await paymentSelect.selectOption(optionValue as string);
  }

  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  const cta = page.getByRole("button", { name: /Continue To Secure Checkout|Confirm Using Plan/i });
  await cta.click();

  if (/\/book-a-class\/[^/]+\/book\?sessionId=/.test(page.url())) {
    const retryCta = page.getByRole("button", { name: /Continue To Secure Checkout|Confirm Using Plan/i });
    if ((await retryCta.count()) > 0) {
      await retryCta.first().click();
    }
  }
}
