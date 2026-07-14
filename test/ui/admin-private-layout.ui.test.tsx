/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  signOut: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireAdminSession: vi.fn(async () => {
    const [{ auth }, { redirect }] = await Promise.all([import("@/auth"), import("next/navigation")]);
    const session = await auth();

    if (!session?.user?.id) {
      redirect("/admin");
    }

    const role = session.user.role;
    if (role !== "ADMIN" && role !== "MASTER_ADMIN") {
      redirect("/admin?error=unauthorized");
    }

    return {
      ...session,
      user: {
        ...session.user,
        role,
      },
    };
  }),
}));

vi.mock("@/lib/client-messages/client-message-service", () => ({
  getUnreadClientMessagesCount: vi.fn(async () => 0),
}));

import { usePathname } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getUnreadClientMessagesCount } from "@/lib/client-messages/client-message-service";
import AdminPrivateLayout from "../../src/app/admin/(private)/layout";

describe("/admin private layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signOut).mockResolvedValue(undefined);
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

  it("redirects authenticated teacher users to /admin?error=unauthorized", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "teacher-1",
        email: "teacher@example.test",
        role: "TEACHER",
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
    const navList = screen.getByTestId("admin-nav-list");
    const logoutItem = screen.getByTestId("admin-nav-logout-item");
    const navItems = within(navList).getAllByRole("listitem");
    expect(navItems.at(-1)).toBe(logoutItem);
    expect(within(logoutItem).getByRole("button", { name: "Logout" })).toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(within(main).queryByRole("button", { name: "Logout" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveClass("bg-[#1d3652]");
    expect(screen.getByRole("button", { name: "People+" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule+" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sales+" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Catalog+" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Communications+" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Content+" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Communications+" }));
    expect(screen.getByRole("link", { name: "Client Messages" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Email Automations" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Content+" }));
    expect(screen.getByRole("link", { name: "Video Library" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Website Content" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Email Automations" }).compareDocumentPosition(screen.getByRole("link", { name: "Website Content" })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByRole("link", { name: "Website Content" }).compareDocumentPosition(screen.getByRole("link", { name: "Check-in Kiosk" })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("Admin Content")).toBeInTheDocument();
    expect(screen.queryByText("Book a Class")).not.toBeInTheDocument();
  });

  it("auto-expands users group for role routes", async () => {
    vi.mocked(usePathname).mockReturnValue("/admin/users/clients");
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

    expect(screen.getByRole("button", { name: "People-" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Staff" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Teachers" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clients" })).toBeInTheDocument();
  });

  it("auto-expands parent group when current path matches child route", async () => {
    vi.mocked(usePathname).mockReturnValue("/admin/sales/loyalty");
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
    expect(screen.getByRole("link", { name: "Memberships" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rewards" })).toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: "Schedule-" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Calendar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bookings" })).toBeInTheDocument();
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
    vi.mocked(usePathname).mockReturnValue("/admin/inbox");
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



