import { expect, test } from "@playwright/test";

import { signInClient, signInTeacher } from "./support/auth";
import { cleanSeededClientBookingsForTest, createUnassignedTeacherSessionForTest } from "./support/e2e-api";
import { SEEDED_CLIENT_WITH_CREDITS, SEEDED_TEACHER } from "./support/constants";

test.describe("teacher flow", () => {
  test.describe.configure({ mode: "serial" });

  // @covers teacher-allowed
  // @covers teacher-sessions-page-loads
  // @covers teacher-session-detail-loads
  // @covers teacher-mutation-action-works
  test("teacher can sign in, view own sessions, and manage own class roster", async ({ page }) => {
    await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_WITH_CREDITS.email);
    await signInTeacher(page, SEEDED_TEACHER);

    await expect(page.getByRole("heading", { name: "Teacher Dashboard" })).toBeVisible();

    await page.goto("/teacher/sessions");
    await expect(page.getByRole("heading", { name: "My Sessions" })).toBeVisible();

    // Seeded sessions are created 72h/96h ahead; if they spill into next week, move forward once.
    const sessionLink = page.getByRole("link", { name: /E2E Flow Class - E2E Session/ }).first();
    if ((await sessionLink.count()) === 0) {
      await page.getByRole("link", { name: "Next week" }).click();
    }
    await expect(sessionLink).toBeVisible();
    await sessionLink.click();
    await expect(page.getByTestId("teacher-session-roster")).toBeVisible();

    const clientOptionValue = await page
      .getByRole("option", { name: /client\.e2e@bookmyclass\.local/i })
      .getAttribute("value");
    expect(clientOptionValue).toBeTruthy();
    await page.getByRole("combobox", { name: "Client" }).selectOption(clientOptionValue as string);
    await page.getByRole("button", { name: "Add client" }).click();

    await expect(page.getByText("Attendee added.")).toBeVisible();
    await expect(page.getByText("E2E Client Credits").first()).toBeVisible();
  });

  test("teacher cannot manage another teacher class roster", async ({ page }) => {
    await signInTeacher(page, SEEDED_TEACHER);
    const unassignedSessionId = await createUnassignedTeacherSessionForTest(page.request);

    await page.goto(`/teacher/sessions/${encodeURIComponent(unassignedSessionId)}`);
    await expect(page).toHaveURL(/\/teacher\/sessions\?error=/);
    await expect(page.getByRole("heading", { name: "My Sessions" })).toBeVisible();
  });

  // @covers teacher-client-blocked
  test("non-teacher user is blocked from teacher area", async ({ page }) => {
    await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);
    await page.goto("/teacher");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  // @covers teacher-anonymous-blocked
  test("anonymous user is blocked from teacher area", async ({ page }) => {
    await page.goto("/teacher");
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=/);
  });

  // @covers teacher-profile-page-loads
  test("teacher profile page loads", async ({ page }) => {
    await signInTeacher(page, SEEDED_TEACHER);
    await page.goto("/teacher/profile");
    await expect(page.getByRole("heading", { name: "My Teacher Profile" })).toBeVisible();
  });
});
