import { isE2EProductionRuntimeAllowed, isE2ETestModeRequested } from "@/lib/e2e/e2e-test-guard";

export class RuntimeEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeEnvError";
  }
}

export function validateRuntimeEnvForEdge(): void {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && isE2ETestModeRequested() && !isE2EProductionRuntimeAllowed()) {
    console.error("[runtime-env] blocked E2E_TEST_MODE activation in production.");
    throw new RuntimeEnvError(
      "E2E_TEST_MODE must not be enabled in production. Refusing to start.",
    );
  }
}
