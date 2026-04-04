/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/(private)/actions", () => ({
  duplicateMarketingCampaignAction: vi.fn(),
  deleteMarketingCampaignDraftAction: vi.fn(),
}));

vi.mock("@/lib/marketing/marketing-service", () => ({
  listMarketingCampaignListItems: vi.fn(),
}));

import { listMarketingCampaignListItems } from "@/lib/marketing/marketing-service";
import AdminMarketingCampaignsPage from "../../src/app/admin/(private)/marketing/campaigns/page";

describe("admin marketing campaigns page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders campaign table without OpenAI usage/cost indicators", async () => {
    vi.mocked(listMarketingCampaignListItems).mockResolvedValue([
      {
        id: "camp-1",
        name: "Spring Push",
        categoryName: "Retention",
        status: "DRAFT",
        audience: "ALL_USERS",
        updatedAt: new Date("2026-04-04T09:00:00.000Z"),
        sentAt: null,
        sentCount: 0,
        openedCount: 0,
        clickedCount: 0,
        openRate: 0,
        clickRate: 0,
      },
    ]);

    render(
      await AdminMarketingCampaignsPage({
        searchParams: Promise.resolve({ status: "draft" }),
      }),
    );

    expect(screen.queryByRole("columnheader", { name: "OpenAI cost" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Draft generations today:/)).not.toBeInTheDocument();
    expect(screen.getByText("Spring Push")).toBeInTheDocument();
  });
});