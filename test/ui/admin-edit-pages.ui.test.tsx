/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
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
}));

vi.mock("@/lib/admin/admin-service", () => ({
  getAdminUserById: vi.fn(),
}));

import { getAdminUserById } from "@/lib/admin/admin-service";

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

  it("renders edit form when user exists", async () => {
    vi.mocked(getAdminUserById).mockResolvedValue({
      id: "user-1",
      name: "Admin User",
      email: "admin@example.test",
      role: "ADMIN",
      isActive: true,
    });

    render(
      await AdminUserEditPage({
        params: Promise.resolve({ id: "user-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "Edit User" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Admin User")).toBeInTheDocument();
    expect(screen.getByDisplayValue("admin@example.test")).toBeInTheDocument();
  });
});
