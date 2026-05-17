"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  bulkSetAutomationTemplateStatus,
  replayAutomationDeadLetterEvent,
  setAutomationTemplateStatus,
  sendAutomationTemplateTestEmail,
  updateAutomationTemplate,
} from "@/lib/email/email-automation-admin-service";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";

const replayInputSchema = z.object({
  eventId: z.string().trim().min(1),
  templateKey: z.string().trim().min(1),
  page: z.coerce.number().int().min(1).optional(),
});

export async function replayAutomationDeadLetterAction(formData: FormData) {
  await assertSameOriginServerAction();
  await requireAdminSession();

  const parsed = replayInputSchema.safeParse({
    eventId: formData.get("eventId"),
    templateKey: formData.get("templateKey"),
    page: formData.get("page"),
  });

  if (!parsed.success) {
    redirect("/admin/automations");
  }

  const { templateKey, page = 1 } = parsed.data;

  const { replayed } = await replayAutomationDeadLetterEvent({ eventId: parsed.data.eventId, templateKey });

  const params = new URLSearchParams();
  if (page > 1) params.set("deadLetterPage", String(page));
  params.set(replayed ? "replaySuccess" : "replayError", "1");

  redirect(`/admin/automations/${templateKey}?${params.toString()}`);
}

const testSendInputSchema = z.object({
  templateKey: z.string().trim().min(1),
  toEmail: z.string().trim().email(),
});

const updateTemplateActionSchema = z.object({
  templateKey: z.string().trim().min(1),
  name: z.string().trim().min(1),
  subjectTemplate: z.string().trim().min(1),
  contentJson: z.string().trim().min(2).max(200_000),
});

export async function updateAutomationTemplateAction(formData: FormData) {
  await assertSameOriginServerAction();
  const session = await requireAdminSession();

  const templateKeyRaw = String(formData.get("templateKey") ?? "").trim();

  const parsed = updateTemplateActionSchema.safeParse({
    templateKey: templateKeyRaw,
    name: formData.get("name"),
    subjectTemplate: formData.get("subjectTemplate"),
    contentJson: formData.get("contentJson"),
  });

  if (!parsed.success) {
    const dest =
      templateKeyRaw.length > 0
        ? `/admin/automations/${templateKeyRaw}/edit?error=invalid_form`
        : `/admin/automations`;
    redirect(dest);
  }

  const { templateKey, name, subjectTemplate, contentJson } = parsed.data;

  let bodyTemplateJson: unknown;
  try {
    bodyTemplateJson = JSON.parse(contentJson);
  } catch {
    redirect(`/admin/automations/${templateKey}/edit?error=invalid_json`);
  }

  try {
    await updateAutomationTemplate({
      templateKey,
      name,
      subjectTemplate,
      bodyTemplateJson,
      actorId: session.user.id,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("AUTOMATION_TEMPLATE_INVALID_TOKENS:")) {
      redirect(`/admin/automations/${templateKey}/edit?error=invalid_tokens`);
    }
    redirect(`/admin/automations/${templateKey}/edit?error=save_failed`);
  }

  redirect(`/admin/automations/${templateKey}/edit?success=1`);
}

export async function sendAutomationTemplateTestEmailAction(formData: FormData) {
  await assertSameOriginServerAction();
  await requireAdminSession();

  const parsed = testSendInputSchema.safeParse({
    templateKey: formData.get("templateKey"),
    toEmail: formData.get("toEmail"),
  });

  if (!parsed.success) {
    redirect("/admin/automations");
  }

  const { templateKey, toEmail } = parsed.data;

  try {
    await sendAutomationTemplateTestEmail({ templateKey, toEmail });
  } catch {
    redirect(`/admin/automations/${templateKey}?testError=1&testEmail=${encodeURIComponent(toEmail)}`);
  }

  const params = new URLSearchParams({ testSuccess: "1", testEmail: toEmail });
  redirect(`/admin/automations/${templateKey}?${params.toString()}`);
}

const setStatusSchema = z.object({
  templateKey: z.string().trim().min(1),
  status: z.enum(["active", "paused"]),
});

export async function setAutomationTemplateStatusAction(formData: FormData) {
  await assertSameOriginServerAction();
  const session = await requireAdminSession();

  const parsed = setStatusSchema.safeParse({
    templateKey: formData.get("templateKey"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    redirect("/admin/automations");
  }
  await setAutomationTemplateStatus({
    templateKey: parsed.data.templateKey,
    isActive: parsed.data.status === "active",
    actorId: session.user.id,
  });
  redirect("/admin/automations");
}

const bulkStatusSchema = z.object({
  status: z.enum(["active", "paused"]),
});

export async function bulkSetAutomationTemplateStatusAction(formData: FormData) {
  await assertSameOriginServerAction();
  const session = await requireAdminSession();

  const parsed = bulkStatusSchema.safeParse({
    status: formData.get("status"),
  });
  if (!parsed.success) {
    redirect("/admin/automations");
  }
  const keys = formData
    .getAll("templateKey")
    .map((item) => String(item).trim())
    .filter(Boolean);
  if (keys.length === 0) {
    redirect("/admin/automations");
  }
  await bulkSetAutomationTemplateStatus({
    templateKeys: keys,
    isActive: parsed.data.status === "active",
    actorId: session.user.id,
  });
  redirect("/admin/automations");
}
