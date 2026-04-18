import { expect, test } from "@playwright/test";
import { signInAdmin, signInClient } from "./support/auth";
import { cleanSeededClientBookingsForTest, prepareWaitlistSessionForTest } from "./support/e2e-api";
import { E2E_PASSWORD, SEEDED_ADMIN, SEEDED_CLIENT_WITH_CREDITS, SEEDED_SERVICE_SLUG } from "./support/constants";

function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateTimeLocalInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

// @covers admin-sign-in
// @covers-partial admin-user-edit-persists
// @covers admin-class-edit-create
// @covers admin-sessions-list-loads
// @covers admin-session-edit-persists
test("critical admin CRUD flows", async ({ page }) => {
  const unique = Date.now();
  const teacherName = `E2E Teacher ${unique}`;
  const teacherEmail = `teacher.${unique}@example.test`;
  const className = `E2E Service ${unique}`;
  const classSlug = `e2e-service-${unique}`;
  const updatedClassName = `${className} Updated`;
  const sessionTitle = `E2E Session ${unique}`;
  const updatedSessionTitle = `${sessionTitle} Updated`;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const sessionStart = new Date();
  sessionStart.setDate(sessionStart.getDate() + 5);
  // Keep the created session inside the rendered admin calendar window (06:00-21:59).
  sessionStart.setHours(10, 0, 0, 0);
  const sessionEnd = new Date(sessionStart.getTime() + 60 * 60 * 1000);

  await signInAdmin(page, SEEDED_ADMIN);

  await page.goto("/admin/users/new");
  await page.getByLabel("Name").fill(teacherName);
  await page.getByLabel("Email").fill(teacherEmail);
  await page.getByLabel("Role").selectOption("TEACHER");
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Save user" }).click();

  await expect(page).toHaveURL(/\/admin\/users(?:\/admins)?$/);
  await page.goto(`/admin/users/teachers?q=${encodeURIComponent(teacherEmail)}`);
  await expect(page.getByText(teacherEmail)).toBeVisible();

  await page.goto("/admin/classes/new");
  await page.getByLabel("Name").fill(className);
  await page.getByLabel("Slug").fill(classSlug);
  await page.getByLabel("Date").fill(toDateInput(tomorrow));
  await page.getByRole("button", { name: "Save class" }).click();

  await expect(page).toHaveURL(/\/admin\/classes$/);
  await expect(page.getByText(className)).toBeVisible();

  const classRow = page.locator("tr").filter({ hasText: className }).first();
  await classRow.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Name").fill(updatedClassName);
  await page.getByRole("button", { name: "Update class" }).click();

  await expect(page).toHaveURL(/\/admin\/classes$/);
  await expect(page.getByText(updatedClassName)).toBeVisible();

  await page.goto("/admin/sessions/new");
  const templateSelect = page.getByLabel("Class Template");
  await templateSelect.selectOption({ label: `${updatedClassName} Schedule` });
  await page.getByLabel("Teacher").selectOption({ label: teacherName });
  await page.getByLabel("Title").fill(sessionTitle);
  await page.getByLabel("Starts At").fill(toDateTimeLocalInput(sessionStart));
  await page.getByLabel("Ends At").fill(toDateTimeLocalInput(sessionEnd));
  await page.getByRole("button", { name: "Save session" }).click();

  await expect(page).toHaveURL(/\/admin\/sessions$/);
  await page.goto(`/admin/sessions?week=${toDateInput(sessionStart)}`);
  const sessionLink = page
    .locator("a[href*='\/admin\/sessions/'][href$='/edit']")
    .filter({ hasText: sessionTitle });
  await expect(sessionLink).toBeVisible();
  await expect(sessionLink).toHaveCount(1);
  await sessionLink.click();

  await page.getByLabel("Title").fill(updatedSessionTitle);
  await page.getByTestId("session-update-button").click();

  await expect(page.getByText("Session updated.")).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue(updatedSessionTitle);
});

// @covers admin-bookings-list-loads
// @covers admin-product-plan-area-loads
// @covers admin-subscriptions-list-loads
// @covers-partial admin-online-learning-crud
test("admin list pages load with stable headings", async ({ page }) => {
  await signInAdmin(page, SEEDED_ADMIN);

  const navLinks = page.locator("[data-testid='admin-nav-list'] a");
  const navOrder = await navLinks.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ""));
  const manageSiteIndex = navOrder.indexOf("Manage Site");
  const automationsIndex = navOrder.indexOf("Automations");
  const launchKioskIndex = navOrder.indexOf("Launch Kiosk");
  expect(manageSiteIndex).toBeGreaterThan(-1);
  expect(automationsIndex).toBeGreaterThan(manageSiteIndex);
  expect(launchKioskIndex).toBeGreaterThan(automationsIndex);

  await page.goto("/admin/bookings");
  await expect(page.getByRole("heading", { name: "Booking List" })).toBeVisible();

  await page.goto("/admin/plans");
  await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();

  await page.goto("/admin/subscriptions");
  await expect(page.getByRole("heading", { name: "Subscriptions" })).toBeVisible();

  await page.goto("/admin/online-learning");
  await expect(page.getByRole("heading", { name: "Online Learning" })).toBeVisible();

  await page.goto("/admin/automations");
  await expect(page.getByRole("heading", { name: "Automations" })).toBeVisible();
});

// @covers admin-manual-attendee-add
test("admin can manually add an eligible client from session edit roster", async ({ page }) => {
  await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_WITH_CREDITS.email);
  await signInAdmin(page, SEEDED_ADMIN);

  await page.goto("/admin/sessions");
  const sessionLink = page.getByRole("link", { name: /E2E Flow Class - E2E Session/ }).first();
  if ((await sessionLink.count()) === 0) {
    await page.getByRole("link", { name: "Next week" }).click();
  }
  await expect(sessionLink).toBeVisible();
  await sessionLink.click();

  const clientOptionValue = await page
    .getByRole("option", { name: /client\.e2e@bookmyclass\.local/i })
    .getAttribute("value");
  expect(clientOptionValue).toBeTruthy();
  await page.getByRole("combobox", { name: "Client" }).selectOption(clientOptionValue as string);
  await page.getByRole("button", { name: "Add attendee" }).click();

  await expect(page.getByText("Attendee added.")).toBeVisible();
  await expect(page.getByTestId(/admin-attendee-/).getByText("E2E Client Credits")).toBeVisible();
});

// @covers admin-waitlist-count-visibility
test("admin calendar shows waitlist count without manual waitlist controls", async ({ page }) => {
  await cleanSeededClientBookingsForTest(page.request, SEEDED_CLIENT_WITH_CREDITS.email);
  const prepared = await prepareWaitlistSessionForTest(page.request, {
    clientEmail: SEEDED_CLIENT_WITH_CREDITS.email,
    serviceSlug: SEEDED_SERVICE_SLUG,
  });

  await signInClient(page, SEEDED_CLIENT_WITH_CREDITS);
  await page.goto(`/book-a-class/${prepared.serviceSlug}`);
  const selectPreparedDateButton = page.getByRole("button", { name: `Select ${prepared.dateKey}` });
  if ((await selectPreparedDateButton.count()) === 0) {
    await page.getByRole("button", { name: "Show next month" }).click();
  }
  await page.getByRole("button", { name: `Select ${prepared.dateKey}` }).click();
  await page.getByTestId(`service-slot-${prepared.sessionId}`).getByRole("button", { name: /Join waitlist/i }).click();
  await expect(page.getByText("You have been added to the waitlist.")).toBeVisible();

  await page.context().clearCookies();
  await signInAdmin(page, SEEDED_ADMIN);
  await page.goto(`/admin/sessions?week=${prepared.dateKey}`);

  const sessionLink = page
    .locator("a[href*='/admin/sessions/'][href$='/edit']")
    .filter({ has: page.getByText("Waitlist: 1") })
    .first();

  await expect(sessionLink).toBeVisible();
  await expect(page.getByText("Waitlist: 1")).toBeVisible();
  await expect(page.getByRole("button", { name: /join waitlist/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /cancel waitlist/i })).toHaveCount(0);
});

