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

vi.mock("@/lib/client-messages/client-message-service", () => ({
  getUnreadClientMessagesCount: vi.fn(async () => 0),
}));

import { usePathname } from "next/navigation";
import { auth } from "@/auth";
import { getUnreadClientMessagesCount } from "@/lib/client-messages/client-message-service";
import AdminPrivateLayout from "../../src/app/admin/(private)/layout";

describe("/admin private layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePathname).mockReturnValue("/admin/dashboard");
    vi.mocked(getUnreadClientMessagesCount).mockResolvedValue(0);
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

  it("renders grouped sidebar and content for admin users", async () => {
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
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveClass("bg-[#1d3652]");
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Booking+" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sales+" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Catalog+" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marketing+" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Online Learning" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage Site" })).toBeInTheDocument();
    expect(screen.getByText("Admin Content")).toBeInTheDocument();
    expect(screen.queryByText("Book a Class")).not.toBeInTheDocument();
  });

  it("auto-expands parent group when current path matches child route", async () => {
    vi.mocked(usePathname).mockReturnValue("/admin/subscriptions");
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

    expect(screen.getByRole("button", { name: "Sales-" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Orders" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Subscriptions" })).toBeInTheDocument();
  });

  it("auto-expands booking group for calendar deep links", async () => {
    vi.mocked(usePathname).mockReturnValue("/admin/sessions");
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

    expect(screen.getByRole("button", { name: "Booking-" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Calendar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Booking List" })).toBeInTheDocument();
  });
  it("hides inbox unread badge when unread count is 0", async () => {
    vi.mocked(getUnreadClientMessagesCount).mockResolvedValue(0);
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

    expect(screen.queryByLabelText(/Inbox unread/i)).not.toBeInTheDocument();
  });

  it("shows inbox unread badge when unread count is greater than 0", async () => {
    vi.mocked(getUnreadClientMessagesCount).mockResolvedValue(3);
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

    expect(screen.getByLabelText("Inbox unread 3")).toBeInTheDocument();
  });
});



