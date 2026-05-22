import * as Sentry from "@sentry/nextjs";

export async function assertRuntimeEnvOnStartup(runtime: string | undefined = process.env.NEXT_RUNTIME): Promise<void> {
  if (runtime === "nodejs" || runtime === "edge") {
    const { validateRuntimeEnvForEdge } = await import("@/lib/config/runtime-env-edge");
    validateRuntimeEnvForEdge();
  }
}

export async function register() {
  await assertRuntimeEnvOnStartup();

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
