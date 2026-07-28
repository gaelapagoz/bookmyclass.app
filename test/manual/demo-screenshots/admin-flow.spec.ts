import { test } from "@playwright/test";
import { capture, signInAsAdmin } from "./helpers";

test.describe("admin flow screenshots", () => {
  test.describe.configure({ mode: "serial" });

  test("01 admin login page", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    await capture(page, "admin-01-admin-login.png");
  });

  test("02 admin dashboard", async ({ page }) => {
    await signInAsAdmin(page);
    // signInAsAdmin lands on /admin/dashboard – wait for it to fully settle.
    await page.waitForLoadState("networkidle");
    await capture(page, "admin-02-admin-dashboard.png");
  });

  test("03 admin schedule and classes", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/sessions");
    await page.waitForLoadState("networkidle");
    await capture(page, "admin-03-admin-schedule-classes.png");
  });

  test("04 admin products and subscriptions", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/plans");
    await page.waitForLoadState("networkidle");
    await capture(page, "admin-04-admin-products-subscriptions.png");
  });

  // Admin users list may show real-looking e-mail addresses.
  // Run only against demo/seeded environments with non-production data.
  test("05 admin users", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/users");
    await page.waitForLoadState("networkidle");
    await capture(page, "admin-05-admin-users.png");
  });

  test("06 admin learning content", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/learning-programs");
    await page.waitForLoadState("networkidle");
    await capture(page, "admin-06-admin-learning-content.png");
  });

  test("07 admin marketing and inbox", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/campaigns");
    await page.waitForLoadState("networkidle");
    await capture(page, "admin-07-admin-marketing-inbox.png");
  });
});
