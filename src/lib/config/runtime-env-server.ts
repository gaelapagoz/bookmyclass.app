import { UploadsConfigError, resolveUploadsConfig } from "@/lib/media/upload-config";
import {
  RuntimeEnvError,
  isLocalE2ERuntime,
  validateRuntimeEnvForEdge,
} from "@/lib/config/runtime-env-edge";

export { RuntimeEnvError };

export function validateRuntimeEnvForServer(): void {
  validateRuntimeEnvForEdge();

  const isProduction = process.env.NODE_ENV === "production";
  const isAllowedLocalE2E = isLocalE2ERuntime();

  if (isAllowedLocalE2E || !isProduction) {
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
