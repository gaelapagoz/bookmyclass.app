import { expect, test } from "@playwright/test";

import { signInAdmin, signInClient, signInTeacher } from "./support/auth";
import { SEEDED_ADMIN, SEEDED_CLIENT_WITH_CREDITS, SEEDED_TEACHER } from "./support/constants";

test.describe("staff entry via /admin", () => {
  test("teacher signs in from /admin and lands in /teacher", async ({ page }) => {
    await signInTeacher(page, SEEDED_TEACHER);
    await expect(page.getByRole("heading", { name: "Teacher Dashboard" })).toBeVisible();
  });

  // @covers admin-sign-in
  test("admin signs in from /admin and lands in admin private area", async ({ page }) => {
    await signInAdmin(page, SEEDED_ADMIN);
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
  });

  // @covers admin-non-admin-denied
  // @covers-partial admin-private-layout-guard
  test("non-staff is blocked from staff entry", async ({ page }) => {
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);
    await page.goto("/admin");
    await expect(page.getByText("does not have staff access", { exact: false })).toBeVisible();
  });

  // @covers admin-non-admin-denied
  test("teacher cannot access admin private area", async ({ page }) => {
    await signInTeacher(page, SEEDED_TEACHER);
    await page.goto("/admin/dashboard");
    await expect(page).toHaveURL(/\/teacher$/);
  });
});
