import { resolveUploadsConfig, UploadsConfigError } from "@/lib/media/upload-config";

export class RuntimeEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeEnvError";
  }
}

function isLocalE2ERuntime(): boolean {
  if (process.env.E2E_TEST_MODE !== "1") {
    return false;
  }

  const databaseUrl = process.env.DATABASE_URL?.toLowerCase() ?? "";
  if (!databaseUrl.includes("e2e")) {
    return false;
  }

  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) {
    return false;
  }

  try {
    const hostname = new URL(appUrl).hostname.toLowerCase();
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

export function validateRuntimeEnv(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const isAllowedLocalE2E = isLocalE2ERuntime();

  if (isProduction && process.env.E2E_TEST_MODE === "1" && !isAllowedLocalE2E) {
    throw new RuntimeEnvError(
      "E2E_TEST_MODE must not be enabled in production. Refusing to start.",
    );
  }

  if (isAllowedLocalE2E) {
    return;
  }

  if (!isProduction) {
    return;
  }

  const missing: string[] = [];

  if (!process.env.AUTH_SECRET?.trim()) missing.push("AUTH_SECRET");
  if (!process.env.STRIPE_SECRET_KEY?.trim()) missing.push("STRIPE_SECRET_KEY");
  if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim()) missing.push("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  if (!process.env.STRIPE_WEBHOOK_SECRET?.trim()) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!process.env.RESEND_API_KEY?.trim()) missing.push("RESEND_API_KEY");
  if (!process.env.EMAIL_FROM?.trim()) missing.push("EMAIL_FROM");
  if (!process.env.MARKETING_TRACKING_SECRET?.trim()) missing.push("MARKETING_TRACKING_SECRET");
  if (!process.env.CRON_SECRET?.trim()) missing.push("CRON_SECRET");
  if (!process.env.UPLOADS_DIR?.trim()) missing.push("UPLOADS_DIR");

  if (missing.length > 0) {
    throw new RuntimeEnvError(
      `Missing required production environment variables: ${missing.join(", ")}`,
    );
  }

  try {
    resolveUploadsConfig();
  } catch (error) {
    if (error instanceof UploadsConfigError) {
      throw new RuntimeEnvError(error.message);
    }

    throw error;
  }
}
