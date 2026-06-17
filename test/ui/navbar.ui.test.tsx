/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, signOutMock, getVerifiedCustomerStateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  signOutMock: vi.fn(async () => undefined),
  getVerifiedCustomerStateMock: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_noStore: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: authMock,
  signOut: signOutMock,
}));

vi.mock("@/lib/auth/verified-customer-state", () => ({
  getVerifiedCustomerState: getVerifiedCustomerStateMock,
}));

vi.mock("@/components/NavbarClient", () => ({
  default: ({
    isAuthenticated,
  }: {
    isAuthenticated: boolean;
    onSignOutAction: (formData: FormData) => Promise<void>;
  }) => <div data-testid="navbar-client-auth-state">{String(isAuthenticated)}</div>,
}));

import Navbar from "@/components/Navbar";

describe("Navbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue(null);
  });

  it("shows signed-out affordances when verified state cannot be proven", async () => {
    authMock.mockResolvedValue({
      user: { id: "client-1", email: "client@example.test" },
      expires: "2099-01-01T00:00:00.000Z",
    });
    getVerifiedCustomerStateMock.mockResolvedValue({
      kind: "stale-session",
      reason: "db-error",
    });

    render(await Navbar());

    expect(screen.getByTestId("navbar-client-auth-state")).toHaveTextContent("false");
  });

  it("shows authenticated affordances when the server verifies the session", async () => {
    authMock.mockResolvedValue({
      user: { id: "client-1", email: "client@example.test" },
      expires: "2099-01-01T00:00:00.000Z",
    });
    getVerifiedCustomerStateMock.mockResolvedValue({
      kind: "verified",
      session: {
        user: { id: "client-1", email: "client@example.test", role: "CLIENT" },
        expires: "2099-01-01T00:00:00.000Z",
      },
    });

    render(await Navbar());

    expect(screen.getByTestId("navbar-client-auth-state")).toHaveTextContent("true");
  });
});
