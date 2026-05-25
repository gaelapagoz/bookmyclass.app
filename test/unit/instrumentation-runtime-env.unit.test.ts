import { afterEach, describe, expect, it, vi } from "vitest";

describe("assertRuntimeEnvOnStartup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("calls server runtime env validation in nodejs runtime", async () => {
    const registerNodeInstrumentation = vi.fn();
    vi.doMock("../../instrumentation-node", () => ({ registerNodeInstrumentation }));

    const { assertRuntimeEnvOnStartup } = await import("../../instrumentation");
    await assertRuntimeEnvOnStartup("nodejs");

    expect(registerNodeInstrumentation).toHaveBeenCalledTimes(1);
  });

  it("calls edge runtime env validation in edge runtime", async () => {
    const registerEdgeInstrumentation = vi.fn();
    vi.doMock("../../instrumentation-edge", () => ({ registerEdgeInstrumentation }));

    const { assertRuntimeEnvOnStartup } = await import("../../instrumentation");
    await assertRuntimeEnvOnStartup("edge");

    expect(registerEdgeInstrumentation).toHaveBeenCalledTimes(1);
  });
});
