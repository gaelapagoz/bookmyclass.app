export class RuntimeEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeEnvError";
  }
}

export function isLocalE2ERuntime(): boolean {
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

export function validateRuntimeEnvForEdge(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const isAllowedLocalE2E = isLocalE2ERuntime();

  if (isProduction && process.env.E2E_TEST_MODE === "1" && !isAllowedLocalE2E) {
    throw new RuntimeEnvError(
      "E2E_TEST_MODE must not be enabled in production. Refusing to start.",
    );
  }
}
