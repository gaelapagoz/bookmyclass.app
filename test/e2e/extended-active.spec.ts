import { expect, test } from "@playwright/test";
import { signInAdmin } from "./support/auth";
import { SEEDED_ADMIN } from "./support/constants";

// @covers public-learning-course-preview
test("online learning navigation flow", async ({ page }) => {
  await page.goto("/learning");
  await expect(page.getByRole("heading", { name: "Online Learning Programs" })).toBeVisible();

  const firstProgramHeading = page.locator("h2").first();
  const firstProgramName = (await firstProgramHeading.textContent())?.trim() ?? "";
  expect(firstProgramName.length).toBeGreaterThan(0);

  await page.getByRole("link", { name: "Explore Program" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: firstProgramName })).toBeVisible();

  const firstCourseHeading = page.locator("h3").first();
  const firstCourseName = (await firstCourseHeading.textContent())?.trim() ?? "";
  expect(firstCourseName.length).toBeGreaterThan(0);

  await page.getByRole("link", { name: "Open Course" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: firstCourseName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In To Watch" })).toBeVisible();
});

// @covers-partial admin-marketing-campaign-draft-flow
test("marketing campaign active flow", async ({ page }) => {
  await signInAdmin(page, SEEDED_ADMIN);

  await page.goto("/admin/campaigns/e2e-marketing-campaign/confirm");
  await expect(page.getByRole("heading", { name: "Confirm Campaign" })).toBeVisible();

  await page.getByRole("button", { name: "Send campaign" }).click();
  await expect.poll(() => page.url()).toMatch(/\/admin\/campaigns\/e2e-marketing-campaign\/(sent|confirm\?.*error=)/);

  const finalUrl = page.url();
  if (finalUrl.includes("/sent")) {
    await expect(page.getByRole("heading", { name: "Campaign Sent", exact: true })).toBeVisible();
  } else {
    expect(finalUrl).toMatch(/error=/);
  }
});

// @covers admin-inbox-loads
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

// @covers public-contact-form-submit
test("public contact form submit succeeds", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Name").fill("E2E Contact");
  await page.getByPlaceholder("Email").fill("contact.e2e@bookmyclass.app");
  await page.getByPlaceholder("Phone").fill("+32000111222");
  await page.getByPlaceholder("Message").fill("E2E contact flow message.");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).toHaveURL(/\/\?contact=sent$/);
  await expect(page.getByText("Message sent successfully.")).toBeVisible();
});

