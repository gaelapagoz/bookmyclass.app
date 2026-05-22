import { afterEach, describe, expect, it, vi } from "vitest";

describe("assertRuntimeEnvOnStartup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("calls runtime env validation in nodejs runtime", async () => {
    const validateRuntimeEnvForEdge = vi.fn();
    vi.doMock("@/lib/config/runtime-env-edge", () => ({ validateRuntimeEnvForEdge }));

    const { assertRuntimeEnvOnStartup } = await import("../../instrumentation");
    await assertRuntimeEnvOnStartup("nodejs");

    expect(validateRuntimeEnvForEdge).toHaveBeenCalledTimes(1);
  });

  it("calls runtime env validation in edge runtime", async () => {
    const validateRuntimeEnvForEdge = vi.fn();
    vi.doMock("@/lib/config/runtime-env-edge", () => ({ validateRuntimeEnvForEdge }));

    const { assertRuntimeEnvOnStartup } = await import("../../instrumentation");
    await assertRuntimeEnvOnStartup("edge");

    expect(validateRuntimeEnvForEdge).toHaveBeenCalledTimes(1);
  });
});
