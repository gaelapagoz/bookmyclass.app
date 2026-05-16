import { expect, test, type Page } from "@playwright/test";
import { SEEDED_CANONICAL_EMAILS, SEEDED_USER_PASSWORD } from "../../../prisma/seed/seed-credentials";

type CredentialKey = "UAT_E2E_EMAIL" | "UAT_E2E_PASSWORD" | "UAT_E2E_ADMIN_EMAIL" | "UAT_E2E_ADMIN_PASSWORD";

function requiredEnv(name: CredentialKey): string {
  const value = process.env[name]?.trim();
  if (!value && !process.env.CI) {
    if (name === "UAT_E2E_EMAIL") return SEEDED_CANONICAL_EMAILS.e2eClient;
    if (name === "UAT_E2E_PASSWORD") return SEEDED_USER_PASSWORD;
    if (name === "UAT_E2E_ADMIN_EMAIL") return SEEDED_CANONICAL_EMAILS.e2eAdmin;
    if (name === "UAT_E2E_ADMIN_PASSWORD") return SEEDED_USER_PASSWORD;
  }
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function expectHomePageMarker(page: Page) {
  const body = await page.locator("body").innerText();
  const hasPrimaryCta = body.includes("Book a Class");
  const hasAppHeroMarker = body.includes("Yoga Pilates Fitness Studio");
  expect(hasPrimaryCta || hasAppHeroMarker).toBeTruthy();
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

test.describe("deployed staging (UAT-backed) release checks", () => {
  test("public release-critical pages are reachable", async ({ page }) => {
    await page.goto("/");
    await expectHomePageMarker(page);

    await page.goto("/admin");
    await expect(page).not.toHaveURL(/500/);

    await page.goto("/book-a-class");
    await expect(page).toHaveURL(/\/book-a-class/);

    await page.goto("/subscription");
    await expect(page).toHaveURL(/\/subscription/);

    await page.goto("/store");
    await expect(page).not.toHaveURL(/500/);
  });

  test("client login reaches dashboard and key release surfaces", async ({ page }) => {
    await signIn(page, requiredEnv("UAT_E2E_EMAIL"), requiredEnv("UAT_E2E_PASSWORD"));

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Client Dashboard" })).toBeVisible();

    await page.goto("/subscription");
    await expect(page.getByText(/\b(EUR|month|session|class)\b/i).first()).toBeVisible();

    await page.goto("/book-a-class");
    await expect(page.getByText(/\b(book|class|session|checkout|payment)\b/i).first()).toBeVisible();

    await page.goto("/store");
    const storeUnavailable = await page.getByText(/not found/i).first().isVisible().catch(() => false);
    if (!storeUnavailable) {
      await expect(page.getByText(/\b(gift|card|merch|store)\b/i).first()).toBeVisible();
    }
  });

  test("admin login reaches admin dashboard or sessions", async ({ page }) => {
    const adminEmail = requiredEnv("UAT_E2E_ADMIN_EMAIL");
    const adminPassword = requiredEnv("UAT_E2E_ADMIN_PASSWORD");

    await signIn(page, adminEmail, adminPassword);
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/sign-in/);

    const body = await page.locator("body").innerText();
    const hasAdminMarker =
      body.includes("Admin") ||
      body.includes("Sessions") ||
      body.includes("Dashboard") ||
      body.includes("Clients");

    expect(hasAdminMarker).toBeTruthy();
  });
});
