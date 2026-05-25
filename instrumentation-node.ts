export async function registerNodeInstrumentation(): Promise<void> {
  const { validateRuntimeEnvForEdge } = await import("@/lib/config/runtime-env-edge");
  validateRuntimeEnvForEdge();
  await import("./sentry.server.config");
}
