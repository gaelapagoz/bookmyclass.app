import { describe, expect, it, vi } from "vitest";

const dispatchEmailAutomationBatchMock = vi.fn();

vi.mock("@/lib/email/email-automation-dispatcher-service", () => ({
  dispatchEmailAutomationBatch: (...args: unknown[]) => dispatchEmailAutomationBatchMock(...args),
}));

import { attemptImmediateLifecycleDispatch } from "../../src/lib/email/lifecycle-email-outbox-service";

describe("attemptImmediateLifecycleDispatch", () => {
  it("propagates dispatcher failures", async () => {
    dispatchEmailAutomationBatchMock.mockRejectedValueOnce(new Error("dispatcher down"));

    await expect(attemptImmediateLifecycleDispatch(new Date())).rejects.toThrow("dispatcher down");
  });
});
