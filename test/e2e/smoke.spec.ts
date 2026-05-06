import { expect, test } from "@playwright/test";
import { signInAdmin, signInClient } from "./support/auth";
import { SEEDED_ADMIN, SEEDED_CLIENT_WITH_CREDITS } from "./support/constants";

// @covers public-homepage-loads
test("public homepage loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Book a Class" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Subscription" }).first()).toBeVisible();
});

// @covers public-class-catalogue-loads
test("public class catalogue loads", async ({ page }) => {
  await page.goto("/book-a-class");
  await expect(page.getByRole("heading", { name: "Book a Class" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Book /i }).first()).toBeVisible();
});

// @covers cross-health-endpoint
test("health endpoint reports readiness state", async ({ request }) => {
  const response = await request.get("/api/health");
  expect([200, 503]).toContain(response.status());
  const payload = (await response.json()) as {
    adminLoginAbuseGuard?: { ready?: boolean };
    db?: string;
    ok?: boolean;
    runtimeEnv?: string;
    timestamp?: string;
  };
  expect(payload.timestamp).toBeTruthy();
  if (payload.runtimeEnv) {
    expect(payload.ok).toBe(false);
    expect(payload.db).toBe("unknown");
    return;
  }

  expect(payload.db).toBe("up");
  expect(payload.ok).toBe(Boolean(payload.adminLoginAbuseGuard?.ready));
});

// @covers customer-anonymous-dashboard-blocked
test("anonymous user is redirected away from dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=/);
});

// @covers admin-private-layout-guard
test("anonymous user is redirected away from admin private area", async ({ page }) => {
  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/admin$/);
});

// @covers admin-sign-in
// @covers admin-dashboard-loads
test("admin sign-in works", async ({ page }) => {
  await signInAdmin(page, SEEDED_ADMIN);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

// @covers customer-sign-in
test("client sign-in works", async ({ page }) => {
  await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);
  await expect(page.getByRole("heading", { name: "Client Dashboard" })).toBeVisible();
});
