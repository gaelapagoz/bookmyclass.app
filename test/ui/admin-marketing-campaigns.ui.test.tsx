/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("@/lib/marketing/marketing-service", () => ({
  getMarketingCampaignListPageData: vi.fn(),
  getMarketingCampaignGlobalMetrics: vi.fn(),
  getMarketingSentCampaignSummaryById: vi.fn(),
}));

import {
  getMarketingCampaignGlobalMetrics,
  getMarketingCampaignListPageData,
  getMarketingSentCampaignSummaryById,
} from "@/lib/marketing/marketing-service";
import AdminMarketingCampaignSummaryPage from "../../src/app/admin/(private)/marketing/campaigns/[id]/summary/page";
import AdminMarketingCampaignsPage from "../../src/app/admin/(private)/marketing/campaigns/page";

describe("admin marketing campaigns page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockReset();
    vi.mocked(getMarketingCampaignGlobalMetrics).mockResolvedValue({
      totalCampaigns: 3,
      totalSentCampaigns: 1,
      totalDraftCampaigns: 2,
      sentInLast30Days: 1,
      totalRecipientsReached: 44,
      averageRecipientsPerSentCampaign: 44,
    });
  });

  it("renders filter/search/pagination and status-based actions", async () => {
    vi.mocked(getMarketingCampaignListPageData).mockResolvedValue({
      filter: "all",
      page: 2,
      pageSize: 20,
      totalItems: 25,
      totalPages: 2,
      query: "spring",
      items: [
        {
          id: "camp-draft",
          name: "Spring Push",
          categoryName: "Retention",
          status: "DRAFT",
          sentAt: null,
          updatedAt: new Date("2026-04-04T09:00:00.000Z"),
          recipientCount: 0,
        },
        {
          id: "camp-sent",
          name: "April Launch",
          categoryName: "Promotions",
          status: "SENT",
          sentAt: new Date("2026-04-03T12:00:00.000Z"),
          updatedAt: new Date("2026-04-03T12:10:00.000Z"),
          recipientCount: 44,
        },
      ],
    });

    render(
      await AdminMarketingCampaignsPage({
        searchParams: Promise.resolve({ status: "all", page: "2", q: "spring" }),
      }),
    );

    expect(screen.getByLabelText("Filter").compareDocumentPosition(screen.getByLabelText("Search campaigns"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
      "href",
      "/admin/marketing/campaigns/new?campaignId=camp-draft",
    );
    expect(screen.getByRole("link", { name: "Summary" })).toHaveAttribute(
      "href",
      "/admin/marketing/campaigns/camp-sent/summary",
    );
    expect(screen.getByText("Total campaigns")).toBeInTheDocument();
    expect(screen.getByText("Avg recipients per sent campaign")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Create campaign" })).toHaveAttribute("href", "/admin/marketing/campaigns/new");
    expect(screen.queryByRole("columnheader", { name: "Open rate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Click rate" })).not.toBeInTheDocument();
  });

  it("renders empty table state", async () => {
    vi.mocked(getMarketingCampaignListPageData).mockResolvedValue({
      filter: "draft",
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 1,
      query: "",
      items: [],
    });

    render(
      await AdminMarketingCampaignsPage({
        searchParams: Promise.resolve({ status: "draft" }),
      }),
    );

    expect(screen.getByText("No campaigns found.")).toBeInTheDocument();
  });

  it("renders sent campaign summary details", async () => {
    vi.mocked(getMarketingSentCampaignSummaryById).mockResolvedValue({
      campaignId: "camp-sent",
      campaignName: "April Launch",
      status: "SENT",
      sentAt: new Date("2026-04-03T12:00:00.000Z"),
      categoryName: "Promotions",
      fromName: "Studio Team",
      fromEmail: "no-reply@bookmyclass.app",
      replyTo: "no-reply@bookmyclass.app",
      subject: "Subject",
      previewText: "Preview",
      selectedSegmentIds: ["seg-a"],
      selectedSegmentNames: ["VIP"],
      recipientCount: 44,
      recipientSentCount: 40,
      recipientFailedCount: 4,
      recipientPendingCount: 0,
      htmlSnapshot: "<p>Rendered</p>",
    });

    render(
      await AdminMarketingCampaignSummaryPage({
        params: Promise.resolve({ id: "camp-sent" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Campaign Summary" })).toBeInTheDocument();
    expect(screen.getByText("April Launch")).toBeInTheDocument();
    expect(screen.getByText("Recipients")).toBeInTheDocument();
    expect(screen.getByText("44")).toBeInTheDocument();
    expect(screen.getByText("Rendered")).toBeInTheDocument();
  });

  it("redirects draft campaign away from sent-only summary", async () => {
    vi.mocked(getMarketingSentCampaignSummaryById).mockResolvedValue({
      campaignId: "camp-draft",
      campaignName: "Draft",
      status: "DRAFT",
      sentAt: null,
      categoryName: null,
      fromName: "Studio Team",
      fromEmail: "no-reply@bookmyclass.app",
      replyTo: "no-reply@bookmyclass.app",
      subject: "Subject",
      previewText: "Preview",
      selectedSegmentIds: [],
      selectedSegmentNames: [],
      recipientCount: 0,
      recipientSentCount: 0,
      recipientFailedCount: 0,
      recipientPendingCount: 0,
      htmlSnapshot: "<p>Rendered</p>",
    });

    await AdminMarketingCampaignSummaryPage({
      params: Promise.resolve({ id: "camp-draft" }),
    });

    expect(redirectMock).toHaveBeenCalledWith("/admin/marketing/campaigns/new?campaignId=camp-draft");
  });
});
