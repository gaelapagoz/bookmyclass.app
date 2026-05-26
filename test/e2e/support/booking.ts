import { expect, type Page } from "@playwright/test";

export async function openBookingFormFromFirstAvailableSlot(page: Page, serviceSlug: string, slotIndex = 0) {
  await page.goto(`/book-a-class/${serviceSlug}`);
  const slotBookButtons = page.getByRole("link", { name: /Book slot/i });
  await expect(slotBookButtons.nth(slotIndex)).toBeVisible();
  await slotBookButtons.nth(slotIndex).click();
  await expect(page).toHaveURL(new RegExp(`/book-a-class/${serviceSlug}/book\\?sessionId=`));
}

export async function submitBookingWithPaymentOption(page: Page, optionLabelContains: RegExp | string) {
  await expect(page.getByRole("heading", { name: "Booking Details" })).toBeVisible();
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
  await cta.click();
}
