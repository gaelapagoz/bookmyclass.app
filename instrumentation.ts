import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";

export async function assertRuntimeEnvOnStartup(runtime: string | undefined = process.env.NEXT_RUNTIME): Promise<void> {
  if (runtime === "nodejs") {
    const { registerNodeInstrumentation } = await import("./instrumentation-node");
    await registerNodeInstrumentation();
    return;
  }

  if (runtime === "edge") {
    const { registerEdgeInstrumentation } = await import("./instrumentation-edge");
    await registerEdgeInstrumentation();
  }
}

export async function register() {
  await assertRuntimeEnvOnStartup();
}

export const onRequestError = Sentry.captureRequestError;
