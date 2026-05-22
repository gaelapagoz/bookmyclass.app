import { expect, type Page } from "@playwright/test";

export async function signInClient(page: Page, input: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(input.email);
  await page.getByLabel("Password").fill(input.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function signInViaAuthCallback(
  page: Page,
  input: { email: string; password: string },
  options?: { authFlow?: "admin"; callbackUrl?: string },
) {
  const csrfResponse = await page.request.get("/api/auth/csrf");
  const csrfBody = (await csrfResponse.json()) as { csrfToken?: string };
  if (!csrfBody.csrfToken) {
    throw new Error("Missing CSRF token for auth callback sign-in.");
  }

  const callbackUrl = options?.callbackUrl ?? "http://127.0.0.1:3100/dashboard";
  const form = new URLSearchParams({
    csrfToken: csrfBody.csrfToken,
    email: input.email,
    password: input.password,
    callbackUrl,
  });

  if (options?.authFlow) {
    form.set("authFlow", options.authFlow);
  }

  await page.request.post("/api/auth/callback/credentials", {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    data: form.toString(),
  });
}

export async function signInTeacher(page: Page, input: { email: string; password: string }) {
  await signInViaAuthCallback(page, input, { authFlow: "admin", callbackUrl: "http://127.0.0.1:3100/teacher" });
  await page.goto("/teacher");
  await expect(page).toHaveURL(/\/teacher$/);
}

export async function signInAdmin(page: Page, input: { email: string; password: string }) {
  await signInViaAuthCallback(page, input, {
    authFlow: "admin",
    callbackUrl: "http://127.0.0.1:3100/admin/dashboard",
  });
  await page.goto("/admin/dashboard");
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
  await expect(page).toHaveURL(/\/verify-email\?/, { timeout: 20000 });
}
