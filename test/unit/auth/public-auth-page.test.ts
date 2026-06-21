import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePublicAuthPageRedirect } from "@/lib/auth/public-auth-page";

vi.mock("@/lib/auth/verified-customer-state", () => ({
  getVerifiedCustomerState: vi.fn(),
}));

const { getVerifiedCustomerState } = await import("@/lib/auth/verified-customer-state");

describe("resolvePublicAuthPageRedirect", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null for signed-out sessions", async () => {
    vi.mocked(getVerifiedCustomerState).mockResolvedValue({ kind: "signed-out" });

    await expect(
      resolvePublicAuthPageRedirect({
        session: null,
      }),
    ).resolves.toBeNull();
  });

  it("routes stale sessions through the stale-session cookie clearer", async () => {
    vi.mocked(getVerifiedCustomerState).mockResolvedValue({
      kind: "stale-session",
      reason: "missing-user",
    });

    await expect(
      resolvePublicAuthPageRedirect({
        session: {} as Session,
        callbackUrl: "/dashboard/bookings",
      }),
    ).resolves.toBe("/auth/stale-session?callbackUrl=%2Fdashboard%2Fbookings");
  });

  it("routes unverified client sessions to verify-email", async () => {
    vi.mocked(getVerifiedCustomerState).mockResolvedValue({
      kind: "email-verification-required",
      email: "client@example.com",
    });

    await expect(
      resolvePublicAuthPageRedirect({
        session: {} as Session,
        callbackUrl: "/dashboard",
      }),
    ).resolves.toBe(
      "/verify-email?blocked=1&email=client%40example.com&callbackUrl=%2Fdashboard",
    );
  });

  it("preserves the callback for verified clients", async () => {
    vi.mocked(getVerifiedCustomerState).mockResolvedValue({
      kind: "verified",
      session: {
        user: {
          id: "user_123",
          role: "CLIENT",
        },
      } as Session & { user: { id: string; role: "CLIENT" } },
    });

    await expect(
      resolvePublicAuthPageRedirect({
        session: {} as Session,
        callbackUrl: "/dashboard/orders",
      }),
    ).resolves.toBe("/dashboard/orders");
  });

  it("sends verified staff users to their workspace", async () => {
    vi.mocked(getVerifiedCustomerState).mockResolvedValue({
      kind: "verified",
      session: {
        user: {
          id: "user_456",
          role: "ADMIN",
        },
      } as Session & { user: { id: string; role: "ADMIN" } },
    });

    await expect(
      resolvePublicAuthPageRedirect({
        session: {} as Session,
        callbackUrl: "/dashboard",
      }),
    ).resolves.toBe("/admin");
  });
});
