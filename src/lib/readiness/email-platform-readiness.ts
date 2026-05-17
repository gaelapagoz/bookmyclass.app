import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import prisma from "@/lib/db";

type ReadinessResult = {
  readonly ok: boolean;
  readonly blockers: readonly string[];
};

const FORBIDDEN_EMAIL_ARCHITECTURE_VARS = [
  "EMAIL_AUTOMATION_OUTBOX_ENABLED",
  "EMAIL_AUTH_OUTBOX_ENABLED",
  "EMAIL_AUTH_FAST_LANE_ENABLED",
  "EMAIL_TEMPLATE_RENDERER_ENABLED",
  "MARKETING_SHARED_BUILDER_ENABLED",
  "EMAIL_AUTH_LEGACY_SEND_ENABLED",
  "EMAIL_AUTOMATION_DISPATCH_ENABLED",
  "EMAIL_BOOKING_EVENTS_ENABLED",
  "EMAIL_WAITLIST_EVENTS_ENABLED",
  "EMAIL_PAYMENT_EVENTS_ENABLED",
  "EMAIL_STORE_EVENTS_ENABLED",
  "EMAIL_GIFT_CARD_EVENTS_ENABLED",
  "EMAIL_AUTOMATION_DISPATCH_PAUSED",
  "EMAIL_BOOKING_EMAILS_PAUSED",
  "EMAIL_WAITLIST_EMAILS_PAUSED",
  "EMAIL_PAYMENT_EMAILS_PAUSED",
  "EMAIL_STORE_EMAILS_PAUSED",
  "EMAIL_GIFT_CARD_EMAILS_PAUSED",
] as const;

const FORBIDDEN_SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".md", ".json", ".env", ".example"]);

function extractEmailAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const angleMatch = trimmed.match(/<([^<>]+)>/);
  const candidate = (angleMatch?.[1] ?? trimmed).trim().toLowerCase();
  if (!candidate || candidate.includes(" ")) return null;
  return candidate;
}

function hasBookMyClassSenderDomain(value: string | undefined): boolean {
  const parsed = value ? extractEmailAddress(value) : null;
  if (!parsed) return false;
  const atIndex = parsed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === parsed.length - 1) return false;
  return parsed.slice(atIndex + 1) === "bookmyclass.app";
}

async function assertTableExists(tableName: string): Promise<boolean> {
  const result = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
    ) AS "exists"
  `;
  return Boolean(result[0]?.exists);
}

async function assertUniqueIndexForEventIdempotency(): Promise<boolean> {
  const result = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'EmailAutomationEvent'
        AND indexdef ILIKE '%UNIQUE%'
        AND indexdef ILIKE '%"idempotencyKey"%'
    ) AS "exists"
  `;
  return Boolean(result[0]?.exists);
}

async function assertDeadLetterColumnsExist(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailAutomationEvent'
      AND column_name IN ('status', 'deadLetteredAt', 'lastError')
  `;
  const names = new Set(rows.map((row) => row.column_name));
  return names.has("status") && names.has("deadLetteredAt") && names.has("lastError");
}

async function listFilesRecursively(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") {
      continue;
    }
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(absolute));
      continue;
    }
    const ext = path.extname(entry.name);
    if (FORBIDDEN_SCAN_EXTENSIONS.has(ext) || entry.name.startsWith(".env")) {
      files.push(absolute);
    }
  }
  return files;
}

async function findForbiddenVarReferences(): Promise<string[]> {
  const roots = [
    path.resolve(process.cwd(), "src"),
    path.resolve(process.cwd(), "scripts"),
    path.resolve(process.cwd(), "docs"),
    path.resolve(process.cwd(), "test"),
  ];
  const rootFiles = [
    path.resolve(process.cwd(), "package.json"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env.test"),
    path.resolve(process.cwd(), ".env.test.example"),
    path.resolve(process.cwd(), ".env.e2e.example"),
  ];

  const files: string[] = [...rootFiles];
  for (const root of roots) {
    files.push(...await listFilesRecursively(root));
  }

  const offenders: string[] = [];
  for (const file of files) {
    const relativePath = path.relative(process.cwd(), file).replaceAll("\\", "/");
    if (relativePath === "src/lib/readiness/email-platform-readiness.ts") {
      continue;
    }
    let source = "";
    try {
      source = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const token of FORBIDDEN_EMAIL_ARCHITECTURE_VARS) {
      if (source.includes(token)) {
        offenders.push(`${path.relative(process.cwd(), file)} contains ${token}`);
      }
    }
  }

  return offenders;
}

async function checkPaymentEmailsWebhookOnly(): Promise<boolean> {
  const successFiles = [
    path.resolve(process.cwd(), "src/app/(protected)/subscription/success/page.tsx"),
    path.resolve(process.cwd(), "src/app/(protected)/store/success/page.tsx"),
  ];

  for (const file of successFiles) {
    const source = await readFile(file, "utf8");
    if (source.includes("sendEmailViaResend(") || source.includes("enqueueEmailAutomationEvent(")) {
      return false;
    }
  }

  const webhookSource = await readFile(
    path.resolve(process.cwd(), "src/lib/public-booking/stripe-webhook-service.ts"),
    "utf8",
  );
  return webhookSource.includes("processStripeWebhookEvent(") && webhookSource.includes("checkout.session.completed");
}

async function checkNoLegacyMarketingRendererFallback(): Promise<boolean> {
  const marketingService = await readFile(
    path.resolve(process.cwd(), "src/lib/marketing/marketing-service.ts"),
    "utf8",
  );
  return !marketingService.includes("campaign.htmlSnapshot?.trim() ||");
}

async function checkCanonicalDispatchPathExists(): Promise<boolean> {
  const file = path.resolve(process.cwd(), "src/lib/email/email-automation-dispatcher-service.ts");
  await access(file);
  const source = await readFile(file, "utf8");
  return source.includes("dispatchEmailAutomationBatch(");
}

export async function verifyEmailPlatformReadiness(env: NodeJS.ProcessEnv): Promise<ReadinessResult> {
  const blockers: string[] = [];

  if (!env.MARKETING_TRACKING_SECRET?.trim()) {
    blockers.push("MARKETING_TRACKING_SECRET is required");
  }
  if (!hasBookMyClassSenderDomain(env.EMAIL_FROM)) {
    blockers.push("EMAIL_FROM must use verified @bookmyclass.app sender domain");
  }

  for (const key of FORBIDDEN_EMAIL_ARCHITECTURE_VARS) {
    if (env[key]?.trim()) {
      blockers.push(`Forbidden email architecture variable is set: ${key}`);
    }
  }

  const requiredTables = [
    "EmailTemplate",
    "EmailAutomationEvent",
    "EmailAutomationAttempt",
    "EmailDispatcherHeartbeat",
    "EmailTemplateAuditLog",
  ] as const;

  for (const table of requiredTables) {
    if (!(await assertTableExists(table))) {
      blockers.push(`Missing required outbox table: ${table}`);
    }
  }
  if (!(await assertUniqueIndexForEventIdempotency())) {
    blockers.push("EmailAutomationEvent.idempotencyKey unique index is missing");
  }
  if (!(await assertDeadLetterColumnsExist())) {
    blockers.push("EmailAutomationEvent dead-letter visibility columns are missing");
  }
  if (!(await checkCanonicalDispatchPathExists())) {
    blockers.push("Dispatcher/outbox canonical path cannot be verified");
  }
  if (!(await checkNoLegacyMarketingRendererFallback())) {
    blockers.push("Legacy marketing htmlSnapshot runtime fallback is still reachable");
  }
  if (!(await checkPaymentEmailsWebhookOnly())) {
    blockers.push("Payment email trigger exclusivity (webhook-only) verification failed");
  }

  const forbiddenRefs = await findForbiddenVarReferences();
  for (const ref of forbiddenRefs) {
    blockers.push(`Forbidden email architecture reference remains: ${ref}`);
  }

  return {
    ok: blockers.length === 0,
    blockers,
  };
}
