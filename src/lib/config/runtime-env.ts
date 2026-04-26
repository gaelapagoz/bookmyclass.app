export class RuntimeEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeEnvError";
  }
}

export function validateRuntimeEnv(): void {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && process.env.E2E_TEST_MODE === "1") {
    throw new RuntimeEnvError(
      "E2E_TEST_MODE must not be enabled in production. Refusing to start.",
    );
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

  if (missing.length > 0) {
    throw new RuntimeEnvError(
      `Missing required production environment variables: ${missing.join(", ")}`,
    );
  }
}
