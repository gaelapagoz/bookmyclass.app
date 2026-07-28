/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sampleDraft = {
  id: "draft",
  name: "Spring retention email",
  categoryId: "cat-retention",
  categoryName: "Retention",
  goalSummary: "",
  goalPrompt: "",
  subject: "Reset your routine this spring",
  previewText: "Fresh classes and offers for this month",
  fromName: "Studio Team",
  fromEmail: "no-reply@bookmyclass.app",
  replyTo: "no-reply@bookmyclass.app",
  imageAssetUrl: "/images/marketing/campaign-draft.jpg",
  selectedSegmentIds: ["seg-a", "seg-b"],
  contentJson: {
    blocks: [
      { type: "heading", text: "Persisted heading", textColor: "#1f2735" },
      { type: "paragraph", text: "Persisted draft content", textColor: "#334155" },
      { type: "button", text: "Book now", url: "https://example.com/book", textColor: "#ffffff", backgroundColor: "#1d3652" },
    ],
  },
  htmlSnapshot: "<p>Persisted preview HTML</p>",
  currentStep: "STEP_2",
  status: "DRAFT",
} as const;

const sampleResolution = {
  selectedSegmentIds: ["seg-a", "seg-b"],
  segmentOptions: [
    { id: "seg-a", name: "Active subscribers" },
    { id: "seg-b", name: "Loyal members" },
    { id: "seg-c", name: "New clients" },
  ],
  totalRecipients: 2,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  recipients: [
    {
      id: "u1",
      name: "Alex Novak",
      email: "alex@example.com",
      marketingSubscriptionStatus: "SUBSCRIBED",
    },
    {
      id: "u2",
      name: "Sophie Martin",
      email: "sophie@example.com",
      marketingSubscriptionStatus: "SUBSCRIBED",
    },
  ],
} as const;

vi.mock("@/app/admin/(private)/actions", () => ({
  saveMarketingCampaignFlowDraftAction: vi.fn(),
  saveMarketingCampaignFlowContentAction: vi.fn(),
  saveMarketingCampaignFlowParametersAction: vi.fn(),
  sendMarketingCampaignFlowTestEmailAction: vi.fn(),
  moveMarketingCampaignFlowToConfirmAction: vi.fn(),
  markMarketingCampaignFlowSentAction: vi.fn(),
}));

vi.mock("@/lib/marketing/marketing-service", () => ({
  getMarketingCampaignFlowDraftById: vi.fn(),
  listMarketingCategories: vi.fn(),
  listMarketingSegments: vi.fn(),
  resolveMarketingCampaignFlowRecipients: vi.fn(),
  getMarketingCampaignFlowSentSummary: vi.fn(async () => ({
    campaignId: "draft",
    campaignName: "Spring retention email",
    status: "SENT",
    recipientCount: 2,
    categoryName: "Retention",
    selectedSegmentIds: ["seg-a", "seg-b"],
    selectedSegmentNames: ["Active subscribers", "Loyal members"],
    sentAt: new Date(),
  })),
}));

import {
  getMarketingCampaignFlowDraftById,
  listMarketingCategories,
  listMarketingSegments,
  resolveMarketingCampaignFlowRecipients,
} from "@/lib/marketing/marketing-service";

import AdminMarketingCampaignCreatePage from "../../src/app/admin/(private)/campaigns/new/page";
import AdminMarketingCampaignTargetPage from "../../src/app/admin/(private)/campaigns/[id]/target/page";
import AdminMarketingCampaignConfirmPage from "../../src/app/admin/(private)/campaigns/[id]/confirm/page";
import AdminMarketingCampaignReviewPage from "../../src/app/admin/(private)/campaigns/[id]/review/page";
import AdminMarketingCampaignSentPage from "../../src/app/admin/(private)/campaigns/[id]/sent/page";

describe("admin marketing campaign flow scaffold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMarketingCampaignFlowDraftById).mockResolvedValue(sampleDraft);
    vi.mocked(listMarketingCategories).mockResolvedValue([
      { id: "cat-retention", name: "Retention", slug: "retention", isActive: true, usageCount: 1, createdAt: new Date(), updatedAt: new Date() },
    ]);
    vi.mocked(listMarketingSegments).mockResolvedValue([
      { id: "seg-a", name: "Active subscribers", slug: "active-subscribers", isActive: true, usageCount: 2, createdAt: new Date(), updatedAt: new Date() },
      { id: "seg-b", name: "Loyal members", slug: "loyal-members", isActive: true, usageCount: 2, createdAt: new Date(), updatedAt: new Date() },
    ]);
    vi.mocked(resolveMarketingCampaignFlowRecipients).mockResolvedValue(sampleResolution);
  });

  it("renders Step 1 metadata form", async () => {
    render(
      await AdminMarketingCampaignCreatePage({
        searchParams: Promise.resolve({ campaignId: "draft" }),
      }),
    );

    expect(screen.queryByRole("link", { name: "Back to campaigns" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Spring retention email")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Reset your routine this spring")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Fresh classes and offers for this month")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/admin/campaigns/draft/target");
    expect(screen.getByDisplayValue("Studio Team")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate draft" })).not.toBeInTheDocument();
    expect(screen.queryByText("AI usage estimate")).not.toBeInTheDocument();
    expect(screen.getByText("Recipient preview")).toBeInTheDocument();
    expect(screen.getByText("Clients with Never subscribed or Unsubscribed are excluded.")).toBeInTheDocument();
  });
  it("renders Step 2 shared builder", async () => {
    render(
      await AdminMarketingCampaignTargetPage({
        params: Promise.resolve({ id: "draft" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByText("Edit Email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.getByText("Add elements")).toBeInTheDocument();
    expect(screen.getByText("✓")).toBeInTheDocument();
    expect(screen.getByText("Basics")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("Fresh classes and offers for this month").length).toBeGreaterThan(1);
  });
  it("keeps entered Step 1 values after failure when no draft id exists yet", async () => {
    vi.mocked(getMarketingCampaignFlowDraftById).mockResolvedValue(null);

    render(
      await AdminMarketingCampaignCreatePage({
        searchParams: Promise.resolve({
          campaignName: "No-ID Campaign",
          subject: "No-ID Subject",
          previewText: "No-ID Preview",
          error: "Could not create the campaign draft shell. Please retry.",
        }),
      }),
    );

    expect(screen.getByDisplayValue("No-ID Campaign")).toBeInTheDocument();
    expect(screen.getByDisplayValue("No-ID Subject")).toBeInTheDocument();
    expect(screen.getByDisplayValue("No-ID Preview")).toBeInTheDocument();
    expect(screen.getByText("Could not create the campaign draft shell. Please retry.")).toBeInTheDocument();
  });

  it("shows active segments on Step 1 even before draft exists", async () => {
    vi.mocked(getMarketingCampaignFlowDraftById).mockResolvedValue(null);

    render(
      await AdminMarketingCampaignCreatePage({
        searchParams: Promise.resolve({ segments: ["seg-a"] }),
      }),
    );

    expect(screen.getByRole("link", { name: /Active subscribers/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Loyal members/i })).toBeInTheDocument();
  });

  it("renders Step 1 recipient targeting and recipient count/preview", async () => {
    render(
      await AdminMarketingCampaignCreatePage({
        searchParams: Promise.resolve({ campaignId: "draft", segments: ["seg-a", "seg-b"], page: "1" }),
      }),
    );

    expect(screen.getByText("Step 1 of 4: set campaign basics and save draft metadata.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Studio Team")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("no-reply@bookmyclass.app").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Active subscribers/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Loyal members/i })).toBeInTheDocument();
    expect(screen.getByText("Recipient preview")).toBeInTheDocument();
    expect(screen.getByText("Alex Novak")).toBeInTheDocument();
    expect(screen.getByText("2 total recipients")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });


  it("renders Step 1 with empty category and segment options on unseeded state", async () => {
    vi.mocked(listMarketingCategories).mockResolvedValue([]);
    vi.mocked(resolveMarketingCampaignFlowRecipients).mockResolvedValue({
      selectedSegmentIds: [],
      segmentOptions: [],
      totalRecipients: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      recipients: [],
    });

    render(
      await AdminMarketingCampaignCreatePage({
        searchParams: Promise.resolve({ campaignId: "draft", page: "1" }),
      }),
    );

    expect(screen.getByText("Step 1 of 4: set campaign basics and save draft metadata.")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "No category" })).toBeInTheDocument();
    expect(screen.queryByText("No segments available. Campaign targeting will use all subscribed clients.")).not.toBeInTheDocument();
    expect(screen.getByText("Recipient preview")).toBeInTheDocument();
    expect(screen.getByText("No subscribed recipients match the current targeting.")).toBeInTheDocument();
    expect(screen.getByText("Only subscribed clients are eligible for marketing sends.")).toBeInTheDocument();
    expect(screen.queryByText("Unable to load")).not.toBeInTheDocument();
  });
  it("rehydrates Step 3 summary and real recipient review", async () => {
    render(
      await AdminMarketingCampaignReviewPage({
        params: Promise.resolve({ id: "draft" }),
        searchParams: Promise.resolve({ segments: ["seg-a", "seg-b"], page: "1" }),
      }),
    );

    expect(screen.getByText("Step 3 of 4: review full campaign summary before final confirmation.")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.getByText("Spring retention email")).toBeInTheDocument();
    expect(screen.getAllByText("Reset your routine this spring").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fresh classes and offers for this month").length).toBeGreaterThan(0);
    expect(screen.getByText("Retention")).toBeInTheDocument();
    expect(screen.getByText("Selected recipient count")).toBeInTheDocument();
    expect(screen.getByLabelText("Test email address")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send test email" })).toBeInTheDocument();
    expect(screen.getByText("Recipient preview")).toBeInTheDocument();
    expect(screen.getByText("Alex Novak")).toBeInTheDocument();
    expect(screen.getByText("2 total recipients")).toBeInTheDocument();
  });

  it("renders Step 4 real recipient review with send CTA", async () => {
    render(
      await AdminMarketingCampaignConfirmPage({
        params: Promise.resolve({ id: "draft" }),
        searchParams: Promise.resolve({ segments: ["seg-a", "seg-b"], page: "1" }),
      }),
    );

    expect(screen.getByText("Step 4 of 4: final confirmation before send.")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Save draft" })).toBeInTheDocument();
    expect(screen.getByText("Ready to send")).toBeInTheDocument();
    expect(screen.getByText("2 subscribed recipients are selected based on your segment targeting.")).toBeInTheDocument();
    expect(screen.getByText("Recipient preview")).toBeInTheDocument();
    expect(screen.getByText("Alex Novak")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send campaign" })).toBeInTheDocument();
  });

  it("renders post-send confirmation screen with summary and go-to-campaigns CTA", async () => {
    render(
      await AdminMarketingCampaignSentPage({
        params: Promise.resolve({ id: "draft" }),
      }),
    );

    expect(screen.getByText("Campaign sent successfully")).toBeInTheDocument();
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Recipients sent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to campaigns" })).toHaveAttribute("href", "/admin/campaigns");
  });

  it("shows Step 3 test-send success feedback", async () => {
    render(
      await AdminMarketingCampaignReviewPage({
        params: Promise.resolve({ id: "draft" }),
        searchParams: Promise.resolve({
          segments: ["seg-a", "seg-b"],
          page: "1",
          testEmail: "tester@example.test",
          success: "Test email sent.",
        }),
      }),
    );

    expect(screen.getByText("Test email sent.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("tester@example.test")).toBeInTheDocument();
  });

  it("shows Step 3 validation error feedback for invalid test email", async () => {
    render(
      await AdminMarketingCampaignReviewPage({
        params: Promise.resolve({ id: "draft" }),
        searchParams: Promise.resolve({
          segments: ["seg-a", "seg-b"],
          page: "1",
          testEmail: "invalid",
          error: "Enter a valid test email address.",
        }),
      }),
    );

    expect(screen.getByText("Enter a valid test email address.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("invalid")).toBeInTheDocument();
  });
});




