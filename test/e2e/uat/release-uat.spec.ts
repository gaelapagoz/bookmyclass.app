import { expect, test } from "@playwright/test";

function requiredEnv(name: "UAT_E2E_EMAIL" | "UAT_E2E_PASSWORD"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

test.describe("deployed UAT release checks", () => {
  test("public pages are reachable", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Book a Class" }).first()).toBeVisible();

    await page.goto("/book-a-class");
    await expect(page).toHaveURL(/\/book-a-class$/);

    await page.goto("/subscription");
    await expect(page).toHaveURL(/\/subscription$/);

    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  });

  test("seeded release user can sign in and open dashboard pages", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(requiredEnv("UAT_E2E_EMAIL"));
    await page.getByLabel("Password").fill(requiredEnv("UAT_E2E_PASSWORD"));
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Client Dashboard" })).toBeVisible();

    await page.goto("/dashboard/profile");
    await expect(page.getByRole("heading", { name: "My Profile" })).toBeVisible();
  });
});
