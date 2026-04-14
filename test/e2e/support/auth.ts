import { expect, type Page } from "@playwright/test";

export async function signInClient(page: Page, input: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(input.email);
  await page.getByLabel("Password").fill(input.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function signInTeacher(page: Page, input: { email: string; password: string }) {
  await page.goto("/admin");
  await page.getByLabel("Email").fill(input.email);
  await page.getByLabel("Password").fill(input.password);
  await page.getByRole("button", { name: "Sign In to Admin" }).click();
  await expect(page).toHaveURL(/\/teacher$/);
}

export async function signInAdmin(page: Page, input: { email: string; password: string }) {
  await page.goto("/admin");
  await page.getByLabel("Email").fill(input.email);
  await page.getByLabel("Password").fill(input.password);
  await page.getByRole("button", { name: "Sign In to Admin" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
}

export async function signUpPublicUser(page: Page, input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}) {
  await page.goto("/sign-up");
  await page.getByLabel("First name").fill(input.firstName);
  await page.getByLabel("Last name").fill(input.lastName);
  await page.getByLabel("Email").fill(input.email);
  await page.getByLabel("Password").fill(input.password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page).toHaveURL(/\/verify-email\?/);
}
