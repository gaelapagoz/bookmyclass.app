import { expect, test } from "@playwright/test";

const aboutCases = [
  { href: "/about/studio", heading: "Our Studio", testId: "mobile-about-link--about-studio" },
  { href: "/about/team", heading: "Our Team", testId: "mobile-about-link--about-team" },
  {
    href: "/about/terms-and-conditions",
    heading: "Terms and Conditions",
    testId: "mobile-about-link--about-terms-and-conditions",
  },
  { href: "/about/faq", heading: "FAQ", testId: "mobile-about-link--about-faq" },
] as const;

async function openMobileMenu(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Toggle navigation menu" }).click();
  await expect(page.getByTestId("mobile-nav-panel")).toBeVisible();
}

async function signInAsSeedClient(page: import("@playwright/test").Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("client@yogapilatesfitness.local");
  await page.getByLabel("Password").fill("Client123!");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("small-screen About submenu links navigate to each About page", async ({ page }) => {
  for (const aboutCase of aboutCases) {
    await page.goto("/");
    await openMobileMenu(page);
    await page.getByTestId("mobile-about-toggle").click();
    await page.getByTestId(aboutCase.testId).click();

    await expect(page).toHaveURL(new RegExp(`${aboutCase.href}$`));
    await expect(page.getByRole("heading", { name: aboutCase.heading })).toBeVisible();
  }
});

test("small-screen menu hides Dashboard when logged out", async ({ page }) => {
  await page.goto("/");
  await openMobileMenu(page);

  const mobilePanel = page.getByTestId("mobile-nav-panel");
  await expect(mobilePanel.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
});

test("small-screen normal link navigates and menu closes", async ({ page }) => {
  await page.goto("/");
  await openMobileMenu(page);

  await page.getByTestId("mobile-nav-panel").getByRole("link", { name: "Book a Class" }).click();

  await expect(page).toHaveURL(/\/book-a-class$/);
  await expect(page.getByTestId("mobile-nav-panel")).toHaveCount(0);
});

test("small-screen menu shows Dashboard when logged in and logout works", async ({ page }) => {
  await signInAsSeedClient(page);
  await openMobileMenu(page);

  const mobilePanel = page.getByTestId("mobile-nav-panel");
  await expect(mobilePanel.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await mobilePanel.getByRole("button", { name: "Log Out" }).click();

  await expect(page).toHaveURL(/\/$/);
  await openMobileMenu(page);
  await expect(page.getByTestId("mobile-nav-panel").getByRole("link", { name: "Sign In" })).toBeVisible();
  await expect(page.getByTestId("mobile-nav-panel").getByRole("link", { name: "Dashboard" })).toHaveCount(0);
});
