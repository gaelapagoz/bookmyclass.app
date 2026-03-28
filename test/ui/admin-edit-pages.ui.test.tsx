/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    const error = new Error("NEXT_NOT_FOUND");
    (error as Error & { digest?: string }).digest = "NEXT_HTTP_ERROR_FALLBACK;404";
    throw error;
  }),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    notFound: notFoundMock,
  };
});

vi.mock("@/app/admin/(private)/actions", () => ({
  updateUserAction: vi.fn(),
  adjustClientCreditsAction: vi.fn(),
  cancelClientMembershipAction: vi.fn(),
}));

vi.mock("@/lib/admin/admin-service", () => ({
  getAdminUserById: vi.fn(),
  getAdminClientActivityData: vi.fn(),
}));

import { getAdminClientActivityData, getAdminUserById } from "@/lib/admin/admin-service";

import AdminUserEditPage from "../../src/app/admin/(private)/users/[id]/edit/page";

describe("admin edit pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggers notFound for missing user record", async () => {
    vi.mocked(getAdminUserById).mockResolvedValue(null);

    await expect(
      AdminUserEditPage({
        params: Promise.resolve({ id: "missing-id" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders edit form when admin user exists", async () => {
    vi.mocked(getAdminUserById).mockResolvedValue({
      id: "user-1",
      name: "Admin User",
      firstName: "Admin",
      lastName: "User",
      email: "admin@example.test",
      role: "ADMIN",
      isActive: true,
      phone: "",
      notes: "",
      bio: "",
      specialties: [],
      certifications: [],
      hireDate: null,
    });

    render(
      await AdminUserEditPage({
        params: Promise.resolve({ id: "user-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "View User" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Admin")).toBeInTheDocument();
    expect(screen.getByDisplayValue("User")).toBeInTheDocument();
    expect(screen.getByDisplayValue("admin@example.test")).toBeInTheDocument();
  });

  it("renders distinct client activity credit forms with expected payload fields", async () => {
    vi.mocked(getAdminUserById).mockResolvedValue({
      id: "client-1",
      name: "Client User",
      firstName: "Client",
      lastName: "User",
      email: "client@example.test",
      role: "CLIENT",
      isActive: true,
      phone: "",
      notes: "",
      bio: "",
      specialties: [],
      certifications: [],
      hireDate: null,
    });
    vi.mocked(getAdminClientActivityData).mockResolvedValue({
      plansBought: [],
      classesBooked: 2,
      classesCancelled: 1,
      outstandingMemberships: [],
      creditEntitlements: [
        {
          entitlementId: "ent-1",
          productName: "10 Class Pack",
          status: "ACTIVE",
          expiresAt: null,
          remainingCredits: 5,
        },
      ],
      creditsRemaining: 5,
      nextCreditExpiration: null,
      eligibleCreditProducts: [{ id: "prod-1", name: "10 Class Pack" }],
    });

    render(
      await AdminUserEditPage({
        params: Promise.resolve({ id: "client-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "Client Activity" })).toBeInTheDocument();

    const adjustForm = screen.getByTestId("client-credits-adjust-form");
    expect(within(adjustForm).getByDisplayValue("client-1")).toHaveAttribute("name", "userId");
    expect(within(adjustForm).getByDisplayValue("ent-1")).toHaveAttribute("name", "entitlementId");
    expect(within(adjustForm).getByRole("spinbutton", { name: "Credits Delta" })).toHaveAttribute(
      "name",
      "creditDelta",
    );

    const createForm = screen.getByTestId("client-credits-create-form");
    expect(within(createForm).getByDisplayValue("client-1")).toHaveAttribute("name", "userId");
    expect(within(createForm).getByRole("spinbutton", { name: "Add Credits" })).toHaveAttribute(
      "name",
      "creditDelta",
    );
  });
});
