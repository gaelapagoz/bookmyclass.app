import { expect, test } from "@playwright/test";
import { signInAdmin } from "./support/auth";
import { SEEDED_ADMIN } from "./support/constants";

test("online learning navigation flow", async ({ page }) => {
  await page.goto("/learning");
  await expect(page.getByRole("heading", { name: "Online Learning Programs" })).toBeVisible();

  await page.getByRole("link", { name: "Explore Program" }).first().click();
  await expect(page.getByRole("heading", { name: "E2E Program" })).toBeVisible();

  await page.getByRole("link", { name: "Open Course" }).first().click();
  await expect(page.getByRole("heading", { name: "E2E Course Video" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In To Watch" })).toBeVisible();
});

test("marketing campaign active flow", async ({ page }) => {
  await signInAdmin(page, SEEDED_ADMIN);

  await page.goto("/admin/marketing/campaigns/e2e-marketing-campaign/confirm");
  await expect(page.getByRole("heading", { name: "Confirm Campaign" })).toBeVisible();

  await page.getByRole("button", { name: "Send campaign" }).click();
  await expect.poll(() => page.url()).toMatch(/\/admin\/marketing\/campaigns\/e2e-marketing-campaign\/(sent|confirm\?.*error=)/);

  const finalUrl = page.url();
  if (finalUrl.includes("/sent")) {
    await expect(page.getByRole("heading", { name: "Campaign Sent", exact: true })).toBeVisible();
  } else {
    expect(finalUrl).toMatch(/error=/);
  }
});

test("inbox review flow", async ({ page }) => {
  await signInAdmin(page, SEEDED_ADMIN);

  await page.goto("/admin/inbox");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();

  const firstRow = page.locator("li").filter({ hasText: "E2E Inbox Message" }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.getByRole("combobox").selectOption("READ");
  await firstRow.getByRole("button", { name: "Update" }).click();

  await expect(firstRow.getByRole("combobox")).toHaveValue("READ");
});
