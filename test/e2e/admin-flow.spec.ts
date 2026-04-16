import { expect, test } from "@playwright/test";
import { signInAdmin } from "./support/auth";
import { prepareCheckInWindowBookingForTest } from "./support/e2e-api";
import { SEEDED_ADMIN } from "./support/constants";

test.describe("admin attendance and kiosk flow", () => {
  test.describe.configure({ mode: "serial" });

  // @covers admin-kiosk-access
  test("admin can launch kiosk and check in client", async ({ page }) => {
    const prepared = await prepareCheckInWindowBookingForTest(page.request, {
      clientEmail: `e2e.admin.kiosk.${Date.now()}@example.test`,
      mode: "in_window",
    });

    await signInAdmin(page, SEEDED_ADMIN);
    await page.goto("/kiosk");
    await expect(page.getByRole("heading", { name: "Kiosk Check-In" })).toBeVisible();

    await page.goto(`/kiosk/${encodeURIComponent(prepared.sessionId)}`);
    await page.getByTestId(`kiosk-check-in-${prepared.bookingId}`).click();
    await expect(page.getByTestId(`kiosk-booking-${prepared.bookingId}`).getByText(/^Checked In$/)).toBeVisible();
  });

  // @covers admin-attendance-finalization
  test("admin can finalize attendance from session edit", async ({ page }) => {
    const prepared = await prepareCheckInWindowBookingForTest(page.request, {
      clientEmail: `e2e.admin.attendance.${Date.now()}@example.test`,
      mode: "in_window",
    });

    await signInAdmin(page, SEEDED_ADMIN);
    await page.goto(`/admin/sessions/${encodeURIComponent(prepared.sessionId)}/edit`);

    const attendeeRow = page.getByTestId(`admin-attendee-${prepared.bookingId}`);
    await expect(attendeeRow).toBeVisible();
    await attendeeRow.getByRole("button", { name: "Mark attended" }).click();

    await expect(page.getByText("Attendance updated.")).toBeVisible();
    await expect(attendeeRow.getByText("Attendance: ATTENDED")).toBeVisible();
  });
});
