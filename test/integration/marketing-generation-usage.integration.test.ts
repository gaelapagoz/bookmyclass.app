import "./helpers/setup-env";

import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateMarketingAiDraft } from "../../src/lib/marketing/marketing-ai";
import {
  MARKETING_DAILY_AI_DRAFT_LIMIT,
  createMarketingCampaignFlowDraft,
  enforceMarketingDailyAiGenerationQuota,
  getMarketingCampaignFlowDraftById,
  getMarketingCampaignGenerationUsageSummary,
  getMarketingDailyAiGenerationQuota,
  updateMarketingCampaignFlowDraft,
} from "../../src/lib/marketing/marketing-service";
import { prisma } from "./helpers/db";
import * as marketingRenderer from "../../src/lib/marketing/marketing-renderer";
import { resetDb } from "./helpers/reset-db";

function mockOpenAiResponse(payload: { subject: string; previewText: string; contentJson: unknown; inputTokens?: number; outputTokens?: number }) {
  const inputTokens = payload.inputTokens ?? 180;
  const outputTokens = payload.outputTokens ?? 260;

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            subject: payload.subject,
            previewText: payload.previewText,
            contentJson: payload.contentJson,
          }),
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
}

async function createAdminAndDraft(name: string) {
  const admin = await prisma.user.create({
    data: {
      name: "Admin User",
      firstName: "Admin",
      lastName: "User",
      email: `admin.${name}.${Date.now()}@example.test`,
      role: Role.ADMIN,
    },
  });

  const draft = await createMarketingCampaignFlowDraft({
    createdById: admin.id,
    name,
    goalPrompt: `Goal for ${name}`,
  });

  return { admin, draft: draft! };
}

describe("marketing OpenAI generation usage tracking", () => {
  beforeEach(async () => {
    await resetDb();
    vi.restoreAllMocks();
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MARKETING_MODEL = "gpt-4.1-mini";
    process.env.OPENAI_MARKETING_INPUT_COST_PER_1K = "0.0004";
    process.env.OPENAI_MARKETING_OUTPUT_COST_PER_1K = "0.0016";
    process.env.OPENAI_MARKETING_PRICING_VERSION = "test-pricing-v1";
  });

  it("persists generated draft content and generation usage/cost", async () => {
    const { draft: createdDraft } = await createAdminAndDraft("April Campaign");

    mockOpenAiResponse({
      subject: "New subject from AI",
      previewText: "New preview from AI",
      contentJson: {
        blocks: [{ type: "paragraph", text: "Generated body from OpenAI" }],
      },
      inputTokens: 500,
      outputTokens: 300,
    });

    const generated = await generateMarketingAiDraft({
      goal: "Retain spring subscribers",
      audience: "Subscribed clients",
      tone: "Friendly",
      cta: "Book now",
      extraContext: "Campaign name: April Campaign",
    });

    await updateMarketingCampaignFlowDraft(createdDraft.id, {
      name: "April Campaign",
      goalPrompt: "Retain spring subscribers",
      subject: generated.subject,
      previewText: generated.previewText,
      contentJson: generated.contentJson,
      currentStep: "STEP_2",
      generationUsage: {
        model: generated.usage.model,
        inputTokens: generated.usage.inputTokens,
        outputTokens: generated.usage.outputTokens,
        totalTokens: generated.usage.totalTokens,
        estimatedInputCost: generated.usage.estimatedInputCost,
        estimatedOutputCost: generated.usage.estimatedOutputCost,
        estimatedTotalCost: generated.usage.estimatedTotalCost,
        pricingVersion: generated.usage.pricingVersion,
        rateBasisJson: generated.usage.rateBasis,
      },
    });

    const persistedDraft = await getMarketingCampaignFlowDraftById(createdDraft.id);
    const usageSummary = await getMarketingCampaignGenerationUsageSummary(createdDraft.id);

    expect(persistedDraft?.subject).toBe("New subject from AI");
    expect(persistedDraft?.previewText).toBe("New preview from AI");
    expect(usageSummary.generationCount).toBe(1);
    expect(usageSummary.latest?.model).toBe("gpt-4.1-mini");
    expect(usageSummary.latest?.inputTokens).toBe(500);
    expect(usageSummary.latest?.outputTokens).toBe(300);
    expect(usageSummary.latest?.totalTokens).toBe(800);
    expect(usageSummary.latest?.pricingVersion).toBe("test-pricing-v1");
    expect(usageSummary.cumulativeEstimatedCost).toBeCloseTo(0.00068, 6);
  });

  it("allows successful generations below limit and blocks the attempt after 20 successful generations", async () => {
    const { draft } = await createAdminAndDraft("Quota Boundary Campaign");

    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

    await prisma.marketingCampaignGenerationUsage.createMany({
      data: Array.from({ length: MARKETING_DAILY_AI_DRAFT_LIMIT - 1 }).map(() => ({
        campaignId: draft.id,
        model: "gpt-4.1-mini",
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        estimatedInputCost: 0.000004,
        estimatedOutputCost: 0.000016,
        estimatedTotalCost: 0.00002,
        pricingVersion: "test-pricing-v1",
        rateBasisJson: { inputCostPer1k: 0.0004, outputCostPer1k: 0.0016 },
        createdAt: tenMinutesAgo,
      })),
    });

    const quotaBefore20th = await getMarketingDailyAiGenerationQuota(now);
    expect(quotaBefore20th.used).toBe(MARKETING_DAILY_AI_DRAFT_LIMIT - 1);
    expect(quotaBefore20th.remaining).toBe(1);

    await expect(enforceMarketingDailyAiGenerationQuota(now)).resolves.toEqual(
      expect.objectContaining({
        used: MARKETING_DAILY_AI_DRAFT_LIMIT - 1,
        remaining: 1,
      }),
    );

    await prisma.marketingCampaignGenerationUsage.create({
      data: {
        campaignId: draft.id,
        model: "gpt-4.1-mini",
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        estimatedInputCost: 0.000004,
        estimatedOutputCost: 0.000016,
        estimatedTotalCost: 0.00002,
        pricingVersion: "test-pricing-v1",
        rateBasisJson: { inputCostPer1k: 0.0004, outputCostPer1k: 0.0016 },
        createdAt: now,
      },
    });

    const quotaAt20 = await getMarketingDailyAiGenerationQuota(now);
    expect(quotaAt20.used).toBe(MARKETING_DAILY_AI_DRAFT_LIMIT);
    expect(quotaAt20.remaining).toBe(0);

    await expect(enforceMarketingDailyAiGenerationQuota(now)).rejects.toThrow(
      "MARKETING_DAILY_AI_GENERATION_LIMIT_REACHED",
    );
  });

  it("accumulates usage history across repeated generations", async () => {
    const { draft } = await createAdminAndDraft("Repeat Campaign");

    mockOpenAiResponse({
      subject: "First generation",
      previewText: "First preview",
      contentJson: { blocks: [{ type: "paragraph", text: "First body" }] },
      inputTokens: 200,
      outputTokens: 100,
    });
    const first = await generateMarketingAiDraft({
      goal: "Goal one",
      audience: "Subscribed clients",
      tone: "Friendly",
      cta: "Book",
    });
    await updateMarketingCampaignFlowDraft(draft.id, {
      subject: first.subject,
      previewText: first.previewText,
      contentJson: first.contentJson,
      generationUsage: {
        model: first.usage.model,
        inputTokens: first.usage.inputTokens,
        outputTokens: first.usage.outputTokens,
        totalTokens: first.usage.totalTokens,
        estimatedInputCost: first.usage.estimatedInputCost,
        estimatedOutputCost: first.usage.estimatedOutputCost,
        estimatedTotalCost: first.usage.estimatedTotalCost,
        pricingVersion: first.usage.pricingVersion,
        rateBasisJson: first.usage.rateBasis,
      },
    });

    mockOpenAiResponse({
      subject: "Second generation",
      previewText: "Second preview",
      contentJson: { blocks: [{ type: "paragraph", text: "Second body" }] },
      inputTokens: 300,
      outputTokens: 250,
    });
    const second = await generateMarketingAiDraft({
      goal: "Goal two",
      audience: "Subscribed clients",
      tone: "Friendly",
      cta: "Book",
    });
    await updateMarketingCampaignFlowDraft(draft.id, {
      subject: second.subject,
      previewText: second.previewText,
      contentJson: second.contentJson,
      generationUsage: {
        model: second.usage.model,
        inputTokens: second.usage.inputTokens,
        outputTokens: second.usage.outputTokens,
        totalTokens: second.usage.totalTokens,
        estimatedInputCost: second.usage.estimatedInputCost,
        estimatedOutputCost: second.usage.estimatedOutputCost,
        estimatedTotalCost: second.usage.estimatedTotalCost,
        pricingVersion: second.usage.pricingVersion,
        rateBasisJson: second.usage.rateBasis,
      },
    });

    const usageSummary = await getMarketingCampaignGenerationUsageSummary(draft.id);

    expect(usageSummary.generationCount).toBe(2);
    expect(usageSummary.latest?.totalTokens).toBe(550);
    expect(usageSummary.cumulativeEstimatedCost).toBeGreaterThan(usageSummary.latest?.estimatedTotalCost ?? 0);
  });

  it("does not corrupt persisted draft state when generation fails and failure does not consume quota", async () => {
    const { draft } = await createAdminAndDraft("Failure-safe campaign");

    await updateMarketingCampaignFlowDraft(draft.id, {
      subject: "Original subject",
      previewText: "Original preview",
      contentJson: { blocks: [{ type: "paragraph", text: "Original body" }] },
    });

    const beforeQuota = await getMarketingDailyAiGenerationQuota();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { message: "Service unavailable" } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      generateMarketingAiDraft({
        goal: "Goal that fails",
        audience: "Subscribed clients",
        tone: "Friendly",
        cta: "Book",
      }),
    ).rejects.toThrow("MARKETING_AI_REQUEST_FAILED");

    const persistedDraft = await getMarketingCampaignFlowDraftById(draft.id);
    const usageSummary = await getMarketingCampaignGenerationUsageSummary(draft.id);
    const afterQuota = await getMarketingDailyAiGenerationQuota();

    expect(persistedDraft?.subject).toBe("Original subject");
    expect(persistedDraft?.previewText).toBe("Original preview");
    expect(usageSummary.generationCount).toBe(0);
    expect(usageSummary.cumulativeEstimatedCost).toBe(0);
    expect(afterQuota.used).toBe(beforeQuota.used);
  });

  it("resets quota on the next day boundary", async () => {
    const { draft } = await createAdminAndDraft("Quota Reset Campaign");

    const todayNoon = new Date();
    todayNoon.setHours(12, 0, 0, 0);
    const tomorrowNoon = new Date(todayNoon);
    tomorrowNoon.setDate(tomorrowNoon.getDate() + 1);

    await prisma.marketingCampaignGenerationUsage.createMany({
      data: Array.from({ length: MARKETING_DAILY_AI_DRAFT_LIMIT }).map(() => ({
        campaignId: draft.id,
        model: "gpt-4.1-mini",
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
        estimatedInputCost: 0.000004,
        estimatedOutputCost: 0.000016,
        estimatedTotalCost: 0.00002,
        pricingVersion: "test-pricing-v1",
        rateBasisJson: { inputCostPer1k: 0.0004, outputCostPer1k: 0.0016 },
        createdAt: todayNoon,
      })),
    });

    const todayQuota = await getMarketingDailyAiGenerationQuota(todayNoon);
    const tomorrowQuota = await getMarketingDailyAiGenerationQuota(tomorrowNoon);

    expect(todayQuota.used).toBe(MARKETING_DAILY_AI_DRAFT_LIMIT);
    expect(todayQuota.remaining).toBe(0);
    expect(tomorrowQuota.used).toBe(0);
    expect(tomorrowQuota.remaining).toBe(MARKETING_DAILY_AI_DRAFT_LIMIT);
  });

  it("returns explicit config errors when OpenAI env vars are missing", async () => {
    process.env.OPENAI_API_KEY = "";
    await expect(
      generateMarketingAiDraft({
        goal: "Goal text",
        audience: "Subscribed clients",
        tone: "Friendly",
        cta: "Book",
      }),
    ).rejects.toThrow("OPENAI_API_KEY_MISSING");

    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MARKETING_MODEL = "";
    await expect(
      generateMarketingAiDraft({
        goal: "Goal text",
        audience: "Subscribed clients",
        tone: "Friendly",
        cta: "Book",
      }),
    ).rejects.toThrow("OPENAI_MARKETING_MODEL_MISSING");
  });

  it("returns explicit OpenAI request and invalid-structure errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "upstream" } }), { status: 500 })),
    );
    await expect(
      generateMarketingAiDraft({
        goal: "Goal text",
        audience: "Subscribed clients",
        tone: "Friendly",
        cta: "Book",
      }),
    ).rejects.toThrow("MARKETING_AI_REQUEST_FAILED");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              previewText: "missing subject",
              contentJson: { blocks: [{ type: "paragraph", text: "Hello" }] },
            }),
            usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(
      generateMarketingAiDraft({
        goal: "Goal text",
        audience: "Subscribed clients",
        tone: "Friendly",
        cta: "Book",
      }),
    ).rejects.toThrow("MARKETING_AI_SCHEMA_INVALID");
  });

  it("returns explicit preview-render and persistence errors in update path", async () => {
    const { draft } = await createAdminAndDraft("Render Persist Errors");

    const renderSpy = vi
      .spyOn(marketingRenderer, "renderMarketingPreviewHtml")
      .mockImplementation(() => {
        throw new Error("renderer broke");
      });

    await expect(
      updateMarketingCampaignFlowDraft(draft.id, {
        contentJson: { blocks: [{ type: "paragraph", text: "Generated body" }] },
      }),
    ).rejects.toThrow("MARKETING_DRAFT_PREVIEW_RENDER_FAILED");

    renderSpy.mockRestore();

    await expect(
      updateMarketingCampaignFlowDraft(draft.id, {
        categoryId: "missing-category-id",
        contentJson: { blocks: [{ type: "paragraph", text: "Generated body" }] },
      }),
    ).rejects.toThrow("MARKETING_DRAFT_PERSIST_FAILED");
  });
});



