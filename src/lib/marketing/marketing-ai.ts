import { z } from "zod";

import { marketingContentSchema } from "@/lib/marketing/marketing-renderer";

const aiRequestSchema = z.object({
  goal: z.string().min(5).max(400),
  audience: z.string().min(2).max(200),
  tone: z.string().min(2).max(100),
  cta: z.string().min(2).max(200),
  extraContext: z.string().max(2000).optional(),
});

const aiResponseSchema = z.object({
  subject: z.string().min(3).max(140),
  previewText: z.string().min(3).max(180),
  contentJson: marketingContentSchema,
});

export type MarketingAiDraft = z.infer<typeof aiResponseSchema>;

export async function generateMarketingAiDraft(input: {
  goal: string;
  audience: string;
  tone: string;
  cta: string;
  extraContext?: string;
}): Promise<MarketingAiDraft> {
  const parsedInput = aiRequestSchema.parse(input);
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY_MISSING");
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
      model: process.env.OPENAI_MARKETING_MODEL?.trim() || "gpt-4.1-mini",
      input: prompt,
      temperature: 0.4,
      max_output_tokens: 1200,
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
    throw new Error("MARKETING_AI_GENERATION_FAILED");
  }

  const payload = await response.json();
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

  return validated.data;
}
