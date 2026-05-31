import { expect, test } from "@playwright/test";

import { signInAdmin, signInClient, signInTeacher } from "./support/auth";
import {
  cleanSeededClientBookingsForTest,
  createVerifiedClientForTest,
  createUnassignedTeacherSessionForTest,
  deactivateUserForTest,
  prepareCheckInWindowBookingForTest,
  prepareWaitlistSessionForTest,
  reactivateUserForTest,
} from "./support/e2e-api";
import {
  E2E_PASSWORD,
  SEEDED_ADMIN,
  SEEDED_CLIENT_NO_CREDITS,
  SEEDED_CLIENT_WITH_CREDITS,
  SEEDED_SERVICE_SLUG,
  SEEDED_TEACHER,
} from "./support/constants";

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
      .getByRole("option", { name: /e2e-client@bookmyclass\.app/i })
      .getAttribute("value");
    expect(clientOptionValue).toBeTruthy();
    await page.getByRole("combobox", { name: "Client" }).selectOption(clientOptionValue as string);
    await page.getByRole("button", { name: "Add client" }).click();

    await expect(page.getByText("E2E Client Credits").first()).toBeVisible({ timeout: 20_000 });
  });

  // @covers-partial teacher-mutation-action-works
  // @covers-partial cross-ineligible-booking-blocked
  test("teacher cannot add client without eligible credit or qualifying subscription", async ({ page }) => {
    await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_NO_CREDITS.email);
    await signInTeacher(page, SEEDED_TEACHER);

    await page.goto("/teacher/sessions");
    const sessionLink = page.getByRole("link", { name: /E2E Flow Class - E2E Session/ }).first();
    if ((await sessionLink.count()) === 0) {
      await page.getByRole("link", { name: "Next week" }).click();
    }
    await expect(sessionLink).toBeVisible();
    await sessionLink.click();

    const clientOptionValue = await page
      .getByRole("option", { name: /e2e-client-nocredits@bookmyclass\.app/i })
      .getAttribute("value");
    expect(clientOptionValue).toBeTruthy();
    await page.getByRole("combobox", { name: "Client" }).selectOption(clientOptionValue as string);
    await page.getByRole("button", { name: "Add client" }).click();

    await expect(page.getByText("You can only add clients with eligible credit or qualifying subscription.")).toBeVisible();
    await expect(page.getByText("Attendee added.")).toHaveCount(0);
  });

  // @covers teacher-kiosk-checkin
  test("teacher can check in a client from kiosk for a selected session", async ({ page }) => {
    const isolatedClientEmail = `e2e.kiosk.${Date.now()}@bookmyclass.app`;
    const prepared = await prepareCheckInWindowBookingForTest(page.request, {
      clientEmail: isolatedClientEmail,
    });
    await signInTeacher(page, SEEDED_TEACHER);

    await page.goto(`/kiosk/${encodeURIComponent(prepared.sessionId)}`);
    await expect(page.getByRole("heading", { name: prepared.sessionTitle })).toBeVisible();
    const bookingRow = page.getByTestId(`kiosk-booking-${prepared.bookingId}`);
    await expect(bookingRow.getByText(isolatedClientEmail)).toBeVisible();
    await page.getByTestId(`kiosk-check-in-${prepared.bookingId}`).click();
    await expect(bookingRow.getByText(/^Checked In$/)).toBeVisible();
  });

  // @covers admin-kiosk-access
  test("admin can access kiosk and check in a client", async ({ page }) => {
    const isolatedClientEmail = `e2e.kiosk.admin.${Date.now()}@bookmyclass.app`;
    const prepared = await prepareCheckInWindowBookingForTest(page.request, {
      clientEmail: isolatedClientEmail,
      mode: "in_window",
    });
    await signInAdmin(page, SEEDED_ADMIN);

    await page.goto(`/kiosk/${encodeURIComponent(prepared.sessionId)}`);
    await expect(page.getByRole("heading", { name: prepared.sessionTitle })).toBeVisible();
    await expect(page.getByTestId(`kiosk-booking-${prepared.bookingId}`)).toBeVisible();
    await page.getByTestId(`kiosk-check-in-${prepared.bookingId}`).click();
    await expect(page.getByTestId(`kiosk-booking-${prepared.bookingId}`).getByText(/^Checked In$/)).toBeVisible();
  });

  // @covers teacher-kiosk-checkin-window-before-blocked
  test("kiosk check-in is blocked before check-in window", async ({ page }) => {
    const isolatedClientEmail = `e2e.kiosk.before.${Date.now()}@bookmyclass.app`;
    const prepared = await prepareCheckInWindowBookingForTest(page.request, {
      clientEmail: isolatedClientEmail,
      mode: "before_window",
    });
    await signInTeacher(page, SEEDED_TEACHER);

    await page.goto(`/kiosk/${encodeURIComponent(prepared.sessionId)}`);
    const bookingRow = page.getByTestId(`kiosk-booking-${prepared.bookingId}`);
    await expect(bookingRow.getByText(/Check-in opens at/i)).toBeVisible();
    await expect(page.getByTestId(`kiosk-check-in-${prepared.bookingId}`)).toHaveCount(0);
  });

  // @covers teacher-kiosk-checkin-window-after-blocked
  test("kiosk check-in is blocked after check-in window", async ({ page }) => {
    const isolatedClientEmail = `e2e.kiosk.after.${Date.now()}@bookmyclass.app`;
    const prepared = await prepareCheckInWindowBookingForTest(page.request, {
      clientEmail: isolatedClientEmail,
      mode: "after_window",
    });
    await signInTeacher(page, SEEDED_TEACHER);

    await page.goto(`/kiosk/${encodeURIComponent(prepared.sessionId)}`);
    const bookingRow = page.getByTestId(`kiosk-booking-${prepared.bookingId}`);
    await expect(bookingRow.getByText(/window has closed/i)).toBeVisible();
    await expect(page.getByTestId(`kiosk-check-in-${prepared.bookingId}`)).toHaveCount(0);
  });

  // @covers teacher-kiosk-private-class-excluded
  test("private class session is excluded from kiosk check-in route", async ({ page }) => {
    const isolatedClientEmail = `e2e.kiosk.private.${Date.now()}@bookmyclass.app`;
    const prepared = await prepareCheckInWindowBookingForTest(page.request, {
      clientEmail: isolatedClientEmail,
      mode: "in_window",
      classMode: "private",
    });
    await signInTeacher(page, SEEDED_TEACHER);

    await page.goto(`/kiosk/${encodeURIComponent(prepared.sessionId)}`);
    await expect(page).toHaveURL(/\/kiosk$/);
  });

  // @covers teacher-staff-attendance-marking
  test("teacher can privately mark attendance from session detail", async ({ page }) => {
    const isolatedClientEmail = `e2e.staff.attendance.${Date.now()}@bookmyclass.app`;
    const prepared = await prepareCheckInWindowBookingForTest(page.request, {
      clientEmail: isolatedClientEmail,
    });

    await signInTeacher(page, SEEDED_TEACHER);
    await page.goto(`/teacher/sessions/${encodeURIComponent(prepared.sessionId)}`);

    const attendeeRow = page.getByTestId(`teacher-attendee-${prepared.bookingId}`);
    await expect(attendeeRow).toBeVisible();
    await attendeeRow.getByRole("button", { name: "Mark attended" }).click();

    await expect(page.getByText("Attendance updated.")).toBeVisible();
    await expect(attendeeRow.getByText("Attendance: ATTENDED")).toBeVisible();
  });

  // @covers teacher-assigned-session-boundary
  test("teacher cannot manage another teacher class roster", async ({ page }) => {
    await signInTeacher(page, SEEDED_TEACHER);
    const unassignedSessionId = await createUnassignedTeacherSessionForTest(page.request);

    await page.goto(`/teacher/sessions/${encodeURIComponent(unassignedSessionId)}`);
    await expect(page).toHaveURL(/\/teacher\/sessions\?error=/);
    await expect(page.getByRole("heading", { name: "My Sessions" })).toBeVisible();
  });

  // @covers teacher-waitlist-count-readonly
  test("teacher calendar shows waitlist count without manual waitlist controls", async ({ page }) => {
    const clientEmail = `e2e.teacher.waitlist.${Date.now()}@bookmyclass.app`;
    await createVerifiedClientForTest(page.request, {
      email: clientEmail,
      password: E2E_PASSWORD,
    });
    const prepared = await prepareWaitlistSessionForTest(page.request, {
      clientEmail,
      createWaitlistEntry: true,
      serviceSlug: SEEDED_SERVICE_SLUG,
    });

    await signInTeacher(page, SEEDED_TEACHER);
    await page.goto(`/teacher/sessions?week=${prepared.dateKey}`);

    const sessionLink = page
      .locator("a[href*='/teacher/sessions/']")
      .filter({ has: page.getByText("Waitlist: 1") })
      .first();

    await expect(sessionLink).toBeVisible();
    await expect(sessionLink.getByText("Waitlist: 1")).toBeVisible();
    await expect(page.getByRole("button", { name: /join waitlist/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /cancel waitlist/i })).toHaveCount(0);
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

  // @covers teacher-db-revocation
  test("deactivated teacher is redirected after DB revocation even with valid JWT", async ({ page }) => {
    // Sign in first to obtain a valid JWT/session cookie.
    await signInTeacher(page, SEEDED_TEACHER);
    await expect(page.getByRole("heading", { name: "Teacher Dashboard" })).toBeVisible();

    // Deactivate the user in the DB â€” simulating an admin revoking access server-side.
    await deactivateUserForTest(page.request, SEEDED_TEACHER.email);

    // requireTeacherSession re-checks the DB on every request; the revocation must be enforced.
    await page.goto("/teacher");
    await expect(page).toHaveURL(/\/(dashboard|sign-in)/);

    // Restore account so subsequent serial tests can sign in as the teacher.
    await reactivateUserForTest(page.request, SEEDED_TEACHER.email);
  });

  // @covers teacher-profile-page-loads
  test("teacher profile page loads", async ({ page }) => {
    await signInTeacher(page, SEEDED_TEACHER);
    await page.goto("/teacher/profile");
    await expect(page.getByRole("heading", { name: "My Teacher Profile" })).toBeVisible();
  });

  // @covers teacher-kiosk-exit-password-reentry
  test("kiosk exit requires password re-entry", async ({ page }) => {
    await signInTeacher(page, SEEDED_TEACHER);
    await page.goto("/kiosk/exit");

    await page.getByLabel("Password").fill("WrongPassword123!");
    await page.getByRole("button", { name: "Exit Kiosk" }).click();
    await expect(page).toHaveURL(/\/kiosk\/exit\?error=invalid_password$/);
    await expect(page.getByText("Invalid password. Please try again.")).toBeVisible();

    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Exit Kiosk" }).click();
    await expect(page).toHaveURL(/\/teacher$/);
  });

  // @covers teacher-kiosk-exit-rate-limit-lockout
  test("kiosk exit locks out after repeated invalid password attempts", async ({ page }) => {
    await signInTeacher(page, SEEDED_TEACHER);
    await page.goto("/kiosk/exit");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.getByTestId("kiosk-exit-password").fill("DefinitelyWrongPassword!");
      await page.getByTestId("kiosk-exit-submit").click();
    }

    await page.getByTestId("kiosk-exit-password").fill("DefinitelyWrongPassword!");
    await page.getByTestId("kiosk-exit-submit").click();
    await expect(page).toHaveURL(/\/kiosk\/exit\?error=rate_limited$/);
    await expect(page.getByText(/Too many attempts/i)).toBeVisible();
  });
});

