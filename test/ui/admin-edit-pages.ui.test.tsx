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
  uploadTeacherImageAction: vi.fn(),
}));

vi.mock("@/lib/admin/admin-service", () => ({
  getAdminUserById: vi.fn(),
  getAdminClientActivityData: vi.fn(),
  listAdminMarketingSegmentOptions: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: vi.fn(async () => ({
    user: { id: "admin-1", role: "MASTER_ADMIN" },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  })),
}));

import { getAdminClientActivityData, getAdminUserById, listAdminMarketingSegmentOptions } from "@/lib/admin/admin-service";
import { requireAdminSession } from "@/lib/auth/require-auth";

import AdminUserEditPage from "../../src/app/admin/(private)/users/[id]/edit/page";

describe("admin edit pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAdminMarketingSegmentOptions).mockResolvedValue([]);
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
      image: "",
      phone: "",
      notes: "",
      bio: "",
      specialties: [],
      certifications: [],
      hireDate: null,
      marketingSubscriptionStatus: "NEVER_SUBSCRIBED",
      marketingSegmentIds: [],
    });

    render(
      await AdminUserEditPage({
        params: Promise.resolve({ id: "user-1" }),
        searchParams: Promise.resolve({ success: "User updated." }),
      }),
    );

    expect(screen.getByRole("heading", { name: "View User" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Admin")).toBeInTheDocument();
    expect(screen.getByDisplayValue("User")).toBeInTheDocument();
    expect(screen.getByDisplayValue("admin@example.test")).toBeInTheDocument();
    expect(screen.getByText("User updated.")).toBeInTheDocument();
  });

  it("renders teacher picture preview when available", async () => {
    vi.mocked(getAdminUserById).mockResolvedValue({
      id: "teacher-1",
      name: "Teacher User",
      firstName: "Teacher",
      lastName: "User",
      email: "teacher@example.test",
      role: "TEACHER",
      isActive: true,
      image: "/images/instructors/teacher-1.jpg",
      phone: "",
      notes: "",
      bio: "",
      specialties: [],
      certifications: [],
      hireDate: null,
      marketingSubscriptionStatus: "NEVER_SUBSCRIBED",
      marketingSegmentIds: [],
    });

    render(
      await AdminUserEditPage({
        params: Promise.resolve({ id: "teacher-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const preview = screen.getByTestId("teacher-image-preview");
    expect(preview).toHaveAttribute("src", "/images/instructors/teacher-1.jpg");
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
      image: "",
      phone: "",
      notes: "",
      bio: "",
      specialties: [],
      certifications: [],
      hireDate: null,
      marketingSubscriptionStatus: "NEVER_SUBSCRIBED",
      marketingSegmentIds: [],
    });
    vi.mocked(listAdminMarketingSegmentOptions).mockResolvedValue([{ id: "seg-1", name: "VIP", isActive: true }]);
    vi.mocked(getAdminClientActivityData).mockResolvedValue({
      plansBought: [],
      classesBooked: 2,
      collectiveClassesBooked: 1,
      privateClassesBooked: 1,
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
    expect(screen.getByText("Collective: 1 · Private: 1")).toBeInTheDocument();

    const adjustForm = screen.getByTestId("client-credits-adjust-form");
    expect(within(adjustForm).getByDisplayValue("client-1")).toHaveAttribute("name", "userId");
    expect(within(adjustForm).getByDisplayValue("ent-1")).toHaveAttribute("name", "entitlementId");
    expect(within(adjustForm).getByRole("spinbutton", { name: "Credits Adjustment (+/-)" })).toHaveAttribute(
      "name",
      "creditDelta",
    );
    expect(within(adjustForm).getByRole("textbox", { name: "Audit reason" })).toHaveAttribute("name", "reason");

    const createForm = screen.getByTestId("client-credits-create-form");
    expect(within(createForm).getByDisplayValue("client-1")).toHaveAttribute("name", "userId");
    expect(within(createForm).getByRole("spinbutton", { name: "Add Credits" })).toHaveAttribute(
      "name",
      "creditDelta",
    );
    expect(within(createForm).getByRole("textbox", { name: "Audit reason" })).toHaveAttribute("name", "reason");
  });
  it("shows restricted master admin management UI to ADMIN users", async () => {
    vi.mocked(requireAdminSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    vi.mocked(getAdminUserById).mockResolvedValue({
      id: "master-1",
      name: "Master User",
      firstName: "Master",
      lastName: "User",
      email: "master@example.test",
      role: "MASTER_ADMIN",
      isActive: true,
      image: "",
      phone: "",
      notes: "",
      bio: "",
      specialties: [],
      certifications: [],
      hireDate: null,
      marketingSubscriptionStatus: "NEVER_SUBSCRIBED",
      marketingSegmentIds: [],
    });

    render(
      await AdminUserEditPage({
        params: Promise.resolve({ id: "master-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByText("Only MASTER_ADMIN can manage another MASTER_ADMIN.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update user" })).toBeDisabled();
  });

  it("hides MASTER_ADMIN option for ADMIN actor when editing non-master users", async () => {
    vi.mocked(requireAdminSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    vi.mocked(getAdminUserById).mockResolvedValue({
      id: "admin-target-1",
      name: "Admin Target",
      firstName: "Admin",
      lastName: "Target",
      email: "admin.target@example.test",
      role: "ADMIN",
      isActive: true,
      image: "",
      phone: "",
      notes: "",
      bio: "",
      specialties: [],
      certifications: [],
      hireDate: null,
      marketingSubscriptionStatus: "NEVER_SUBSCRIBED",
      marketingSegmentIds: [],
    });

    render(
      await AdminUserEditPage({
        params: Promise.resolve({ id: "admin-target-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.queryByRole("option", { name: "MASTER_ADMIN" })).not.toBeInTheDocument();
  });
});














