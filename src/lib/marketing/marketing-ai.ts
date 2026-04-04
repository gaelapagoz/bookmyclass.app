import { z } from "zod";

import { marketingContentSchema } from "@/lib/marketing/marketing-renderer";

const aiRequestSchema = z.object({
  goal: z.string().min(5).max(400),
  audience: z.string().min(2).max(200),
  tone: z.string().min(2).max(100),
  cta: z.string().min(2).max(200),
  extraContext: z.string().max(20000).optional(),
});

const aiResponseSchema = z.object({
  subject: z.string().min(3).max(140),
  previewText: z.string().min(3).max(180),
  contentJson: marketingContentSchema,
});

export type MarketingAiDraft = z.infer<typeof aiResponseSchema>;

export type MarketingAiUsageEstimate = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedInputCost: number;
  estimatedOutputCost: number;
  estimatedTotalCost: number;
  pricingVersion: string;
  rateBasis: {
    inputCostPer1k: number;
    outputCostPer1k: number;
  };
};

type MarketingAiGenerationResult = MarketingAiDraft & {
  usage: MarketingAiUsageEstimate;
};

const MODEL_DEFAULT_RATES_PER_1K: Record<string, { input: number; output: number; pricingVersion: string }> = {
  "gpt-4.1-mini": { input: 0.0004, output: 0.0016, pricingVersion: "gpt-4.1-mini-default-2026-04" },
  "gpt-4.1": { input: 0.002, output: 0.008, pricingVersion: "gpt-4.1-default-2026-04" },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006, pricingVersion: "gpt-4o-mini-default-2026-04" },
};

function roundCost(value: number): number {
  return Number(value.toFixed(6));
}

function resolvePricingForModel(model: string) {
  const fallback = MODEL_DEFAULT_RATES_PER_1K[model] ?? {
    input: 0,
    output: 0,
    pricingVersion: `${model}-default-unknown`,
  };

  const parsedInputRate = Number.parseFloat(process.env.OPENAI_MARKETING_INPUT_COST_PER_1K ?? "");
  const parsedOutputRate = Number.parseFloat(process.env.OPENAI_MARKETING_OUTPUT_COST_PER_1K ?? "");

  return {
    inputCostPer1k: Number.isFinite(parsedInputRate) && parsedInputRate >= 0 ? parsedInputRate : fallback.input,
    outputCostPer1k: Number.isFinite(parsedOutputRate) && parsedOutputRate >= 0 ? parsedOutputRate : fallback.output,
    pricingVersion: process.env.OPENAI_MARKETING_PRICING_VERSION?.trim() || fallback.pricingVersion,
  };
}

export function buildMarketingDraftJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["subject", "previewText", "contentJson"],
    properties: {
      subject: {
        type: "string",
        minLength: 3,
        maxLength: 140,
      },
      previewText: {
        type: "string",
        minLength: 3,
        maxLength: 180,
      },
      contentJson: {
        type: "object",
        additionalProperties: false,
        required: ["blocks"],
        properties: {
          blocks: {
            type: "array",
            minItems: 1,
            maxItems: 60,
            items: {
              oneOf: [
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type"],
                  properties: {
                    type: { const: "heading" },
                    contentHtml: { type: "string" },
                    text: { type: "string" },
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type"],
                  properties: {
                    type: { const: "paragraph" },
                    contentHtml: { type: "string" },
                    text: { type: "string" },
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "url"],
                  properties: {
                    type: { const: "button" },
                    labelHtml: { type: "string" },
                    text: { type: "string" },
                    url: { type: "string", format: "uri" },
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "url"],
                  properties: {
                    type: { const: "image" },
                    url: { type: "string", format: "uri" },
                    alt: { type: "string", maxLength: 240 },
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type"],
                  properties: {
                    type: { const: "divider" },
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "size"],
                  properties: {
                    type: { const: "spacer" },
                    size: { type: "integer", minimum: 8, maximum: 80 },
                  },
                },
              ],
            },
          },
        },
      },
    },
  };
}

export async function generateMarketingAiDraft(input: {
  goal: string;
  audience: string;
  tone: string;
  cta: string;
  extraContext?: string;
}): Promise<MarketingAiGenerationResult> {
  const parsedInput = aiRequestSchema.parse(input);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MARKETING_MODEL?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY_MISSING");
  }
  if (!model) {
    throw new Error("OPENAI_MARKETING_MODEL_MISSING");
  }

  const prompt = `You generate marketing email drafts for a yoga/pilates studio SaaS.
Return JSON with keys: subject, previewText, contentJson.
contentJson must be {"blocks": [...] } and each block type is one of: heading, paragraph, button, image, divider, spacer.
Do not include markdown.

Goal: ${parsedInput.goal}
Audience: ${parsedInput.audience}
Tone: ${parsedInput.tone}
CTA: ${parsedInput.cta}
Extra context: ${parsedInput.extraContext ?? ""}`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: 0.4,
      max_output_tokens: 1200,
      text: {
        format: {
          type: "json_schema",
          name: "marketing_campaign_draft",
          schema: buildMarketingDraftJsonSchema(),
          strict: true,
        },
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    console.error("[marketing-ai] generation-failed", {
      status: response.status,
      statusText: response.statusText,
      details,
    });
    throw new Error("MARKETING_AI_REQUEST_FAILED");
  }

  const payload = await response.json();
  const usage = payload && typeof payload === "object" ? (payload as { usage?: unknown }).usage : null;
  const usageInputTokens =
    usage && typeof usage === "object" && typeof (usage as { input_tokens?: unknown }).input_tokens === "number"
      ? (usage as { input_tokens: number }).input_tokens
      : 0;
  const usageOutputTokens =
    usage && typeof usage === "object" && typeof (usage as { output_tokens?: unknown }).output_tokens === "number"
      ? (usage as { output_tokens: number }).output_tokens
      : 0;
  const usageTotalTokens =
    usage && typeof usage === "object" && typeof (usage as { total_tokens?: unknown }).total_tokens === "number"
      ? (usage as { total_tokens: number }).total_tokens
      : usageInputTokens + usageOutputTokens;

  const pricing = resolvePricingForModel(model);
  const estimatedInputCost = roundCost((usageInputTokens / 1000) * pricing.inputCostPer1k);
  const estimatedOutputCost = roundCost((usageOutputTokens / 1000) * pricing.outputCostPer1k);
  const estimatedTotalCost = roundCost(estimatedInputCost + estimatedOutputCost);

  const text =
    (payload as { output_text?: unknown }).output_text && typeof (payload as { output_text?: unknown }).output_text === "string"
      ? ((payload as { output_text: string }).output_text || "")
      : "";

  if (!text.trim()) {
    throw new Error("MARKETING_AI_EMPTY_OUTPUT");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    throw new Error("MARKETING_AI_INVALID_JSON");
  }

  const validated = aiResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new Error("MARKETING_AI_SCHEMA_INVALID");
  }

  return {
    ...validated.data,
    usage: {
      model,
      inputTokens: usageInputTokens,
      outputTokens: usageOutputTokens,
      totalTokens: usageTotalTokens,
      estimatedInputCost,
      estimatedOutputCost,
      estimatedTotalCost,
      pricingVersion: pricing.pricingVersion,
      rateBasis: {
        inputCostPer1k: pricing.inputCostPer1k,
        outputCostPer1k: pricing.outputCostPer1k,
      },
    },
  };
}
