import { expect, test } from "@playwright/test";
import { signInAdmin, signInClient } from "./support/auth";
import { SEEDED_ADMIN, SEEDED_CLIENT_WITH_CREDITS } from "./support/constants";

test("public homepage loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Book a Class" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Subscription" }).first()).toBeVisible();
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
