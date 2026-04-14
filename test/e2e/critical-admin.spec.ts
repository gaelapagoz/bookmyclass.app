import { expect, test } from "@playwright/test";
import { signInAdmin } from "./support/auth";
import { E2E_PASSWORD, SEEDED_ADMIN } from "./support/constants";

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

  await page.goto("/admin/bookings");
  await expect(page.getByRole("heading", { name: "Booking List" })).toBeVisible();

  await page.goto("/admin/plans");
  await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();

  await page.goto("/admin/subscriptions");
  await expect(page.getByRole("heading", { name: "Subscriptions" })).toBeVisible();

  await page.goto("/admin/online-learning");
  await expect(page.getByRole("heading", { name: "Online Learning" })).toBeVisible();
});

