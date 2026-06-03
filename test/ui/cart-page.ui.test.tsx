/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PriceType, ProductType } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CartPageClient } from "../../src/components/cart/CartPageClient";
import {
  CART_STORAGE_KEY,
  generateCartCheckoutIdempotencyKey,
  rememberClientCartSnapshotForCheckoutSession,
  getCheckoutSubmissionFingerprint,
  maybeClearClientCartAfterConfirmedCheckout,
} from "../../src/lib/cart/cart-client";
import { CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX } from "../../src/lib/cart/cart-contract";

vi.mock("../../src/components/book-a-class/service-detail/SignInModal", () => ({
  SignInModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Sign in modal">
      <p>Sign In</p>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

function seedCart(lines: Array<{
  productId: string;
  priceId: string;
  productName: string;
  priceName: string;
  priceType: PriceType;
  quantity: number;
  unitAmountMinor: number;
}>) {
  window.localStorage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      lines: lines.map((line) => ({
        ...line,
        productDescription: null,
        productType: ProductType.CLASS_PACK,
        currencyCode: "EUR",
        billingInterval: line.priceType === PriceType.RECURRING ? "MONTH" : null,
        billingIntervalCount: line.priceType === PriceType.RECURRING ? 1 : null,
      })),
    }),
  );
}

function createNoopReconcileResponse() {
  const raw = window.localStorage.getItem(CART_STORAGE_KEY);
  const parsed = raw ? JSON.parse(raw) as { lines?: unknown[] } : {};
  return new Response(
    JSON.stringify({
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
      removedCount: 0,
      removedLines: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function mockCartFetch(checkoutResponses: Response[] = []) {
  const pendingCheckoutResponses = [...checkoutResponses];
  const fetchMock = vi.isMockFunction(global.fetch)
    ? vi.mocked(global.fetch)
    : vi.spyOn(global, "fetch");

  return fetchMock.mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    if (url.includes("/api/cart/reconcile")) {
      return createNoopReconcileResponse();
    }
    if (url.includes("/api/wallet/balance")) {
      return new Response(JSON.stringify({ balance: null }), { status: 200, headers: { "content-type": "application/json" } });
    }

    const next = pendingCheckoutResponses.shift();
    if (next) {
      return next;
    }

    return new Response(
      JSON.stringify({
        code: "CHECKOUT_CREATE_FAILED",
        message: "Could not start checkout.",
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  mockCartFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Cart page", () => {
  it("removes stale server-rejected cart lines and shows the empty cart", async () => {
    seedCart([
      {
        productId: "prod_deleted",
        priceId: "price_deleted",
        productName: "Deleted Pack",
        priceName: "Old Price",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);

    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url.includes("/api/cart/reconcile")) {
        return new Response(
          JSON.stringify({
            lines: [],
            removedCount: 1,
            removedLines: [{ productId: "prod_deleted", priceId: "price_deleted", quantity: 1, reason: "PRICE_NOT_ACTIVE" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("{}", { status: 500 });
    });

    render(<CartPageClient />);

    await waitFor(() => {
      expect(screen.getByText("Unavailable cart items were removed.")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Your cart is empty.")).toHaveLength(2);
    expect(JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? "{}")).toMatchObject({
      lines: [],
    });
  });

  it("supports quantity controls for one-time products, remove action, subtotal, and disabled checkout when invalid", async () => {
    seedCart([
      {
        productId: "prod_one",
        priceId: "price_one",
        productName: "One-time Pack",
        priceName: "Pack Price",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);

    render(<CartPageClient />);

    await waitFor(() => {
      expect(screen.getByText("One-time Pack")).toBeInTheDocument();
    });

    expect(screen.getAllByText(/25\.00/)).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: /increase quantity/i }));
    expect(screen.getAllByText(/50\.00/)).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: /decrease quantity/i }));
    expect(screen.getAllByText(/25\.00/)).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getAllByText("Your cart is empty.")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Checkout" })).toBeDisabled();

    seedCart([
      {
        productId: "prod_recurring_controls",
        priceId: "price_recurring_controls",
        productName: "Recurring Plan",
        priceName: "Recurring",
        priceType: PriceType.RECURRING,
        quantity: 1,
        unitAmountMinor: 9900,
      },
    ]);
    window.dispatchEvent(new Event("cart:updated"));

    await waitFor(() => {
      expect(screen.getByText("Recurring Plan")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /increase quantity for recurring plan/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /decrease quantity for recurring plan/i })).toBeDisabled();

    seedCart([
      {
        productId: "prod_rec",
        priceId: "price_rec",
        productName: "Recurring Plan",
        priceName: "Recurring",
        priceType: PriceType.RECURRING,
        quantity: 1,
        unitAmountMinor: 9900,
      },
      {
        productId: "prod_ot",
        priceId: "price_ot",
        productName: "One-time Pack",
        priceName: "One-time",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);
    window.dispatchEvent(new Event("cart:updated"));

    await waitFor(() => {
      expect(
        screen.getByText("You cannot mix recurring and one-time products in the same checkout."),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Checkout" })).toBeDisabled();
  });

  it("opens sign-in modal when checkout is unauthenticated", async () => {
    seedCart([
      {
        productId: "prod_one",
        priceId: "price_one",
        productName: "One-time Pack",
        priceName: "Pack Price",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);

    mockCartFetch([
      new Response(
        JSON.stringify({
          code: "AUTH_REQUIRED",
          message: "Authentication required.",
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    ]);

    render(<CartPageClient />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled();
    });

    await userEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(screen.getByRole("dialog", { name: "Sign in modal" })).toBeInTheDocument();
  });

  it("shows verify-email action on EMAIL_VERIFICATION_REQUIRED", async () => {
    seedCart([
      {
        productId: "prod_one",
        priceId: "price_one",
        productName: "One-time Pack",
        priceName: "Pack Price",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);

    mockCartFetch([
      new Response(
        JSON.stringify({
          code: "EMAIL_VERIFICATION_REQUIRED",
          message: "Your account must be active and email-verified before checkout.",
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    ]);

    render(<CartPageClient />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled();
    });

    await userEvent.click(screen.getByRole("button", { name: "Checkout" }));
    const verifyLink = await screen.findByRole("link", { name: "Verify your email" });
    expect(verifyLink).toHaveAttribute("href", expect.stringContaining("/verify-email?callbackUrl="));
  });

  it("retries in-progress checkout and redirects when session becomes available", async () => {
    seedCart([
      {
        productId: "prod_one_redirect",
        priceId: "price_one_redirect",
        productName: "One-time Pack",
        priceName: "Pack Price",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);

    const fetchSpy = mockCartFetch([
      new Response(
        JSON.stringify({
          code: "IDEMPOTENCY_IN_PROGRESS",
          message: "Checkout request is being processed.",
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
      new Response(
        JSON.stringify({
          code: "CHECKOUT_SESSION_CREATED",
          checkoutUrl: "https://checkout.stripe.test/session_123",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ]);

    render(<CartPageClient />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled();
    });

    await userEvent.click(screen.getByRole("button", { name: "Checkout" }));

    await waitFor(() => {
      expect(fetchSpy.mock.calls.filter((call) => String(call[0]).includes("/api/cart/checkout"))).toHaveLength(2);
    });

    const checkoutCalls = fetchSpy.mock.calls.filter((call) => String(call[0]).includes("/api/cart/checkout"));
    const firstKey = (checkoutCalls[0]?.[1]?.headers as Record<string, string>)?.["Idempotency-Key"];
    const secondKey = (checkoutCalls[1]?.[1]?.headers as Record<string, string>)?.["Idempotency-Key"];
    expect(firstKey).toBe(secondKey);
    expect(screen.queryByText("Checkout request is being processed.")).not.toBeInTheDocument();
  });

  it("generates unique fallback idempotency keys and uses distinct keys for distinct submissions", async () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });

    try {
      const keyOne = generateCartCheckoutIdempotencyKey();
      const keyTwo = generateCartCheckoutIdempotencyKey();
      expect(keyOne).toMatch(CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX);
      expect(keyTwo).toMatch(CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX);
      expect(keyOne).not.toBe(keyTwo);

      seedCart([
        {
          productId: "prod_one_checkout",
          priceId: "price_one_checkout",
          productName: "One-time Pack",
          priceName: "Pack Price",
          priceType: PriceType.ONE_TIME,
          quantity: 1,
          unitAmountMinor: 2500,
        },
      ]);

      const seenKeys: string[] = [];
      mockCartFetch().mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        if (url.includes("/api/cart/reconcile")) {
          return createNoopReconcileResponse();
        }
        const headers = init?.headers as Record<string, string> | undefined;
        const key = headers?.["Idempotency-Key"];
        if (typeof key === "string") {
          seenKeys.push(key);
        }
        return new Response(
          JSON.stringify({
            code: "CHECKOUT_CREATE_FAILED",
            message: "Could not start checkout.",
          }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      });

      render(<CartPageClient />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled();
      });

      await userEvent.click(screen.getByRole("button", { name: "Checkout" }));

      await userEvent.click(screen.getByRole("button", { name: /increase quantity/i }));
      await userEvent.click(screen.getByRole("button", { name: "Checkout" }));

      expect(seenKeys).toHaveLength(2);
      expect(seenKeys[0]).toMatch(CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX);
      expect(seenKeys[1]).toMatch(CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX);
      expect(seenKeys[0]).not.toBe(seenKeys[1]);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: originalCrypto,
      });
    }
  });

  it("applies a coupon preview and includes coupon code in checkout request", async () => {
    seedCart([
      {
        productId: "prod_one_coupon",
        priceId: "price_one_coupon",
        productName: "One-time Pack",
        priceName: "Pack Price",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);

    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url.includes("/api/cart/reconcile")) {
        return createNoopReconcileResponse();
      }
      if (url.includes("/api/cart/coupon/validate")) {
        return new Response(
          JSON.stringify({ couponCode: "SAVE10", subtotalAmountMinor: 2500, discountAmountMinor: 250, totalAmountMinor: 2250, currencyCode: "EUR" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/cart/checkout")) {
        // echo back the body for inspection
        const bodyText = init?.body as string | undefined;
        return new Response(JSON.stringify({ code: "CHECKOUT_SESSION_CREATED", checkoutUrl: "https://checkout.test/session", bodyEcho: bodyText }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    });

    render(<CartPageClient />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled();
    });

    const input = screen.getByTestId("coupon-input");
    await userEvent.type(input, "save10");
    await userEvent.click(screen.getByTestId("coupon-apply"));

    await waitFor(() => {
      const couponBlock = within(screen.getByTestId("coupon-block"));
      expect(couponBlock.getByText(/Applied:/)).toBeInTheDocument();
      expect(couponBlock.getByText("SAVE10")).toBeInTheDocument();
      expect(couponBlock.getByText(/€2\.50/)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Checkout" }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/cart/checkout"));
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const body = calls[0]?.[1]?.body as string;
      expect(body).toContain('"couponCode":"SAVE10"');
    });

    fetchMock.mockRestore();
  });

  it("clears client cart after confirmed checkout when coupon applied and lines match", async () => {
    seedCart([
      {
        productId: "prod_one_coupon_clear",
        priceId: "price_one_coupon_clear",
        productName: "One-time Pack",
        priceName: "Pack Price",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);

    // simulate applied coupon
    window.localStorage.setItem("studio_cart_applied_coupon_v1", JSON.stringify({ couponCode: "SAVE10" }));

    // create a fingerprint and remember it for a fake checkout session id
    const raw = window.localStorage.getItem(CART_STORAGE_KEY) as string;
    const parsed = JSON.parse(raw);
    const lines = parsed.lines ?? [];
    const linesFingerprint = getCheckoutSubmissionFingerprint(lines);
    const fingerprintWithCoupon = `${linesFingerprint}|coupon=SAVE10`;
    const checkoutSessionId = "fake_checkout_123";
    rememberClientCartSnapshotForCheckoutSession({ checkoutSessionId, fingerprint: fingerprintWithCoupon });

    // current cart matches lines; call maybeClear and expect it to clear
    const result = maybeClearClientCartAfterConfirmedCheckout({ checkoutSessionId, cartClearEligible: true, purchasedLines: [{ productId: "prod_one_coupon_clear", priceId: "price_one_coupon_clear", quantity: 1 }] });
    expect(result).toBe(true);
    // cart storage should be cleared after successful checkout
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("studio_cart_applied_coupon_v1")).toBeNull();
  });

  it("clears client cart after confirmed checkout when coupon key missing but lines match", async () => {
    seedCart([
      {
        productId: "prod_one_coupon_clear2",
        priceId: "price_one_coupon_clear2",
        productName: "One-time Pack",
        priceName: "Pack Price",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);

    // do NOT set applied coupon key

    const raw = window.localStorage.getItem(CART_STORAGE_KEY) as string;
    const parsed = JSON.parse(raw);
    const lines = parsed.lines ?? [];
    const linesFingerprint = getCheckoutSubmissionFingerprint(lines);
    const fingerprintWithCoupon = `${linesFingerprint}|coupon=SAVE10`;
    const checkoutSessionId = "fake_checkout_456";
    rememberClientCartSnapshotForCheckoutSession({ checkoutSessionId, fingerprint: fingerprintWithCoupon });

    const result = maybeClearClientCartAfterConfirmedCheckout({ checkoutSessionId, cartClearEligible: true, purchasedLines: [{ productId: "prod_one_coupon_clear2", priceId: "price_one_coupon_clear2", quantity: 1 }] });
    expect(result).toBe(true);
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("studio_cart_applied_coupon_v1")).toBeNull();
  });

  it("does not clear cart when cart lines changed after checkout started", async () => {
    seedCart([
      {
        productId: "prod_changed",
        priceId: "price_changed",
        productName: "One-time Pack",
        priceName: "Pack Price",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);

    const raw = window.localStorage.getItem(CART_STORAGE_KEY) as string;
    const parsed = JSON.parse(raw);
    const lines = parsed.lines ?? [];
    const linesFingerprint = getCheckoutSubmissionFingerprint(lines);
    const fingerprintWithCoupon = `${linesFingerprint}|coupon=SAVE10`;
    const checkoutSessionId = "fake_checkout_changed";
    rememberClientCartSnapshotForCheckoutSession({ checkoutSessionId, fingerprint: fingerprintWithCoupon });

    // mutate current cart to a different state
    seedCart([
      {
        productId: "prod_changed",
        priceId: "price_changed",
        productName: "One-time Pack",
        priceName: "Pack Price",
        priceType: PriceType.ONE_TIME,
        quantity: 2,
        unitAmountMinor: 2500,
      },
    ]);

    const result = maybeClearClientCartAfterConfirmedCheckout({ checkoutSessionId, cartClearEligible: true, purchasedLines: [{ productId: "prod_changed", priceId: "price_changed", quantity: 1 }] });
    expect(result).toBe(false);
    const after = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? "{}");
    // cart should remain with the changed quantity
    expect(after.lines[0].quantity).toBe(2);
  });

  it("supports legacy string snapshot format and clears accordingly", async () => {
    seedCart([
      {
        productId: "prod_legacy",
        priceId: "price_legacy",
        productName: "One-time Pack",
        priceName: "Pack Price",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);

    const raw = window.localStorage.getItem(CART_STORAGE_KEY) as string;
    const parsed = JSON.parse(raw);
    const lines = parsed.lines ?? [];
    const linesFingerprint = getCheckoutSubmissionFingerprint(lines);
    const checkoutSessionId = "fake_checkout_legacy";
    // write legacy string snapshot directly
    window.localStorage.setItem("studio_cart_checkout_snapshot_v1:" + checkoutSessionId, linesFingerprint);

    const result = maybeClearClientCartAfterConfirmedCheckout({ checkoutSessionId, cartClearEligible: true, purchasedLines: [{ productId: "prod_legacy", priceId: "price_legacy", quantity: 1 }] });
    expect(result).toBe(true);
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it("shows state-aware message for long unresolved FAILED_STRIPE_UNCERTAIN responses", async () => {
    seedCart([
      {
        productId: "prod_uncertain",
        priceId: "price_uncertain",
        productName: "One-time Pack",
        priceName: "Pack Price",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);

    mockCartFetch().mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url.includes("/api/cart/reconcile")) {
        return createNoopReconcileResponse();
      }
      return new Response(
        JSON.stringify({
          code: "IDEMPOTENCY_IN_PROGRESS",
          message: "Checkout request is being processed.",
          retryAfterMs: 1,
          idempotency: {
            state: "FAILED_STRIPE_UNCERTAIN",
          },
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      );
    });

    render(<CartPageClient />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled();
    });

    await userEvent.click(screen.getByRole("button", { name: "Checkout" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Checkout confirmation is delayed with our payment provider. Please wait a moment and try checkout again.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("uses a fresh idempotency key on a new explicit click after exhausted FAILED_STRIPE_UNCERTAIN retries", async () => {
    seedCart([
      {
        productId: "prod_uncertain_fresh_click",
        priceId: "price_uncertain_fresh_click",
        productName: "One-time Pack",
        priceName: "Pack Price",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);

    const seenKeys: string[] = [];
    mockCartFetch().mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url.includes("/api/cart/reconcile")) {
        return createNoopReconcileResponse();
      }
      const headers = init?.headers as Record<string, string> | undefined;
      const key = headers?.["Idempotency-Key"];
      if (typeof key === "string") {
        seenKeys.push(key);
      }
      return new Response(
        JSON.stringify({
          code: "IDEMPOTENCY_IN_PROGRESS",
          message: "Checkout request is being processed.",
          retryAfterMs: 1,
          idempotency: { state: "FAILED_STRIPE_UNCERTAIN" },
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      );
    });

    render(<CartPageClient />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled();
    });

    await userEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => {
      expect(screen.getByText(/Checkout confirmation is delayed/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Checkout" }));

    await waitFor(() => {
      expect(seenKeys.length).toBeGreaterThanOrEqual(8);
    });

    const firstAttemptKeys = seenKeys.slice(0, 4);
    const secondAttemptKeys = seenKeys.slice(4, 8);
    expect(firstAttemptKeys.length).toBe(4);
    expect(secondAttemptKeys.length).toBe(4);
    expect(new Set(firstAttemptKeys).size).toBe(1);
    expect(new Set(secondAttemptKeys).size).toBe(1);
    expect(firstAttemptKeys[0]).not.toBe(secondAttemptKeys[0]);
  });

  it("uses a fresh idempotency key after terminal checkout failure on a new click", async () => {
    seedCart([
      {
        productId: "prod_terminal_retry",
        priceId: "price_terminal_retry",
        productName: "One-time Pack",
        priceName: "Pack Price",
        priceType: PriceType.ONE_TIME,
        quantity: 1,
        unitAmountMinor: 2500,
      },
    ]);

    const seenKeys: string[] = [];
    mockCartFetch().mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url.includes("/api/cart/reconcile")) {
        return createNoopReconcileResponse();
      }
      const headers = init?.headers as Record<string, string> | undefined;
      const key = headers?.["Idempotency-Key"];
      if (typeof key === "string") {
        seenKeys.push(key);
      }

      return new Response(
        JSON.stringify({
          code: "CHECKOUT_CREATE_FAILED",
          message: "Checkout could not be confirmed yet. Please retry shortly.",
          idempotency: {
            state: "FAILED_STRIPE_UNCERTAIN",
            replayed: false,
          },
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    });

    render(<CartPageClient />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled();
    });

    await userEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => {
      expect(screen.getByText("Checkout could not be confirmed yet. Please retry shortly.")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Checkout" }));

    await waitFor(() => {
      expect(seenKeys).toHaveLength(2);
    });
    expect(seenKeys[0]).toMatch(CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX);
    expect(seenKeys[1]).toMatch(CART_CHECKOUT_IDEMPOTENCY_KEY_REGEX);
    expect(seenKeys[0]).not.toBe(seenKeys[1]);
  });
});
