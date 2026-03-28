/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    redirect: redirectMock,
    usePathname: vi.fn(() => "/admin/dashboard"),
  };
});

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

import { auth } from "@/auth";
import AdminPrivateLayout from "../../src/app/admin/(private)/layout";

describe("/admin private layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users to /admin", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    await expect(
      AdminPrivateLayout({
        children: <div>Protected</div>,
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/admin");
  });

  it("redirects authenticated non-admin users to /admin?error=unauthorized", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "client-1",
        email: "client@example.test",
        role: "CLIENT",
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await expect(
      AdminPrivateLayout({
        children: <div>Protected</div>,
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/admin?error=unauthorized");
  });

  it("renders sidebar and content for admin users", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "admin-1",
        email: "admin@example.test",
        role: "ADMIN",
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    render(
      await AdminPrivateLayout({
        children: <div>Admin Content</div>,
      }),
    );

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bookings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Subscriptions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Classes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plans" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage Site" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Online Learning" })).toBeInTheDocument();
    const navOrder = screen
      .getAllByRole("link")
      .map((element) => element.textContent?.trim())
      .filter(Boolean);
    expect(navOrder).toEqual([
      "Dashboard",
      "Users",
      "Sessions",
      "Bookings",
      "Subscriptions",
      "Inbox",
      "Classes",
      "Plans",
      "Manage Site",
      "Online Learning",
    ]);
    expect(screen.getByText("Admin Content")).toBeInTheDocument();
    expect(screen.queryByText("Book a Class")).not.toBeInTheDocument();
  });
});
