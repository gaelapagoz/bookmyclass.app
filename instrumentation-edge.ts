import { validateRuntimeEnvForEdge } from "@/lib/config/runtime-env-edge";

export async function registerEdgeInstrumentation(): Promise<void> {
  validateRuntimeEnvForEdge();
  await import("./sentry.edge.config");
}

