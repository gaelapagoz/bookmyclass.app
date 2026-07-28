import { describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import LegacyLoyaltyRedirect from "../../src/app/admin/(private)/catalog/loyalty/[[...slug]]/page";
import LegacyCampaignsRedirect from "../../src/app/admin/(private)/marketing/campaigns/[[...slug]]/page";
import LegacySegmentsRedirect from "../../src/app/admin/(private)/marketing/segments/[[...slug]]/page";

describe("admin legacy route redirects", () => {
  it("redirects catalog loyalty to canonical loyalty", async () => {
    await expect(
      LegacyLoyaltyRedirect({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/loyalty");
  });

  it("redirects marketing campaign children and preserves query parameters", async () => {
    await expect(
      LegacyCampaignsRedirect({
        params: Promise.resolve({ slug: ["camp-1", "edit"] }),
        searchParams: Promise.resolve({ status: "draft", segments: ["seg-a", "seg-b"] }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/campaigns/camp-1/edit?status=draft&segments=seg-a&segments=seg-b");
  });

  it("redirects marketing segments and preserves filters", async () => {
    await expect(
      LegacySegmentsRedirect({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ status: "active" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/segments?status=active");
  });

  it("does not target another legacy route", async () => {
    try {
      await LegacyCampaignsRedirect({
        params: Promise.resolve({ slug: ["new"] }),
        searchParams: Promise.resolve({}),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }

    expect(redirectMock).toHaveBeenLastCalledWith("/admin/campaigns/new");
  });
});
