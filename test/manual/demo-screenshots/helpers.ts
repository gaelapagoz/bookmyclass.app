import path from "path";
import type { Page } from "@playwright/test";

export const demoClient = {
  email: process.env.DEMO_CLIENT_EMAIL ?? "client.e2e@bookmyclass.local",
  password: process.env.DEMO_CLIENT_PASSWORD ?? "E2EPass123!",
};

export const demoAdmin = {
  email: process.env.DEMO_ADMIN_EMAIL ?? "admin.e2e@bookmyclass.local",
  password: process.env.DEMO_ADMIN_PASSWORD ?? "E2EPass123!",
};

export const demoServiceSlug = process.env.DEMO_SERVICE_SLUG ?? "e2e-flow-class";

const screenshotDir = path.resolve(process.cwd(), "artifacts/demo-screenshots/images");

export async function capture(page: Page, filename: string) {
  await page.screenshot({
    path: path.join(screenshotDir, filename),
    fullPage: false,
  });
}

export async function signInAsClient(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(demoClient.email);
  await page.getByLabel("Password").fill(demoClient.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
}

export async function signInAsAdmin(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Email").fill(demoAdmin.email);
  await page.getByLabel("Password").fill(demoAdmin.password);
  await page.getByRole("button", { name: "Sign In to Admin" }).click();
  await page.waitForURL(/\/admin\/dashboard/, { timeout: 20_000 });
}
