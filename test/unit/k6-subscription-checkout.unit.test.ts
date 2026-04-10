import { beforeEach, describe, expect, it, vi } from "vitest";

const loginWithCredentialsMock = vi.fn();
const pickUserByCohortMock = vi.fn();
const pickProductSeedMock = vi.fn();
const getMock = vi.fn();
const postJsonMock = vi.fn();
const assertStatusMock = vi.fn();
const assertJsonPathMock = vi.fn();
const paceMock = vi.fn();
const counterAddMock = vi.fn();

vi.mock("../../k6/lib/auth.js", () => ({
  loginWithCredentials: (...args: unknown[]) => loginWithCredentialsMock(...args),
}));

vi.mock("../../k6/lib/data.js", () => ({
  pickUserByCohort: (...args: unknown[]) => pickUserByCohortMock(...args),
  pickProductSeed: (...args: unknown[]) => pickProductSeedMock(...args),
}));

vi.mock("../../k6/lib/http.js", () => ({
  get: (...args: unknown[]) => getMock(...args),
  postJson: (...args: unknown[]) => postJsonMock(...args),
}));

vi.mock("../../k6/lib/checks.js", () => ({
  assertStatus: (...args: unknown[]) => assertStatusMock(...args),
  assertJsonPath: (...args: unknown[]) => assertJsonPathMock(...args),
}));

vi.mock("../../k6/lib/pacing.js", () => ({
  pace: (...args: unknown[]) => paceMock(...args),
}));

vi.mock("k6/metrics", () => ({
  Counter: function Counter() {
    this.add = (...args: unknown[]) => counterAddMock(...args);
  },
}));

function mockResponse(status: number, body: unknown) {
  return {
    status,
    json: () => body,
  };
}

describe("k6 subscription checkout scenario", () => {
  beforeEach(() => {
    vi.resetModules();
    loginWithCredentialsMock.mockReset();
    pickUserByCohortMock.mockReset();
    pickProductSeedMock.mockReset();
    getMock.mockReset();
    postJsonMock.mockReset();
    assertStatusMock.mockReset();
    assertJsonPathMock.mockReset();
    paceMock.mockReset();
    counterAddMock.mockReset();

    pickUserByCohortMock.mockReturnValue({
      email: "buyer@example.test",
      password: "pw",
    });
    pickProductSeedMock.mockReturnValue({
      productId: "stale-product",
    });

    (globalThis as unknown as { __ENV?: Record<string, string> }).__ENV = {};
  });

  it("invalidates stale product id and retries once with live product", async () => {
    getMock
      .mockReturnValueOnce(mockResponse(200, { products: [{ productId: "fresh-product" }] }))
      .mockReturnValueOnce(mockResponse(200, { products: [{ productId: "fresh-product" }] }));

    postJsonMock
      .mockReturnValueOnce(mockResponse(404, { code: "PRODUCT_NOT_FOUND", error: "Product not found" }))
      .mockReturnValueOnce(mockResponse(200, { checkoutUrl: "https://checkout", checkoutSessionId: "cs_123" }));

    const { subscriptionCheckoutScenario } = await import("../../k6/scenarios/subscription-checkout.js");
    subscriptionCheckoutScenario();

    expect(postJsonMock).toHaveBeenCalledTimes(2);
    expect(postJsonMock.mock.calls[0][1]).toEqual({ productId: "stale-product" });
    expect(postJsonMock.mock.calls[1][1]).toEqual({ productId: "fresh-product" });
    expect(counterAddMock).toHaveBeenCalledTimes(1);
  });

  it("classifies and skips when retried product is still invalid", async () => {
    getMock
      .mockReturnValueOnce(mockResponse(200, { products: [{ productId: "fresh-product" }] }))
      .mockReturnValueOnce(mockResponse(200, { products: [{ productId: "fresh-product" }] }));

    postJsonMock
      .mockReturnValueOnce(mockResponse(404, { code: "PRODUCT_NOT_FOUND", error: "Product not found" }))
      .mockReturnValueOnce(mockResponse(404, { code: "PRODUCT_NOT_FOUND", error: "Product not found" }));

    const { subscriptionCheckoutScenario } = await import("../../k6/scenarios/subscription-checkout.js");
    expect(() => subscriptionCheckoutScenario()).not.toThrow();

    expect(postJsonMock).toHaveBeenCalledTimes(2);
    expect(counterAddMock).toHaveBeenCalledTimes(2);
    expect(assertJsonPathMock).not.toHaveBeenCalledWith(
      expect.anything(),
      "subscription_checkout url present",
      expect.any(Function),
    );
  });
});
