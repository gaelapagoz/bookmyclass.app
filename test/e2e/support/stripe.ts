import { URL } from "node:url";
import { expect, type Page } from "@playwright/test";

export async function captureCheckoutSessionIdFromStripeRedirect(page: Page): Promise<string> {
  await page.waitForURL(/checkout\.stripe\.com|\/c\/pay\//, { timeout: 20_000 });
  const currentUrl = page.url();
  const parsed = new URL(currentUrl);

  const fromSearch = parsed.searchParams.get("session_id");
  if (fromSearch) {
    return fromSearch;
  }

  const pathMatch = parsed.pathname.match(/\/c\/pay\/([^/?#]+)/);
  const fallback = pathMatch?.[1];
  expect(fallback).toBeTruthy();
  return fallback as string;
}
