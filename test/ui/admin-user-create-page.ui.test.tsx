/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/(private)/actions", () => ({
  createUserAction: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: vi.fn(),
}));

import { requireAdminSession } from "@/lib/auth/require-auth";
import AdminUserCreatePage from "../../src/app/admin/(private)/users/new/page";

describe("admin user create page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides MASTER_ADMIN option for ADMIN actor", async () => {
    vi.mocked(requireAdminSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    render(await AdminUserCreatePage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("option", { name: "MASTER_ADMIN" })).not.toBeInTheDocument();
  });

  it("shows MASTER_ADMIN option for MASTER_ADMIN actor", async () => {
    vi.mocked(requireAdminSession).mockResolvedValue({
      user: { id: "master-1", role: "MASTER_ADMIN" },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    render(await AdminUserCreatePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("option", { name: "MASTER_ADMIN" })).toBeInTheDocument();
  });
});
